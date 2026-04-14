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
import { buildStoragePathForStore, getActiveStores, getStoreById, type StoreRow } from "./store-utils";
import { buildFolderPath, buildStoreTargetPath, isLegacyObjectKey } from "./path-builder";

export type ConflictStrategy = "skip" | "keep_newer" | "overwrite";

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

async function computeTargetPath(
  db: Database,
  targetStore: Pick<StoreRow, "config" | "credentialSource">,
  file: {
    workspaceId: string;
    objectKey: string;
    name: string;
    folderId: string | null;
  },
): Promise<string> {
  if (isLegacyObjectKey(file.objectKey)) {
    if (targetStore.credentialSource === "platform") {
      // Legacy file on the platform store — keep existing path
      return buildStoragePathForStore(targetStore, file.objectKey);
    }
    // Legacy file → user store: compute human-readable path from metadata
    const displayPath = await buildFolderPath(db, file.workspaceId, {
      name: file.name,
      folderId: file.folderId,
    });
    return buildStoreTargetPath(targetStore, file.workspaceId, displayPath);
  }

  // New-format objectKey is already a display path
  return buildStoreTargetPath(targetStore, file.workspaceId, file.objectKey);
}

export async function syncFileToStores(params: {
  fileId: string;
  resolveFileSource: FileSourceResolver;
  sourceStoreId?: string;
  targetStoreId?: string;
  conflictStrategy?: ConflictStrategy;
  runId?: string;
  db?: Database;
}): Promise<{ synced: number; failed: number; skipped: number }> {
  const db = getDatabase(params.db);
  const tag = `[sync:file:${params.fileId.slice(0, 8)}]`;

  const [file] = await db
    .select({
      id: files.id,
      workspaceId: files.workspaceId,
      blobId: files.blobId,
      status: files.status,
      name: files.name,
      folderId: files.folderId,
      updatedAt: files.updatedAt,
      objectKey: fileBlobs.objectKey,
    })
    .from(files)
    .innerJoin(fileBlobs, eq(files.blobId, fileBlobs.id))
    .where(eq(files.id, params.fileId))
    .limit(1);

  if (!file) {
    console.warn(`${tag} File not found, skipping`);
    return { synced: 0, failed: 0, skipped: 0 };
  }
  if (file.status !== "ready") {
    console.warn(`${tag} File status is "${file.status}", skipping`);
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
    console.warn(
      `${tag} No writable targets (${workspaceStores.length} stores total, sourceStoreId=${params.sourceStoreId ?? "none"}, targetStoreId=${params.targetStoreId ?? "any"})`,
    );
    return { synced: 0, failed: 0, skipped: 0 };
  }

  const locations = await db
    .select({
      id: blobLocations.id,
      storeId: blobLocations.storeId,
      storagePath: blobLocations.storagePath,
      state: blobLocations.state,
      updatedAt: blobLocations.updatedAt,
    })
    .from(blobLocations)
    .where(eq(blobLocations.blobId, file.blobId));

  let source: Awaited<ReturnType<FileSourceResolver>>;
  try {
    source = await params.resolveFileSource(
      file.id,
      params.sourceStoreId,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `${tag} Failed to resolve file source (objectKey=${file.objectKey}): ${msg}`,
    );
    // Record failure for every target so the run counts are accurate
    for (const targetStore of writableTargets) {
      const targetPath = await computeTargetPath(db, targetStore, file);
      await upsertRunItem({
        db,
        runId: params.runId,
        blobId: file.blobId,
        sourceStoreId: null,
        targetStoreId: targetStore.id,
        status: "failed",
        errorMessage: `Source resolution failed: ${msg}`,
      });
      await db
        .insert(blobLocations)
        .values({
          blobId: file.blobId,
          storeId: targetStore.id,
          storagePath: targetPath,
          state: "failed",
          origin: "replicated",
          lastError: `Source resolution failed: ${msg}`,
        })
        .onConflictDoUpdate({
          target: [blobLocations.blobId, blobLocations.storeId],
          set: {
            state: "failed",
            lastError: `Source resolution failed: ${msg}`,
            updatedAt: new Date(),
          },
        });
    }
    return { synced: 0, failed: writableTargets.length, skipped: 0 };
  }

  console.log(
    `${tag} Syncing objectKey="${file.objectKey}" from store ${source.storeId.slice(0, 8)} → ${writableTargets.length} target(s)`,
  );

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const touchedStoreIds = new Set<string>([source.storeId]);

  for (const targetStore of writableTargets) {
    const existing = locations.find(
      (location) => location.storeId === targetStore.id,
    );
    const targetPath = await computeTargetPath(db, targetStore, file);

    const strategy = params.conflictStrategy ?? "skip";

    if (
      existing &&
      existing.state === "available" &&
      existing.storagePath === targetPath
    ) {
      const shouldSkip =
        strategy === "skip" ||
        (strategy === "keep_newer" &&
          file.updatedAt <= (existing.updatedAt ?? new Date(0)));

      if (shouldSkip) {
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
      console.log(
        `${tag} Downloading from source path="${source.storagePath}"`,
      );
      const { data, contentType } = await source.storage.download(
        source.storagePath,
      );
      console.log(
        `${tag} Uploading to ${targetStore.provider} store ${targetStore.id.slice(0, 8)} path="${targetPath}"`,
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
      console.log(`${tag} ✓ Synced to store ${targetStore.id.slice(0, 8)}`);
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
      const msg =
        error instanceof Error ? error.message : "Sync failed unexpectedly";
      const stack = error instanceof Error ? error.stack : undefined;
      console.error(
        `${tag} ✗ Failed to sync to ${targetStore.provider} store ${targetStore.id.slice(0, 8)}: ${msg}`,
      );
      if (stack) {
        console.error(`${tag}   ${stack.split("\n").slice(1, 4).join("\n  ")}`);
      }
      await db
        .insert(blobLocations)
        .values({
          blobId: file.blobId,
          storeId: targetStore.id,
          storagePath: targetPath,
          state: "failed",
          origin: "replicated",
          lastError: msg,
        })
        .onConflictDoUpdate({
          target: [blobLocations.blobId, blobLocations.storeId],
          set: {
            storagePath: targetPath,
            state: "failed",
            lastError: msg,
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
        errorMessage: msg,
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
  conflictStrategy?: ConflictStrategy;
  kind?: SyncRunKind;
  runId?: string;
  db?: Database;
}): Promise<{ runId: string }> {
  const db = getDatabase(params.db);
  let runId: string;
  const wsTag = `[sync:workspace:${params.workspaceId.slice(0, 8)}]`;

  const workspaceFiles = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.workspaceId, params.workspaceId),
        eq(files.status, "ready"),
      ),
    );

  console.log(
    `${wsTag} Starting sync: ${workspaceFiles.length} file(s), targetStoreId=${params.targetStoreId ?? "all"}`,
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

  console.log(`${wsTag} Run ${runId.slice(0, 8)} created`);

  let processed = 0;
  let failed = 0;

  try {
    await runWithConcurrency(workspaceFiles, 3, async (file) => {
      const result = await syncFileToStores({
        db,
        fileId: file.id,
        resolveFileSource: params.resolveFileSource,
        targetStoreId: params.targetStoreId,
        conflictStrategy: params.conflictStrategy,
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

    const finalStatus = failed > 0 ? "failed" : "completed";
    console.log(
      `${wsTag} Run ${runId.slice(0, 8)} finished: ${finalStatus} (processed=${processed}, failed=${failed})`,
    );

    await db
      .update(replicationRuns)
      .set({
        status: finalStatus,
        processedItems: processed,
        failedItems: failed,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(replicationRuns.id, runId));
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Workspace sync failed";
    console.error(
      `${wsTag} Run ${runId.slice(0, 8)} crashed after ${processed} files: ${msg}`,
    );
    if (error instanceof Error && error.stack) {
      console.error(
        `${wsTag}   ${error.stack.split("\n").slice(1, 5).join("\n  ")}`,
      );
    }

    await db
      .update(replicationRuns)
      .set({
        status: "failed",
        processedItems: processed,
        failedItems: failed + 1,
        errorMessage: msg,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(replicationRuns.id, runId));
  }

  return { runId };
}
