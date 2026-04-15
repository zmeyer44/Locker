import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../server/auth";
import { headers } from "next/headers";
import { getDb } from "@locker/database/client";
import { fileBlobs, files, workspaces, workspaceMembers } from "@locker/database";
import {
  createStorageForFile,
  shouldEnforceQuotaForFile,
} from "../../../../server/storage";
import { eq, and, sql } from "drizzle-orm";
import { invalidateWorkspaceVfsSnapshot } from "../../../../server/vfs/locker-vfs";
import { markFileUploadReady } from "../../../../server/stores/file-records";
import { runFileReadyHooks, deleteFileEverywhere } from "../../../../server/stores/lifecycle";

export const runtime = "nodejs";

// Disable body parser — we stream the raw request body
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read metadata from headers instead of FormData
  const reqHeaders = await headers();
  const fileId = reqHeaders.get("x-file-id");
  const workspaceSlug = reqHeaders.get("x-workspace-slug");
  const contentType =
    req.headers.get("content-type") ?? "application/octet-stream";
  const contentLengthHeader = req.headers.get("content-length");

  if (!fileId || !workspaceSlug) {
    return NextResponse.json(
      { error: "Missing x-file-id or x-workspace-slug headers" },
      { status: 400 },
    );
  }

  if (!req.body) {
    return NextResponse.json({ error: "No body" }, { status: 400 });
  }

  const contentLength = Number.parseInt(contentLengthHeader ?? "", 10);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return NextResponse.json(
      { error: "Missing or invalid content-length header" },
      { status: 400 },
    );
  }

  const db = getDb();
  const userId = session.user.id;

  // Verify workspace membership
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

  // Verify the file record exists and belongs to this workspace
  const [fileRecord] = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.workspaceId, membership.workspaceId),
        eq(files.status, "uploading"),
      ),
    );

  if (!fileRecord) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }

  if (fileRecord.size !== contentLength) {
    return NextResponse.json(
      { error: "Content length does not match initiated upload size" },
      { status: 400 },
    );
  }

  // Enforce quota based on where bytes actually land (the file's config),
  // not the workspace's current config which may have changed since initiate.
  // For replace uploads, subtract the existing file's size from the net increase.
  if (await shouldEnforceQuotaForFile(fileRecord.id)) {
    let freedBytes = 0;
    if (fileRecord.replacesFileId) {
      const [replacedFile] = await db
        .select({ size: files.size })
        .from(files)
        .where(eq(files.id, fileRecord.replacesFileId))
        .limit(1);
      freedBytes = Number(replacedFile?.size ?? 0);
    }

    const netIncrease = contentLength - freedBytes;
    if (
      (membership.storageUsed ?? 0) + netIncrease >
      (membership.storageLimit ?? 0)
    ) {
      return NextResponse.json(
        { error: "Storage quota exceeded" },
        { status: 507 },
      );
    }
  }

  // Stream the request body to storage
  const storage = await createStorageForFile(fileRecord.id);

  try {
    await storage.upload({
      path: fileRecord.storagePath,
      data: req.body as unknown as ReadableStream,
      contentType,
    });

    // For replace: delete the old file now that the new upload has succeeded.
    // Read replacesFileId from the file record (set during initiate).
    if (fileRecord.replacesFileId) {
      const [replacedFile] = await db
        .select({ name: files.name })
        .from(files)
        .where(eq(files.id, fileRecord.replacesFileId))
        .limit(1);

      await deleteFileEverywhere({
        db,
        workspaceId: membership.workspaceId,
        fileId: fileRecord.replacesFileId,
        deletedByUserId: userId,
      });

      // Restore the original display name (dedup gave the new file a temp name)
      if (replacedFile) {
        await db
          .update(files)
          .set({ name: replacedFile.name })
          .where(eq(files.id, fileId));
      }
    }

    // Mark file as ready
    await markFileUploadReady({ db, fileId });

    // Update storage usage
    await db
      .update(workspaces)
      .set({
        storageUsed: sql`${workspaces.storageUsed} + ${contentLength}`,
      })
      .where(eq(workspaces.id, membership.workspaceId));

    void runFileReadyHooks({
      db,
      workspaceId: membership.workspaceId,
      userId,
      fileId,
    }).catch(() => {});

    invalidateWorkspaceVfsSnapshot(membership.workspaceId);
    return NextResponse.json({ success: true, fileId });
  } catch (err) {
    // Clean up on failure
    try {
      await storage.delete(fileRecord.storagePath);
    } catch {
      // best effort
    }
    await db.transaction(async (tx) => {
      await tx.delete(files).where(eq(files.id, fileId));
      await tx.delete(fileBlobs).where(eq(fileBlobs.id, fileRecord.blobId));
    });
    invalidateWorkspaceVfsSnapshot(membership.workspaceId);

    return NextResponse.json(
      { error: (err as Error).message ?? "Upload failed" },
      { status: 500 },
    );
  }
}
