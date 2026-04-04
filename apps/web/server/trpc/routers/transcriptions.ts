import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { createRouter, workspaceProcedure } from "../init";
import { files, fileTranscriptions } from "@locker/database";
import { isTextIndexable, transcribeFile } from "../../plugins/transcription";

export const transcriptionsRouter = createRouter({
  /** Get the transcription for a file (if any). */
  getByFileId: workspaceProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          id: fileTranscriptions.id,
          fileId: fileTranscriptions.fileId,
          pluginSlug: fileTranscriptions.pluginSlug,
          content: fileTranscriptions.content,
          status: fileTranscriptions.status,
          errorMessage: fileTranscriptions.errorMessage,
          createdAt: fileTranscriptions.createdAt,
          updatedAt: fileTranscriptions.updatedAt,
        })
        .from(fileTranscriptions)
        .where(
          and(
            eq(fileTranscriptions.fileId, input.fileId),
            eq(fileTranscriptions.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);

      return row ?? null;
    }),

  /** Batch query transcription status for multiple files. */
  statusByFileIds: workspaceProcedure
    .input(z.object({ fileIds: z.array(z.string().uuid()).max(200) }))
    .query(async ({ ctx, input }) => {
      if (input.fileIds.length === 0) return {};

      const rows = await ctx.db
        .select({
          fileId: fileTranscriptions.fileId,
          status: fileTranscriptions.status,
        })
        .from(fileTranscriptions)
        .where(
          and(
            inArray(fileTranscriptions.fileId, input.fileIds),
            eq(fileTranscriptions.workspaceId, ctx.workspaceId),
          ),
        );

      const result: Record<string, string> = {};
      for (const row of rows) {
        result[row.fileId] = row.status;
      }
      return result;
    }),

  /** Manually trigger transcription for a file. */
  generate: workspaceProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [file] = await ctx.db
        .select({
          id: files.id,
          name: files.name,
          mimeType: files.mimeType,
          storagePath: files.storagePath,
          storageConfigId: files.storageConfigId,
        })
        .from(files)
        .where(
          and(
            eq(files.id, input.fileId),
            eq(files.workspaceId, ctx.workspaceId),
            eq(files.status, "ready"),
          ),
        )
        .limit(1);

      if (!file) {
        return { status: "error" as const, message: "File not found" };
      }

      if (isTextIndexable(file.mimeType)) {
        return {
          status: "error" as const,
          message:
            "Text files are already indexed directly and do not need transcription",
        };
      }

      // Fire-and-forget
      void transcribeFile({
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
        storagePath: file.storagePath,
        storageConfigId: file.storageConfigId,
      }).catch(() => {});

      return { status: "queued" as const, message: "Transcription started" };
    }),

  /** Delete a transcription for a file. */
  delete: workspaceProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(fileTranscriptions)
        .where(
          and(
            eq(fileTranscriptions.fileId, input.fileId),
            eq(fileTranscriptions.workspaceId, ctx.workspaceId),
          ),
        );

      return { success: true };
    }),
});
