import { TRPCError } from "@trpc/server";
import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import { createRouter, workspaceProcedure } from "../init";
import { fileBlobs, files, folders, workspaces } from "@locker/database";
import {
  createStorageForWorkspace,
  createStorageForFile,
  shouldEnforceQuota,
} from "../../../server/storage";
import { invalidateWorkspaceVfsSnapshot } from "../../vfs/locker-vfs";
import {
  checkConflictsSchema,
  initiateUploadSchema,
  completeUploadSchema,
  abortUploadSchema,
  MULTIPART_THRESHOLD,
  MULTIPART_PART_SIZE,
} from "@locker/common";
import {
  createPendingFileUpload,
  markFileUploadReady,
} from "../../stores/file-records";
import { runFileReadyHooks, deleteFileEverywhere } from "../../stores/lifecycle";

export const uploadsRouter = createRouter({
  getProvider: workspaceProcedure.query(async ({ ctx }) => {
    const { storage, providerName } = await createStorageForWorkspace(
      ctx.workspaceId,
    );
    return {
      provider: providerName,
      supportsPresignedUpload: storage.supportsPresignedUpload,
    };
  }),

  checkConflicts: workspaceProcedure
    .input(checkConflictsSchema)
    .mutation(async ({ ctx, input }) => {
      const { db, workspaceId } = ctx;
      const folderId = input.folderId ?? null;

      const existing = await db
        .select({ id: files.id, name: files.name, size: files.size })
        .from(files)
        .where(
          and(
            eq(files.workspaceId, workspaceId),
            eq(files.status, "ready"),
            folderId ? eq(files.folderId, folderId) : isNull(files.folderId),
            inArray(files.name, input.fileNames),
          ),
        );

      return existing;
    }),

  initiate: workspaceProcedure
    .input(initiateUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const { db, workspaceId, userId } = ctx;
      const folderId = input.folderId ?? null;

      // Validate folder ownership
      if (folderId) {
        const [folder] = await db
          .select({ id: folders.id })
          .from(folders)
          .where(
            and(
              eq(folders.id, folderId),
              eq(folders.workspaceId, workspaceId),
            ),
          );
        if (!folder) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Folder not found",
          });
        }
      }

      // If replacing, delete the existing file first (frees storage quota)
      if (input.conflictResolution === "replace") {
        const [existing] = await db
          .select({ id: files.id })
          .from(files)
          .where(
            and(
              eq(files.workspaceId, workspaceId),
              eq(files.status, "ready"),
              eq(files.name, input.fileName),
              folderId ? eq(files.folderId, folderId) : isNull(files.folderId),
            ),
          )
          .limit(1);

        if (existing) {
          await deleteFileEverywhere({
            db,
            workspaceId,
            fileId: existing.id,
            deletedByUserId: userId,
          });
        }
      }

      // Check storage quota (skipped for BYOB and self-hosted/local)
      if (await shouldEnforceQuota(workspaceId)) {
        const [ws] = await db
          .select({
            storageUsed: workspaces.storageUsed,
            storageLimit: workspaces.storageLimit,
          })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId));

        if (
          !ws ||
          (ws.storageUsed ?? 0) + input.fileSize > (ws.storageLimit ?? 0)
        ) {
          throw new TRPCError({
            code: "PAYLOAD_TOO_LARGE",
            message: "Storage quota exceeded",
          });
        }
      }

      const pending = await createPendingFileUpload({
        db,
        workspaceId,
        userId,
        folderId,
        fileName: input.fileName,
        mimeType: input.contentType,
        size: input.fileSize,
        status: "uploading",
        overwrite: input.conflictResolution === "replace",
      });

      // Determine upload strategy
      if (!pending.storage.supportsPresignedUpload) {
        return {
          fileId: pending.fileId,
          storagePath: pending.storagePath,
          strategy: "server-buffered" as const,
        };
      }

      if (input.fileSize < MULTIPART_THRESHOLD) {
        // Single presigned PUT
        const { url } = await pending.storage.createPresignedUpload!({
          path: pending.storagePath,
          contentType: input.contentType,
          size: input.fileSize,
        });

        return {
          fileId: pending.fileId,
          storagePath: pending.storagePath,
          strategy: "presigned-put" as const,
          presignedUrl: url,
        };
      }

      // Multipart upload
      const partCount = Math.ceil(input.fileSize / MULTIPART_PART_SIZE);
      const { uploadId } = await pending.storage.createMultipartUpload!({
        path: pending.storagePath,
        contentType: input.contentType,
      });

      const { urls } = await pending.storage.getMultipartPartUrls!({
        path: pending.storagePath,
        uploadId,
        parts: partCount,
      });

      return {
        fileId: pending.fileId,
        storagePath: pending.storagePath,
        strategy: "multipart" as const,
        uploadId,
        partSize: MULTIPART_PART_SIZE,
        parts: urls,
      };
    }),

  complete: workspaceProcedure
    .input(completeUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const { db, workspaceId } = ctx;

      const [file] = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.id, input.fileId),
            eq(files.workspaceId, workspaceId),
            eq(files.status, "uploading"),
          ),
        );

      if (!file) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });
      }

      // Complete multipart upload if applicable
      if (input.uploadId && input.parts) {
        const storage = await createStorageForFile(file.id);
        await storage.completeMultipartUpload!({
          path: file.storagePath,
          uploadId: input.uploadId,
          parts: input.parts,
        });
      }

      await markFileUploadReady({ db, fileId: input.fileId });
      const [updated] = await db
        .select()
        .from(files)
        .where(eq(files.id, input.fileId))
        .limit(1);

      // Update storage usage
      await db
        .update(workspaces)
        .set({
          storageUsed: sql`${workspaces.storageUsed} + ${file.size}`,
        })
        .where(eq(workspaces.id, workspaceId));

      void runFileReadyHooks({
        db,
        workspaceId,
        userId: ctx.userId,
        fileId: input.fileId,
      }).catch(() => {});

      invalidateWorkspaceVfsSnapshot(workspaceId);
      return updated;
    }),

  abort: workspaceProcedure
    .input(abortUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const { db, workspaceId } = ctx;

      const [file] = await db
        .select()
        .from(files)
        .where(
          and(eq(files.id, input.fileId), eq(files.workspaceId, workspaceId)),
        );

      if (!file) return { success: true };

      const storage = await createStorageForFile(file.id);

      // Abort multipart upload if applicable
      if (input.uploadId) {
        try {
          await storage.abortMultipartUpload!({
            path: file.storagePath,
            uploadId: input.uploadId,
          });
        } catch {
          // Best effort - ignore errors
        }
      }

      // Try to delete any uploaded data
      try {
        await storage.delete(file.storagePath);
      } catch {
        // Best effort
      }

      // Delete the file record
      await db.transaction(async (tx) => {
        await tx.delete(files).where(eq(files.id, input.fileId));
        await tx.delete(fileBlobs).where(eq(fileBlobs.id, file.blobId));
      });

      invalidateWorkspaceVfsSnapshot(workspaceId);
      return { success: true };
    }),
});
