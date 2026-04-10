import { tool } from "ai";
import { z } from "zod/v4";
import { eq, and, asc, desc, ilike, inArray, sql, isNull, or } from "drizzle-orm";
import { files, folders, workspaces, fileTranscriptions } from "@locker/database";
import { resolvePluginEndpoint } from "../../plugins/resolve-endpoint";
import { qmdClient } from "../../plugins/handlers/qmd-client";
import { ftsClient } from "../../plugins/handlers/fts-client";
import { createStorageForFile } from "../../storage";
import { invalidateWorkspaceVfsSnapshot } from "../../vfs/locker-vfs";
import type { AssistantToolContext } from "./types";

export function createFileTools(ctx: AssistantToolContext) {
  return {
    searchFiles: tool({
      description:
        "Search for files by name or content in the workspace. Uses full-text search and semantic search when available. Returns up to 20 results.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search query"),
      }),
      execute: async ({ query }) => {
        const escapedQuery = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

        // Search via plugins (QMD and FTS) in parallel
        const qmdEndpoint = await resolvePluginEndpoint(
          ctx.db,
          ctx.workspaceId,
          "qmd-search",
          {
            serviceUrl: process.env.QMD_SERVICE_URL,
            apiSecret: process.env.QMD_API_SECRET,
          },
        );
        const ftsEndpoint = await resolvePluginEndpoint(
          ctx.db,
          ctx.workspaceId,
          "fts-search",
          {
            serviceUrl: process.env.FTS_SERVICE_URL,
            apiSecret: process.env.FTS_API_SECRET,
          },
        );

        const [qmdResults, ftsResults] = await Promise.all([
          qmdEndpoint
            ? qmdClient
                .search(
                  { workspaceId: ctx.workspaceId, query, limit: 20 },
                  qmdEndpoint,
                )
                .catch(() => [])
            : [],
          ftsEndpoint
            ? ftsClient
                .search(
                  { workspaceId: ctx.workspaceId, query, limit: 20 },
                  ftsEndpoint,
                )
                .catch(() => [])
            : [],
        ]);

        // Merge content results from search plugins
        const scoreMap = new Map<
          string,
          { score: number; snippet?: string }
        >();
        for (const r of [...qmdResults, ...ftsResults]) {
          const existing = scoreMap.get(r.fileId);
          if (!existing || r.score > existing.score) {
            scoreMap.set(r.fileId, { score: r.score, snippet: r.snippet });
          }
        }

        // Fallback: if no search plugins returned results, search
        // the file_transcriptions table directly for content matches.
        // This covers environments without QMD/FTS services.
        const transcriptionSnippets = new Map<string, string>();
        if (scoreMap.size === 0) {
          const words = query
            .split(/\s+/)
            .filter((w) => w.length > 1);

          if (words.length > 0) {
            // Search transcriptions for any of the query words
            const transcriptionHits = await ctx.db
              .select({
                fileId: fileTranscriptions.fileId,
                content: fileTranscriptions.content,
              })
              .from(fileTranscriptions)
              .where(
                and(
                  eq(fileTranscriptions.workspaceId, ctx.workspaceId),
                  eq(fileTranscriptions.status, "ready"),
                  or(
                    ...words.map((w) =>
                      ilike(
                        fileTranscriptions.content,
                        `%${w.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`,
                      ),
                    ),
                  ),
                ),
              )
              .limit(20);

            for (const hit of transcriptionHits) {
              scoreMap.set(hit.fileId, { score: 1, snippet: undefined });
              // Extract a snippet around the first matching word
              const lowerContent = hit.content.toLowerCase();
              for (const w of words) {
                const idx = lowerContent.indexOf(w.toLowerCase());
                if (idx !== -1) {
                  const start = Math.max(0, idx - 60);
                  const end = Math.min(hit.content.length, idx + w.length + 60);
                  const snippet =
                    (start > 0 ? "..." : "") +
                    hit.content.slice(start, end).trim() +
                    (end < hit.content.length ? "..." : "");
                  transcriptionSnippets.set(hit.fileId, snippet);
                  break;
                }
              }
            }
          }
        }

        const contentFileIds = [...scoreMap.keys()];

        // Name-based search
        const nameMatches = await ctx.db
          .select({
            id: files.id,
            name: files.name,
            mimeType: files.mimeType,
            size: files.size,
            folderId: files.folderId,
            createdAt: files.createdAt,
            updatedAt: files.updatedAt,
          })
          .from(files)
          .where(
            and(
              eq(files.workspaceId, ctx.workspaceId),
              eq(files.status, "ready"),
              ilike(files.name, `%${escapedQuery}%`),
            ),
          )
          .limit(20);

        // Content-only matches (not already found by name)
        const nameIds = new Set(nameMatches.map((f) => f.id));
        const contentOnlyIds = contentFileIds.filter((id) => !nameIds.has(id));

        let contentMatches: typeof nameMatches = [];
        if (contentOnlyIds.length > 0) {
          contentMatches = await ctx.db
            .select({
              id: files.id,
              name: files.name,
              mimeType: files.mimeType,
              size: files.size,
              folderId: files.folderId,
              createdAt: files.createdAt,
              updatedAt: files.updatedAt,
            })
            .from(files)
            .where(
              and(
                eq(files.workspaceId, ctx.workspaceId),
                eq(files.status, "ready"),
                inArray(files.id, contentOnlyIds),
              ),
            )
            .limit(20);
        }

        // Combine, deduplicate, sort by score
        const allResults = [...nameMatches, ...contentMatches].map((file) => {
          const contentInfo = scoreMap.get(file.id);
          return {
            ...file,
            snippet:
              contentInfo?.snippet ??
              transcriptionSnippets.get(file.id) ??
              null,
            contentScore: contentInfo?.score ?? null,
          };
        });

        allResults.sort(
          (a, b) => (b.contentScore ?? 0) - (a.contentScore ?? 0),
        );

        return { files: allResults.slice(0, 20) };
      },
    }),

    listFiles: tool({
      description:
        "List files in the workspace. Optionally filter by folder. Returns up to 50 files.",
      inputSchema: z.object({
        folderId: z
          .string()
          .uuid()
          .nullable()
          .optional()
          .describe(
            "Folder ID to list files in. Null or omitted for root-level files.",
          ),
        sortBy: z
          .enum(["name", "createdAt", "updatedAt", "size"])
          .default("name")
          .describe("Field to sort by"),
        sortDirection: z
          .enum(["asc", "desc"])
          .default("asc")
          .describe("Sort direction"),
      }),
      execute: async ({ folderId, sortBy, sortDirection }) => {
        const conditions = [
          eq(files.workspaceId, ctx.workspaceId),
          eq(files.status, "ready"),
        ];

        if (folderId) {
          conditions.push(eq(files.folderId, folderId));
        } else {
          // null or undefined (omitted) → root-level files only
          conditions.push(isNull(files.folderId));
        }

        const orderFn = sortDirection === "desc" ? desc : asc;
        const orderCol = {
          name: files.name,
          createdAt: files.createdAt,
          updatedAt: files.updatedAt,
          size: files.size,
        }[sortBy];

        const rows = await ctx.db
          .select({
            id: files.id,
            name: files.name,
            mimeType: files.mimeType,
            size: files.size,
            folderId: files.folderId,
            createdAt: files.createdAt,
            updatedAt: files.updatedAt,
          })
          .from(files)
          .where(and(...conditions))
          .orderBy(orderFn(orderCol))
          .limit(50);

        return { files: rows };
      },
    }),

    getFile: tool({
      description: "Get detailed metadata for a specific file.",
      inputSchema: z.object({
        fileId: z.string().uuid().describe("ID of the file"),
      }),
      execute: async ({ fileId }) => {
        const [file] = await ctx.db
          .select({
            id: files.id,
            name: files.name,
            mimeType: files.mimeType,
            size: files.size,
            folderId: files.folderId,
            status: files.status,
            createdAt: files.createdAt,
            updatedAt: files.updatedAt,
          })
          .from(files)
          .where(
            and(
              eq(files.id, fileId),
              eq(files.workspaceId, ctx.workspaceId),
            ),
          )
          .limit(1);

        if (!file) return { error: "File not found" };
        return { file };
      },
    }),

    renameFile: tool({
      description: "Rename an existing file.",
      inputSchema: z.object({
        fileId: z.string().uuid().describe("ID of the file to rename"),
        name: z.string().min(1).describe("New name for the file"),
      }),
      execute: async ({ fileId, name }) => {
        const [file] = await ctx.db
          .update(files)
          .set({ name, updatedAt: new Date() })
          .where(
            and(
              eq(files.id, fileId),
              eq(files.workspaceId, ctx.workspaceId),
            ),
          )
          .returning();

        if (!file) return { error: "File not found" };
        invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
        return { file: { id: file.id, name: file.name } };
      },
    }),

    moveFile: tool({
      description: "Move a file to a different folder.",
      inputSchema: z.object({
        fileId: z.string().uuid().describe("ID of the file to move"),
        targetFolderId: z
          .string()
          .uuid()
          .nullable()
          .describe("Target folder ID. Null to move to root."),
      }),
      execute: async ({ fileId, targetFolderId }) => {
        if (targetFolderId) {
          const [target] = await ctx.db
            .select({ id: folders.id })
            .from(folders)
            .where(
              and(
                eq(folders.id, targetFolderId),
                eq(folders.workspaceId, ctx.workspaceId),
              ),
            )
            .limit(1);

          if (!target) return { error: "Target folder not found" };
        }

        const [file] = await ctx.db
          .update(files)
          .set({ folderId: targetFolderId, updatedAt: new Date() })
          .where(
            and(
              eq(files.id, fileId),
              eq(files.workspaceId, ctx.workspaceId),
            ),
          )
          .returning();

        if (!file) return { error: "File not found" };
        invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
        return { file: { id: file.id, name: file.name, folderId: file.folderId } };
      },
    }),

    deleteFile: tool({
      description:
        "Delete a file from the workspace. This permanently removes the file and its storage.",
      inputSchema: z.object({
        fileId: z.string().uuid().describe("ID of the file to delete"),
      }),
      execute: async ({ fileId }) => {
        const [file] = await ctx.db
          .select()
          .from(files)
          .where(
            and(
              eq(files.id, fileId),
              eq(files.workspaceId, ctx.workspaceId),
            ),
          )
          .limit(1);

        if (!file) return { error: "File not found" };

        // Deindex from search plugins (best-effort)
        const qmdEndpoint = await resolvePluginEndpoint(
          ctx.db,
          ctx.workspaceId,
          "qmd-search",
          {
            serviceUrl: process.env.QMD_SERVICE_URL,
            apiSecret: process.env.QMD_API_SECRET,
          },
        );
        const ftsEndpoint = await resolvePluginEndpoint(
          ctx.db,
          ctx.workspaceId,
          "fts-search",
          {
            serviceUrl: process.env.FTS_SERVICE_URL,
            apiSecret: process.env.FTS_API_SECRET,
          },
        );

        await Promise.allSettled([
          qmdEndpoint
            ? qmdClient.deindexFile(
                { workspaceId: ctx.workspaceId, fileId },
                qmdEndpoint,
              )
            : Promise.resolve(),
          ftsEndpoint
            ? ftsClient.deindexFile(
                { workspaceId: ctx.workspaceId, fileId },
                ftsEndpoint,
              )
            : Promise.resolve(),
        ]);

        // Delete from storage
        try {
          const storage = await createStorageForFile(
            file.storageConfigId,
          );
          if (storage && file.storagePath) {
            await storage.delete(file.storagePath);
          }
        } catch {
          // Storage deletion is best-effort
        }

        // Delete DB record and update storage usage atomically
        await ctx.db.transaction(async (tx) => {
          await tx.delete(files).where(
            and(
              eq(files.id, fileId),
              eq(files.workspaceId, ctx.workspaceId),
            ),
          );
          await tx
            .update(workspaces)
            .set({
              storageUsed: sql`GREATEST(${workspaces.storageUsed} - ${file.size}, 0)`,
            })
            .where(eq(workspaces.id, ctx.workspaceId));
        });

        invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
        return { success: true, deletedFile: file.name };
      },
    }),

    getFileDownloadUrl: tool({
      description: "Get a download URL for a file.",
      inputSchema: z.object({
        fileId: z.string().uuid().describe("ID of the file"),
      }),
      execute: async ({ fileId }) => {
        const [file] = await ctx.db
          .select({
            id: files.id,
            name: files.name,
            storagePath: files.storagePath,
            storageConfigId: files.storageConfigId,
          })
          .from(files)
          .where(
            and(
              eq(files.id, fileId),
              eq(files.workspaceId, ctx.workspaceId),
            ),
          )
          .limit(1);

        if (!file || !file.storagePath) return { error: "File not found" };

        try {
          const storage = await createStorageForFile(file.storageConfigId);
          if (storage) {
            const url = await storage.getSignedUrl(file.storagePath, 3600);
            return { downloadUrl: url, fileName: file.name };
          }
        } catch {
          // Fall through
        }

        // Fallback to serve route
        return {
          downloadUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/files/serve/${file.storagePath}`,
          fileName: file.name,
        };
      },
    }),
  };
}
