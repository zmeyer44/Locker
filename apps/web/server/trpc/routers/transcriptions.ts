import { z } from "zod";
import { eq, and, inArray, desc } from "drizzle-orm";
import { createRouter, workspaceProcedure } from "../init";
import { files, fileTranscriptions } from "@locker/database";
import {
  isTextIndexable,
  findTranscriptionPlugin,
  transcribeFile,
} from "../../plugins/transcription";
import { qmdClient } from "../../plugins/handlers/qmd-client";
import { ftsClient } from "../../plugins/handlers/fts-client";
import { resolvePluginEndpoint } from "../../plugins/resolve-endpoint";

export const transcriptionsRouter = createRouter({
  /** Get the transcription for a file (if any). */
  getByFileId: workspaceProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
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
          .orderBy(desc(fileTranscriptions.updatedAt))
          .limit(1);

        return row ?? null;
      } catch {
        return null;
      }
    }),

  /** Batch query transcription status for multiple files. */
  statusByFileIds: workspaceProcedure
    .input(z.object({ fileIds: z.array(z.string().uuid()).max(200) }))
    .query(async ({ ctx, input }) => {
      if (input.fileIds.length === 0) return {};

      try {
        const rows = await ctx.db
          .select({
            fileId: fileTranscriptions.fileId,
            status: fileTranscriptions.status,
            updatedAt: fileTranscriptions.updatedAt,
          })
          .from(fileTranscriptions)
          .where(
            and(
              inArray(fileTranscriptions.fileId, input.fileIds),
              eq(fileTranscriptions.workspaceId, ctx.workspaceId),
            ),
          )
          .orderBy(desc(fileTranscriptions.updatedAt));

        // Keep only the most recently updated transcription per file
        const result: Record<string, string> = {};
        for (const row of rows) {
          if (!(row.fileId in result)) {
            result[row.fileId] = row.status;
          }
        }
        return result;
      } catch {
        // Table may not exist if migration 0009 hasn't been applied yet
        return {};
      }
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

      const plugin = await findTranscriptionPlugin(
        ctx.db,
        ctx.workspaceId,
        file.mimeType,
      );
      if (!plugin) {
        return {
          status: "error" as const,
          message:
            "No active transcription plugin supports this file type. Install and configure a document transcription plugin first.",
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
      // Check if the source file is text-indexable. If not, the only
      // indexed content was from the transcription, so we must deindex.
      const [file] = await ctx.db
        .select({ mimeType: files.mimeType })
        .from(files)
        .where(
          and(
            eq(files.id, input.fileId),
            eq(files.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);

      await ctx.db
        .delete(fileTranscriptions)
        .where(
          and(
            eq(fileTranscriptions.fileId, input.fileId),
            eq(fileTranscriptions.workspaceId, ctx.workspaceId),
          ),
        );

      // Deindex from search if the source file had no native text content
      if (file && !isTextIndexable(file.mimeType)) {
        const qmdEndpoint = await resolvePluginEndpoint(
          ctx.db,
          ctx.workspaceId,
          "qmd-search",
          {
            serviceUrl: process.env.QMD_SERVICE_URL,
            apiSecret: process.env.QMD_API_SECRET,
          },
        );
        if (qmdEndpoint) {
          void qmdClient
            .deindexFile(
              { workspaceId: ctx.workspaceId, fileId: input.fileId },
              qmdEndpoint,
            )
            .catch(() => {});
        }

        const ftsEndpoint = await resolvePluginEndpoint(
          ctx.db,
          ctx.workspaceId,
          "fts-search",
          {
            serviceUrl: process.env.FTS_SERVICE_URL,
            apiSecret: process.env.FTS_API_SECRET,
          },
        );
        if (ftsEndpoint) {
          void ftsClient
            .deindexFile(
              { workspaceId: ctx.workspaceId, fileId: input.fileId },
              ftsEndpoint,
            )
            .catch(() => {});
        }
      }

      return { success: true };
    }),
});
