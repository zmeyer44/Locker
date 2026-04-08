import { z } from "zod";
import { eq, and, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createRouter,
  protectedProcedure,
  workspaceProcedure,
  workspaceAdminProcedure,
} from "../init";
import {
  workspaces,
  workspaceMembers,
  workspaceInvites,
  users,
} from "@locker/database";
import { inviteMemberSchema, updateMemberRoleSchema } from "@locker/common";
import crypto from "crypto";
import { createNotification } from "../../notifications";

export const membersRouter = createRouter({
  list: workspaceProcedure.query(async ({ ctx }) => {
    const members = await ctx.db
      .select({
        id: workspaceMembers.id,
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        createdAt: workspaceMembers.createdAt,
        userName: users.name,
        userEmail: users.email,
        userImage: users.image,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, ctx.workspaceId));

    return members;
  }),

  /** List pending invites addressed to the current user's email */
  myPendingInvites: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ctx.userId));

    if (!user) return [];

    const invites = await ctx.db
      .select({
        id: workspaceInvites.id,
        token: workspaceInvites.token,
        role: workspaceInvites.role,
        expiresAt: workspaceInvites.expiresAt,
        createdAt: workspaceInvites.createdAt,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
        inviterName: users.name,
        inviterEmail: users.email,
      })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
      .innerJoin(users, eq(users.id, workspaceInvites.invitedById))
      .where(
        and(
          eq(workspaceInvites.email, user.email),
          eq(workspaceInvites.status, "pending"),
          gt(workspaceInvites.expiresAt, new Date()),
        ),
      );

    return invites;
  }),

  invite: workspaceAdminProcedure
    .input(inviteMemberSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if already a member
      const existingMember = await ctx.db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, ctx.workspaceId),
            eq(users.email, input.email),
          ),
        );

      if (existingMember.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this workspace",
        });
      }

      // Check for existing pending invite
      const existingInvite = await ctx.db
        .select({ id: workspaceInvites.id })
        .from(workspaceInvites)
        .where(
          and(
            eq(workspaceInvites.workspaceId, ctx.workspaceId),
            eq(workspaceInvites.email, input.email),
            eq(workspaceInvites.status, "pending"),
          ),
        );

      if (existingInvite.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An invitation is already pending for this email",
        });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const [invite] = await ctx.db
        .insert(workspaceInvites)
        .values({
          workspaceId: ctx.workspaceId,
          email: input.email,
          role: input.role,
          token,
          invitedById: ctx.userId,
          expiresAt,
        })
        .returning();

      // Shared lookups for email + notification
      const [workspace] = await ctx.db
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, ctx.workspaceId));

      const [inviter] = await ctx.db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, ctx.userId));

      const wsName = workspace?.name ?? "a workspace";

      // Send invitation email
      try {
        const { sendEmail } = await import("@locker/email");
        const { WorkspaceInviteEmail } =
          await import("@locker/email/templates/workspace-invite");

        const baseUrl =
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        const inviteUrl = `${baseUrl}/invite/${token}`;

        await sendEmail({
          to: input.email,
          subject: `Join ${wsName} on Locker`,
          react: WorkspaceInviteEmail({
            email: input.email,
            url: inviteUrl,
            workspaceName: wsName,
            inviterName: inviter?.name ?? undefined,
            inviterEmail: inviter?.email ?? undefined,
          }),
        });
      } catch {
        // Email send failure is non-fatal - invite is still created
        console.error("Failed to send invitation email");
      }

      // Create in-app notification for the invited user (if they already have an account)
      try {
        const [invitedUser] = await ctx.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, input.email))
          .limit(1);

        if (invitedUser) {
          const inviterName = inviter?.name ?? "Someone";

          await createNotification({
            db: ctx.db,
            userId: invitedUser.id,
            type: "workspace_invite",
            title: `${inviterName} invited you to ${wsName}`,
            body: `You've been invited to join the "${wsName}" workspace as a ${input.role}.`,
            actionUrl: `/invite/${token}`,
            metadata: {
              workspaceId: ctx.workspaceId,
              inviteId: invite!.id,
            },
          });
        }
      } catch {
        // Notification failure is non-fatal
        console.error("Failed to create invite notification");
      }

      return invite;
    }),

  listInvites: workspaceAdminProcedure.query(async ({ ctx }) => {
    const invites = await ctx.db
      .select({
        id: workspaceInvites.id,
        email: workspaceInvites.email,
        role: workspaceInvites.role,
        status: workspaceInvites.status,
        expiresAt: workspaceInvites.expiresAt,
        createdAt: workspaceInvites.createdAt,
        inviterName: users.name,
      })
      .from(workspaceInvites)
      .innerJoin(users, eq(users.id, workspaceInvites.invitedById))
      .where(
        and(
          eq(workspaceInvites.workspaceId, ctx.workspaceId),
          eq(workspaceInvites.status, "pending"),
        ),
      );

    return invites;
  }),

  revokeInvite: workspaceAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(workspaceInvites)
        .set({ status: "expired" })
        .where(
          and(
            eq(workspaceInvites.id, input.id),
            eq(workspaceInvites.workspaceId, ctx.workspaceId),
          ),
        );

      return { success: true };
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [invite] = await ctx.db
        .select()
        .from(workspaceInvites)
        .where(
          and(
            eq(workspaceInvites.token, input.token),
            eq(workspaceInvites.status, "pending"),
          ),
        );

      if (!invite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found or already used",
        });
      }

      if (invite.expiresAt < new Date()) {
        await ctx.db
          .update(workspaceInvites)
          .set({ status: "expired" })
          .where(eq(workspaceInvites.id, invite.id));

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invitation has expired",
        });
      }

      // Verify email matches
      const [user] = await ctx.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.userId));

      if (user?.email !== invite.email) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This invitation was sent to a different email address",
        });
      }

      // Check if already a member
      const existing = await ctx.db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, invite.workspaceId),
            eq(workspaceMembers.userId, ctx.userId),
          ),
        );

      if (existing.length > 0) {
        await ctx.db
          .update(workspaceInvites)
          .set({ status: "accepted" })
          .where(eq(workspaceInvites.id, invite.id));

        const [ws] = await ctx.db
          .select({ slug: workspaces.slug })
          .from(workspaces)
          .where(eq(workspaces.id, invite.workspaceId));

        return { workspaceSlug: ws?.slug };
      }

      // Add as member
      await ctx.db.insert(workspaceMembers).values({
        workspaceId: invite.workspaceId,
        userId: ctx.userId,
        role: invite.role,
      });

      // Mark invite as accepted
      await ctx.db
        .update(workspaceInvites)
        .set({ status: "accepted" })
        .where(eq(workspaceInvites.id, invite.id));

      const [ws] = await ctx.db
        .select({ slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, invite.workspaceId));

      return { workspaceSlug: ws?.slug };
    }),

  getInviteInfo: protectedProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ ctx, input }) => {
      const [invite] = await ctx.db
        .select({
          id: workspaceInvites.id,
          email: workspaceInvites.email,
          role: workspaceInvites.role,
          status: workspaceInvites.status,
          expiresAt: workspaceInvites.expiresAt,
          workspaceName: workspaces.name,
          workspaceSlug: workspaces.slug,
          inviterName: users.name,
        })
        .from(workspaceInvites)
        .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
        .innerJoin(users, eq(users.id, workspaceInvites.invitedById))
        .where(eq(workspaceInvites.token, input.token));

      return invite ?? null;
    }),

  updateRole: workspaceAdminProcedure
    .input(updateMemberRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const [member] = await ctx.db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, ctx.workspaceId),
          ),
        );

      if (!member) throw new TRPCError({ code: "NOT_FOUND" });

      if (member.role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot change the owner's role",
        });
      }

      if (member.userId === ctx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot change your own role",
        });
      }

      const [updated] = await ctx.db
        .update(workspaceMembers)
        .set({ role: input.role })
        .where(eq(workspaceMembers.id, input.memberId))
        .returning();

      return updated;
    }),

  removeMember: workspaceAdminProcedure
    .input(z.object({ memberId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [member] = await ctx.db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, ctx.workspaceId),
          ),
        );

      if (!member) throw new TRPCError({ code: "NOT_FOUND" });

      if (member.role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot remove the workspace owner",
        });
      }

      await ctx.db
        .delete(workspaceMembers)
        .where(eq(workspaceMembers.id, input.memberId));

      return { success: true };
    }),

  leave: workspaceProcedure.mutation(async ({ ctx }) => {
    if (ctx.workspaceRole === "owner") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "The owner cannot leave the workspace. Transfer ownership first.",
      });
    }

    await ctx.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, ctx.workspaceId),
          eq(workspaceMembers.userId, ctx.userId),
        ),
      );

    return { success: true };
  }),
});
