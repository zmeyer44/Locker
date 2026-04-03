'use client';

import { useState } from 'react';
import {
  Key,
  Plus,
  Loader2,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils';

export default function ApiKeysPage() {
  const workspace = useWorkspace();
  const utils = trpc.useUtils();
  const { data: keys } = trpc.s3Keys.list.useQuery();

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPerms, setCreatePerms] = useState<'readonly' | 'readwrite'>('readwrite');
  const [newKey, setNewKey] = useState<{ accessKeyId: string; secretKey: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const createKey = trpc.s3Keys.create.useMutation({
    onSuccess: (data) => {
      utils.s3Keys.list.invalidate();
      setNewKey({ accessKeyId: data.accessKeyId, secretKey: data.secretKey });
      setCreateName('');
      setShowCreate(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const revokeKey = trpc.s3Keys.revoke.useMutation({
    onSuccess: () => { utils.s3Keys.list.invalidate(); toast.success('Key revoked'); },
  });

  const deleteKey = trpc.s3Keys.delete.useMutation({
    onSuccess: () => { utils.s3Keys.list.invalidate(); toast.success('Key deleted'); },
  });

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const endpoint = `${baseUrl}/api/s3`;

  return (
    <div>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4">
          <Key className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">API Keys</span>
        </div>
        <div className="px-4">
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus /> Create key
          </Button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-6 space-y-8">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">S3-Compatible API</h2>
          <p className="text-sm text-muted-foreground">
            Connect any S3-compatible client (AWS CLI, rclone, boto3) to this workspace.
          </p>
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Endpoint URL</p>
                <p className="text-sm font-mono">{endpoint}</p>
              </div>
              <Button variant="ghost" size="icon-xs" onClick={() => handleCopy(endpoint, 'endpoint')}>
                {copied === 'endpoint' ? <Check className="text-green-500" /> : <Copy />}
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Bucket name</p>
                <p className="text-sm font-mono">{workspace.slug}</p>
              </div>
              <Button variant="ghost" size="icon-xs" onClick={() => handleCopy(workspace.slug, 'bucket')}>
                {copied === 'bucket' ? <Check className="text-green-500" /> : <Copy />}
              </Button>
            </div>
            <Separator />
            <div>
              <p className="text-xs font-medium text-muted-foreground">Region</p>
              <p className="text-sm font-mono">us-east-1</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Access Keys {keys && `(${keys.length})`}</h2>
          {!keys || keys.length === 0 ? (
            <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-12 text-center">
              <Key className="size-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No API keys yet</p>
              <p className="text-xs text-muted-foreground mt-1">Create a key to connect S3-compatible clients</p>
            </div>
          ) : (
            <div className="rounded-lg border bg-card overflow-hidden divide-y">
              {keys.map((key) => (
                <div key={key.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{key.name}</p>
                      {!key.isActive && (
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 bg-muted text-muted-foreground rounded-sm">Revoked</span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-muted-foreground">{key.accessKeyId}</p>
                    <p className="text-xs text-muted-foreground">
                      {key.permissions} &middot; Created {formatDate(key.createdAt)}
                      {key.lastUsedAt && ` · Last used ${formatDate(key.lastUsedAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {key.isActive && (
                      <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive"
                        onClick={() => { if (confirm('Revoke this key?')) revokeKey.mutate({ id: key.id }); }}>
                        <AlertTriangle />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive"
                      onClick={() => { if (confirm('Delete this key permanently?')) deleteKey.mutate({ id: key.id }); }}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Generate credentials for S3-compatible access</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (createName.trim()) createKey.mutate({ name: createName.trim(), permissions: createPerms }); }} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input placeholder="e.g. CI/CD pipeline" value={createName} onChange={(e) => setCreateName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Permissions</label>
              <Select value={createPerms} onValueChange={(v) => setCreatePerms(v as 'readonly' | 'readwrite')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="readwrite">Read & Write</SelectItem>
                  <SelectItem value="readonly">Read Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={!createName.trim() || createKey.isPending}>
                {createKey.isPending ? <Loader2 className="animate-spin" /> : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newKey} onOpenChange={(open) => { if (!open) { setNewKey(null); setShowSecret(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>Save the secret key now — it won&apos;t be shown again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Access Key ID</p>
                  <p className="text-sm font-mono">{newKey?.accessKeyId}</p>
                </div>
                <Button variant="ghost" size="icon-xs" onClick={() => handleCopy(newKey?.accessKeyId ?? '', 'akid')}>
                  {copied === 'akid' ? <Check className="text-green-500" /> : <Copy />}
                </Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">Secret Access Key</p>
                  <p className="text-sm font-mono truncate">{showSecret ? newKey?.secretKey : '••••••••••••••••••••••••'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-xs" onClick={() => setShowSecret(!showSecret)}>
                    {showSecret ? <EyeOff /> : <Eye />}
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => handleCopy(newKey?.secretKey ?? '', 'secret')}>
                    {copied === 'secret' ? <Check className="text-green-500" /> : <Copy />}
                  </Button>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">Copy the secret key now. It is encrypted and cannot be retrieved later.</p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setNewKey(null); setShowSecret(false); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
