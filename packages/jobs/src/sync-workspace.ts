import { and, eq, inArray } from "drizzle-orm";
import {
  blobLocations,
  fileBlobs,
  files,
  replicationRunItems,
  replicationRuns,
  stores,
} from "@locker/database";
import type { Database } from "@locker/database";
import { getDb } from "@locker/database/client";
import type { StorageProvider } from "@locker/storage";
import { buildStoragePathForStore, getActiveStores, getStoreById } from "./store-utils";

export type FileSourceResolver = (
  fileId: string,
  preferredStoreId?: string,
) => Promise<{
  storage: StorageProvider;
  storagePath: string;
  storeId: string;
}>;

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
  resolveFileSource: FileSourceResolver;
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

  const source = await params.resolveFileSource(
    file.id,
    params.sourceStoreId,
  );

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const touchedStoreIds = new Set<string>([source.storeId]);

  for (const targetStore of writableTargets) {
    const existing = locations.find(
      (location) => location.storeId === targetStore.id,
    );
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
        sourceStoreId: source.storeId,
        targetStoreId: targetStore.id,
        status: "skipped",
      });
      continue;
    }

    await upsertRunItem({
      db,
      runId: params.runId,
      blobId: file.blobId,
      sourceStoreId: source.storeId,
      targetStoreId: targetStore.id,
      status: "running",
    });

    try {
      const { storage: targetStorage } = await getStoreById(targetStore.id);
      const { data, contentType } = await source.storage.download(
        source.storagePath,
      );
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
        sourceStoreId: source.storeId,
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
              error instanceof Error
                ? error.message
                : "Sync failed unexpectedly",
            updatedAt: new Date(),
          },
        });

      await upsertRunItem({
        db,
        runId: params.runId,
        blobId: file.blobId,
        sourceStoreId: source.storeId,
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
  resolveFileSource: FileSourceResolver;
  targetStoreId?: string;
  triggeredByUserId?: string;
  kind?: SyncRunKind;
  runId?: string;
  db?: Database;
}): Promise<{ runId: string }> {
  const db = getDatabase(params.db);
  let runId: string;

  const workspaceFiles = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.workspaceId, params.workspaceId),
        eq(files.status, "ready"),
      ),
    );

  if (params.runId) {
    await db
      .update(replicationRuns)
      .set({
        status: "running",
        totalItems: workspaceFiles.length,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(replicationRuns.id, params.runId));
    runId = params.runId;
  } else {
    const [run] = await db
      .insert(replicationRuns)
      .values({
        workspaceId: params.workspaceId,
        kind: params.kind ?? "manual_sync",
        status: "running",
        totalItems: workspaceFiles.length,
        targetStoreId: params.targetStoreId ?? null,
        triggeredByUserId: params.triggeredByUserId ?? null,
        startedAt: new Date(),
      })
      .returning({ id: replicationRuns.id });
    runId = run!.id;
  }

  let processed = 0;
  let failed = 0;

  try {

    await runWithConcurrency(workspaceFiles, 3, async (file) => {
      const result = await syncFileToStores({
        db,
        fileId: file.id,
        resolveFileSource: params.resolveFileSource,
        targetStoreId: params.targetStoreId,
        runId,
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
        .where(eq(replicationRuns.id, runId));
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
      .where(eq(replicationRuns.id, runId));
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
      .where(eq(replicationRuns.id, runId));
  }

  return { runId };
}
