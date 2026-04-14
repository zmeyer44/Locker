import path from "path";
import { lookup as mimeLookup } from "mime-types";
import { and, eq, inArray } from "drizzle-orm";
import {
  blobLocations,
  fileBlobs,
  files,
  ingestTombstones,
  replicationRuns,
  stores,
  workspaces,
} from "@locker/database";
import type { Database } from "@locker/database";
import { getDb } from "@locker/database/client";
import { getStoreById, makeWebFileSourceResolver, getPrimaryStore } from "../storage";
import { createPendingFileUpload, markFileUploadReady } from "./file-records";
import { runFileReadyHooks } from "./lifecycle";
import { syncFileToStores, buildStoreTargetPath } from "@locker/jobs";
import type { ConflictStrategy } from "@locker/jobs";

// Re-export from @locker/jobs for callers that import from this file
export { syncWorkspaceStores, syncFileToStores, type FileSourceResolver, type ConflictStrategy } from "@locker/jobs";

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

export async function ingestFromReadOnlyStore(params: {
  storeId: string;
  triggeredByUserId?: string;
  clearTombstones?: boolean;
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

  if (params.clearTombstones) {
    await db
      .delete(ingestTombstones)
      .where(eq(ingestTombstones.storeId, store.id));
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

  const resolveFileSource = makeWebFileSourceResolver();
  let ingested = 0;
  let skipped = 0;

  for (const object of discovered) {
    if (existingPaths.has(object.path) || ignoredPaths.has(object.path)) {
      skipped += 1;
      continue;
    }

    const name = path.basename(object.path) || "imported-file";
    const mimeType = mimeLookup(name) || "application/octet-stream";
    const pending = await createPendingFileUpload({
      db,
      workspaceId: store.workspaceId,
      userId: params.triggeredByUserId ?? workspace.ownerId,
      folderId: null,
      fileName: name,
      mimeType,
      size: object.size,
      status: "uploading",
    });

    try {
      const sourceObject = await storage.download(object.path);
      await pending.storage.upload({
        path: pending.storagePath,
        data: sourceObject.data,
        contentType: mimeType,
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
        resolveFileSource,
        sourceStoreId: pending.storeId,
      });

      void runFileReadyHooks({
        db,
        workspaceId: store.workspaceId,
        userId: params.triggeredByUserId ?? workspace.ownerId,
        fileId: pending.fileId,
      }).catch(() => {});

      ingested += 1;
    } catch (err) {
      console.error(`[ingest] Failed to ingest "${object.path}":`, err);
      await db.transaction(async (tx) => {
        await tx
          .delete(blobLocations)
          .where(eq(blobLocations.blobId, pending.blobId));
        await tx.delete(files).where(eq(files.id, pending.fileId));
        await tx.delete(fileBlobs).where(eq(fileBlobs.id, pending.blobId));
      });
    }
  }

  await touchStoreSyncTime(db, [store.id]);
  return { ingested, skipped };
}

/**
 * Strip a store's prefix from a listed object path to get the display path.
 * For platform stores: strip rootPrefix + workspaceId.
 * For user stores: strip rootPrefix only.
 */
function stripStorePrefix(
  objectPath: string,
  rootPrefix: string,
  credentialSource: string,
  workspaceId: string,
): string {
  let display = objectPath;

  // Strip rootPrefix
  const normalizedPrefix = rootPrefix.replace(/^\/+|\/+$/g, "");
  if (normalizedPrefix && display.startsWith(normalizedPrefix + "/")) {
    display = display.slice(normalizedPrefix.length + 1);
  }

  // For platform stores, also strip the workspaceId prefix
  if (credentialSource === "platform" && display.startsWith(workspaceId + "/")) {
    display = display.slice(workspaceId.length + 1);
  }

  return display;
}

export async function pullFromStore(params: {
  storeId: string;
  conflictStrategy: ConflictStrategy;
  triggeredByUserId?: string;
  db?: Database;
}): Promise<{ runId: string }> {
  const db = getDatabase(params.db);
  const { store, storage } = await getStoreById(params.storeId);

  if (!storage.list) {
    throw new Error("This store does not support listing files");
  }

  const [workspace] = await db
    .select({ ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.id, store.workspaceId))
    .limit(1);

  if (!workspace) throw new Error("Workspace not found");

  const config = (store.config as Record<string, unknown> | null) ?? {};
  const rootPrefix =
    typeof config.rootPrefix === "string" ? config.rootPrefix : "";

  const tag = `[pull:${store.id.slice(0, 8)}]`;
  const discovered = await storage.list(rootPrefix);
  console.log(`${tag} Discovered ${discovered.length} file(s) in store`);

  // Create a replication run for progress tracking
  const [run] = await db
    .insert(replicationRuns)
    .values({
      workspaceId: store.workspaceId,
      kind: "manual_pull",
      status: "running",
      sourceStoreId: store.id,
      totalItems: discovered.length,
      triggeredByUserId: params.triggeredByUserId ?? null,
      startedAt: new Date(),
    })
    .returning({ id: replicationRuns.id });
  const runId = run!.id;

  // Load tombstones (files user previously deleted)
  const tombstones = await db
    .select({ externalPath: ingestTombstones.externalPath })
    .from(ingestTombstones)
    .where(eq(ingestTombstones.storeId, store.id));
  const ignoredPaths = new Set(tombstones.map((t) => t.externalPath));

  const userId = params.triggeredByUserId ?? workspace.ownerId;
  const resolveFileSource = makeWebFileSourceResolver();
  const primary = await getPrimaryStore(store.workspaceId);

  let pulled = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const object of discovered) {
    if (ignoredPaths.has(object.path)) {
      skipped += 1;
      continue;
    }

    // Skip store-test marker files
    if (object.path.includes(".locker-store-test-")) {
      skipped += 1;
      continue;
    }

    const displayPath = stripStorePrefix(
      object.path,
      rootPrefix,
      store.credentialSource,
      store.workspaceId,
    );

    if (!displayPath) {
      skipped += 1;
      continue;
    }

    // Check if a file with this display path already exists in the workspace
    const [existingBlob] = await db
      .select({
        id: fileBlobs.id,
        fileId: files.id,
        fileUpdatedAt: files.updatedAt,
        storagePath: files.storagePath,
      })
      .from(fileBlobs)
      .innerJoin(files, eq(files.blobId, fileBlobs.id))
      .where(
        and(
          eq(fileBlobs.workspaceId, store.workspaceId),
          eq(fileBlobs.objectKey, displayPath),
        ),
      )
      .limit(1);

    if (existingBlob) {
      // File exists — apply conflict strategy
      if (params.conflictStrategy === "skip") {
        skipped += 1;
        continue;
      }

      if (
        params.conflictStrategy === "keep_newer" &&
        object.lastModified <= existingBlob.fileUpdatedAt
      ) {
        skipped += 1;
        continue;
      }

      // Overwrite: re-download and update the existing file
      try {
        const sourceData = await storage.download(object.path);
        await primary.storage.upload({
          path: existingBlob.storagePath,
          data: sourceData.data,
          contentType: sourceData.contentType,
        });

        await db
          .update(fileBlobs)
          .set({ byteSize: object.size, updatedAt: new Date() })
          .where(eq(fileBlobs.id, existingBlob.id));

        await db
          .update(files)
          .set({ size: object.size, updatedAt: new Date() })
          .where(eq(files.id, existingBlob.fileId));

        await db
          .update(blobLocations)
          .set({ lastVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(blobLocations.blobId, existingBlob.id));

        updated += 1;
        console.log(`${tag} Updated "${displayPath}"`);
      } catch (err) {
        failed += 1;
        console.error(
          `${tag} Failed to update "${displayPath}":`,
          err instanceof Error ? err.message : err,
        );
      }
      continue;
    }

    // New file — import it
    const fileName = path.basename(displayPath) || "imported-file";
    const dirPath = path.dirname(displayPath);
    const mimeType = mimeLookup(fileName) || "application/octet-stream";

    // Resolve folder chain from the display path
    let folderId: string | null = null;
    if (dirPath && dirPath !== ".") {
      const { resolveOrCreateFolderChain } = await import("../s3/paths");
      folderId = await resolveOrCreateFolderChain(
        db,
        store.workspaceId,
        userId,
        dirPath.split("/").filter(Boolean),
      );
    }

    try {
      const pending = await createPendingFileUpload({
        db,
        workspaceId: store.workspaceId,
        userId,
        folderId,
        fileName,
        mimeType,
        size: object.size,
        status: "uploading",
      });

      const sourceData = await storage.download(object.path);
      await pending.storage.upload({
        path: pending.storagePath,
        data: sourceData.data,
        contentType: mimeType,
      });

      await markFileUploadReady({ db, fileId: pending.fileId });

      // Record blob location on the source store
      const sourceStoragePath = buildStoreTargetPath(
        store,
        store.workspaceId,
        pending.objectKey,
      );
      await db
        .insert(blobLocations)
        .values({
          blobId: pending.blobId,
          storeId: store.id,
          storagePath: sourceStoragePath,
          state: "available",
          origin: "ingested",
          lastVerifiedAt: object.lastModified,
        })
        .onConflictDoNothing();

      void runFileReadyHooks({
        db,
        workspaceId: store.workspaceId,
        userId,
        fileId: pending.fileId,
      }).catch(() => {});

      pulled += 1;
      console.log(`${tag} Imported "${displayPath}"`);
    } catch (err) {
      failed += 1;
      console.error(
        `${tag} Failed to import "${displayPath}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await db
    .update(replicationRuns)
    .set({
      status: failed > 0 ? "failed" : "completed",
      processedItems: pulled + updated + skipped,
      failedItems: failed,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(replicationRuns.id, runId));

  await touchStoreSyncTime(db, [store.id]);
  console.log(
    `${tag} Pull complete: ${pulled} imported, ${updated} updated, ${skipped} skipped, ${failed} failed`,
  );
  return { runId };
}
