"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users, ArrowRight, Plus } from "lucide-react";
import { Logo } from "@/assets/logo";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");

  const { data: pendingInvites, isLoading: invitesLoading } =
    trpc.members.myPendingInvites.useQuery();

  const createWorkspace = trpc.workspaces.create.useMutation({
    onSuccess: (workspace) => {
      router.push(`/w/${workspace.slug}`);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const acceptInvite = trpc.members.acceptInvite.useMutation({
    onSuccess: (result) => {
      if (result.workspaceSlug) {
        router.push(`/w/${result.workspaceSlug}`);
      } else {
        router.push("/home");
      }
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createWorkspace.mutate({ name: name.trim() });
  };

  const hasInvites = (pendingInvites?.length ?? 0) > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-2">
            <Logo className="size-8 text-primary" />
            <span className="text-lg font-semibold">Locker</span>
          </div>

          <h1 className="mb-1 text-xl font-semibold tracking-tight">
            Get started
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            {hasInvites
              ? "You have pending invites, or create a new workspace"
              : "Workspaces let you organize files and collaborate with your team"}
          </p>

          {/* Pending invites */}
          {invitesLoading ? (
            <div className="mb-4 flex items-center justify-center py-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : hasInvites ? (
            <div className="mb-4 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Pending invitations
              </label>
              {pendingInvites!.map((invite) => (
                <InviteCard
                  key={invite.id}
                  workspaceName={invite.workspaceName}
                  role={invite.role}
                  inviterName={invite.inviterName}
                  isPending={
                    acceptInvite.isPending &&
                    acceptInvite.variables?.token === invite.token
                  }
                  onAccept={() => acceptInvite.mutate({ token: invite.token })}
                />
              ))}
            </div>
          ) : null}

          {/* Divider when invites exist */}
          {hasInvites && (
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-card px-3 text-xs text-muted-foreground">
                  or create a new workspace
                </span>
              </div>
            </div>
          )}

          {/* Create workspace form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {!hasInvites && (
              <h2 className="sr-only">Create your workspace</h2>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace name</label>
              <Input
                placeholder="e.g. Acme Inc"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus={!hasInvites}
                required
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              variant={hasInvites ? "outline" : "default"}
              disabled={!name.trim() || createWorkspace.isPending}
            >
              {createWorkspace.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <>
                  <Plus className="size-4" />
                  Create workspace
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function InviteCard({
  workspaceName,
  role,
  inviterName,
  isPending,
  onAccept,
}: {
  workspaceName: string;
  role: string;
  inviterName: string | null;
  isPending: boolean;
  onAccept: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold">
        {workspaceName[0]?.toUpperCase() ?? "W"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{workspaceName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {inviterName ? `Invited by ${inviterName}` : "Pending invitation"}
          {" · "}
          {role}
        </p>
      </div>
      <Button
        size="sm"
        onClick={onAccept}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <>
            Join
            <ArrowRight className="size-3.5" />
          </>
        )}
      </Button>
    </div>
  );
}
