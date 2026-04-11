import path from "path";
import { and, eq, inArray } from "drizzle-orm";
import {
  blobLocations,
  fileBlobs,
  files,
  ingestTombstones,
  replicationRunItems,
  replicationRuns,
  stores,
  workspaces,
} from "@locker/database";
import type { Database } from "@locker/database";
import { getDb } from "@locker/database/client";
import {
  buildStoragePathForStore,
  createStorageForFile,
  getActiveStores,
  getFileStoragePath,
  getFileStoreId,
  getStoreById,
} from "../storage";
import { createPendingFileUpload, markFileUploadReady } from "./file-records";

type SyncRunKind = typeof replicationRuns.$inferInsert.kind;

function getDatabase(db?: Database): Database {
  return db ?? getDb();
}

async function touchStoreSyncTime(db: Database, storeIds: string[]) {
  if (storeIds.length === 0) return;
  await db
    .update(stores)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(inArray(stores.id, storeIds));
}

async function upsertRunItem(params: {
  db: Database;
  runId?: string;
  blobId: string;
  sourceStoreId?: string | null;
  targetStoreId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  errorMessage?: string | null;
}) {
  if (!params.runId) return;

  await params.db
    .insert(replicationRunItems)
    .values({
      runId: params.runId,
      blobId: params.blobId,
      sourceStoreId: params.sourceStoreId ?? null,
      targetStoreId: params.targetStoreId,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
      startedAt: params.status === "running" ? new Date() : null,
      completedAt:
        params.status === "completed" ||
        params.status === "failed" ||
        params.status === "skipped"
          ? new Date()
          : null,
    })
    .onConflictDoUpdate({
      target: [
        replicationRunItems.runId,
        replicationRunItems.blobId,
        replicationRunItems.targetStoreId,
      ],
      set: {
        status: params.status,
        errorMessage: params.errorMessage ?? null,
        startedAt: params.status === "running" ? new Date() : undefined,
        completedAt:
          params.status === "completed" ||
          params.status === "failed" ||
          params.status === "skipped"
            ? new Date()
            : undefined,
      },
    });
}

