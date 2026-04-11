import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@locker/database/client";
import {
  blobLocations,
  files,
  stores,
  storeSecrets,
  workspaceStorageSettings,
} from "@locker/database";
import {
  createStorage,
  createStorageFromConfig,
  type StorageProvider,
  type WorkspaceStorageConfig,
} from "@locker/storage";
import { decryptSecret, encryptSecret } from "./s3/auth";

type StoreRow = typeof stores.$inferSelect;

const providerNameMap = {
  s3: "s3",
  r2: "r2",
  vercel_blob: "vercel",
  local: "local",
} as const;

function getPlatformStoreProvider(): StoreRow["provider"] {
  switch (process.env.BLOB_STORAGE_PROVIDER) {
    case "s3":
      return "s3";
    case "r2":
      return "r2";
    case "vercel":
      return "vercel_blob";
    case "local":
    default:
      return "local";
  }
}

function getDefaultStoreName(provider: StoreRow["provider"]): string {
  switch (provider) {
    case "local":
      return "Local Storage";
    case "s3":
      return "Default S3";
    case "r2":
      return "Default R2";
    case "vercel_blob":
      return "Default Blob";
    default:
      return "Default Storage";
  }
}

function asConfigObject(
  value: Record<string, unknown> | null,
): Record<string, unknown> {
  return value ?? {};
}

function getConfigString(
  config: Record<string, unknown>,
  key: string,
): string | null {
  const value = config[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function buildStorageConfig(
  store: StoreRow,
  encryptedCredentials?: string | null,
): WorkspaceStorageConfig {
  const config = asConfigObject(store.config as Record<string, unknown> | null);
  const decryptedCredentials = encryptedCredentials
    ? JSON.parse(decryptSecret(encryptedCredentials))
    : undefined;

  return {
    provider: store.provider,
    bucket: getConfigString(config, "bucket"),
    region: getConfigString(config, "region"),
    endpoint: getConfigString(config, "endpoint"),
    accountId: getConfigString(config, "accountId"),
    publicUrl: getConfigString(config, "publicUrl"),
    baseDir: getConfigString(config, "baseDir"),
    credentials: decryptedCredentials,
  };
}

function normalizeObjectKey(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function joinStoragePath(prefix: string | null, objectKey: string): string {
  const normalizedPrefix = prefix?.replace(/^\/+|\/+$/g, "") ?? "";
  const normalizedObjectKey = normalizeObjectKey(objectKey);
  return normalizedPrefix
    ? `${normalizedPrefix}/${normalizedObjectKey}`
    : normalizedObjectKey;
}

export function buildStoragePathForStore(
  store: Pick<StoreRow, "config">,
  objectKey: string,
): string {
  const config = asConfigObject(store.config as Record<string, unknown> | null);
  return joinStoragePath(getConfigString(config, "rootPrefix"), objectKey);
}

async function hydrateStore(
  store: StoreRow,
): Promise<{ store: StoreRow; storage: StorageProvider }> {
  const db = getDb();
  const [secretRow] = await db
    .select({ encryptedCredentials: storeSecrets.encryptedCredentials })
    .from(storeSecrets)
    .where(eq(storeSecrets.storeId, store.id))
    .limit(1);

  return {
    store,
    storage:
      store.credentialSource === "platform"
        ? createStorageFromConfig(buildStorageConfig(store))
        : createStorageFromConfig(
            buildStorageConfig(store, secretRow?.encryptedCredentials ?? null),
          ),
  };
}

export interface WorkspaceStorageResult {
  storage: StorageProvider;
  store: StoreRow;
  storeId: string;
  providerName: string;
}

export async function getActiveStores(workspaceId: string): Promise<StoreRow[]> {
  const db = getDb();
  return db
    .select()
    .from(stores)
    .where(and(eq(stores.workspaceId, workspaceId), eq(stores.status, "active")))
    .orderBy(asc(stores.readPriority), asc(stores.createdAt));
}

export async function getStoreById(storeId: string): Promise<{
  store: StoreRow;
  storage: StorageProvider;
}> {
  const db = getDb();
  const [store] = await db
    .select()
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) {
    throw new Error("Store not found");
  }

  return hydrateStore(store);
}

export async function getPrimaryStore(workspaceId: string): Promise<{
  store: StoreRow;
  storage: StorageProvider;
}> {
  const db = getDb();
  let [settings] = await db
    .select({ primaryStoreId: workspaceStorageSettings.primaryStoreId })
    .from(workspaceStorageSettings)
    .where(eq(workspaceStorageSettings.workspaceId, workspaceId))
    .limit(1);

  if (!settings) {
    await createDefaultStoreForWorkspace({ workspaceId });
    [settings] = await db
      .select({ primaryStoreId: workspaceStorageSettings.primaryStoreId })
      .from(workspaceStorageSettings)
      .where(eq(workspaceStorageSettings.workspaceId, workspaceId))
      .limit(1);
  }

  if (!settings) {
    throw new Error("Workspace storage settings not found");
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
    providerName: providerNameMap[store.provider],
  };
}

async function getFileLocationContext(
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
    await db.insert(blobLocations).values({
      blobId: file.blobId,
      storeId: primary.store.id,
      storagePath: file.storagePath,
      state: "available",
      origin: "primary_upload",
      lastVerifiedAt: new Date(),
    });

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
    (location) => location.storagePath === file.storagePath,
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
  return store.credentialSource === "platform" && store.provider !== "local";
}

export async function shouldEnforceQuotaForFile(fileId: string): Promise<boolean> {
  const { store } = await getFileLocationContext(fileId);
  return store.credentialSource === "platform" && store.provider !== "local";
}

export async function createDefaultStoreForWorkspace(params: {
  workspaceId: string;
}): Promise<{ storeId: string }> {
  const db = getDb();
  const provider = getPlatformStoreProvider();
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

export async function saveStoreSecret(storeId: string, credentials: unknown) {
  const db = getDb();
  const encryptedCredentials = encryptSecret(JSON.stringify(credentials));
  const [existing] = await db
    .select({ storeId: storeSecrets.storeId })
    .from(storeSecrets)
    .where(eq(storeSecrets.storeId, storeId))
    .limit(1);

  if (existing) {
    await db
      .update(storeSecrets)
      .set({
        encryptedCredentials,
        updatedAt: new Date(),
      })
      .where(eq(storeSecrets.storeId, storeId));
    return;
  }

  await db.insert(storeSecrets).values({
    storeId,
    encryptedCredentials,
  });
}
