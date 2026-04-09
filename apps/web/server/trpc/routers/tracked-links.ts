import { z } from "zod";
import { eq, and, sql, desc, count, asc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { createRouter, workspaceProcedure, publicProcedure } from "../init";
import {
  trackedLinks,
  trackedLinkEvents,
  files,
  folders,
} from "@locker/database";
import {
  createTrackedLinkSchema,
  updateTrackedLinkSchema,
} from "@locker/common";
import { TRACKED_LINK_TOKEN_LENGTH } from "@locker/common";
import { createStorageForFile } from "../../../server/storage";
import { hashLinkPassword, verifyLinkPassword } from "../../security/password";
import { isDescendantFolder, buildBreadcrumbs } from "./shares";

function generateToken(): string {
  return randomBytes(TRACKED_LINK_TOKEN_LENGTH).toString("hex");
}

export const trackedLinksRouter = createRouter({
  list: workspaceProcedure.query(async ({ ctx }) => {
    const links = await ctx.db
      .select()
      .from(trackedLinks)
      .where(eq(trackedLinks.workspaceId, ctx.workspaceId))
      .orderBy(desc(trackedLinks.createdAt));

    const enriched = await Promise.all(
      links.map(async (link) => {
        let itemName = "Unknown";
        let itemType: "file" | "folder" = "file";

        if (link.fileId) {
          const [file] = await ctx.db
            .select({ name: files.name, mimeType: files.mimeType })
            .from(files)
            .where(eq(files.id, link.fileId));
          itemName = file?.name ?? "Deleted file";
          itemType = "file";
        } else if (link.folderId) {
          const [folder] = await ctx.db
            .select({ name: folders.name })
            .from(folders)
            .where(eq(folders.id, link.folderId));
          itemName = folder?.name ?? "Deleted folder";
          itemType = "folder";
        }

        // Get unique visitors count
        const [visitors] = await ctx.db
          .select({
            count: sql<number>`count(distinct ${trackedLinkEvents.visitorId})`,
          })
          .from(trackedLinkEvents)
          .where(eq(trackedLinkEvents.trackedLinkId, link.id));

        return {
          ...link,
          itemName,
          itemType,
          uniqueVisitors: visitors?.count ?? 0,
        };
      }),
    );

    return enriched;
  }),

  get: workspaceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [link] = await ctx.db
        .select()
        .from(trackedLinks)
        .where(
          and(
            eq(trackedLinks.id, input.id),
            eq(trackedLinks.workspaceId, ctx.workspaceId),
          ),
        );

      if (!link) return null;

      let itemName = "Unknown";
      let itemType: "file" | "folder" = "file";
      let mimeType: string | undefined;

      if (link.fileId) {
        const [file] = await ctx.db
          .select({ name: files.name, mimeType: files.mimeType })
          .from(files)
          .where(eq(files.id, link.fileId));
        itemName = file?.name ?? "Deleted file";
        mimeType = file?.mimeType;
        itemType = "file";
      } else if (link.folderId) {
        const [folder] = await ctx.db
          .select({ name: folders.name })
          .from(folders)
          .where(eq(folders.id, link.folderId));
        itemName = folder?.name ?? "Deleted folder";
        itemType = "folder";
      }

      return { ...link, itemName, itemType, mimeType };
    }),

  create: workspaceProcedure
    .input(createTrackedLinkSchema)
    .mutation(async ({ ctx, input }) => {
      if (!input.fileId && !input.folderId) {
        throw new Error("Must specify either fileId or folderId");
      }

      if (input.fileId) {
        const [file] = await ctx.db
          .select()
          .from(files)
          .where(
            and(
              eq(files.id, input.fileId),
              eq(files.workspaceId, ctx.workspaceId),
            ),
          );
        if (!file) throw new Error("File not found");
      }

      if (input.folderId) {
        const [folder] = await ctx.db
          .select()
          .from(folders)
          .where(
            and(
              eq(folders.id, input.folderId),
              eq(folders.workspaceId, ctx.workspaceId),
            ),
          );
        if (!folder) throw new Error("Folder not found");
      }

      const token = generateToken();

      const [link] = await ctx.db
        .insert(trackedLinks)
        .values({
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
          fileId: input.fileId ?? null,
          folderId: input.folderId ?? null,
          token,
          name: input.name,
          description: input.description ?? null,
          access: input.access,
          hasPassword: !!input.password,
          passwordHash: input.password
            ? hashLinkPassword(input.password)
            : null,
          requireEmail: input.requireEmail,
          expiresAt: input.expiresAt ?? null,
          validFrom: input.validFrom ?? null,
          validUntil: input.validUntil ?? null,
          maxViews: input.maxViews ?? null,
        })
        .returning();

      return {
        ...link,
        trackingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/t/${token}`,
      };
    }),

  update: workspaceProcedure
    .input(updateTrackedLinkSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, password, ...rest } = input;

      const updateData: Record<string, unknown> = {
        ...rest,
        updatedAt: new Date(),
      };

      // Handle password update
      if (password === null) {
        updateData.hasPassword = false;
        updateData.passwordHash = null;
      } else if (password) {
        updateData.hasPassword = true;
        updateData.passwordHash = hashLinkPassword(password);
      }
      delete updateData.password;

      const [updated] = await ctx.db
        .update(trackedLinks)
        .set(updateData)
        .where(
          and(
            eq(trackedLinks.id, id),
            eq(trackedLinks.workspaceId, ctx.workspaceId),
          ),
        )
        .returning();

      return updated;
    }),

  delete: workspaceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(trackedLinks)
        .where(
          and(
            eq(trackedLinks.id, input.id),
            eq(trackedLinks.workspaceId, ctx.workspaceId),
          ),
        );
      return { success: true };
    }),

  // Get event log for a tracked link
  events: workspaceProcedure
    .input(
      z.object({
        linkId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const [link] = await ctx.db
        .select({ id: trackedLinks.id })
        .from(trackedLinks)
        .where(
          and(
            eq(trackedLinks.id, input.linkId),
            eq(trackedLinks.workspaceId, ctx.workspaceId),
          ),
        );
      if (!link) throw new Error("Link not found");

      const events = await ctx.db
        .select()
        .from(trackedLinkEvents)
        .where(eq(trackedLinkEvents.trackedLinkId, input.linkId))
        .orderBy(desc(trackedLinkEvents.timestamp))
        .limit(input.limit)
        .offset(input.offset);

      const [total] = await ctx.db
        .select({ count: count() })
        .from(trackedLinkEvents)
        .where(eq(trackedLinkEvents.trackedLinkId, input.linkId));

      return { events, total: total?.count ?? 0 };
    }),

  // Aggregated analytics for a tracked link
  analytics: workspaceProcedure
    .input(
      z.object({
        linkId: z.string().uuid(),
        days: z.number().int().min(1).max(90).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const [link] = await ctx.db
        .select({ id: trackedLinks.id })
        .from(trackedLinks)
        .where(
          and(
            eq(trackedLinks.id, input.linkId),
            eq(trackedLinks.workspaceId, ctx.workspaceId),
          ),
        );
      if (!link) throw new Error("Link not found");

      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - input.days);

      // Views by day
      const viewsByDay = await ctx.db
        .select({
          date: sql<string>`date(${trackedLinkEvents.timestamp})`,
          views: count(),
        })
        .from(trackedLinkEvents)
        .where(
          and(
            eq(trackedLinkEvents.trackedLinkId, input.linkId),
            sql`${trackedLinkEvents.timestamp} >= ${sinceDate}`,
          ),
        )
        .groupBy(sql`date(${trackedLinkEvents.timestamp})`)
        .orderBy(sql`date(${trackedLinkEvents.timestamp})`);

      // Device type breakdown
      const deviceBreakdown = await ctx.db
        .select({
          deviceType: trackedLinkEvents.deviceType,
          count: count(),
        })
        .from(trackedLinkEvents)
        .where(eq(trackedLinkEvents.trackedLinkId, input.linkId))
        .groupBy(trackedLinkEvents.deviceType);

      // Browser breakdown
      const browserBreakdown = await ctx.db
        .select({
          browser: trackedLinkEvents.browser,
          count: count(),
        })
        .from(trackedLinkEvents)
        .where(eq(trackedLinkEvents.trackedLinkId, input.linkId))
        .groupBy(trackedLinkEvents.browser);

      // OS breakdown
      const osBreakdown = await ctx.db
        .select({
          os: trackedLinkEvents.os,
          count: count(),
        })
        .from(trackedLinkEvents)
        .where(eq(trackedLinkEvents.trackedLinkId, input.linkId))
        .groupBy(trackedLinkEvents.os);

      // Country breakdown
      const countryBreakdown = await ctx.db
        .select({
          country: trackedLinkEvents.country,
          countryCode: trackedLinkEvents.countryCode,
          count: count(),
        })
        .from(trackedLinkEvents)
        .where(eq(trackedLinkEvents.trackedLinkId, input.linkId))
        .groupBy(trackedLinkEvents.country, trackedLinkEvents.countryCode);

      // City breakdown
      const cityBreakdown = await ctx.db
        .select({
          city: trackedLinkEvents.city,
          region: trackedLinkEvents.region,
          country: trackedLinkEvents.country,
          count: count(),
        })
        .from(trackedLinkEvents)
        .where(eq(trackedLinkEvents.trackedLinkId, input.linkId))
        .groupBy(
          trackedLinkEvents.city,
          trackedLinkEvents.region,
          trackedLinkEvents.country,
        );

      // Referrer breakdown
      const referrerBreakdown = await ctx.db
        .select({
          referrer: trackedLinkEvents.referrer,
          count: count(),
        })
        .from(trackedLinkEvents)
        .where(eq(trackedLinkEvents.trackedLinkId, input.linkId))
        .groupBy(trackedLinkEvents.referrer);

      // Unique visitors
      const [uniqueVisitors] = await ctx.db
        .select({
          count: sql<number>`count(distinct ${trackedLinkEvents.visitorId})`,
        })
        .from(trackedLinkEvents)
        .where(eq(trackedLinkEvents.trackedLinkId, input.linkId));

      // Avg duration
      const [avgDuration] = await ctx.db
        .select({
          avg: sql<number>`avg(${trackedLinkEvents.durationSeconds})`,
        })
        .from(trackedLinkEvents)
        .where(
          and(
            eq(trackedLinkEvents.trackedLinkId, input.linkId),
            sql`${trackedLinkEvents.durationSeconds} is not null`,
          ),
        );

      return {
        viewsByDay,
        deviceBreakdown,
        browserBreakdown,
        osBreakdown,
        countryBreakdown,
        cityBreakdown,
        referrerBreakdown,
        uniqueVisitors: uniqueVisitors?.count ?? 0,
        avgDurationSeconds: avgDuration?.avg
          ? Math.round(avgDuration.avg)
          : null,
      };
    }),

  // Public: access a tracked link (called from /t/[token])
  access: publicProcedure
    .input(
      z.object({
        token: z.string(),
        password: z.string().optional(),
        email: z.string().email().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [link] = await ctx.db
        .select()
        .from(trackedLinks)
        .where(eq(trackedLinks.token, input.token));

      if (!link || !link.isActive) {
        return { error: "Link not found or has been deactivated" };
      }

      const now = new Date();

      if (link.expiresAt && new Date(link.expiresAt) < now) {
        return { error: "This link has expired" };
      }

      if (link.validFrom && new Date(link.validFrom) > now) {
        return { error: "This link is not yet active" };
      }

      if (link.validUntil && new Date(link.validUntil) < now) {
        return { error: "This link is no longer valid" };
      }

      if (link.maxViews && link.viewCount >= link.maxViews) {
        return { error: "View limit reached" };
      }

      if (link.hasPassword) {
        if (!input.password) {
          return { requiresPassword: true, requiresEmail: link.requireEmail };
        }
        if (!verifyLinkPassword(input.password, link.passwordHash)) {
          return { error: "Incorrect password" };
        }
      }

      if (link.requireEmail && !input.email) {
        return { requiresEmail: true, requiresPassword: link.hasPassword };
      }

      // Get the shared item
      let sharedItem: {
        type: "file" | "folder";
        name: string;
        size?: number;
        mimeType?: string;
        files?: { id: string; name: string; size: number; mimeType: string }[];
        subfolders?: { id: string; name: string }[];
      } | null = null;

      if (link.fileId) {
        const [file] = await ctx.db
          .select()
          .from(files)
          .where(eq(files.id, link.fileId));
        if (file) {
          sharedItem = {
            type: "file",
            name: file.name,
            size: file.size,
            mimeType: file.mimeType,
          };
        }
      } else if (link.folderId) {
        const [folder] = await ctx.db
          .select()
          .from(folders)
          .where(eq(folders.id, link.folderId));
        const folderFiles = await ctx.db
          .select({
            id: files.id,
            name: files.name,
            size: files.size,
            mimeType: files.mimeType,
          })
          .from(files)
          .where(eq(files.folderId, link.folderId));
        const subfolders = await ctx.db
          .select({ id: folders.id, name: folders.name })
          .from(folders)
          .where(eq(folders.parentId, link.folderId))
          .orderBy(asc(folders.name));

        if (folder) {
          sharedItem = {
            type: "folder",
            name: folder.name,
            files: folderFiles,
            subfolders,
          };
        }
      }

      // Update view count
      await ctx.db
        .update(trackedLinks)
        .set({
          viewCount: sql`${trackedLinks.viewCount} + 1`,
          lastAccessedAt: now,
        })
        .where(eq(trackedLinks.id, link.id));

      return {
        item: sharedItem,
        access: link.access,
        linkId: link.id,
        linkName: link.name,
      };
    }),

  // Public: browse into a subfolder of a shared folder
  browseFolder: publicProcedure
    .input(
      z.object({
        token: z.string(),
        folderId: z.string().uuid(),
        password: z.string().optional(),
        email: z.string().email().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [link] = await ctx.db
        .select()
        .from(trackedLinks)
        .where(eq(trackedLinks.token, input.token));

      if (!link || !link.isActive || !link.folderId) {
        return { error: "Link not found or has been deactivated" };
      }

      const now = new Date();
      if (link.expiresAt && new Date(link.expiresAt) < now) {
        return { error: "This link has expired" };
      }
      if (link.validFrom && new Date(link.validFrom) > now) {
        return { error: "This link is not yet active" };
      }
      if (link.validUntil && new Date(link.validUntil) < now) {
        return { error: "This link is no longer valid" };
      }
      if (link.hasPassword) {
        if (!input.password) return { requiresPassword: true };
        if (!verifyLinkPassword(input.password, link.passwordHash)) {
          return { error: "Incorrect password" };
        }
      }
      if (link.requireEmail && !input.email) {
        return { requiresEmail: true };
      }

      const isDescendant = await isDescendantFolder(
        ctx.db,
        input.folderId,
        link.folderId,
      );
      if (!isDescendant) {
        return { error: "Folder not found" };
      }

      const [folder] = await ctx.db
        .select({ id: folders.id, name: folders.name, parentId: folders.parentId })
        .from(folders)
        .where(eq(folders.id, input.folderId));

      if (!folder) {
        return { error: "Folder not found" };
      }

      const folderFiles = await ctx.db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
        })
        .from(files)
        .where(eq(files.folderId, input.folderId));

      const subfolders = await ctx.db
        .select({ id: folders.id, name: folders.name })
        .from(folders)
        .where(eq(folders.parentId, input.folderId))
        .orderBy(asc(folders.name));

      const breadcrumbs = await buildBreadcrumbs(ctx.db, input.folderId, link.folderId);

      return {
        folder: { id: folder.id, name: folder.name },
        files: folderFiles,
        subfolders,
        breadcrumbs,
        access: link.access,
      };
    }),

  getDownloadUrl: publicProcedure
    .input(
      z.object({
        token: z.string(),
        fileId: z.string().uuid().optional(),
        password: z.string().optional(),
        email: z.string().email().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db
        .select()
        .from(trackedLinks)
        .where(eq(trackedLinks.token, input.token));

      if (!link || !link.isActive) throw new Error("Link not found");
      if (link.access !== "download") throw new Error("Download not allowed");
      if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
        throw new Error("Link expired");
      }
      if (link.validFrom && new Date(link.validFrom) > new Date()) {
        throw new Error("Link is not yet active");
      }
      if (link.validUntil && new Date(link.validUntil) < new Date()) {
        throw new Error("Link is no longer active");
      }
      if (link.maxViews && link.viewCount >= link.maxViews) {
        throw new Error("View limit reached");
      }
      if (link.requireEmail && !input.email) {
        throw new Error("Email required");
      }
      if (
        link.hasPassword &&
        !verifyLinkPassword(input.password, link.passwordHash)
      ) {
        throw new Error("Incorrect password");
      }

      let fileId: string;
      if (link.fileId) {
        if (input.fileId && input.fileId !== link.fileId) {
          throw new Error("File not found");
        }
        fileId = link.fileId;
      } else if (link.folderId) {
        if (!input.fileId) throw new Error("No file specified");
        fileId = input.fileId;
      } else {
        throw new Error("Link target not found");
      }

      const [targetFile] = await ctx.db
        .select()
        .from(files)
        .where(
          and(
            eq(files.id, fileId),
            eq(files.workspaceId, link.workspaceId),
            eq(files.status, "ready"),
          ),
        );
      if (!targetFile) throw new Error("File not found");

      // For folder shares, verify the file lives inside the shared folder tree
      if (link.folderId) {
        if (!targetFile.folderId) throw new Error("File not found");
        const allowed = await isDescendantFolder(
          ctx.db,
          targetFile.folderId,
          link.folderId,
        );
        if (!allowed) throw new Error("File not found");
      }

      // Increment download count
      await ctx.db
        .update(trackedLinks)
        .set({
          downloadCount: sql`${trackedLinks.downloadCount} + 1`,
        })
        .where(eq(trackedLinks.id, link.id));

      const storage = await createStorageForFile(targetFile.storageConfigId);
      const url = await storage.getSignedUrl(targetFile.storagePath, 3600);
      return { url, filename: targetFile.name };
    }),
});
