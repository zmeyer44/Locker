import { z } from "zod";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { createRouter, workspaceProcedure } from "../init";
import {
  knowledgeBases,
  kbTags,
  kbConversations,
  kbMessages,
  kbFileIngestions,
  tags,
  fileTags,
  files,
  fileTranscriptions,
} from "@locker/database";
import {
  createKnowledgeBaseSchema,
  updateKnowledgeBaseSchema,
  isTextIndexable,
} from "@locker/common";
import { TRPCError } from "@trpc/server";
import type { Database } from "@locker/database";
import { createStorageForWorkspace, createStorageForFile } from "../../storage";
import { getHandler, buildPluginContext } from "../../plugins/runtime";
import { ingestFileIntoKB } from "../../knowledge-base/auto-ingest";

async function getKBWithAccess(
  db: Database,
  kbId: string,
  workspaceId: string,
) {
  const [kb] = await db
    .select()
    .from(knowledgeBases)
    .where(
      and(
        eq(knowledgeBases.id, kbId),
        eq(knowledgeBases.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!kb) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Knowledge base not found",
    });
  }
  return kb;
}

function validatePagePath(pagePath: string): void {
  if (
    pagePath.includes("..") ||
    pagePath.startsWith("/") ||
    !pagePath.endsWith(".md")
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid page path" });
  }
}

