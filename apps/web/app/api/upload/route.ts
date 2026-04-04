import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../server/auth";
import { headers } from "next/headers";
import { getDb } from "@locker/database/client";
import { files, folders, workspaces, workspaceMembers } from "@locker/database";
import {
  createStorageForWorkspace,
  createStorageForFile,
  shouldEnforceQuota,
  shouldEnforceQuotaForConfig,
} from "../../../server/storage";
import { MAX_FILE_SIZE } from "@locker/common";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  qmdClient,
  streamToString,
} from "../../../server/plugins/handlers/qmd-client";
import { ftsClient } from "../../../server/plugins/handlers/fts-client";
import { resolvePluginEndpoint } from "../../../server/plugins/resolve-endpoint";
import { invalidateWorkspaceVfsSnapshot } from "../../../server/vfs/locker-vfs";
import {
  isTextIndexable,
  transcribeFile,
} from "../../../server/plugins/transcription";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const folderId = formData.get("folderId") as string | null;
  const existingFileId = formData.get("fileId") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  const db = getDb();
  const userId = session.user.id;

  // Resolve workspace from header
  const reqHeaders = await headers();
  const workspaceSlug = reqHeaders.get("x-workspace-slug");
  if (!workspaceSlug) {
    return NextResponse.json({ error: "Workspace required" }, { status: 400 });
  }

  const [membership] = await db
    .select({
      workspaceId: workspaces.id,
      storageUsed: workspaces.storageUsed,
      storageLimit: workspaces.storageLimit,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaces.slug, workspaceSlug),
        eq(workspaceMembers.userId, userId),
      ),
    );

  if (!membership) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const { workspaceId, storageUsed, storageLimit } = membership;

  // Validate folder belongs to workspace if provided
  if (folderId) {
    const [folder] = await db
      .select()
      .from(folders)
      .where(
        and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)),
      );
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
  }

  let existingUploadRecord:
    | {
        id: string;
        size: number;
        storagePath: string;
        status: string;
        storageConfigId: string | null;
      }
    | undefined;

  if (existingFileId) {
    const [uploadRecord] = await db
      .select({
        id: files.id,
        size: files.size,
        storagePath: files.storagePath,
        status: files.status,
        storageConfigId: files.storageConfigId,
      })
      .from(files)
      .where(
        and(eq(files.id, existingFileId), eq(files.workspaceId, workspaceId)),
      );

    if (!uploadRecord) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    if (uploadRecord.status !== "uploading") {
      return NextResponse.json(
        { error: "Upload has already been completed or aborted" },
        { status: 409 },
      );
    }

    if (uploadRecord.size !== file.size) {
      return NextResponse.json(
        { error: "File size does not match initiated upload" },
        { status: 400 },
      );
    }

    existingUploadRecord = uploadRecord;
  }

  // Check storage quota based on where bytes will actually land:
  // resumed uploads use the file's config, fresh uploads use current workspace config.
  const enforceQuota = existingUploadRecord
    ? await shouldEnforceQuotaForConfig(
        workspaceId,
        existingUploadRecord.storageConfigId,
      )
    : await shouldEnforceQuota(workspaceId);

  if (enforceQuota) {
    if ((storageUsed ?? 0) + file.size > (storageLimit ?? 0)) {
      return NextResponse.json(
        { error: "Storage quota exceeded" },
        { status: 507 },
      );
    }
  }

  // Resolve storage: for resumed uploads use the config recorded at initiate
  // time; for fresh uploads use the current workspace config.
  let storage: Awaited<ReturnType<typeof createStorageForFile>>;
  let newConfigId: string | null = null;
  let newProviderName: string | undefined;

  if (existingUploadRecord) {
    storage = await createStorageForFile(existingUploadRecord.storageConfigId);
  } else {
    const ws = await createStorageForWorkspace(workspaceId);
    storage = ws.storage;
    newConfigId = ws.configId;
    newProviderName = ws.providerName;
  }

  const fileId = existingUploadRecord?.id ?? randomUUID();
  const storagePath =
    existingUploadRecord?.storagePath ??
    `${workspaceId}/${fileId}/${file.name}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await storage.upload({
      path: storagePath,
      data: buffer,
      contentType: file.type || "application/octet-stream",
    });
  } catch (err) {
    // Clean up the file record if this was a fresh upload
    if (!existingFileId) {
      await db
        .delete(files)
        .where(eq(files.id, fileId))
        .catch(() => {});
    }
    return NextResponse.json(
      { error: `Storage upload failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  let newFile: typeof files.$inferSelect | undefined;
  if (existingFileId) {
    // Update existing record created by uploads.initiate
    [newFile] = await db
      .update(files)
      .set({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        storagePath,
        status: "ready",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(files.id, existingFileId),
          eq(files.workspaceId, workspaceId),
          eq(files.status, "uploading"),
        ),
      )
      .returning();
  } else {
    [newFile] = await db
      .insert(files)
      .values({
        id: fileId,
        workspaceId,
        userId,
        folderId: folderId || null,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        storagePath,
        storageProvider: newProviderName!,
        storageConfigId: newConfigId,
        status: "ready",
      })
      .returning();
  }

  // Update workspace storage usage
  const billedSize = existingUploadRecord?.size ?? file.size;
  await db
    .update(workspaces)
    .set({ storageUsed: sql`${workspaces.storageUsed} + ${billedSize}` })
    .where(eq(workspaces.id, workspaceId));

  // Fire-and-forget: index file for search plugins
  if (newFile) {
    const uploadedFile = newFile;
    void (async () => {
      // Lazily fetch content only if at least one search plugin needs it
      let content: string | undefined;

      async function getContent(): Promise<string | undefined> {
        if (content !== undefined) return content;
        try {
          const dl = await storage.download(uploadedFile.storagePath);
          content = await streamToString(dl.data);
        } catch {
          content = undefined;
        }
        return content;
      }

      // QMD semantic search
      if (qmdClient.shouldIndex(uploadedFile.mimeType)) {
        try {
          const qmdEndpoint = await resolvePluginEndpoint(
            db,
            workspaceId,
            "qmd-search",
            {
              serviceUrl: process.env.QMD_SERVICE_URL,
              apiSecret: process.env.QMD_API_SECRET,
            },
          );
          if (qmdEndpoint) {
            const text = await getContent();
            if (text) {
              await qmdClient.indexFile(
                {
                  workspaceId,
                  fileId: uploadedFile.id,
                  fileName: uploadedFile.name,
                  mimeType: uploadedFile.mimeType,
                  content: text,
                },
                qmdEndpoint,
              );
            }
          }
        } catch {}
      }

      // FTS5 full-text search
      if (ftsClient.shouldIndex(uploadedFile.mimeType)) {
        try {
          const ftsEndpoint = await resolvePluginEndpoint(
            db,
            workspaceId,
            "fts-search",
            {
              serviceUrl: process.env.FTS_SERVICE_URL,
              apiSecret: process.env.FTS_API_SECRET,
            },
          );
          if (ftsEndpoint) {
            const text = await getContent();
            if (text) {
              await ftsClient.indexFile(
                {
                  workspaceId,
                  fileId: uploadedFile.id,
                  fileName: uploadedFile.name,
                  mimeType: uploadedFile.mimeType,
                  content: text,
                },
                ftsEndpoint,
              );
            }
          }
        } catch {}
      }
    })();

    // Fire-and-forget: transcribe non-text files (images, PDFs, etc.)
    if (!isTextIndexable(uploadedFile.mimeType)) {
      void transcribeFile({
        db,
        workspaceId,
        userId,
        fileId: uploadedFile.id,
        fileName: uploadedFile.name,
        mimeType: uploadedFile.mimeType,
        storagePath: uploadedFile.storagePath,
        storageConfigId: uploadedFile.storageConfigId,
      }).catch(() => {});
    }
  }

  invalidateWorkspaceVfsSnapshot(workspaceId);
  return NextResponse.json({ file: newFile });
}
