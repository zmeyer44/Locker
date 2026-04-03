'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Trash2, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { formatBytes } from '@/lib/utils';

export default function WorkspaceSettingsPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const { data } = trpc.workspaces.get.useQuery({ slug: workspace.slug });
  const utils = trpc.useUtils();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [initialized, setInitialized] = useState(false);

  if (data && !initialized) {
    setName(data.name);
    setSlug(data.slug);
    setInitialized(true);
  }

  const update = trpc.workspaces.update.useMutation({
    onSuccess: (updated) => {
      utils.workspaces.list.invalidate();
      utils.workspaces.get.invalidate();
      toast.success('Workspace updated');
      if (updated?.slug && updated.slug !== workspace.slug) {
        router.push(`/w/${updated.slug}/settings`);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteWs = trpc.workspaces.delete.useMutation({
    onSuccess: () => {
      toast.success('Workspace deleted');
      router.push('/');
    },
    onError: (err) => toast.error(err.message),
  });

  const isOwner = workspace.role === 'owner';
  const isAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  return (
    <div>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4">
          <Settings className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Settings</span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-6 space-y-8">
        {/* General settings */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">General</h2>
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace URL</label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">/w/</span>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            </div>
            {isAdmin && (
              <Button
                onClick={() => update.mutate({ name, slug })}
                disabled={update.isPending}
                size="sm"
              >
                {update.isPending ? <Loader2 className="animate-spin" /> : 'Save changes'}
              </Button>
            )}
          </div>
        </div>

        {/* Storage */}
        {data && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Storage</h2>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Used</span>
                <span className="font-medium">
                  {formatBytes(data.storageUsed)} / {formatBytes(data.storageLimit)}
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min((data.storageUsed / data.storageLimit) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Danger zone */}
        {isOwner && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
            <div className="rounded-lg border border-destructive/20 bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Delete workspace</p>
                  <p className="text-xs text-muted-foreground">
                    Permanently delete this workspace and all its data
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm('Are you sure? This cannot be undone.')) {
                      deleteWs.mutate({ confirm: true });
                    }
                  }}
                  disabled={deleteWs.isPending}
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
