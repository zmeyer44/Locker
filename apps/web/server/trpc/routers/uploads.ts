import { TRPCError } from "@trpc/server";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createRouter, workspaceProcedure } from "../init";
import { files, folders, workspaces } from "@locker/database";
import {
  createStorageForWorkspace,
  createStorageForFile,
  shouldEnforceQuota,
} from "../../../server/storage";
import { qmdClient, streamToString } from "../../plugins/handlers/qmd-client";
import { ftsClient } from "../../plugins/handlers/fts-client";
import { resolvePluginEndpoint } from "../../plugins/resolve-endpoint";
import { invalidateWorkspaceVfsSnapshot } from "../../vfs/locker-vfs";
import { isTextIndexable, transcribeFile } from "../../plugins/transcription";
import {
  initiateUploadSchema,
  completeUploadSchema,
  abortUploadSchema,
  MULTIPART_THRESHOLD,
  MULTIPART_PART_SIZE,
} from "@locker/common";

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

  initiate: workspaceProcedure
    .input(initiateUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const { db, workspaceId, userId } = ctx;

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

      // Validate folder ownership
      if (input.folderId) {
        const [folder] = await db
          .select({ id: folders.id })
          .from(folders)
          .where(
            and(
              eq(folders.id, input.folderId),
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

      const fileId = randomUUID();
      const storagePath = `${workspaceId}/${fileId}/${input.fileName}`;
      const { storage, configId, providerName } =
        await createStorageForWorkspace(workspaceId);

      // Insert file record with 'uploading' status
      await db.insert(files).values({
        id: fileId,
        workspaceId,
        userId,
        folderId: input.folderId ?? null,
        name: input.fileName,
        mimeType: input.contentType,
        size: input.fileSize,
        storagePath,
        storageProvider: providerName,
        storageConfigId: configId,
        status: "uploading",
      });

      // Determine upload strategy
      if (!storage.supportsPresignedUpload) {
        return {
          fileId,
          storagePath,
          strategy: "server-buffered" as const,
        };
      }

      if (input.fileSize < MULTIPART_THRESHOLD) {
        // Single presigned PUT
        const { url } = await storage.createPresignedUpload!({
          path: storagePath,
          contentType: input.contentType,
          size: input.fileSize,
        });

        return {
          fileId,
          storagePath,
          strategy: "presigned-put" as const,
          presignedUrl: url,
        };
      }

      // Multipart upload
      const partCount = Math.ceil(input.fileSize / MULTIPART_PART_SIZE);
      const { uploadId } = await storage.createMultipartUpload!({
        path: storagePath,
        contentType: input.contentType,
      });

      const { urls } = await storage.getMultipartPartUrls!({
        path: storagePath,
        uploadId,
        parts: partCount,
      });

      return {
        fileId,
        storagePath,
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
        const storage = await createStorageForFile(file.storageConfigId);
        await storage.completeMultipartUpload!({
          path: file.storagePath,
          uploadId: input.uploadId,
          parts: input.parts,
        });
      }

      // Mark as ready
      const [updated] = await db
        .update(files)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(files.id, input.fileId))
        .returning();

      // Update storage usage
      await db
        .update(workspaces)
        .set({
          storageUsed: sql`${workspaces.storageUsed} + ${file.size}`,
        })
        .where(eq(workspaces.id, workspaceId));

      // Fire-and-forget: index file for QMD search
      if (qmdClient.shouldIndex(file.mimeType)) {
        void (async () => {
          try {
            const endpoint = await resolvePluginEndpoint(
              db,
              workspaceId,
              "qmd-search",
              {
                serviceUrl: process.env.QMD_SERVICE_URL,
                apiSecret: process.env.QMD_API_SECRET,
              },
            );
            if (!endpoint) return;
            const storage = await createStorageForFile(file.storageConfigId);
            const { data } = await storage.download(file.storagePath);
            const content = await streamToString(data);
            await qmdClient.indexFile(
              {
                workspaceId,
                fileId: input.fileId,
                fileName: file.name,
                mimeType: file.mimeType,
                content,
              },
              endpoint,
            );
          } catch {}
        })();
      }

      // Fire-and-forget: index file for FTS search
      if (ftsClient.shouldIndex(file.mimeType)) {
        void (async () => {
          try {
            const endpoint = await resolvePluginEndpoint(
              db,
              workspaceId,
              "fts-search",
              {
                serviceUrl: process.env.FTS_SERVICE_URL,
                apiSecret: process.env.FTS_API_SECRET,
              },
            );
            if (!endpoint) return;
            const storage = await createStorageForFile(file.storageConfigId);
            const { data } = await storage.download(file.storagePath);
            const content = await streamToString(data);
            await ftsClient.indexFile(
              {
                workspaceId,
                fileId: input.fileId,
                fileName: file.name,
                mimeType: file.mimeType,
                content,
              },
              endpoint,
            );
          } catch {}
        })();
      }

      // Fire-and-forget: transcribe non-text files (images, PDFs, etc.)
      if (!isTextIndexable(file.mimeType)) {
        void transcribeFile({
          db,
          workspaceId,
          userId: ctx.userId,
          fileId: input.fileId,
          fileName: file.name,
          mimeType: file.mimeType,
          storagePath: file.storagePath,
          storageConfigId: file.storageConfigId,
        }).catch(() => {});
      }

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

      const storage = await createStorageForFile(file.storageConfigId);

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
      await db.delete(files).where(eq(files.id, input.fileId));

      invalidateWorkspaceVfsSnapshot(workspaceId);
      return { success: true };
    }),
});
