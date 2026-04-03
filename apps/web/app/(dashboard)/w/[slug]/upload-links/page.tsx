'use client';

import { useState } from 'react';
import { Copy, Trash2, XCircle, Upload, Plus, Check } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export default function UploadLinksPage() {
  const { data: links } = trpc.uploadLinks.list.useQuery();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const createLink = trpc.uploadLinks.create.useMutation({
    onSuccess: (data) => {
      utils.uploadLinks.list.invalidate();
      setShowCreate(false);
      setName('');
      navigator.clipboard.writeText(data.uploadUrl);
      toast.success('Upload link created and copied');
    },
  });

  const revoke = trpc.uploadLinks.revoke.useMutation({
    onSuccess: () => {
      utils.uploadLinks.list.invalidate();
      toast.success('Upload link revoked');
    },
  });

  const deleteLink = trpc.uploadLinks.delete.useMutation({
    onSuccess: () => {
      utils.uploadLinks.list.invalidate();
      toast.success('Upload link deleted');
    },
  });

  const handleCopy = async (token: string, id: string) => {
    const url = `${window.location.origin}/upload/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div>
      {/* Sticky top bar */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4">
          <span className="text-sm font-medium">Upload Links</span>
        </div>
        <div className="px-4">
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus />
            Create link
          </Button>
        </div>
      </header>

      <div className="p-6">
        {!links || links.length === 0 ? (
          <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-20 text-center">
            <Upload className="size-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No upload links yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Create a link to let others upload files to your storage
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="grid grid-cols-[1fr_120px_100px_120px_100px] gap-4 px-4 py-2 border-b bg-muted/50">
              <span className="text-xs font-medium text-muted-foreground">
                Name
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Destination
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Uploads
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Created
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Actions
              </span>
            </div>

            {links.map((link) => (
              <div
                key={link.id}
                className="grid grid-cols-[1fr_120px_100px_120px_100px] gap-4 px-4 py-2.5 border-b last:border-b-0 items-center"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm truncate">{link.name}</span>
                  {!link.isActive && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 bg-muted text-muted-foreground rounded-sm">
                      Revoked
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground truncate">
                  {link.folderName ?? 'Root'}
                </span>
                <span className="text-xs font-mono text-muted-foreground tabular-nums">
                  {link.filesUploaded}
                  {link.maxFiles ? ` / ${link.maxFiles}` : ''}
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  {formatDate(link.createdAt)}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleCopy(link.token, link.id)}
                    disabled={!link.isActive}
                  >
                    {copiedId === link.id ? (
                      <Check className="text-green-500" />
                    ) : (
                      <Copy />
                    )}
                  </Button>
                  {link.isActive && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => revoke.mutate({ id: link.id })}
                    >
                      <XCircle />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteLink.mutate({ id: link.id })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create Upload Link Dialog */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Create upload link</DialogTitle>
              <DialogDescription>
                Others can use this link to upload files to your storage
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                createLink.mutate({ name: name.trim() });
              }}
            >
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Name
                </label>
                <Input
                  placeholder="e.g. Photo submissions"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              <DialogFooter className="pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!name.trim() || createLink.isPending}
                >
                  Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
