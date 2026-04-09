import { eq, and, isNull, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { folders, files, workspaces } from "@locker/database";
import type { Database } from "@locker/database";
import type { StorageProvider } from "@locker/storage";
import { invalidateWorkspaceVfsSnapshot } from "../vfs/locker-vfs";

// ---------------------------------------------------------------------------
// PluginStorage interface
// ---------------------------------------------------------------------------

export interface PluginStorage {
  /** Upload a file into this plugin's storage folder. */
  upload(params: {
    fileName: string;
    data: Buffer | ReadableStream;
    contentType: string;
    /** Optional subfolder within the plugin folder, e.g. "images". */
    subPath?: string;
  }): Promise<{ fileId: string; storagePath: string }>;

  /** Download a file previously stored by this plugin. */
  download(fileId: string): Promise<{
    data: ReadableStream;
    contentType: string;
    size: number;
  }>;

  /** Get a signed URL for a plugin-stored file. */
  getSignedUrl(fileId: string, expiresIn?: number): Promise<string>;

  /** Delete a plugin-stored file (removes from storage and DB). */
  delete(fileId: string): Promise<void>;

  /** List files stored by this plugin. */
  listFiles(subPath?: string): Promise<
    Array<{
      id: string;
      name: string;
      size: number;
      mimeType: string;
      createdAt: Date;
    }>
  >;
}

// ---------------------------------------------------------------------------
// Folder initialization (idempotent, cached)
// ---------------------------------------------------------------------------

interface FolderIds {
  rootFolderId: string;
  pluginFolderId: string;
}

const folderCache = new Map<string, Promise<FolderIds>>();

async function ensurePluginFolder(
  db: Database,
  workspaceId: string,
  userId: string,
  pluginSlug: string,
): Promise<FolderIds> {
  const cacheKey = `${workspaceId}:${pluginSlug}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async (): Promise<FolderIds> => {
    // Ensure .plugins root folder
    let [rootFolder] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(
        and(
          eq(folders.workspaceId, workspaceId),
          isNull(folders.parentId),
          eq(folders.name, ".plugins"),
        ),
      )
      .limit(1);

    if (!rootFolder) {
      [rootFolder] = await db
        .insert(folders)
        .values({
          workspaceId,
          userId,
          parentId: null,
          name: ".plugins",
        })
        .returning({ id: folders.id });
    }

    // Ensure plugin-specific subfolder
    let [pluginFolder] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(
        and(
          eq(folders.workspaceId, workspaceId),
          eq(folders.parentId, rootFolder.id),
          eq(folders.name, pluginSlug),
        ),
      )
      .limit(1);

    if (!pluginFolder) {
      [pluginFolder] = await db
        .insert(folders)
        .values({
          workspaceId,
          userId,
          parentId: rootFolder.id,
          name: pluginSlug,
        })
        .returning({ id: folders.id });
    }

    return {
      rootFolderId: rootFolder.id,
      pluginFolderId: pluginFolder.id,
    };
  })();

  // Cache the promise but evict on failure
  folderCache.set(cacheKey, promise);
  promise.catch(() => folderCache.delete(cacheKey));

  return promise;
}

/** Resolve or create a subfolder within the plugin folder. */
async function ensureSubFolder(
  db: Database,
  workspaceId: string,
  userId: string,
  parentId: string,
  name: string,
): Promise<string> {
  let [folder] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.workspaceId, workspaceId),
        eq(folders.parentId, parentId),
        eq(folders.name, name),
      ),
    )
    .limit(1);

  if (!folder) {
    [folder] = await db
      .insert(folders)
      .values({ workspaceId, userId, parentId, name })
      .returning({ id: folders.id });
  }

  return folder.id;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPluginStorage(params: {
  db: Database;
  storage: StorageProvider;
  workspaceId: string;
  userId: string;
  pluginSlug: string;
  storageConfigId: string | null;
  providerName: string;
}): PluginStorage {
  const { db, storage, workspaceId, userId, pluginSlug, storageConfigId, providerName } =
    params;

  async function resolveFolderId(subPath?: string): Promise<string> {
    const { pluginFolderId } = await ensurePluginFolder(
      db,
      workspaceId,
      userId,
      pluginSlug,
    );

    if (!subPath) return pluginFolderId;

    // Walk or create nested subfolders (e.g. "images/chat")
    let currentId = pluginFolderId;
    for (const segment of subPath.split("/").filter(Boolean)) {
      currentId = await ensureSubFolder(
        db,
        workspaceId,
        userId,
        currentId,
        segment,
      );
    }
    return currentId;
  }

  return {
    async upload(uploadParams) {
      const folderId = await resolveFolderId(uploadParams.subPath);
      const fileId = crypto.randomUUID();
      const storagePath = `${workspaceId}/${fileId}/${uploadParams.fileName}`;

      // Upload to storage backend
      await storage.upload({
        path: storagePath,
        data:
          uploadParams.data instanceof Buffer
            ? uploadParams.data
            : uploadParams.data,
        contentType: uploadParams.contentType,
      });

      // Compute size for DB entry
      const size =
        uploadParams.data instanceof Buffer ? uploadParams.data.byteLength : 0;

      // Create file record
      await db.insert(files).values({
        id: fileId,
        workspaceId,
        userId,
        folderId,
        name: uploadParams.fileName,
        mimeType: uploadParams.contentType,
        size,
        storagePath,
        storageProvider: providerName,
        storageConfigId,
        status: "ready",
      });

      // Update workspace storage usage
      if (size > 0) {
        await db
          .update(workspaces)
          .set({
            storageUsed: sql`${workspaces.storageUsed} + ${size}`,
          })
          .where(eq(workspaces.id, workspaceId));
      }

      invalidateWorkspaceVfsSnapshot(workspaceId);

      return { fileId, storagePath };
    },

    async download(fileId) {
      const [file] = await db
        .select({
          storagePath: files.storagePath,
          storageConfigId: files.storageConfigId,
        })
        .from(files)
        .where(
          and(eq(files.id, fileId), eq(files.workspaceId, workspaceId)),
        )
        .limit(1);

      if (!file) throw new Error("File not found");

      return storage.download(file.storagePath);
    },

    async getSignedUrl(fileId, expiresIn) {
      const [file] = await db
        .select({ storagePath: files.storagePath })
        .from(files)
        .where(
          and(eq(files.id, fileId), eq(files.workspaceId, workspaceId)),
        )
        .limit(1);

      if (!file) throw new Error("File not found");

      return storage.getSignedUrl(file.storagePath, expiresIn);
    },

    async delete(fileId) {
      const [file] = await db
        .select({
          storagePath: files.storagePath,
          size: files.size,
        })
        .from(files)
        .where(
          and(eq(files.id, fileId), eq(files.workspaceId, workspaceId)),
        )
        .limit(1);

      if (!file) return;

      // Delete from storage
      try {
        await storage.delete(file.storagePath);
      } catch {
        // Storage deletion is best-effort
      }

      // Delete DB record
      await db.delete(files).where(eq(files.id, fileId));

      // Decrement workspace storage usage
      if (file.size > 0) {
        await db
          .update(workspaces)
          .set({
            storageUsed: sql`GREATEST(${workspaces.storageUsed} - ${file.size}, 0)`,
          })
          .where(eq(workspaces.id, workspaceId));
      }

      invalidateWorkspaceVfsSnapshot(workspaceId);
    },

    async listFiles(subPath) {
      const folderId = await resolveFolderId(subPath);

      return db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
          createdAt: files.createdAt,
        })
        .from(files)
        .where(
          and(
            eq(files.workspaceId, workspaceId),
            eq(files.folderId, folderId),
          ),
        );
    },
  };
}

// ---------------------------------------------------------------------------
// Cleanup (for plugin uninstall)
// ---------------------------------------------------------------------------

export async function cleanupPluginStorage(params: {
  db: Database;
  storage: StorageProvider;
  workspaceId: string;
  pluginSlug: string;
}): Promise<void> {
  const { db, storage, workspaceId, pluginSlug } = params;

  // Find the .plugins root folder
  const [rootFolder] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.workspaceId, workspaceId),
        isNull(folders.parentId),
        eq(folders.name, ".plugins"),
      ),
    )
    .limit(1);

  if (!rootFolder) return;

  // Find the plugin subfolder
  const [pluginFolder] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.workspaceId, workspaceId),
        eq(folders.parentId, rootFolder.id),
        eq(folders.name, pluginSlug),
      ),
    )
    .limit(1);

  if (!pluginFolder) return;

  // Collect all folder IDs (plugin folder + any nested subfolders)
  const allFolderIds = [pluginFolder.id];
  let frontier = [pluginFolder.id];
  while (frontier.length > 0) {
    const children = await db
      .select({ id: folders.id })
      .from(folders)
      .where(inArray(folders.parentId, frontier));
    const childIds = children.map((f) => f.id);
    allFolderIds.push(...childIds);
    frontier = childIds;
  }

  // Find all files in these folders
  const pluginFiles = await db
    .select({
      id: files.id,
      storagePath: files.storagePath,
      size: files.size,
    })
    .from(files)
    .where(inArray(files.folderId, allFolderIds));

  // Delete files from storage (best-effort)
  let totalSize = 0;
  for (const file of pluginFiles) {
    totalSize += Number(file.size);
    try {
      await storage.delete(file.storagePath);
    } catch {
      // best-effort
    }
  }

  // Delete file records
  if (pluginFiles.length > 0) {
    await db
      .delete(files)
      .where(
        inArray(
          files.id,
          pluginFiles.map((f) => f.id),
        ),
      );
  }

  // Delete folder records (children first, then plugin folder)
  for (const folderId of allFolderIds.reverse()) {
    await db.delete(folders).where(eq(folders.id, folderId));
  }

  // Adjust workspace storage
  if (totalSize > 0) {
    await db
      .update(workspaces)
      .set({
        storageUsed: sql`GREATEST(${workspaces.storageUsed} - ${totalSize}, 0)`,
      })
      .where(eq(workspaces.id, workspaceId));
  }

  // Evict cache
  folderCache.delete(`${workspaceId}:${pluginSlug}`);

  invalidateWorkspaceVfsSnapshot(workspaceId);
}
