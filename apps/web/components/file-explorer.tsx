"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  FolderPlus,
  Upload,
  MoreHorizontal,
  Pencil,
  Trash2,
  Share2,
  Download,
  ChevronRight,
  Home,
  BarChart3,
  Sparkles,
  FileText,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { formatBytes, formatDate } from "@/lib/utils";
import { FileIcon } from "@/components/file-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UploadDialog } from "@/components/upload-dialog";
import { CreateFolderDialog } from "@/components/create-folder-dialog";
import { RenameDialog } from "@/components/rename-dialog";
import { ShareDialog } from "@/components/share-dialog";
import { CreateTrackedLinkDialog } from "@/components/create-tracked-link-dialog";
import { TranscriptionViewer } from "@/components/transcription-viewer";
import { DroppableFolderRow } from "@/components/file-explorer/droppable-folder-row";
import { DraggableFileRow } from "@/components/file-explorer/draggable-file-row";
import { CommandSearch } from "@/components/command-search";
import { DesktopDropOverlay } from "@/components/desktop-drop-overlay";
import { useFileDrop } from "@/hooks/use-file-drop";
import { useWorkspace } from "@/lib/workspace-context";
import { isTextIndexable } from "@locker/common";
import { toast } from "sonner";

const ROW_GRID =
  "grid grid-cols-[1fr_40px] sm:grid-cols-[1fr_100px_140px_40px] gap-4 px-4 py-2.5 border-b last:border-b-0";

