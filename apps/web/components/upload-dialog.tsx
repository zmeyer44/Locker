'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { cn, formatBytes } from '@/lib/utils';
import { FileIcon } from '@/components/file-icon';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useWorkspace } from '@/lib/workspace-context';
import { uploadFile } from '@/lib/upload';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { MAX_FILE_SIZE } from '@openstore/common';

interface UploadFileEntry {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  progress?: number;
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const utils = trpc.useUtils();
  const workspace = useWorkspace();

  const initiateMutation = trpc.uploads.initiate.useMutation();
  const completeMutation = trpc.uploads.complete.useMutation();
  const abortMutation = trpc.uploads.abort.useMutation();

  // Populate files when opened with initialFiles (from desktop drop)
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0 && initialFiles !== initializedFor) {
      setInitializedFor(initialFiles);
      setFiles(initialFiles.map((file) => ({ file, status: 'pending' as const })));
    }
  }, [open, initialFiles, initializedFor]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map((file) => ({
      file,
      status: 'pending' as const,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

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

  const handleUpload = async () => {
    setUploading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    for (let i = 0; i < files.length; i++) {
      const entry = files[i]!;
      if (entry.status !== 'pending') continue;
      if (controller.signal.aborted) break;

      setFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: 'uploading', progress: 0 } : f,
        ),
      );

      try {
        await uploadFile({
          file: entry.file,
          folderId,
          workspaceSlug: workspace.slug,
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

        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: 'done', progress: 100 } : f,
          ),
        );
      } catch (err) {
        if (controller.signal.aborted) break;
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: 'error', error: (err as Error).message }
              : f,
          ),
        );
      }
    }

    setUploading(false);
    abortControllerRef.current = null;
    utils.files.list.invalidate();
    utils.storage.usage.invalidate();
    if (!controller.signal.aborted) {
      toast.success('Upload complete');
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
  };

  const handleClose = (open: boolean) => {
    if (!uploading) {
      setFiles([]);
      setInitializedFor(null);
      onOpenChange(open);
    }
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;

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
            'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
            isDragActive
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50',
          )}
        >
          <input {...getInputProps()} />
          <Upload className="size-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {isDragActive
              ? 'Drop files here...'
              : 'Drop files here or click to browse'}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Max {formatBytes(MAX_FILE_SIZE)} per file
          </p>
        </div>

        {files.length > 0 && (
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

                  {entry.status === 'done' && (
                    <CheckCircle className="size-3.5 text-green-500 shrink-0" />
                  )}
                  {entry.status === 'error' && (
                    <AlertCircle className="size-3.5 text-destructive shrink-0" />
                  )}
                  {entry.status === 'pending' && !uploading && (
                    <button
                      onClick={() => removeFile(i)}
                      className="size-4 flex items-center justify-center hover:bg-muted rounded-sm cursor-pointer"
                    >
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  )}
                </div>

                {/* Progress bar for active uploads */}
                {entry.status === 'uploading' && entry.progress !== undefined && (
                  <Progress value={entry.progress} className="h-1" />
                )}
              </div>
            ))}
          </div>
        )}

        {pendingCount > 0 && !uploading && (
          <Button onClick={handleUpload} className="w-full">
            <Upload />
            Upload {pendingCount} {pendingCount === 1 ? 'file' : 'files'}
          </Button>
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
