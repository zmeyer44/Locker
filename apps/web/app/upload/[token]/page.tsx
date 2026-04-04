"use client";

import { useState, useCallback, use } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  Lock,
  AlertCircle,
  CheckCircle,
  Loader2,
  X,
} from "lucide-react";
import { Logo } from "@/assets/logo";
import { trpc } from "@/lib/trpc/client";
import { cn, formatBytes } from "@/lib/utils";
import { FileIcon } from "@/components/file-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface UploadEntry {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export default function PublicUploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [password, setPassword] = useState("");
  const [enteredPassword, setEnteredPassword] = useState<string | undefined>();
  const [files, setFiles] = useState<UploadEntry[]>([]);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = trpc.uploadLinks.validate.useQuery({
    token,
    password: enteredPassword,
  });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (data && "allowedMimeTypes" in data && data.allowedMimeTypes) {
        const filtered = acceptedFiles.filter((f) =>
          data.allowedMimeTypes!.includes(f.type),
        );
        if (filtered.length !== acceptedFiles.length) {
          toast.error("Some files were rejected due to type restrictions");
        }
        setFiles((prev) => [
          ...prev,
          ...filtered.map((file) => ({ file, status: "pending" as const })),
        ]);
      } else {
        setFiles((prev) => [
          ...prev,
          ...acceptedFiles.map((file) => ({
            file,
            status: "pending" as const,
          })),
        ]);
      }
    },
    [data],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize:
      data && "maxFileSize" in data && data.maxFileSize
        ? data.maxFileSize
        : undefined,
  });

  const handleUpload = async () => {
    setUploading(true);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      const entry = files[i]!;
      if (entry.status !== "pending") continue;

      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: "uploading" } : f)),
      );

      try {
        const formData = new FormData();
        formData.append("file", entry.file);
        formData.append("token", token);
        if (enteredPassword) formData.append("password", enteredPassword);

        const res = await fetch("/api/upload/public", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error ?? "Upload failed");
        }

        successCount++;
        setFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, status: "done" } : f)),
        );
      } catch (err) {
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
    if (errorCount > 0 && successCount === 0) {
      toast.error("Upload failed");
    } else if (errorCount > 0) {
      toast.warning(`${successCount} uploaded, ${errorCount} failed`);
    } else if (successCount > 0) {
      toast.success("Upload complete");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="skeleton h-8 w-32 rounded-sm" />
      </div>
    );
  }

  if (data && "requiresPassword" in data && data.requiresPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-6">
            <Logo className="size-5 text-primary" />
            <span className="title text-base">Locker</span>
          </div>
          <Lock className="h-8 w-8 text-muted-foreground/50 mb-3" />
          <h1 className="title text-lg mb-1">Password required</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEnteredPassword(password);
            }}
          >
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <Button type="submit" className="w-full mt-3">
              Access
            </Button>
          </form>
        </div>
      </div>
    );
  }

  if (data && "error" in data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <h1 className="title text-lg mb-1">Unable to access</h1>
          <p className="text-sm text-muted-foreground">{data.error}</p>
        </div>
      </div>
    );
  }

  const pendingCount = files.filter((f) => f.status === "pending").length;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 mb-6">
          <Logo className="size-5 text-primary" />
          <span className="title text-base">Locker</span>
          <span className="text-xs font-medium text-muted-foreground px-1.5 py-0.5 bg-primary/5 text-primary rounded-sm ml-auto">
            Upload
          </span>
        </div>

        <h1 className="title text-lg mb-1">
          {data && "name" in data ? data.name : "Upload"}
        </h1>
        <p className="text-sm text-muted-foreground mb-4">
          {data && "remainingUploads" in data && data.remainingUploads !== null
            ? `${data.remainingUploads} uploads remaining`
            : "Drop files to upload"}
        </p>

        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-sm p-8 text-center cursor-pointer transition-colors mb-4",
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50",
          )}
        >
          <input {...getInputProps()} />
          <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-foreground">
            Drop files here or click to browse
          </p>
        </div>

        {files.length > 0 && (
          <div className="max-h-48 overflow-auto space-y-1 mb-4">
            {files.map((entry, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm bg-background"
              >
                <FileIcon
                  name={entry.file.name}
                  mimeType={entry.file.type}
                  className="size-3.5 shrink-0"
                />
                <span className="text-xs text-foreground truncate flex-1">
                  {entry.file.name}
                </span>
                <span className="text-xs font-medium text-muted-foreground shrink-0">
                  {formatBytes(entry.file.size)}
                </span>
                {entry.status === "uploading" && (
                  <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
                )}
                {entry.status === "done" && (
                  <CheckCircle className="size-3.5 text-green-500 shrink-0" />
                )}
                {entry.status === "error" && (
                  <AlertCircle className="size-3.5 text-destructive shrink-0" />
                )}
                {entry.status === "pending" && !uploading && (
                  <button
                    onClick={() =>
                      setFiles((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="h-4 w-4 flex items-center justify-center cursor-pointer"
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {pendingCount > 0 && (
          <Button
            onClick={handleUpload}
            disabled={uploading}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="size-3.5" />
                Upload {pendingCount} {pendingCount === 1 ? "file" : "files"}
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