async function streamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export const knowledgeBasesRouter = createRouter({
  list: workspaceProcedure.query(async ({ ctx }) => {
    const kbRows = await ctx.db
      .select({
        id: knowledgeBases.id,
        name: knowledgeBases.name,
        description: knowledgeBases.description,
        status: knowledgeBases.status,
        lastIngestedAt: knowledgeBases.lastIngestedAt,
        createdAt: knowledgeBases.createdAt,
      })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.workspaceId, ctx.workspaceId))
      .orderBy(asc(knowledgeBases.name));

    if (kbRows.length === 0) return [];

    const tagRows = await ctx.db
      .select({
        knowledgeBaseId: kbTags.knowledgeBaseId,
        tagId: tags.id,
        tagName: tags.name,
        tagSlug: tags.slug,
        tagColor: tags.color,
      })
      .from(kbTags)
      .innerJoin(tags, eq(kbTags.tagId, tags.id))
      .where(
        inArray(
          kbTags.knowledgeBaseId,
          kbRows.map((kb) => kb.id),
        ),
      );

    const tagsByKb = new Map<
      string,
      { id: string; name: string; slug: string; color: string | null }[]
    >();
    for (const row of tagRows) {
      const arr = tagsByKb.get(row.knowledgeBaseId) ?? [];
      arr.push({
        id: row.tagId,
        name: row.tagName,
        slug: row.tagSlug,
        color: row.tagColor,
      });
      tagsByKb.set(row.knowledgeBaseId, arr);
    }

    return kbRows.map((kb) => ({
      ...kb,
      tags: tagsByKb.get(kb.id) ?? [],
    }));
  }),

  get: workspaceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .select({
          id: knowledgeBases.id,
          name: knowledgeBases.name,
          description: knowledgeBases.description,
          schemaPrompt: knowledgeBases.schemaPrompt,
          model: knowledgeBases.model,
          status: knowledgeBases.status,
          lastIngestedAt: knowledgeBases.lastIngestedAt,
          lastLintedAt: knowledgeBases.lastLintedAt,
          wikiStoragePath: knowledgeBases.wikiStoragePath,
          createdAt: knowledgeBases.createdAt,
        })
        .from(knowledgeBases)
        .where(
          and(
            eq(knowledgeBases.id, input.id),
            eq(knowledgeBases.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Knowledge base not found",
        });
      }

      const kbTagRows = await ctx.db
        .select({
          tagId: tags.id,
          tagName: tags.name,
          tagSlug: tags.slug,
          tagColor: tags.color,
        })
        .from(kbTags)
        .innerJoin(tags, eq(kbTags.tagId, tags.id))
        .where(eq(kbTags.knowledgeBaseId, result.id));

      return {
        ...result,
        tags: kbTagRows.map((t) => ({
          id: t.tagId,
          name: t.tagName,
          slug: t.tagSlug,
          color: t.tagColor,
        })),
      };
    }),

  create: workspaceProcedure
    .input(createKnowledgeBaseSchema)
    .mutation(async ({ ctx, input }) => {
      const tagIds = [...new Set(input.tagIds)];
      const kbId = crypto.randomUUID();
      const wikiStoragePath = `${ctx.workspaceId}/.kb/${kbId}/wiki/`;

      const [kb] = await ctx.db.transaction(async (tx) => {
        // Validate tags inside the transaction to prevent TOCTOU races
        const validTags = await tx
          .select({ id: tags.id })
          .from(tags)
          .where(
            and(
              inArray(tags.id, tagIds),
              eq(tags.workspaceId, ctx.workspaceId),
            ),
          );

        if (validTags.length !== tagIds.length) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "One or more tags not found",
          });
        }

        const [inserted] = await tx
          .insert(knowledgeBases)
          .values({
            id: kbId,
            workspaceId: ctx.workspaceId,
            createdById: ctx.userId,
            name: input.name,
            description: input.description,
            schemaPrompt: input.schemaPrompt ?? "",
            wikiStoragePath,
          })
          .returning();

        await tx.insert(kbTags).values(
          tagIds.map((tagId) => ({
            knowledgeBaseId: inserted.id,
            tagId,
          })),
        );

        return [inserted];
      });

      // Initialize index.md and log.md in storage (best-effort — the KB
      // is already created so we don't want a storage error to fail the
      // whole mutation).
      try {
        const { storage } = await createStorageForWorkspace(ctx.workspaceId);
        await storage.upload({
          path: `${wikiStoragePath}index.md`,
          data: Buffer.from("# Wiki Index\n\nNo pages yet.\n", "utf-8"),
          contentType: "text/markdown",
        });
        await storage.upload({
          path: `${wikiStoragePath}log.md`,
          data: Buffer.from("# Ingestion Log\n", "utf-8"),
          contentType: "text/markdown",
        });
      } catch {
        // Storage init is best-effort; ingestAll will recreate these files
      }

      // Fire-and-forget: ingest all documents with the selected tags
      const taggedFiles = await ctx.db
        .select({ id: files.id })
        .from(fileTags)
        .innerJoin(files, eq(fileTags.fileId, files.id))
        .where(inArray(fileTags.tagId, tagIds));

      if (taggedFiles.length > 0) {
        // Deduplicate files (a file could have multiple of the selected tags)
        const uniqueFileIds = [...new Set(taggedFiles.map((f) => f.id))];

        // Set status to building while ingestion runs
        await ctx.db
          .update(knowledgeBases)
          .set({ status: "building", updatedAt: new Date() })
          .where(eq(knowledgeBases.id, kb.id));

        const handler = getHandler("knowledge-base");
        const ingestFn = handler?.ingest;

        if (ingestFn) {
          void (async () => {
            try {
              for (const fileId of uniqueFileIds) {
                try {
                  await ingestFileIntoKB({
                    db: ctx.db,
                    workspaceId: ctx.workspaceId,
                    userId: ctx.userId,
                    knowledgeBaseId: kb.id,
                    fileId,
                  });
                } catch {
                  // Best-effort per file
                }
              }
              await ctx.db
                .update(knowledgeBases)
                .set({
                  status: "active",
                  lastIngestedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(knowledgeBases.id, kb.id));
            } catch {
              await ctx.db
                .update(knowledgeBases)
                .set({ status: "error", updatedAt: new Date() })
                .where(eq(knowledgeBases.id, kb.id))
                .catch(() => {});
            }
          })();
        } else {
          // Handler not available — reset so the KB doesn't stay stuck in "building"
          await ctx.db
            .update(knowledgeBases)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(knowledgeBases.id, kb.id));
        }
      }

      return kb;
    }),

  update: workspaceProcedure
    .input(updateKnowledgeBaseSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (updates.name !== undefined) set.name = updates.name;
      if (updates.description !== undefined)
        set.description = updates.description;
      if (updates.schemaPrompt !== undefined)
        set.schemaPrompt = updates.schemaPrompt;
      if (updates.model !== undefined) set.model = updates.model;

      const [updated] = await ctx.db
        .update(knowledgeBases)
        .set(set)
        .where(
          and(
            eq(knowledgeBases.id, id),
            eq(knowledgeBases.workspaceId, ctx.workspaceId),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Knowledge base not found",
        });
      }
      return updated;
    }),

  delete: workspaceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(knowledgeBases)
        .where(
          and(
            eq(knowledgeBases.id, input.id),
            eq(knowledgeBases.workspaceId, ctx.workspaceId),
          ),
        )
        .returning();

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Knowledge base not found",
        });
      }
      return { success: true };
    }),

  sources: workspaceProcedure
    .input(z.object({ knowledgeBaseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await getKBWithAccess(ctx.db, input.knowledgeBaseId, ctx.workspaceId);

      // Get all tag IDs linked to this KB
      const linkedTags = await ctx.db
        .select({ tagId: kbTags.tagId })
        .from(kbTags)
        .where(eq(kbTags.knowledgeBaseId, input.knowledgeBaseId));

      if (linkedTags.length === 0) return [];

      const tagIds = linkedTags.map((t) => t.tagId);

      const rows = await ctx.db
        .select({
          id: files.id,
          name: files.name,
          mimeType: files.mimeType,
          size: files.size,
          updatedAt: files.updatedAt,
          ingestedAt: kbFileIngestions.ingestedAt,
        })
        .from(fileTags)
        .innerJoin(files, eq(fileTags.fileId, files.id))
        .leftJoin(
          kbFileIngestions,
          and(
            eq(kbFileIngestions.fileId, files.id),
            eq(kbFileIngestions.knowledgeBaseId, input.knowledgeBaseId),
          ),
        )
        .where(inArray(fileTags.tagId, tagIds))
        .orderBy(asc(files.name));

      // Deduplicate files that match multiple tags
      const seen = new Set<string>();
      return rows.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
    }),

  wikiPages: workspaceProcedure
    .input(z.object({ knowledgeBaseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const kb = await getKBWithAccess(
        ctx.db,
        input.knowledgeBaseId,
        ctx.workspaceId,
      );

      const { storage } = await createStorageForWorkspace(ctx.workspaceId);
      try {
        const { data } = await storage.download(
          `${kb.wikiStoragePath}index.md`,
        );
        const indexContent = await streamToString(data);

        const pages: Array<{ path: string; title: string }> = [];
        const linkRegex = /^- \[(.+?)\]\((.+?)\)/gm;
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(indexContent)) !== null) {
          pages.push({ title: match[1], path: match[2] });
        }
        return pages;
      } catch {
        return [];
      }
    }),

  wikiGraph: workspaceProcedure
    .input(z.object({ knowledgeBaseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const kb = await getKBWithAccess(
        ctx.db,
        input.knowledgeBaseId,
        ctx.workspaceId,
      );

      const { storage } = await createStorageForWorkspace(ctx.workspaceId);

      // Parse the index to get the page list
      let pages: Array<{ path: string; title: string }> = [];
      try {
        const { data } = await storage.download(
          `${kb.wikiStoragePath}index.md`,
        );
        const indexContent = await streamToString(data);
        const linkRegex = /^- \[(.+?)\]\((.+?)\)/gm;
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(indexContent)) !== null) {
          pages.push({ title: match[1], path: match[2] });
        }
      } catch {
        return { nodes: [], edges: [] };
      }

      if (pages.length === 0) return { nodes: [], edges: [] };

      // Build a slug→path lookup for resolving links
      const slugToPath = new Map<string, string>();
      for (const page of pages) {
        slugToPath.set(page.path, page.path);
        // Also map without .md extension
        if (page.path.endsWith(".md")) {
          slugToPath.set(page.path.slice(0, -3), page.path);
        }
      }

      // Read each page content and extract [[links]]
      const edgeSet = new Set<string>();
      const edges: Array<{ source: string; target: string }> = [];

      await Promise.all(
        pages.map(async (page) => {
          try {
            const { data } = await storage.download(
              `${kb.wikiStoragePath}${page.path}`,
            );
            const content = await streamToString(data);
            // Each callback needs its own regex instance (g flag is stateful)
            const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
            let linkMatch: RegExpExecArray | null;
            while ((linkMatch = wikiLinkRegex.exec(content)) !== null) {
              const slug = linkMatch[1];
              const targetPath =
                slugToPath.get(slug) ??
                slugToPath.get(`${slug}.md`);
              if (targetPath && targetPath !== page.path) {
                const key = `${page.path}\0${targetPath}`;
                if (!edgeSet.has(key)) {
                  edgeSet.add(key);
                  edges.push({ source: page.path, target: targetPath });
                }
              }
            }
          } catch {
            // Skip pages that can't be read
          }
        }),
      );

      return {
        nodes: pages.map((p) => ({ id: p.path, label: p.title })),
        edges,
      };
    }),

  wikiPage: workspaceProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string().uuid(),
        pagePath: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      validatePagePath(input.pagePath);
      const kb = await getKBWithAccess(
        ctx.db,
        input.knowledgeBaseId,
        ctx.workspaceId,
      );

      const { storage } = await createStorageForWorkspace(ctx.workspaceId);
      try {
        const { data } = await storage.download(
          `${kb.wikiStoragePath}${input.pagePath}`,
        );
        const content = await streamToString(data);
        return { content };
      } catch {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Wiki page not found",
        });
      }
    }),

  updateWikiPage: workspaceProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string().uuid(),
        pagePath: z.string().min(1),
        content: z.string().max(500_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      validatePagePath(input.pagePath);
      const kb = await getKBWithAccess(
        ctx.db,
        input.knowledgeBaseId,
        ctx.workspaceId,
      );

      const { storage } = await createStorageForWorkspace(ctx.workspaceId);
      await storage.upload({
        path: `${kb.wikiStoragePath}${input.pagePath}`,
        data: Buffer.from(input.content, "utf-8"),
        contentType: "text/markdown",
      });

      return { success: true };
    }),

  ingest: workspaceProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string().uuid(),
        fileId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify access
      await getKBWithAccess(ctx.db, input.knowledgeBaseId, ctx.workspaceId);

      const result = await ingestFileIntoKB({
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        knowledgeBaseId: input.knowledgeBaseId,
        fileId: input.fileId,
      });

      if (result.status === "error") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.message,
        });
      }
      if (result.status === "skipped") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This file needs to be transcribed first. Install the Document Transcription plugin and transcribe the file.",
        });
      }

      return result;
    }),

  ingestAll: workspaceProcedure
    .input(z.object({ knowledgeBaseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const kb = await getKBWithAccess(
        ctx.db,
        input.knowledgeBaseId,
        ctx.workspaceId,
      );

      if (kb.status === "building") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Knowledge base is already building",
        });
      }

      // Set status to building
      await ctx.db
        .update(knowledgeBases)
        .set({ status: "building", updatedAt: new Date() })
        .where(eq(knowledgeBases.id, kb.id));

      // Get all tag IDs linked to this KB
      const linkedTags = await ctx.db
        .select({ tagId: kbTags.tagId })
        .from(kbTags)
        .where(eq(kbTags.knowledgeBaseId, kb.id));

      const tagIds = linkedTags.map((t) => t.tagId);

      // Get all tagged files (deduplicated)
      const rawFiles = tagIds.length > 0
        ? await ctx.db
            .select({
              id: files.id,
              name: files.name,
              mimeType: files.mimeType,
              storagePath: files.storagePath,
              storageConfigId: files.storageConfigId,
            })
            .from(fileTags)
            .innerJoin(files, eq(fileTags.fileId, files.id))
            .where(inArray(fileTags.tagId, tagIds))
        : [];

      const seen = new Set<string>();
      const taggedFiles = rawFiles.filter((f) => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });

      const handler = getHandler("knowledge-base");
      const ingestFn = handler?.ingest;
      if (!ingestFn) {
        // Reset status since we can't proceed
        await ctx.db
          .update(knowledgeBases)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(knowledgeBases.id, kb.id));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Knowledge base handler not available",
        });
      }

      const pluginCtx = await buildPluginContext({
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        pluginId: kb.id,
        pluginSlug: "knowledge-base",
        config: {},
      });

      // Fire-and-forget: process files in the background so the HTTP
      // request returns immediately instead of blocking for minutes.
      // The KB `status` field ("building" → "active"/"error") is the
      // polling mechanism for the client.
      void (async () => {
        let errors = 0;
        try {
          for (const file of taggedFiles) {
            try {
              let fileContent: string;

              if (isTextIndexable(file.mimeType)) {
                const storage = await createStorageForFile(
                  file.storageConfigId,
                );
                const { data } = await storage.download(file.storagePath);
                fileContent = await streamToString(data);
              } else {
                const [transcription] = await ctx.db
                  .select({ content: fileTranscriptions.content })
                  .from(fileTranscriptions)
                  .where(
                    and(
                      eq(fileTranscriptions.fileId, file.id),
                      eq(fileTranscriptions.status, "ready"),
                    ),
                  )
                  .limit(1);

                if (!transcription?.content) {
                  errors++;
                  continue;
                }
                fileContent = transcription.content;
              }

              await ingestFn(pluginCtx, {
                knowledgeBaseId: kb.id,
                fileId: file.id,
                fileName: file.name,
                fileContent,
                wikiStoragePath: kb.wikiStoragePath,
                schemaPrompt: kb.schemaPrompt,
              });

              // Record per-file ingestion
              await ctx.db
                .insert(kbFileIngestions)
                .values({
                  knowledgeBaseId: kb.id,
                  fileId: file.id,
                  status: "ingested",
                  ingestedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: [
                    kbFileIngestions.knowledgeBaseId,
                    kbFileIngestions.fileId,
                  ],
                  set: { status: "ingested", ingestedAt: new Date() },
                });
            } catch {
              errors++;
            }
          }

          await ctx.db
            .update(knowledgeBases)
            .set({
              status: "active",
              lastIngestedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(knowledgeBases.id, kb.id));
        } catch {
          // If the whole loop blows up, mark as error so it doesn't stay
          // stuck in "building" forever.
          await ctx.db
            .update(knowledgeBases)
            .set({ status: "error", updatedAt: new Date() })
            .where(eq(knowledgeBases.id, kb.id))
            .catch(() => {});
        }
      })();

      return { status: "building", totalFiles: taggedFiles.length };
    }),

  lint: workspaceProcedure
    .input(z.object({ knowledgeBaseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const kb = await getKBWithAccess(
        ctx.db,
        input.knowledgeBaseId,
        ctx.workspaceId,
      );

      const handler = getHandler("knowledge-base");
      if (!handler?.lint) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Knowledge base handler not available",
        });
      }

      const pluginCtx = await buildPluginContext({
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        pluginId: kb.id,
        pluginSlug: "knowledge-base",
        config: {},
      });

      const result = await handler.lint(pluginCtx, {
        knowledgeBaseId: kb.id,
        wikiStoragePath: kb.wikiStoragePath,
        schemaPrompt: kb.schemaPrompt,
      });

      await ctx.db
        .update(knowledgeBases)
        .set({ lastLintedAt: new Date(), updatedAt: new Date() })
        .where(eq(knowledgeBases.id, kb.id));

      return result;
    }),

  conversations: workspaceProcedure
    .input(z.object({ knowledgeBaseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await getKBWithAccess(ctx.db, input.knowledgeBaseId, ctx.workspaceId);

      return ctx.db
        .select({
          id: kbConversations.id,
          title: kbConversations.title,
          createdAt: kbConversations.createdAt,
          updatedAt: kbConversations.updatedAt,
        })
        .from(kbConversations)
        .where(
          and(
            eq(kbConversations.knowledgeBaseId, input.knowledgeBaseId),
            eq(kbConversations.userId, ctx.userId),
          ),
        )
        .orderBy(desc(kbConversations.updatedAt));
    }),

  conversation: workspaceProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [conversation] = await ctx.db
        .select({
          id: kbConversations.id,
          title: kbConversations.title,
          knowledgeBaseId: kbConversations.knowledgeBaseId,
          createdAt: kbConversations.createdAt,
        })
        .from(kbConversations)
        .innerJoin(
          knowledgeBases,
          eq(kbConversations.knowledgeBaseId, knowledgeBases.id),
        )
        .where(
          and(
            eq(kbConversations.id, input.conversationId),
            eq(kbConversations.userId, ctx.userId),
            eq(knowledgeBases.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const messages = await ctx.db
        .select({
          id: kbMessages.id,
          role: kbMessages.role,
          parts: kbMessages.parts,
          metadata: kbMessages.metadata,
          createdAt: kbMessages.createdAt,
        })
        .from(kbMessages)
        .where(eq(kbMessages.conversationId, conversation.id))
        .orderBy(asc(kbMessages.createdAt));

      return { ...conversation, messages };
    }),

  createConversation: workspaceProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string().uuid(),
        title: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getKBWithAccess(ctx.db, input.knowledgeBaseId, ctx.workspaceId);

      const [conversation] = await ctx.db
        .insert(kbConversations)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          userId: ctx.userId,
          title: input.title ?? null,
        })
        .returning();

      return conversation;
    }),

  deleteConversation: workspaceProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify conversation belongs to a KB in the current workspace
      const [conv] = await ctx.db
        .select({ id: kbConversations.id })
        .from(kbConversations)
        .innerJoin(
          knowledgeBases,
          eq(kbConversations.knowledgeBaseId, knowledgeBases.id),
        )
        .where(
          and(
            eq(kbConversations.id, input.conversationId),
            eq(kbConversations.userId, ctx.userId),
            eq(knowledgeBases.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);

      if (!conv) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      await ctx.db
        .delete(kbConversations)
        .where(eq(kbConversations.id, conv.id));

      return { success: true };
    }),
});
