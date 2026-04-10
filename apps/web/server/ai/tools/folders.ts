import { tool } from "ai";
import { z } from "zod/v4";
import { eq, and, asc, isNull, not, like } from "drizzle-orm";
import { folders, files } from "@locker/database";
import { invalidateWorkspaceVfsSnapshot } from "../../vfs/locker-vfs";
import type { AssistantToolContext } from "./types";

export function createFolderTools(ctx: AssistantToolContext) {
  return {
    listFolders: tool({
      description:
        "List folders in the workspace. Optionally filter by parent folder. Returns folder names and IDs.",
      inputSchema: z.object({
        parentId: z
          .string()
          .uuid()
          .nullable()
          .optional()
          .describe(
            "Parent folder ID to list children of. Null or omitted for root folders.",
          ),
      }),
      execute: async ({ parentId }) => {
        const conditions = [
          eq(folders.workspaceId, ctx.workspaceId),
          not(like(folders.name, ".%")),
        ];

        if (parentId) {
          conditions.push(eq(folders.parentId, parentId));
        } else {
          conditions.push(isNull(folders.parentId));
        }

        const rows = await ctx.db
          .select({
            id: folders.id,
            name: folders.name,
            parentId: folders.parentId,
            color: folders.color,
            createdAt: folders.createdAt,
          })
          .from(folders)
          .where(and(...conditions))
          .orderBy(asc(folders.name))
          .limit(50);

        return { folders: rows };
      },
    }),

    createFolder: tool({
      description:
        "Create a new folder in the workspace. Returns the created folder.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Name for the new folder"),
        parentId: z
          .string()
          .uuid()
          .nullable()
          .optional()
          .describe("Parent folder ID. Null or omitted to create at root."),
      }),
      execute: async ({ name, parentId }) => {
        if (parentId) {
          const [parent] = await ctx.db
            .select({ id: folders.id })
            .from(folders)
            .where(
              and(
                eq(folders.id, parentId),
                eq(folders.workspaceId, ctx.workspaceId),
              ),
            )
            .limit(1);

          if (!parent) {
            return { error: "Parent folder not found" };
          }
        }

        const [folder] = await ctx.db
          .insert(folders)
          .values({
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
            parentId: parentId ?? null,
            name,
          })
          .returning();

        invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
        return { folder };
      },
    }),

    renameFolder: tool({
      description: "Rename an existing folder.",
      inputSchema: z.object({
        folderId: z.string().uuid().describe("ID of the folder to rename"),
        name: z.string().min(1).describe("New name for the folder"),
      }),
      execute: async ({ folderId, name }) => {
        const [folder] = await ctx.db
          .update(folders)
          .set({ name, updatedAt: new Date() })
          .where(
            and(
              eq(folders.id, folderId),
              eq(folders.workspaceId, ctx.workspaceId),
            ),
          )
          .returning();

        if (!folder) {
          return { error: "Folder not found" };
        }

        invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
        return { folder };
      },
    }),

    moveFolder: tool({
      description: "Move a folder to a different parent folder.",
      inputSchema: z.object({
        folderId: z.string().uuid().describe("ID of the folder to move"),
        targetFolderId: z
          .string()
          .uuid()
          .nullable()
          .describe("Target parent folder ID. Null to move to root."),
      }),
      execute: async ({ folderId, targetFolderId }) => {
        if (targetFolderId) {
          // Validate target exists
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

          if (!target) {
            return { error: "Target folder not found" };
          }

          // Prevent circular move
          if (targetFolderId === folderId) {
            return { error: "Cannot move a folder into itself" };
          }

          // Fetch all workspace folders once, then walk ancestors in-memory
          const allFolders = await ctx.db
            .select({ id: folders.id, parentId: folders.parentId })
            .from(folders)
            .where(eq(folders.workspaceId, ctx.workspaceId));

          const parentMap = new Map(allFolders.map((f) => [f.id, f.parentId]));
          let currentId: string | null = targetFolderId;
          while (currentId) {
            const parentId = parentMap.get(currentId);
            if (parentId === undefined) break;
            if (parentId === folderId) {
              return { error: "Cannot move a folder into one of its children" };
            }
            currentId = parentId;
          }
        }

        const [folder] = await ctx.db
          .update(folders)
          .set({ parentId: targetFolderId, updatedAt: new Date() })
          .where(
            and(
              eq(folders.id, folderId),
              eq(folders.workspaceId, ctx.workspaceId),
            ),
          )
          .returning();

        if (!folder) {
          return { error: "Folder not found" };
        }

        invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
        return { folder };
      },
    }),

    deleteFolder: tool({
      description:
        "Delete a folder. Files inside will be moved to root, not deleted. Sub-folders are deleted recursively.",
      inputSchema: z.object({
        folderId: z.string().uuid().describe("ID of the folder to delete"),
      }),
      execute: async ({ folderId }) => {
        // Verify folder exists
        const [folder] = await ctx.db
          .select({ id: folders.id, name: folders.name })
          .from(folders)
          .where(
            and(
              eq(folders.id, folderId),
              eq(folders.workspaceId, ctx.workspaceId),
            ),
          )
          .limit(1);

        if (!folder) {
          return { error: "Folder not found" };
        }

        // Recursive delete wrapped in a transaction for atomicity
        await ctx.db.transaction(async (tx) => {
          async function deleteFolderRecursive(id: string) {
            const subfolders = await tx
              .select({ id: folders.id })
              .from(folders)
              .where(
                and(
                  eq(folders.parentId, id),
                  eq(folders.workspaceId, ctx.workspaceId),
                ),
              );

            for (const sub of subfolders) {
              await deleteFolderRecursive(sub.id);
            }

            // Move files to root instead of deleting them
            await tx
              .update(files)
              .set({ folderId: null })
              .where(
                and(
                  eq(files.folderId, id),
                  eq(files.workspaceId, ctx.workspaceId),
                ),
              );

            await tx
              .delete(folders)
              .where(
                and(
                  eq(folders.id, id),
                  eq(folders.workspaceId, ctx.workspaceId),
                ),
              );
          }

          await deleteFolderRecursive(folderId);
        });
        invalidateWorkspaceVfsSnapshot(ctx.workspaceId);
        return { success: true, deletedFolder: folder.name };
      },
    }),
  };
}
