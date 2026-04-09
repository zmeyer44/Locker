import { z } from "zod";
import {
  eq,
  and,
  asc,
  desc,
  isNull,
  sql,
  ilike,
  inArray,
  not,
  or,
  gte,
  lt,
  like,
} from "drizzle-orm";
import { createRouter, workspaceProcedure } from "../init";
import { files, workspaces, folders, fileTags, tags } from "@locker/database";
import { createStorageForFile } from "../../../server/storage";
import {
  renameFileSchema,
  moveItemSchema,
  paginationSchema,
  sortSchema,
  IMAGE_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  VIDEO_MIME_TYPES,
  AUDIO_MIME_TYPES,
  ARCHIVE_MIME_TYPES,
} from "@locker/common";
import { enhanceSearchResultsWithPlugins } from "../../plugins/search";
import { qmdClient } from "../../plugins/handlers/qmd-client";
import { ftsClient } from "../../plugins/handlers/fts-client";
import { resolvePluginEndpoint } from "../../plugins/resolve-endpoint";
import { invalidateWorkspaceVfsSnapshot } from "../../vfs/locker-vfs";

export const filesRouter = createRouter({
  list: workspaceProcedure
    .input(
      z.object({
        folderId: z.string().uuid().nullable().default(null),
        search: z.string().optional(),
        tagSlugs: z.array(z.string()).optional(),
        fileTypes: z
          .array(
            z.enum([
              "image",
              "document",
              "video",
              "audio",
              "archive",
              "other",
            ]),
          )
          .optional(),
        createdAfter: z.string().date().optional(),
        createdBefore: z.string().date().optional(),
        ...paginationSchema.shape,
        ...sortSchema.shape,
      }),
    )
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const {
        folderId,
        search,
        tagSlugs,
        fileTypes,
        createdAfter,
        createdBefore,
        page,
        pageSize,
        field,
        direction,
      } = input;

      const conditions = [eq(files.workspaceId, ctx.workspaceId)];

      if (search) {
        // Fetch content-matched file IDs from search plugins
        const contentFileIds = new Set<string>();

        // QMD semantic search
        const qmdEndpoint = await resolvePluginEndpoint(
          db,
          ctx.workspaceId,
          "qmd-search",
          {
            serviceUrl: process.env.QMD_SERVICE_URL,
            apiSecret: process.env.QMD_API_SECRET,
          },
        );
        if (qmdEndpoint) {
          try {
            const qmdResults = await qmdClient.search(
              {
                workspaceId: ctx.workspaceId,
                query: search,
                limit: pageSize,
              },
              qmdEndpoint,
            );
            for (const r of qmdResults) contentFileIds.add(r.fileId);
          } catch {}
        }

        // FTS5 full-text search
        const ftsEndpoint = await resolvePluginEndpoint(
          db,
          ctx.workspaceId,
          "fts-search",
          {
            serviceUrl: process.env.FTS_SERVICE_URL,
            apiSecret: process.env.FTS_API_SECRET,
          },
        );
        if (ftsEndpoint) {
          try {
            const ftsResults = await ftsClient.search(
              {
                workspaceId: ctx.workspaceId,
                query: search,
                limit: pageSize,
              },
              ftsEndpoint,
            );
            for (const r of ftsResults) contentFileIds.add(r.fileId);
          } catch {}
        }

        const nameMatch = ilike(files.name, `%${search}%`);
        if (contentFileIds.size > 0) {
          conditions.push(
            or(nameMatch, inArray(files.id, [...contentFileIds]))!,
          );
        } else {
          conditions.push(nameMatch);
        }
        // Exclude files inside hidden system folders (e.g. .plugins)
        const hiddenRoots = await db
          .select({ id: folders.id })
          .from(folders)
          .where(
            and(
              eq(folders.workspaceId, ctx.workspaceId),
              like(folders.name, ".%"),
            ),
          );
        if (hiddenRoots.length > 0) {
          const rootIds = hiddenRoots.map((f) => f.id);
          const children = await db
            .select({ id: folders.id })
            .from(folders)
            .where(inArray(folders.parentId, rootIds));
          const allHiddenIds = [...rootIds, ...children.map((f) => f.id)];
          conditions.push(
            or(isNull(files.folderId), not(inArray(files.folderId, allHiddenIds)))!,
          );
        }
      } else {
        conditions.push(
          folderId ? eq(files.folderId, folderId) : isNull(files.folderId),
        );
      }

      // Tag filtering (AND semantics: file must have ALL selected tags)
      if (tagSlugs && tagSlugs.length > 0) {
        conditions.push(
          inArray(
            files.id,
            db
              .select({ fileId: fileTags.fileId })
              .from(fileTags)
              .innerJoin(tags, eq(fileTags.tagId, tags.id))
              .where(
                and(
                  inArray(tags.slug, tagSlugs),
                  eq(tags.workspaceId, ctx.workspaceId),
                ),
              )
              .groupBy(fileTags.fileId)
              .having(
                sql`count(distinct ${fileTags.tagId}) = ${tagSlugs.length}`,
              ),
          ),
        );
      }

      // File type filtering (OR semantics: file matches ANY selected type)
      if (fileTypes && fileTypes.length > 0) {
        const categoryMap: Record<string, readonly string[]> = {
          image: IMAGE_MIME_TYPES,
          document: DOCUMENT_MIME_TYPES,
          video: VIDEO_MIME_TYPES,
          audio: AUDIO_MIME_TYPES,
          archive: ARCHIVE_MIME_TYPES,
        };

        const mimeTypes: string[] = [];
        let includeOther = false;

        for (const type of fileTypes) {
          if (type === "other") {
            includeOther = true;
          } else if (categoryMap[type]) {
            mimeTypes.push(...categoryMap[type]);
          }
        }

        const allKnownMimeTypes: string[] = [
          ...IMAGE_MIME_TYPES,
          ...DOCUMENT_MIME_TYPES,
          ...VIDEO_MIME_TYPES,
          ...AUDIO_MIME_TYPES,
          ...ARCHIVE_MIME_TYPES,
        ];

        if (mimeTypes.length > 0 && includeOther) {
          conditions.push(
            or(
              inArray(files.mimeType, mimeTypes),
              not(inArray(files.mimeType, allKnownMimeTypes)),
            )!,
          );
        } else if (mimeTypes.length > 0) {
          conditions.push(inArray(files.mimeType, mimeTypes));
        } else if (includeOther) {
          conditions.push(not(inArray(files.mimeType, allKnownMimeTypes)));
        }
      }

      // Date filtering (inclusive range on createdAt)
      if (createdAfter) {
        conditions.push(gte(files.createdAt, new Date(createdAfter)));
      }
      if (createdBefore) {
        const endOfDay = new Date(createdBefore);
        endOfDay.setDate(endOfDay.getDate() + 1);
        conditions.push(lt(files.createdAt, endOfDay));
      }

      const orderBy =
        direction === "asc" ? asc(files[field]) : desc(files[field]);

      const [items, countResult] = await Promise.all([
        db
          .select()
          .from(files)
          .where(and(...conditions))
          .orderBy(orderBy)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db
          .select({ count: sql<number>`count(*)` })
          .from(files)
          .where(and(...conditions)),
      ]);

      const enhancedItems =
        search && search.trim().length > 0
          ? await enhanceSearchResultsWithPlugins({
              db,
              workspaceId: ctx.workspaceId,
              query: search,
              results: items,
            })
          : items;

      const total = Number(countResult[0]?.count ?? 0);

      return {
        items: enhancedItems,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }),

  search: workspaceProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const { query } = input;

      // Collect content-matched file IDs with snippets/scores
      const contentMap = new Map<string, { snippet?: string; score: number }>();

      // QMD semantic search
      const qmdEndpoint = await resolvePluginEndpoint(
        db,
        ctx.workspaceId,
        "qmd-search",
        {
          serviceUrl: process.env.QMD_SERVICE_URL,
          apiSecret: process.env.QMD_API_SECRET,
        },
      );
      if (qmdEndpoint) {
        try {
          const qmdResults = await qmdClient.search(
            {
              workspaceId: ctx.workspaceId,
              query,
              limit: 20,
            },
            qmdEndpoint,
          );
          for (const r of qmdResults) {
            contentMap.set(r.fileId, {
              snippet: r.snippet,
              score: r.score,
            });
          }
        } catch {}
      }

      // FTS full-text search
      const ftsEndpoint = await resolvePluginEndpoint(
        db,
        ctx.workspaceId,
        "fts-search",
        {
          serviceUrl: process.env.FTS_SERVICE_URL,
          apiSecret: process.env.FTS_API_SECRET,
        },
      );
      if (ftsEndpoint) {
        try {
          const ftsResults = await ftsClient.search(
            {
              workspaceId: ctx.workspaceId,
              query,
              limit: 20,
            },
            ftsEndpoint,
          );
          for (const r of ftsResults) {
            // Keep whichever source gave a higher score
            const existing = contentMap.get(r.fileId);
            if (!existing || r.score > existing.score) {
              contentMap.set(r.fileId, {
                snippet: r.snippet ?? existing?.snippet,
                score: r.score,
              });
            }
          }
        } catch {}
      }

      const escapedQuery = query.replace(/[%_\\]/g, "\\$&");
      const nameMatches = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.workspaceId, ctx.workspaceId),
            ilike(files.name, `%${escapedQuery}%`),
          ),
        )
        .limit(20);

      const nameIds = new Set(nameMatches.map((f) => f.id));
      const contentOnlyIds = [...contentMap.keys()].filter(
        (id) => !nameIds.has(id),
      );

      let contentOnlyFiles: typeof nameMatches = [];
      if (contentOnlyIds.length > 0) {
        contentOnlyFiles = await db
          .select()
          .from(files)
          .where(
            and(
              eq(files.workspaceId, ctx.workspaceId),
              inArray(files.id, contentOnlyIds),
            ),
          );
      }

      const allFiles = [...nameMatches, ...contentOnlyFiles];
      const results = allFiles.map((f) => ({
        ...f,
        snippet: contentMap.get(f.id)?.snippet ?? null,
        contentScore: contentMap.get(f.id)?.score ?? null,
      }));

      results.sort((a, b) => {
        if (a.contentScore && !b.contentScore) return -1;
        if (!a.contentScore && b.contentScore) return 1;
        if (a.contentScore && b.contentScore)
          return b.contentScore - a.contentScore;
        return a.name.localeCompare(b.name);
      });

      return results.slice(0, 20);
    }),

  get: workspaceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [file] = await ctx.db
        .select()
        .from(files)
        .where(
          and(eq(files.id, input.id), eq(files.workspaceId, ctx.workspaceId)),
        );

      if (!file) return null;
      return file;
    }),

  getDownloadUrl: workspaceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [file] = await ctx.db
        .select()
        .from(files)
        .where(
          and(eq(files.id, input.id), eq(files.workspaceId, ctx.workspaceId)),
        );

      if (!file) throw new Error("File not found");

      const storage = await createStorageForFile(file.storageConfigId);
      const url = await storage.getSignedUrl(file.storagePath, 3600);
      return { url, filename: file.name, mimeType: file.mimeType };
    }),

  rename: workspaceProcedure
    .input(renameFileSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(files)
        .set({ name: input.name, updatedAt: new Date() })
        .where(
          and(eq(files.id, input.id), eq(files.workspaceId, ctx.workspaceId)),
        )
        .returning();

      invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
      return updated;
    }),

  move: workspaceProcedure
    .input(moveItemSchema)
    .mutation(async ({ ctx, input }) => {
      // Validate target folder belongs to user
      if (input.targetFolderId) {
        const [folder] = await ctx.db
          .select()
          .from(folders)
          .where(
            and(
              eq(folders.id, input.targetFolderId),
              eq(folders.workspaceId, ctx.workspaceId),
            ),
          );
        if (!folder) throw new Error("Target folder not found");
      }

      const [updated] = await ctx.db
        .update(files)
        .set({ folderId: input.targetFolderId, updatedAt: new Date() })
        .where(
          and(eq(files.id, input.id), eq(files.workspaceId, ctx.workspaceId)),
        )
        .returning();

      invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
      return updated;
    }),

  delete: workspaceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [file] = await ctx.db
        .select()
        .from(files)
        .where(
          and(eq(files.id, input.id), eq(files.workspaceId, ctx.workspaceId)),
        );

      if (!file) throw new Error("File not found");

      // Delete from storage
      const storage = await createStorageForFile(file.storageConfigId);
      await storage.delete(file.storagePath);

      // De-index from search plugins
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
            { workspaceId: ctx.workspaceId, fileId: file.id },
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
            { workspaceId: ctx.workspaceId, fileId: file.id },
            ftsEndpoint,
          )
          .catch(() => {});
      }

      // Delete from database
      await ctx.db.delete(files).where(eq(files.id, input.id));

      // Update storage usage
      await ctx.db
        .update(workspaces)
        .set({
          storageUsed: sql`GREATEST(${workspaces.storageUsed} - ${file.size}, 0)`,
        })
        .where(eq(workspaces.id, ctx.workspaceId));

      invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
      return { success: true };
    }),

  deleteMany: workspaceProcedure
    .input(z.object({ ids: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      let totalSize = 0;

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

      for (const id of input.ids) {
        const [file] = await ctx.db
          .select()
          .from(files)
          .where(and(eq(files.id, id), eq(files.workspaceId, ctx.workspaceId)));

        if (file) {
          const storage = await createStorageForFile(file.storageConfigId);
          await storage.delete(file.storagePath);
          if (qmdEndpoint) {
            void qmdClient
              .deindexFile(
                { workspaceId: ctx.workspaceId, fileId: file.id },
                qmdEndpoint,
              )
              .catch(() => {});
          }
          if (ftsEndpoint) {
            void ftsClient
              .deindexFile(
                { workspaceId: ctx.workspaceId, fileId: file.id },
                ftsEndpoint,
              )
              .catch(() => {});
          }
          await ctx.db.delete(files).where(eq(files.id, id));
          totalSize += file.size;
        }
      }

      if (totalSize > 0) {
        await ctx.db
          .update(workspaces)
          .set({
            storageUsed: sql`GREATEST(${workspaces.storageUsed} - ${totalSize}, 0)`,
          })
          .where(eq(workspaces.id, ctx.workspaceId));
      }

      invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
      return { success: true, deleted: input.ids.length };
    }),
});