export async function syncFileToStores(params: {
  fileId: string;
  sourceStoreId?: string;
  targetStoreId?: string;
  runId?: string;
  db?: Database;
}): Promise<{ synced: number; failed: number; skipped: number }> {
  const db = getDatabase(params.db);

  const [file] = await db
    .select({
      id: files.id,
      workspaceId: files.workspaceId,
      blobId: files.blobId,
      status: files.status,
      objectKey: fileBlobs.objectKey,
    })
    .from(files)
    .innerJoin(fileBlobs, eq(files.blobId, fileBlobs.id))
    .where(eq(files.id, params.fileId))
    .limit(1);

  if (!file || file.status !== "ready") {
    return { synced: 0, failed: 0, skipped: 0 };
  }

  const workspaceStores = await getActiveStores(file.workspaceId);
  const writableTargets = workspaceStores.filter(
    (store) =>
      store.writeMode === "write" &&
      store.id !== params.sourceStoreId &&
      (!params.targetStoreId || store.id === params.targetStoreId),
  );

  if (writableTargets.length === 0) {
    return { synced: 0, failed: 0, skipped: 0 };
  }

  const locations = await db
    .select({
      id: blobLocations.id,
      storeId: blobLocations.storeId,
      storagePath: blobLocations.storagePath,
      state: blobLocations.state,
    })
    .from(blobLocations)
    .where(eq(blobLocations.blobId, file.blobId));

  const sourceStoreId = params.sourceStoreId ?? (await getFileStoreId(file.id));
  const sourceStorage = await createStorageForFile(file.id, sourceStoreId);
  const sourcePath = await getFileStoragePath(file.id, sourceStoreId);

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const touchedStoreIds = new Set<string>([sourceStoreId]);

  for (const targetStore of writableTargets) {
    const existing = locations.find((location) => location.storeId === targetStore.id);
    const targetPath = buildStoragePathForStore(targetStore, file.objectKey);

    if (
      existing &&
      existing.state === "available" &&
      existing.storagePath === targetPath
    ) {
      skipped += 1;
      await upsertRunItem({
        db,
        runId: params.runId,
        blobId: file.blobId,
        sourceStoreId,
        targetStoreId: targetStore.id,
        status: "skipped",
      });
      continue;
    }

    await upsertRunItem({
      db,
      runId: params.runId,
      blobId: file.blobId,
      sourceStoreId,
      targetStoreId: targetStore.id,
      status: "running",
    });

    try {
      const { storage: targetStorage } = await getStoreById(targetStore.id);
      const { data, contentType } = await sourceStorage.download(sourcePath);
      await targetStorage.upload({
        path: targetPath,
        data,
        contentType,
      });

      await db
        .insert(blobLocations)
        .values({
          blobId: file.blobId,
          storeId: targetStore.id,
          storagePath: targetPath,
          state: "available",
          origin: "replicated",
          lastVerifiedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [blobLocations.blobId, blobLocations.storeId],
          set: {
            storagePath: targetPath,
            state: "available",
            lastError: null,
            lastVerifiedAt: new Date(),
            updatedAt: new Date(),
          },
        });

      touchedStoreIds.add(targetStore.id);
      synced += 1;
      await upsertRunItem({
        db,
        runId: params.runId,
        blobId: file.blobId,
        sourceStoreId,
        targetStoreId: targetStore.id,
        status: "completed",
      });
    } catch (error) {
      failed += 1;
      await db
        .insert(blobLocations)
        .values({
          blobId: file.blobId,
          storeId: targetStore.id,
          storagePath: targetPath,
          state: "failed",
          origin: "replicated",
          lastError:
            error instanceof Error ? error.message : "Sync failed unexpectedly",
        })
        .onConflictDoUpdate({
          target: [blobLocations.blobId, blobLocations.storeId],
          set: {
            storagePath: targetPath,
            state: "failed",
            lastError:
              error instanceof Error ? error.message : "Sync failed unexpectedly",
            updatedAt: new Date(),
          },
        });

      await upsertRunItem({
        db,
        runId: params.runId,
        blobId: file.blobId,
        sourceStoreId,
        targetStoreId: targetStore.id,
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Sync failed unexpectedly",
      });
    }
  }

  await touchStoreSyncTime(db, [...touchedStoreIds]);
  return { synced, failed, skipped };
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

export async function syncWorkspaceStores(params: {
  workspaceId: string;
  targetStoreId?: string;
  triggeredByUserId?: string;
  kind?: SyncRunKind;
  db?: Database;
}): Promise<{ runId: string }> {
  const db = getDatabase(params.db);
  const [run] = await db
    .insert(replicationRuns)
    .values({
      workspaceId: params.workspaceId,
      kind: params.kind ?? "manual_sync",
      status: "running",
      targetStoreId: params.targetStoreId ?? null,
      triggeredByUserId: params.triggeredByUserId ?? null,
      startedAt: new Date(),
    })
    .returning({ id: replicationRuns.id });

  const workspaceFiles = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.workspaceId, params.workspaceId), eq(files.status, "ready")));

  let processed = 0;
  let failed = 0;

  try {
    await db
      .update(replicationRuns)
      .set({
        totalItems: workspaceFiles.length,
        updatedAt: new Date(),
      })
      .where(eq(replicationRuns.id, run!.id));

    await runWithConcurrency(workspaceFiles, 3, async (file) => {
      const result = await syncFileToStores({
        db,
        fileId: file.id,
        targetStoreId: params.targetStoreId,
        runId: run!.id,
      });
      processed += 1;
      if (result.failed > 0) failed += 1;

      await db
        .update(replicationRuns)
        .set({
          processedItems: processed,
          failedItems: failed,
          updatedAt: new Date(),
        })
        .where(eq(replicationRuns.id, run!.id));
    });

    await db
      .update(replicationRuns)
      .set({
        status: failed > 0 ? "failed" : "completed",
        processedItems: processed,
        failedItems: failed,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(replicationRuns.id, run!.id));
  } catch (error) {
    await db
      .update(replicationRuns)
      .set({
        status: "failed",
        processedItems: processed,
        failedItems: failed + 1,
        errorMessage:
          error instanceof Error ? error.message : "Workspace sync failed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(replicationRuns.id, run!.id));
  }

  return { runId: run!.id };
}

export async function ingestFromReadOnlyStore(params: {
  storeId: string;
  triggeredByUserId?: string;
  db?: Database;
}): Promise<{ ingested: number; skipped: number }> {
  const db = getDatabase(params.db);
  const { store, storage } = await getStoreById(params.storeId);

  if (store.writeMode !== "read_only" || store.ingestMode !== "scan") {
    throw new Error("Store is not configured for read-only ingest");
  }

  if (!storage.list) {
    throw new Error("Selected store does not support listing objects");
  }

  const [workspace] = await db
    .select({ ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.id, store.workspaceId))
    .limit(1);

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  const config = (store.config as Record<string, unknown> | null) ?? {};
  const rootPrefix =
    typeof config.rootPrefix === "string" ? config.rootPrefix : "";
  const discovered = await storage.list(rootPrefix);

  const existingLocations = await db
    .select({ storagePath: blobLocations.storagePath })
    .from(blobLocations)
    .where(eq(blobLocations.storeId, store.id));
  const existingPaths = new Set(existingLocations.map((location) => location.storagePath));

  const tombstones = await db
    .select({ externalPath: ingestTombstones.externalPath })
    .from(ingestTombstones)
    .where(eq(ingestTombstones.storeId, store.id));
  const ignoredPaths = new Set(tombstones.map((item) => item.externalPath));

  let ingested = 0;
  let skipped = 0;

  for (const object of discovered) {
    if (existingPaths.has(object.path) || ignoredPaths.has(object.path)) {
      skipped += 1;
      continue;
    }

    const name = path.basename(object.path) || "imported-file";
    const pending = await createPendingFileUpload({
      db,
      workspaceId: store.workspaceId,
      userId: params.triggeredByUserId ?? workspace.ownerId,
      folderId: null,
      fileName: name,
      mimeType: "application/octet-stream",
      size: object.size,
      status: "uploading",
    });

    try {
      const sourceObject = await storage.download(object.path);
      await pending.storage.upload({
        path: pending.storagePath,
        data: sourceObject.data,
        contentType: sourceObject.contentType,
      });

      await markFileUploadReady({ db, fileId: pending.fileId });

      await db
        .insert(blobLocations)
        .values({
          blobId: pending.blobId,
          storeId: store.id,
          storagePath: object.path,
          state: "available",
          origin: "ingested",
          lastVerifiedAt: object.lastModified,
        })
        .onConflictDoNothing();

      await syncFileToStores({
        db,
        fileId: pending.fileId,
        sourceStoreId: pending.storeId,
      });
      ingested += 1;
    } catch {
      await db
        .update(fileBlobs)
        .set({
          state: "failed",
          updatedAt: new Date(),
        })
        .where(eq(fileBlobs.id, pending.blobId));
      await db
        .update(files)
        .set({
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(files.id, pending.fileId));
    }
  }

  await touchStoreSyncTime(db, [store.id]);
  return { ingested, skipped };
}