export function FileExplorer({ folderId }: { folderId: string | null }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | undefined>(
    undefined,
  );
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    name: string;
    type: "file" | "folder";
  } | null>(null);
  const [shareTarget, setShareTarget] = useState<{
    id: string;
    name: string;
    type: "file" | "folder";
  } | null>(null);
  const [trackTarget, setTrackTarget] = useState<{
    id: string;
    name: string;
    type: "file" | "folder";
  } | null>(null);
  const [transcriptionTarget, setTranscriptionTarget] = useState<{
    id: string;
    name: string;
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
    page: 1,
    pageSize: 100,
    field: "name",
    direction: "asc",
  });

  const deleteFile = trpc.files.delete.useMutation({
    onSuccess: () => {
      utils.files.list.invalidate();
      utils.storage.usage.invalidate();
      toast.success("File deleted");
    },
  });

  const deleteFolder = trpc.folders.delete.useMutation({
    onSuccess: () => {
      utils.folders.list.invalidate();
      toast.success("Folder deleted");
    },
  });

  const getDownloadUrl = trpc.files.getDownloadUrl.useMutation();
  const runPluginAction = trpc.plugins.runAction.useMutation();

  const { data: filePluginActions = [] } = trpc.plugins.fileActions.useQuery({
    target: "file",
  });
  const { data: folderPluginActions = [] } = trpc.plugins.fileActions.useQuery({
    target: "folder",
  });

  const fileIds = useMemo(
    () => (fileList?.items ?? []).map((f) => f.id),
    [fileList],
  );
  const { data: transcriptionStatuses = {} } =
    trpc.transcriptions.statusByFileIds.useQuery(
      { fileIds },
      { enabled: fileIds.length > 0, retry: false },
    );
  const generateTranscription = trpc.transcriptions.generate.useMutation({
    onSuccess: (result) => {
      if (result.status === "queued") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      utils.transcriptions.statusByFileIds.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleDownload = useCallback(
    async (fileId: string) => {
      const result = await getDownloadUrl.mutateAsync({ id: fileId });
      const a = document.createElement("a");
      a.href = result.url;
      a.download = result.filename;
      a.click();
    },
    [getDownloadUrl],
  );

  const handleDesktopDrop = useCallback((files: File[]) => {
    setDroppedFiles(files);
    setShowUpload(true);
  }, []);

  const handlePluginAction = useCallback(
    async (
      action: {
        workspacePluginId: string;
        actionId: string;
        label: string;
      },
      target: "file" | "folder",
      targetId: string,
    ) => {
      try {
        const result = await runPluginAction.mutateAsync({
          workspacePluginId: action.workspacePluginId,
          actionId: action.actionId,
          target,
          targetId,
        });

        toast.success(result.message);
        if (result.downloadUrl) {
          window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
        }
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [runPluginAction],
  );

  const onDrop = useCallback(
    (item: { id: string; type: "file" | "folder" }, targetFolderId: string) => {
      handleDrop(item, targetFolderId);
    },
    [handleDrop],
  );

  const folders = folderList ?? [];
  const files = fileList?.items ?? [];
  const isEmpty = folders.length === 0 && files.length === 0;

  return (
    <div>
      {/* Sticky top bar */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4">
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
          <CommandSearch />
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
                            type: "folder",
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
                            type: "folder",
                          })
                        }
                      >
                        <Share2 />
                        Share
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          setTrackTarget({
                            id: folder.id,
                            name: folder.name,
                            type: "folder",
                          })
                        }
                      >
                        <BarChart3 />
                        Track
                      </DropdownMenuItem>
                      {folderPluginActions.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          {folderPluginActions.map((action) => (
                            <DropdownMenuItem
                              key={`${action.workspacePluginId}:${action.actionId}`}
                              onSelect={() =>
                                handlePluginAction(action, "folder", folder.id)
                              }
                            >
                              <Sparkles />
                              {action.label}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => deleteFolder.mutate({ id: folder.id })}
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
                <div className="hidden sm:block">
                  <span className="text-xs font-mono text-muted-foreground tabular-nums">
                    {formatBytes(file.size)}
                  </span>
                </div>
                <div className="hidden sm:block">
                  <span className="text-xs font-mono text-muted-foreground">
                    {formatDate(file.updatedAt)}
                  </span>
                </div>
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
                    <DropdownMenuItem onSelect={() => handleDownload(file.id)}>
                      <Download />
                      Download
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setRenameTarget({
                          id: file.id,
                          name: file.name,
                          type: "file",
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
                          type: "file",
                        })
                      }
                    >
                      <Share2 />
                      Share
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setTrackTarget({
                          id: file.id,
                          name: file.name,
                          type: "file",
                        })
                      }
                    >
                      <BarChart3 />
                      Track
                    </DropdownMenuItem>
                    {filePluginActions.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        {filePluginActions.map((action) => (
                          <DropdownMenuItem
                            key={`${action.workspacePluginId}:${action.actionId}`}
                            onSelect={() =>
                              handlePluginAction(action, "file", file.id)
                            }
                          >
                            <Sparkles />
                            {action.label}
                          </DropdownMenuItem>
                        ))}
                      </>
                    )}
                    {(() => {
                      const tStatus = transcriptionStatuses[file.id];
                      if (tStatus === "ready") {
                        return (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                setTranscriptionTarget({
                                  id: file.id,
                                  name: file.name,
                                })
                              }
                            >
                              <FileText />
                              View Transcription
                            </DropdownMenuItem>
                          </>
                        );
                      }
                      if (tStatus === "processing") {
                        return (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem disabled>
                              <Loader2 className="animate-spin" />
                              Transcription in progress...
                            </DropdownMenuItem>
                          </>
                        );
                      }
                      if (tStatus === "failed") {
                        return (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                generateTranscription.mutate({
                                  fileId: file.id,
                                })
                              }
                            >
                              <FileText />
                              Retry Transcription
                            </DropdownMenuItem>
                          </>
                        );
                      }
                      if (!tStatus && !isTextIndexable(file.mimeType)) {
                        return (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                generateTranscription.mutate({
                                  fileId: file.id,
                                })
                              }
                            >
                              <FileText />
                              Generate Transcription
                            </DropdownMenuItem>
                          </>
                        );
                      }
                      return null;
                    })()}
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

      {/* Desktop file drop overlay */}
      <DesktopDropOverlay onFilesDropped={handleDesktopDrop} />

      {/* Dialogs */}
      <UploadDialog
        open={showUpload}
        onOpenChange={(open) => {
          setShowUpload(open);
          if (!open) setDroppedFiles(undefined);
        }}
        folderId={folderId}
        initialFiles={droppedFiles}
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
      {trackTarget && (
        <CreateTrackedLinkDialog
          open={!!trackTarget}
          onOpenChange={(open) => !open && setTrackTarget(null)}
          target={trackTarget}
        />
      )}
      {transcriptionTarget && (
        <TranscriptionViewer
          open={!!transcriptionTarget}
          onOpenChange={(open) => !open && setTranscriptionTarget(null)}
          file={transcriptionTarget}
        />
      )}
    </div>
  );
}
