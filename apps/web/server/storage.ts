import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@locker/database/client";
import {
  blobLocations,
  files,
  stores,
  storeSecrets,
  workspaceStorageSettings,
} from "@locker/database";
import type { StorageProvider } from "@locker/storage";
import { encryptSecret } from "./s3/auth";
import { runtime } from "./runtime-context";
import {
  hydrateStore,
  getActiveStores as _getActiveStores,
  getStoreById as _getStoreById,
  buildStoragePathForStore as _buildStoragePathForStore,
  type StoreRow,
  type WorkspaceStorageResult as _WorkspaceStorageResult,
} from "@locker/jobs";
import type { FileSourceResolver } from "@locker/jobs";

// Re-export shared helpers so existing imports from this file continue to work
export const getActiveStores = _getActiveStores;
export const getStoreById = _getStoreById;
export const buildStoragePathForStore = _buildStoragePathForStore;
export type { StoreRow };
export type WorkspaceStorageResult = _WorkspaceStorageResult;

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

const providerNameMap = {
  s3: "s3",
  r2: "r2",
  vercel_blob: "vercel",
  local: "local",
} as const;

function getDefaultStoreName(_provider: StoreRow["provider"]): string {
  return "Locker Cloud";
}

export async function getPrimaryStore(workspaceId: string): Promise<{
  store: StoreRow;
  storage: StorageProvider;
}> {
  const db = getDb();
  const [settings] = await db
    .select({ primaryStoreId: workspaceStorageSettings.primaryStoreId })
    .from(workspaceStorageSettings)
    .where(eq(workspaceStorageSettings.workspaceId, workspaceId))
    .limit(1);

  if (!settings) {
    // Auto-create for workspaces that predate the explicit init path.
    // createDefaultStoreForWorkspace will fail-fast if the provider is
    // misconfigured, so this is safe — it won't silently create a broken store.
    await createDefaultStoreForWorkspace({ workspaceId });
    const [retried] = await db
      .select({ primaryStoreId: workspaceStorageSettings.primaryStoreId })
      .from(workspaceStorageSettings)
      .where(eq(workspaceStorageSettings.workspaceId, workspaceId))
      .limit(1);

    if (!retried) {
      throw new StorageConfigError(
        "Workspace storage is not initialized. Please contact your workspace administrator.",
      );
    }

    return getStoreById(retried.primaryStoreId);
  }

  return getStoreById(settings.primaryStoreId);
}

export async function createStorageForWorkspace(
  workspaceId: string,
): Promise<WorkspaceStorageResult> {
  const { store, storage } = await getPrimaryStore(workspaceId);
  return {
    storage,
    store,
    storeId: store.id,
    providerName: providerNameMap[store.provider as keyof typeof providerNameMap],
  };
}

export async function getFileLocationContext(
  fileId: string,
  preferredStoreId?: string,
): Promise<{
  fileId: string;
  blobId: string;
  storagePath: string;
  store: StoreRow;
  storage: StorageProvider;
}> {
  const db = getDb();
  const [file] = await db
    .select({
      id: files.id,
      workspaceId: files.workspaceId,
      blobId: files.blobId,
      storagePath: files.storagePath,
    })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1);

  if (!file) {
    throw new Error("File not found");
  }

  const locations = await db
    .select({
      storagePath: blobLocations.storagePath,
      state: blobLocations.state,
      store: stores,
    })
    .from(blobLocations)
    .innerJoin(stores, eq(blobLocations.storeId, stores.id))
    .where(eq(blobLocations.blobId, file.blobId))
    .orderBy(asc(stores.readPriority), asc(blobLocations.createdAt));

  if (locations.length === 0) {
    const primary = await getPrimaryStore(file.workspaceId);
    await db
      .insert(blobLocations)
      .values({
        blobId: file.blobId,
        storeId: primary.store.id,
        storagePath: file.storagePath,
        state: "available",
        origin: "primary_upload",
        lastVerifiedAt: new Date(),
      })
      .onConflictDoNothing();

    return {
      fileId: file.id,
      blobId: file.blobId,
      storagePath: file.storagePath,
      store: primary.store,
      storage: primary.storage,
    };
  }

  const preferredLocation = preferredStoreId
    ? locations.find((location) => location.store.id === preferredStoreId)
    : undefined;
  const exactPathLocation = locations.find(
    (location) =>
      location.storagePath === file.storagePath &&
      location.state !== "failed",
  );
  const availableLocation = locations.find(
    (location) => location.state === "available" || location.state === "pending",
  );
  const chosenLocation =
    preferredLocation ?? exactPathLocation ?? availableLocation ?? locations[0]!;

  const { storage } = await hydrateStore(chosenLocation.store);

  return {
    fileId: file.id,
    blobId: file.blobId,
    storagePath: chosenLocation.storagePath,
    store: chosenLocation.store,
    storage,
  };
}

