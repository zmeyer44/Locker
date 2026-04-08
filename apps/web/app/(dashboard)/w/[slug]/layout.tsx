import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { headers } from "next/headers";
import { getDb } from "@locker/database/client";
import { workspaces, workspaceMembers } from "@locker/database";
import { eq, and } from "drizzle-orm";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { KBAnnouncementModal } from "@/components/kb-announcement-modal";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login");
  }

  const db = getDb();
  const [membership] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        eq(workspaceMembers.userId, session.user.id),
      ),
    );

  if (!membership) {
    redirect("/home");
  }

  return (
    <WorkspaceProvider
      workspace={{
        id: membership.id,
        name: membership.name,
        slug: membership.slug,
        role: membership.role,
      }}
    >
      {children}
      <KBAnnouncementModal />
    </WorkspaceProvider>
  );
}
