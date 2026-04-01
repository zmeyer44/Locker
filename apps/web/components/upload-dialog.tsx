'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { cn, formatBytes } from '@/lib/utils';
import { FileIcon } from '@/components/file-icon';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { MAX_FILE_SIZE } from '@openstore/common';

interface UploadFile {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

export function UploadDialog({
  open,
  onOpenChange,
  folderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
}) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const utils = trpc.useUtils();
  const workspace = useWorkspace();

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

    for (let i = 0; i < files.length; i++) {
      const entry = files[i]!;
      if (entry.status !== 'pending') continue;

      setFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: 'uploading' } : f,
        ),
      );

      try {
        const formData = new FormData();
        formData.append('file', entry.file);
        if (folderId) formData.append('folderId', folderId);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          headers: { 'x-workspace-slug': workspace.slug },
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? 'Upload failed');
        }

        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: 'done' } : f,
          ),
        );
      } catch (err) {
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
    utils.files.list.invalidate();
    utils.storage.usage.invalidate();
    toast.success('Upload complete');
  };

  const handleClose = (open: boolean) => {
    if (!uploading) {
      setFiles([]);
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
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50"
              >
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

                {entry.status === 'uploading' && (
                  <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
                )}
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
            ))}
          </div>
        )}

        {pendingCount > 0 && (
          <Button onClick={handleUpload} disabled={uploading} className="w-full">
            {uploading ? (
              <>
                <Loader2 className="animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload />
                Upload {pendingCount} {pendingCount === 1 ? 'file' : 'files'}
              </>
            )}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
