import { z } from "zod";
import { eq, and, asc, isNull, not, like } from "drizzle-orm";
import { createRouter, workspaceProcedure } from "../init";
import { folders, files } from "@locker/database";
import {
  createFolderSchema,
  renameFolderSchema,
  moveItemSchema,
} from "@locker/common";
import { invalidateWorkspaceVfsSnapshot } from "../../vfs/locker-vfs";

export const foldersRouter = createRouter({
  list: workspaceProcedure
    .input(
      z.object({
        parentId: z.string().uuid().nullable().default(null),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(folders.workspaceId, ctx.workspaceId)];

      if (input.parentId) {
        conditions.push(eq(folders.parentId, input.parentId));
      } else {
        conditions.push(isNull(folders.parentId));
      }

      // Hide system folders (dot-prefixed, e.g. .plugins) from the explorer
      conditions.push(not(like(folders.name, ".%")));

      return ctx.db
        .select()
        .from(folders)
        .where(and(...conditions))
        .orderBy(asc(folders.name));
    }),

  get: workspaceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [folder] = await ctx.db
        .select()
        .from(folders)
        .where(
          and(
            eq(folders.id, input.id),
            eq(folders.workspaceId, ctx.workspaceId),
          ),
        );

      return folder ?? null;
    }),

  getBreadcrumbs: workspaceProcedure
    .input(z.object({ folderId: z.string().uuid().nullable() }))
    .query(async ({ ctx, input }) => {
      if (!input.folderId) return [];

      const breadcrumbs: { id: string; name: string }[] = [];
      let currentId: string | null = input.folderId;

      while (currentId) {
        const [folder] = await ctx.db
          .select({
            id: folders.id,
            name: folders.name,
            parentId: folders.parentId,
          })
          .from(folders)
          .where(
            and(
              eq(folders.id, currentId),
              eq(folders.workspaceId, ctx.workspaceId),
            ),
          );

        if (!folder) break;
        breadcrumbs.unshift({ id: folder.id, name: folder.name });
        currentId = folder.parentId;
      }

      return breadcrumbs;
    }),

  create: workspaceProcedure
    .input(createFolderSchema)
    .mutation(async ({ ctx, input }) => {
      // Validate parent folder belongs to user
      if (input.parentId) {
        const [parent] = await ctx.db
          .select()
          .from(folders)
          .where(
            and(
              eq(folders.id, input.parentId),
              eq(folders.workspaceId, ctx.workspaceId),
            ),
          );
        if (!parent) throw new Error("Parent folder not found");
      }

      const [folder] = await ctx.db
        .insert(folders)
        .values({
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
          parentId: input.parentId ?? null,
          name: input.name,
        })
        .returning();

      invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
      return folder;
    }),

  rename: workspaceProcedure
    .input(renameFolderSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(folders)
        .set({ name: input.name, updatedAt: new Date() })
        .where(
          and(
            eq(folders.id, input.id),
            eq(folders.workspaceId, ctx.workspaceId),
          ),
        )
        .returning();

      invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
      return updated;
    }),

  move: workspaceProcedure
    .input(moveItemSchema)
    .mutation(async ({ ctx, input }) => {
      // Prevent moving folder into itself or its children
      if (input.targetFolderId) {
        const [targetFolder] = await ctx.db
          .select({ id: folders.id })
          .from(folders)
          .where(
            and(
              eq(folders.id, input.targetFolderId),
              eq(folders.workspaceId, ctx.workspaceId),
            ),
          );

        if (!targetFolder) {
          throw new Error("Target folder not found");
        }

        let currentId: string | null = input.targetFolderId;
        while (currentId) {
          if (currentId === input.id) {
            throw new Error(
              "Cannot move a folder into itself or its subfolder",
            );
          }
          const [parent] = await ctx.db
            .select({ parentId: folders.parentId })
            .from(folders)
            .where(
              and(
                eq(folders.id, currentId),
                eq(folders.workspaceId, ctx.workspaceId),
              ),
            );
          if (!parent) {
            throw new Error("Target folder not found");
          }
          currentId = parent?.parentId ?? null;
        }
      }

      const [updated] = await ctx.db
        .update(folders)
        .set({ parentId: input.targetFolderId, updatedAt: new Date() })
        .where(
          and(
            eq(folders.id, input.id),
            eq(folders.workspaceId, ctx.workspaceId),
          ),
        )
        .returning();

      invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
      return updated;
    }),

  delete: workspaceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // This cascades — files in this folder get folderId set to null
      // Subfolders are deleted via application-level cascade
      await deleteFolderRecursive(ctx.db, ctx.workspaceId, input.id);
      invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
      return { success: true };
    }),
});

async function deleteFolderRecursive(
  db: ReturnType<typeof import("@locker/database/client").getDb>,
  workspaceId: string,
  folderId: string,
) {
  // Get all subfolders
  const subfolders = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(eq(folders.parentId, folderId), eq(folders.workspaceId, workspaceId)),
    );

  // Recursively delete subfolders
  for (const subfolder of subfolders) {
    await deleteFolderRecursive(db, workspaceId, subfolder.id);
  }

  // Move files in this folder to root (set folderId to null)
  await db
    .update(files)
    .set({ folderId: null })
    .where(
      and(eq(files.folderId, folderId), eq(files.workspaceId, workspaceId)),
    );

  // Delete the folder
  await db
    .delete(folders)
    .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)));
}