export async function createStorageForFile(
  fileId: string,
  preferredStoreId?: string,
): Promise<StorageProvider> {
  const { storage } = await getFileLocationContext(fileId, preferredStoreId);
  return storage;
}

export async function getFileStoragePath(
  fileId: string,
  preferredStoreId?: string,
): Promise<string> {
  const { storagePath } = await getFileLocationContext(fileId, preferredStoreId);
  return storagePath;
}

export async function getFileStoreId(
  fileId: string,
  preferredStoreId?: string,
): Promise<string> {
  const { store } = await getFileLocationContext(fileId, preferredStoreId);
  return store.id;
}

export async function shouldEnforceQuota(workspaceId: string): Promise<boolean> {
  const { store } = await getPrimaryStore(workspaceId);
  if (store.credentialSource !== "platform") return false;
  if (!runtime.longRunningSupported) return true;
  return store.provider !== "local";
}

export async function shouldEnforceQuotaForFile(fileId: string): Promise<boolean> {
  const { store } = await getFileLocationContext(fileId);
  if (store.credentialSource !== "platform") return false;
  if (!runtime.longRunningSupported) return true;
  return store.provider !== "local";
}

export async function createDefaultStoreForWorkspace(params: {
  workspaceId: string;
}): Promise<{ storeId: string }> {
  const configured = runtime.configuredPlatformStorageProvider;
  if (!configured) {
    if (runtime.platformStorageProvider) {
      throw new StorageConfigError(
        `Storage provider "${runtime.platformStorageProvider}" is selected but not configured. Provide the required credentials for your chosen provider.`,
      );
    }
    throw new StorageConfigError(
      "No storage provider is configured. Set BLOB_STORAGE_PROVIDER and provide the required credentials.",
    );
  }

  const provider = configured;
  const db = getDb();
  const baseConfig: Record<string, unknown> = {};

  if (provider === "s3") {
    baseConfig.bucket = process.env.S3_BUCKET ?? "locker";
    baseConfig.region = process.env.AWS_REGION ?? "us-east-1";
  } else if (provider === "r2") {
    baseConfig.bucket = process.env.R2_BUCKET ?? "locker";
    baseConfig.publicUrl = process.env.R2_PUBLIC_URL ?? null;
  } else if (provider === "local") {
    baseConfig.baseDir = process.env.LOCAL_BLOB_DIR ?? "./local-blobs";
  }

  return db.transaction(async (tx) => {
    const [store] = await tx
      .insert(stores)
      .values({
        workspaceId: params.workspaceId,
        name: getDefaultStoreName(provider),
        provider,
        credentialSource: "platform",
        status: "active",
        writeMode: "write",
        ingestMode: "none",
        readPriority: 100,
        config: baseConfig,
      })
      .returning({ id: stores.id });

    await tx
      .insert(workspaceStorageSettings)
      .values({
        workspaceId: params.workspaceId,
        primaryStoreId: store!.id,
      })
      .onConflictDoNothing();

    return { storeId: store!.id };
  });
}

export function makeWebFileSourceResolver(): FileSourceResolver {
  return async (fileId, preferredStoreId) => {
    const ctx = await getFileLocationContext(fileId, preferredStoreId);
    return {
      storage: ctx.storage,
      storagePath: ctx.storagePath,
      storeId: ctx.store.id,
    };
  };
}

export async function saveStoreSecret(
  storeId: string,
  credentials: unknown,
  txDb?: Pick<ReturnType<typeof getDb>, "insert">,
) {
  const db = txDb ?? getDb();
  const encryptedCredentials = encryptSecret(JSON.stringify(credentials));
  await db
    .insert(storeSecrets)
    .values({ storeId, encryptedCredentials })
    .onConflictDoUpdate({
      target: storeSecrets.storeId,
      set: { encryptedCredentials, updatedAt: new Date() },
    });
}
