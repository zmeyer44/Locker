'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Copy,
  Trash2,
  Check,
  BarChart3,
  Eye,
  Users,
  Download,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { formatDate, getRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FileIcon } from '@/components/file-icon';
import { toast } from 'sonner';

export default function TrackedLinksPage() {
  const pathname = usePathname();
  const { data: links } = trpc.trackedLinks.list.useQuery();
  const utils = trpc.useUtils();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const updateLink = trpc.trackedLinks.update.useMutation({
    onSuccess: () => {
      utils.trackedLinks.list.invalidate();
    },
  });

  const deleteLink = trpc.trackedLinks.delete.useMutation({
    onSuccess: () => {
      utils.trackedLinks.list.invalidate();
      toast.success('Tracked link deleted');
    },
  });

  const handleCopy = async (token: string, id: string) => {
    const url = `${window.location.origin}/t/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleActive = (id: string, isActive: boolean) => {
    updateLink.mutate({ id, isActive: !isActive });
  };

  return (
    <div>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4">
          <BarChart3 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Tracked Links</span>
        </div>
      </header>

      <div className="p-6">
        {!links || links.length === 0 ? (
          <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-20 text-center">
            <BarChart3 className="size-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No tracked links yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Create tracked links from the file explorer to monitor engagement
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {links.map((link) => (
              <div
                key={link.id}
                className="rounded-lg border bg-card overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Link
                          href={`${pathname}/${link.id}`}
                          className="text-sm font-semibold hover:underline truncate"
                        >
                          {link.name}
                        </Link>
                        {!link.isActive && (
                          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 bg-muted text-muted-foreground rounded-sm shrink-0">
                            Inactive
                          </span>
                        )}
                        {link.expiresAt &&
                          new Date(link.expiresAt) < new Date() && (
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded-sm shrink-0">
                              Expired
                            </span>
                          )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FileIcon
                          name={link.itemName}
                          isFolder={link.itemType === 'folder'}
                          className="size-3.5 shrink-0"
                        />
                        <span className="truncate">{link.itemName}</span>
                        {link.description && (
                          <>
                            <span className="text-border">|</span>
                            <span className="truncate">
                              {link.description}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleCopy(link.token, link.id)}
                        title="Copy link"
                      >
                        {copiedId === link.id ? (
                          <Check className="text-green-500" />
                        ) : (
                          <Copy />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => toggleActive(link.id, link.isActive)}
                        title={link.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {link.isActive ? (
                          <ToggleRight className="text-green-500" />
                        ) : (
                          <ToggleLeft />
                        )}
                      </Button>
                      <Link href={`${pathname}/${link.id}`}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="View analytics"
                        >
                          <ExternalLink />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteLink.mutate({ id: link.id })}
                        title="Delete"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-5 mt-3 pt-3 border-t">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Eye className="size-3.5" />
                      <span className="font-mono tabular-nums">
                        {link.viewCount}
                      </span>
                      <span>views</span>
                      {link.maxViews && (
                        <span className="text-border">
                          / {link.maxViews} max
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="size-3.5" />
                      <span className="font-mono tabular-nums">
                        {link.uniqueVisitors}
                      </span>
                      <span>unique</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Download className="size-3.5" />
                      <span className="font-mono tabular-nums">
                        {link.downloadCount}
                      </span>
                      <span>downloads</span>
                    </div>
                    <div className="ml-auto text-xs text-muted-foreground">
                      {link.lastAccessedAt ? (
                        <span>
                          Last viewed{' '}
                          {getRelativeTime(link.lastAccessedAt.toString())}
                        </span>
                      ) : (
                        <span>Created {formatDate(link.createdAt)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
