'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  FolderPlus,
  Upload,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Share2,
  Download,
  ChevronRight,
  Home,
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { formatBytes, formatDate } from '@/lib/utils';
import { FileIcon } from '@/components/file-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UploadDialog } from '@/components/upload-dialog';
import { CreateFolderDialog } from '@/components/create-folder-dialog';
import { RenameDialog } from '@/components/rename-dialog';
import { ShareDialog } from '@/components/share-dialog';
import { DroppableFolderRow } from '@/components/file-explorer/droppable-folder-row';
import { DraggableFileRow } from '@/components/file-explorer/draggable-file-row';
import { useFileDrop } from '@/hooks/use-file-drop';
import { useWorkspace } from '@/lib/workspace-context';
import { toast } from 'sonner';

const ROW_GRID =
  'grid grid-cols-[1fr_40px] sm:grid-cols-[1fr_100px_140px_40px] gap-4 px-4 py-2.5 border-b last:border-b-0';

export function FileExplorer({ folderId }: { folderId: string | null }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const [search, setSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    name: string;
    type: 'file' | 'folder';
  } | null>(null);
  const [shareTarget, setShareTarget] = useState<{
    id: string;
    name: string;
    type: 'file' | 'folder';
  } | null>(null);

  const utils = trpc.useUtils();
  const { handleDrop } = useFileDrop();

  const { data: breadcrumbs } = trpc.folders.getBreadcrumbs.useQuery({
    folderId,
  });

  const { data: folderList } = trpc.folders.list.useQuery({
    parentId: folderId,
  });

  const { data: fileList } = trpc.files.list.useQuery({
    folderId,
    search: search || undefined,
    page: 1,
    pageSize: 100,
    field: 'name',
    direction: 'asc',
  });

  const deleteFile = trpc.files.delete.useMutation({
    onSuccess: () => {
      utils.files.list.invalidate();
      utils.storage.usage.invalidate();
      toast.success('File deleted');
    },
  });

  const deleteFolder = trpc.folders.delete.useMutation({
    onSuccess: () => {
      utils.folders.list.invalidate();
      toast.success('Folder deleted');
    },
  });

  const getDownloadUrl = trpc.files.getDownloadUrl.useMutation();

  const handleDownload = useCallback(
    async (fileId: string) => {
      const result = await getDownloadUrl.mutateAsync({ id: fileId });
      const a = document.createElement('a');
      a.href = result.url;
      a.download = result.filename;
      a.click();
    },
    [getDownloadUrl],
  );

  const onDrop = useCallback(
    (item: { id: string; type: 'file' | 'folder' }, targetFolderId: string) => {
      handleDrop(item, targetFolderId);
    },
    [handleDrop],
  );

  const folders = folderList ?? [];
  const files = fileList?.items ?? [];
  const isEmpty = folders.length === 0 && files.length === 0 && !search;

  return (
    <div>
      {/* Sticky top bar */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <nav className="flex items-center gap-1 text-sm">
            <button
              onClick={() => router.push(`/w/${workspace.slug}`)}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            >
              <Home className="size-3.5" />
              <span>Home</span>
            </button>
            {breadcrumbs?.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <ChevronRight className="size-3 text-muted-foreground/50" />
                <button
                  onClick={() =>
                    router.push(`/w/${workspace.slug}/folder/${crumb.id}`)
                  }
                  className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 px-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreateFolder(true)}
          >
            <FolderPlus />
            New Folder
          </Button>
          <Button size="sm" onClick={() => setShowUpload(true)}>
            <Upload />
            Upload
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="p-6">
        {/* Search bar */}
        <div className="mb-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8"
            />
          </div>
        </div>

        {/* File List */}
        {isEmpty ? (
          <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-20 text-center">
            <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Upload className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">No files yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Upload files or create a folder to get started
            </p>
            <Button size="sm" onClick={() => setShowUpload(true)}>
              <Upload />
              Upload files
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_40px] sm:grid-cols-[1fr_100px_140px_40px] gap-4 px-4 py-2 border-b bg-muted/50">
              <span className="text-xs font-medium text-muted-foreground">
                Name
              </span>
              <span className="hidden sm:block text-xs font-medium text-muted-foreground">
                Size
              </span>
              <span className="hidden sm:block text-xs font-medium text-muted-foreground">
                Modified
              </span>
              <span />
            </div>

            {/* Folders — droppable targets + draggable sources */}
            {folders.map((folder) => (
              <DroppableFolderRow
                key={folder.id}
                folderId={folder.id}
                folderName={folder.name}
                onDrop={onDrop}
                onClick={() =>
                  router.push(`/w/${workspace.slug}/folder/${folder.id}`)
                }
                className={`${ROW_GRID} hover:bg-muted/50 cursor-pointer group transition-colors`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileIcon
                    name={folder.name}
                    isFolder
                    className="size-4 shrink-0"
                  />
                  <span className="text-sm font-medium truncate">
                    {folder.name}
                  </span>
                </div>
                <span className="hidden sm:block text-xs font-mono text-muted-foreground">
                  &mdash;
                </span>
                <span className="hidden sm:block text-xs font-mono text-muted-foreground">
                  {formatDate(folder.updatedAt)}
                </span>
                <div onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 group-hover:opacity-100"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          setRenameTarget({
                            id: folder.id,
                            name: folder.name,
                            type: 'folder',
                          })
                        }
                      >
                        <Pencil />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          setShareTarget({
                            id: folder.id,
                            name: folder.name,
                            type: 'folder',
                          })
                        }
                      >
                        <Share2 />
                        Share
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() =>
                          deleteFolder.mutate({ id: folder.id })
                        }
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </DroppableFolderRow>
            ))}

            {/* Files — draggable sources */}
            {files.map((file) => (
              <DraggableFileRow
                key={file.id}
                fileId={file.id}
                fileName={file.name}
                className={`${ROW_GRID} hover:bg-muted/50 group transition-colors`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileIcon
                    name={file.name}
                    mimeType={file.mimeType}
                    className="size-4 shrink-0"
                  />
                  <span className="text-sm truncate">{file.name}</span>
                </div>
                <span className="hidden sm:block text-xs font-mono text-muted-foreground tabular-nums">
                  {formatBytes(file.size)}
                </span>
                <span className="hidden sm:block text-xs font-mono text-muted-foreground">
                  {formatDate(file.updatedAt)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 group-hover:opacity-100"
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => handleDownload(file.id)}
                    >
                      <Download />
                      Download
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setRenameTarget({
                          id: file.id,
                          name: file.name,
                          type: 'file',
                        })
                      }
                    >
                      <Pencil />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setShareTarget({
                          id: file.id,
                          name: file.name,
                          type: 'file',
                        })
                      }
                    >
                      <Share2 />
                      Share
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => deleteFile.mutate({ id: file.id })}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </DraggableFileRow>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <UploadDialog
        open={showUpload}
        onOpenChange={setShowUpload}
        folderId={folderId}
      />
      <CreateFolderDialog
        open={showCreateFolder}
        onOpenChange={setShowCreateFolder}
        parentId={folderId}
      />
      {renameTarget && (
        <RenameDialog
          open={!!renameTarget}
          onOpenChange={(open) => !open && setRenameTarget(null)}
          target={renameTarget}
        />
      )}
      {shareTarget && (
        <ShareDialog
          open={!!shareTarget}
          onOpenChange={(open) => !open && setShareTarget(null)}
          target={shareTarget}
        />
      )}
    </div>
  );
}
