import { z } from "zod";
import { eq, and, asc, inArray } from "drizzle-orm";
import { createRouter, workspaceProcedure } from "../init";
import { tags, fileTags, files } from "@locker/database";
import {
  createTagSchema,
  updateTagSchema,
  deleteTagSchema,
  setFileTagsSchema,
} from "@locker/common";
import { TRPCError } from "@trpc/server";

export const tagsRouter = createRouter({
  list: workspaceProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(tags)
      .where(eq(tags.workspaceId, ctx.workspaceId))
      .orderBy(asc(tags.name));
  }),

  create: workspaceProcedure
    .input(createTagSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const [tag] = await ctx.db
          .insert(tags)
          .values({
            workspaceId: ctx.workspaceId,
            name: input.name,
            color: input.color,
          })
          .returning();
        return tag;
      } catch (err: any) {
        if (err?.code === "23505") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A tag with this name already exists",
          });
        }
        throw err;
      }
    }),

  update: workspaceProcedure
    .input(updateTagSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (updates.name !== undefined) set.name = updates.name;
      if (updates.color !== undefined) set.color = updates.color;

      try {
        const [updated] = await ctx.db
          .update(tags)
          .set(set)
          .where(and(eq(tags.id, id), eq(tags.workspaceId, ctx.workspaceId)))
          .returning();

        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
        }
        return updated;
      } catch (err: any) {
        if (err?.code === "23505") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A tag with this name already exists",
          });
        }
        throw err;
      }
    }),

  delete: workspaceProcedure
    .input(deleteTagSchema)
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(tags)
        .where(
          and(eq(tags.id, input.id), eq(tags.workspaceId, ctx.workspaceId)),
        )
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
      }
      return { success: true };
    }),

  setFileTags: workspaceProcedure
    .input(setFileTagsSchema)
    .mutation(async ({ ctx, input }) => {
      const { fileId } = input;
      const tagIds = [...new Set(input.tagIds)];

      // Verify file belongs to workspace
      const [file] = await ctx.db
        .select({ id: files.id })
        .from(files)
        .where(
          and(eq(files.id, fileId), eq(files.workspaceId, ctx.workspaceId)),
        );

      if (!file) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      }

      // Verify all tags belong to workspace
      if (tagIds.length > 0) {
        const validTags = await ctx.db
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
            code: "BAD_REQUEST",
            message: "One or more tags not found",
          });
        }
      }

      // Replace all tags for this file in a transaction
      await ctx.db.transaction(async (tx) => {
        await tx.delete(fileTags).where(eq(fileTags.fileId, fileId));

        if (tagIds.length > 0) {
          await tx.insert(fileTags).values(
            tagIds.map((tagId) => ({
              fileId,
              tagId,
            })),
          );
        }
      });

      // Return the new tags for this file
      const newTags = await ctx.db
        .select({
          id: tags.id,
          name: tags.name,
          color: tags.color,
        })
        .from(fileTags)
        .innerJoin(tags, eq(fileTags.tagId, tags.id))
        .where(eq(fileTags.fileId, fileId));

      return newTags;
    }),

  getFileTags: workspaceProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: tags.id,
          name: tags.name,
          color: tags.color,
        })
        .from(fileTags)
        .innerJoin(tags, eq(fileTags.tagId, tags.id))
        .innerJoin(files, eq(fileTags.fileId, files.id))
        .where(
          and(
            eq(fileTags.fileId, input.fileId),
            eq(files.workspaceId, ctx.workspaceId),
          ),
        )
        .orderBy(asc(tags.name));
    }),

  getFileTagsBatch: workspaceProcedure
    .input(z.object({ fileIds: z.array(z.string().uuid()) }))
    .query(async ({ ctx, input }) => {
      if (input.fileIds.length === 0) return {};

      const rows = await ctx.db
        .select({
          fileId: fileTags.fileId,
          tagId: tags.id,
          tagName: tags.name,
          tagColor: tags.color,
        })
        .from(fileTags)
        .innerJoin(tags, eq(fileTags.tagId, tags.id))
        .innerJoin(files, eq(fileTags.fileId, files.id))
        .where(
          and(
            inArray(fileTags.fileId, input.fileIds),
            eq(files.workspaceId, ctx.workspaceId),
          ),
        )
        .orderBy(asc(tags.name));

      const result: Record<
        string,
        { id: string; name: string; color: string | null }[]
      > = {};
      for (const row of rows) {
        if (!result[row.fileId]) result[row.fileId] = [];
        result[row.fileId].push({
          id: row.tagId,
          name: row.tagName,
          color: row.tagColor,
        });
      }
      return result;
    }),
});
