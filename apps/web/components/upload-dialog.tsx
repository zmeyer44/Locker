"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, CheckCircle, AlertCircle, Loader2, Tag, Check, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn, formatBytes } from "@/lib/utils";
import { FileIcon } from "@/components/file-icon";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useWorkspace } from "@/lib/workspace-context";
import { uploadFile } from "@/lib/upload";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MAX_FILE_SIZE } from "@locker/common";

interface FileConflict {
  existingFileId: string;
  existingFileSize: number;
  resolution: "replace" | "keep-both" | null;
}

interface UploadFileEntry {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  progress?: number;
  conflict?: FileConflict;
}

export function UploadDialog({
  open,
  onOpenChange,
  folderId,
  initialFiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
  initialFiles?: File[];
}) {
  const [files, setFiles] = useState<UploadFileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [initializedFor, setInitializedFor] = useState<File[] | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const utils = trpc.useUtils();
  const workspace = useWorkspace();

  const { data: allTags = [] } = trpc.tags.list.useQuery(undefined, {
    enabled: open,
  });
  const initiateMutation = trpc.uploads.initiate.useMutation();
  const completeMutation = trpc.uploads.complete.useMutation();
  const abortMutation = trpc.uploads.abort.useMutation();
  const setFileTagsMutation = trpc.tags.setFileTags.useMutation();
  const checkConflictsMutation = trpc.uploads.checkConflicts.useMutation();

  const checkConflicts = useCallback(
    async (entries: UploadFileEntry[]) => {
      const pendingNames = entries
        .filter((e) => e.status === "pending")
        .map((e) => e.file.name);
      if (pendingNames.length === 0) return;

      try {
        const existing = await checkConflictsMutation.mutateAsync({
          folderId,
          fileNames: pendingNames,
        });

        if (existing.length === 0) return;

        const conflictMap = new Map(
          existing.map((e) => [e.name, { id: e.id, size: Number(e.size) }]),
        );

        setFiles((prev) =>
          prev.map((f) => {
            const match = conflictMap.get(f.file.name);
            if (match && f.status === "pending") {
              return {
                ...f,
                conflict: {
                  existingFileId: match.id,
                  existingFileSize: match.size,
                  resolution: null,
                },
              };
            }
            return f;
          }),
        );
      } catch {
        // Graceful degradation — proceed without conflict info
      }
    },
    [folderId, checkConflictsMutation],
  );

  // Populate files when opened with initialFiles (from desktop drop)
  useEffect(() => {
    if (
      open &&
      initialFiles &&
      initialFiles.length > 0 &&
      initialFiles !== initializedFor
    ) {
      setInitializedFor(initialFiles);
      const entries = initialFiles.map((file) => ({
        file,
        status: "pending" as const,
      }));
      setFiles(entries);
      checkConflicts(entries);
    }
  }, [open, initialFiles, initializedFor, checkConflicts]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const newEntries = acceptedFiles.map((file) => ({
        file,
        status: "pending" as const,
      }));
      setFiles((prev) => [...prev, ...newEntries]);
      checkConflicts(newEntries);
    },
    [checkConflicts],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize: MAX_FILE_SIZE,
    onDropRejected: (rejections) => {
      for (const rejection of rejections) {
        toast.error(`${rejection.file.name}: ${rejection.errors[0]?.message}`);
      }
    },
  });

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const resolveConflict = (
    index: number,
    resolution: "replace" | "keep-both",
  ) => {
    setFiles((prev) =>
      prev.map((f, i) =>
        i === index && f.conflict
          ? { ...f, conflict: { ...f.conflict, resolution } }
          : f,
      ),
    );
  };

  const resolveAllConflicts = (resolution: "replace" | "keep-both") => {
    setFiles((prev) =>
      prev.map((f) =>
        f.conflict && f.conflict.resolution === null
          ? { ...f, conflict: { ...f.conflict, resolution } }
          : f,
      ),
    );
  };

  const handleUpload = async () => {
    setUploading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      const entry = files[i]!;
      if (entry.status !== "pending") continue;
      if (controller.signal.aborted) break;

      setFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: "uploading", progress: 0 } : f,
        ),
      );

      try {
        const fileId = await uploadFile({
          file: entry.file,
          folderId,
          workspaceSlug: workspace.slug,
          conflictResolution: entry.conflict?.resolution ?? undefined,
          uploads: {
            initiate: initiateMutation,
            complete: completeMutation,
            abort: abortMutation,
          },
          onProgress: (progress) => {
            setFiles((prev) =>
              prev.map((f, idx) =>
                idx === i ? { ...f, progress: progress.percentage } : f,
              ),
            );
          },
          abortSignal: controller.signal,
        });

        if (selectedTagIds.size > 0) {
          await setFileTagsMutation.mutateAsync({
            fileId,
            tagIds: [...selectedTagIds],
          });
        }

        successCount++;
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "done", progress: 100 } : f,
          ),
        );
      } catch (err) {
        if (controller.signal.aborted) break;
        errorCount++;
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: "error", error: (err as Error).message }
              : f,
          ),
        );
      }
    }

    setUploading(false);
    abortControllerRef.current = null;
    utils.files.list.invalidate();
    utils.storage.usage.invalidate();
    if (selectedTagIds.size > 0) {
      utils.tags.getFileTagsBatch.invalidate();
    }
    if (!controller.signal.aborted) {
      if (errorCount > 0 && successCount === 0) {
        toast.error("Upload failed");
      } else if (errorCount > 0) {
        toast.warning(`${successCount} uploaded, ${errorCount} failed`);
      } else if (successCount > 0) {
        toast.success("Upload complete");
        // Auto-close dialog when all files uploaded successfully
        setFiles([]);
        setInitializedFor(null);
        setSelectedTagIds(new Set());
        onOpenChange(false);
      }
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
  };

  const handleClose = (open: boolean) => {
    if (!uploading) {
      setFiles([]);
      setInitializedFor(null);
      setSelectedTagIds(new Set());
      onOpenChange(open);
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const unresolvedConflicts = files.filter(
    (f) => f.status === "pending" && f.conflict?.resolution === null,
  );
  const hasUnresolvedConflicts = unresolvedConflicts.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
          <DialogDescription>
            Drag and drop files or click to browse
          </DialogDescription>
        </DialogHeader>

        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50",
          )}
        >
          <input {...getInputProps()} />
          <Upload className="size-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {isDragActive
              ? "Drop files here..."
              : "Drop files here or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Max {formatBytes(MAX_FILE_SIZE)} per file
          </p>
        </div>

        {files.length > 0 && (
          <>
            {/* Batch conflict actions */}
            {unresolvedConflicts.length >= 2 && !uploading && (
              <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  {unresolvedConflicts.length} files already exist
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => resolveAllConflicts("replace")}
                    className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                  >
                    Replace all
                  </button>
                  <span className="text-xs text-amber-400 dark:text-amber-600">
                    |
                  </span>
                  <button
                    onClick={() => resolveAllConflicts("keep-both")}
                    className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                  >
                    Keep all
                  </button>
                </div>
              </div>
            )}

            <div className="max-h-48 overflow-auto space-y-1">
              {files.map((entry, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-1 px-2 py-1.5 rounded-md bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <FileIcon
                      name={entry.file.name}
                      mimeType={entry.file.type}
                      className="size-3.5 shrink-0"
                    />
                    <span className="text-xs truncate flex-1">
                      {entry.file.name}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {formatBytes(entry.file.size)}
                    </span>

                    {entry.status === "done" && (
                      <CheckCircle className="size-3.5 text-green-500 shrink-0" />
                    )}
                    {entry.status === "error" && (
                      <AlertCircle className="size-3.5 text-destructive shrink-0" />
                    )}
                    {entry.status === "pending" && !uploading && (
                      <button
                        onClick={() => removeFile(i)}
                        className="size-4 flex items-center justify-center hover:bg-muted rounded-sm cursor-pointer"
                      >
                        <X className="size-3 text-muted-foreground" />
                      </button>
                    )}
                  </div>

                  {/* Conflict resolution UI */}
                  {entry.conflict &&
                    entry.status === "pending" &&
                    !uploading && (
                      <div className="flex items-center gap-1.5 ml-5">
                        {entry.conflict.resolution === null ? (
                          <>
                            <AlertTriangle className="size-3 text-amber-500 shrink-0" />
                            <span className="text-xs text-amber-600 dark:text-amber-400">
                              File exists
                            </span>
                            <button
                              onClick={() => resolveConflict(i, "replace")}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Replace
                            </button>
                            <span className="text-xs text-muted-foreground">
                              |
                            </span>
                            <button
                              onClick={() => resolveConflict(i, "keep-both")}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Keep both
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {entry.conflict.resolution === "replace"
                              ? "Will replace existing"
                              : "Will keep both"}
                          </span>
                        )}
                      </div>
                    )}

                  {/* Progress bar for active uploads */}
                  {entry.status === "uploading" &&
                    entry.progress !== undefined && (
                      <Progress value={entry.progress} className="h-1" />
                    )}
                </div>
              ))}
            </div>
          </>
        )}

        {pendingCount > 0 && !uploading && (
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "gap-1.5 shrink-0",
                    selectedTagIds.size > 0 && "text-primary border-primary/30",
                  )}
                >
                  <Tag className="size-3.5" />
                  {selectedTagIds.size > 0 ? (
                    <span>
                      {selectedTagIds.size} tag
                      {selectedTagIds.size !== 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span>Tag</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-52 p-1">
                {allTags.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                    No tags yet
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto">
                    {allTags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted transition-colors"
                      >
                        <div
                          className="size-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: tag.color ?? "#6b7280",
                          }}
                        />
                        <span className="flex-1 truncate">{tag.name}</span>
                        {selectedTagIds.has(tag.id) && (
                          <Check className="size-3.5 text-primary shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <Button
              onClick={handleUpload}
              disabled={hasUnresolvedConflicts}
              className="flex-1"
            >
              <Upload />
              Upload {pendingCount} {pendingCount === 1 ? "file" : "files"}
            </Button>
          </div>
        )}

        {uploading && (
          <div className="flex gap-2">
            <Button disabled className="flex-1">
              <Loader2 className="animate-spin" />
              Uploading...
            </Button>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
