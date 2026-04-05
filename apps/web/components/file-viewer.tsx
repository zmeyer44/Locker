"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Code,
  Download,
  Eye,
  Share2,
  BarChart3,
  Pencil,
  Trash2,
  Home,
  ChevronRight,
  Sparkles,
  FileText,
  Loader2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trpc } from "@/lib/trpc/client";
import { cn, formatBytes, formatDate, getFileExtension } from "@/lib/utils";
import { FileIcon } from "@/components/file-icon";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RenameDialog } from "@/components/rename-dialog";
import { ShareDialog } from "@/components/share-dialog";
import { CreateTrackedLinkDialog } from "@/components/create-tracked-link-dialog";
import { TranscriptionViewer } from "@/components/transcription-viewer";
import { useWorkspace } from "@/lib/workspace-context";
import { isTextIndexable } from "@locker/common";
import { toast } from "sonner";
import { PDFViewer } from "@/components/pdf-viewer";

/* ------------------------------------------------------------------ */
/*  Viewer type detection                                              */
/* ------------------------------------------------------------------ */

type ViewerType =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "text"
  | "unsupported";

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "rb",
  "java",
  "kt",
  "swift",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "json",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "md",
  "mdx",
  "txt",
  "log",
  "csv",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "sql",
  "graphql",
  "gql",
  "svelte",
  "vue",
  "astro",
]);

function getViewerType(mimeType: string, name: string): ViewerType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  const ext = getFileExtension(name);
  if (ext === "md" || ext === "mdx" || mimeType === "text/markdown")
    return "markdown";
  if (mimeType.startsWith("text/") || isTextIndexable(mimeType)) return "text";
  if (CODE_EXTENSIONS.has(ext)) return "text";
  return "unsupported";
}

function getFriendlyTypeName(mimeType: string, name: string): string {
  const ext = getFileExtension(name).toUpperCase();
  if (mimeType.startsWith("image/")) return ext ? `${ext} Image` : "Image";
  if (mimeType.startsWith("video/")) return ext ? `${ext} Video` : "Video";
  if (mimeType.startsWith("audio/")) return ext ? `${ext} Audio` : "Audio";
  if (mimeType === "application/pdf") return "PDF Document";
  if (ext === "MD" || ext === "MDX") return "Markdown";
  if (ext === "CSV") return "CSV Spreadsheet";
  if (ext === "XLSX" || ext === "XLS") return "Excel Spreadsheet";
  if (ext === "PPTX" || ext === "PPT") return "Presentation";
  if (ext === "DOCX" || ext === "DOC") return "Word Document";
  if (ext === "ZIP") return "ZIP Archive";
  if (ext === "RAR") return "RAR Archive";
  if (ext) return `${ext} File`;
  return mimeType;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function FileViewer({ fileId }: { fileId: string }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const utils = trpc.useUtils();

  /* ---- dialog state ---- */
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

  /* ---- preview state ---- */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  /* ---- queries ---- */
  const { data: file, isLoading: fileLoading } = trpc.files.get.useQuery({
    id: fileId,
  });

  const { data: breadcrumbs } = trpc.folders.getBreadcrumbs.useQuery(
    { folderId: file?.folderId ?? null },
    { enabled: !!file },
  );

  const fileIds = useMemo(() => (file ? [file.id] : []), [file?.id]);
  const { data: transcriptionStatuses = {} } =
    trpc.transcriptions.statusByFileIds.useQuery(
      { fileIds },
      { enabled: fileIds.length > 0, retry: false },
    );

  const { data: filePluginActions = [] } = trpc.plugins.fileActions.useQuery({
    target: "file",
  });

  /* ---- mutations ---- */
  const getDownloadUrl = trpc.files.getDownloadUrl.useMutation();

  const deleteFile = trpc.files.delete.useMutation({
    onSuccess: () => {
      utils.files.list.invalidate();
      utils.storage.usage.invalidate();
      toast.success("File deleted");
      if (file?.folderId) {
        router.push(`/w/${workspace.slug}/folder/${file.folderId}`);
      } else {
        router.push(`/w/${workspace.slug}`);
      }
    },
  });

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

  const runPluginAction = trpc.plugins.runAction.useMutation();

  /* ---- fetch signed URL + text content ---- */
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setPreviewLoading(true);

    getDownloadUrl
      .mutateAsync({ id: fileId })
      .then((result) => {
        if (cancelled) return;
        setPreviewUrl(result.url);

        const vt = getViewerType(file.mimeType, file.name);
        if (vt === "text" || vt === "markdown") {
          fetch(result.url)
            .then((r) => r.text())
            .then((text) => {
              if (!cancelled) {
                setTextContent(text);
                setPreviewLoading(false);
              }
            })
            .catch(() => !cancelled && setPreviewLoading(false));
        } else {
          setPreviewLoading(false);
        }
      })
      .catch(() => !cancelled && setPreviewLoading(false));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  /* ---- handlers ---- */
  const handleDownload = useCallback(async () => {
    try {
      const result = await getDownloadUrl.mutateAsync({ id: fileId });
      const a = document.createElement("a");
      a.href = result.url;
      a.download = file?.name ?? "download";
      a.click();
    } catch {
      toast.error("Failed to download file");
    }
  }, [fileId, file?.name, getDownloadUrl]);

  const handlePluginAction = useCallback(
    async (action: {
      workspacePluginId: string;
      actionId: string;
      label: string;
    }) => {
      try {
        const result = await runPluginAction.mutateAsync({
          workspacePluginId: action.workspacePluginId,
          actionId: action.actionId,
          target: "file",
          targetId: fileId,
        });
        toast.success(result.message);
        if (result.downloadUrl) {
          window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
        }
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [runPluginAction, fileId],
  );

  const navigateBack = useCallback(() => {
    if (file?.folderId) {
      router.push(`/w/${workspace.slug}/folder/${file.folderId}`);
    } else {
      router.push(`/w/${workspace.slug}`);
    }
  }, [router, workspace.slug, file?.folderId]);

  /* ---- loading skeleton ---- */
  if (fileLoading) {
    return <ViewerSkeleton />;
  }

  /* ---- not found ---- */
  if (!file) {
    return (
      <div>
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/w/${workspace.slug}`)}
          >
            <Home className="size-3.5" />
            Back to files
          </Button>
        </header>
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileText className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium mb-1">File not found</p>
          <p className="text-sm text-muted-foreground mb-4">
            This file may have been deleted or you don&apos;t have access.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push(`/w/${workspace.slug}`)}
          >
            Go to files
          </Button>
        </div>
      </div>
    );
  }

  const viewerType = getViewerType(file.mimeType, file.name);
  const tStatus = transcriptionStatuses[file.id];
  const friendlyType = getFriendlyTypeName(file.mimeType, file.name);

  return (
    <div>
      {/* Header */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4 min-w-0">
          <nav className="flex items-center gap-1 text-sm min-w-0">
            <button
              onClick={() => router.push(`/w/${workspace.slug}`)}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer transition-colors shrink-0"
            >
              <Home className="size-3.5" />
              <span>Home</span>
            </button>
            {breadcrumbs?.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1 shrink-0">
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
            <span className="flex items-center gap-1 min-w-0">
              <ChevronRight className="size-3 text-muted-foreground/50 shrink-0" />
              <span className="font-medium truncate">{file.name}</span>
            </span>
          </nav>
        </div>
      </header>

      {/* Content */}
      <div className="p-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Preview area */}
          <div className="flex-1 min-w-0">
            <PreviewArea
              viewerType={viewerType}
              previewUrl={previewUrl}
              textContent={textContent}
              file={file}
              loading={previewLoading}
              onDownload={handleDownload}
            />
          </div>

          {/* Details sidebar */}
          <aside className="w-full lg:w-72 shrink-0 space-y-4">
            {/* File info */}
            <div className="rounded-lg border bg-card p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <FileIcon
                    name={file.name}
                    mimeType={file.mimeType}
                    className="size-5"
                  />
                </div>
                <div className="min-w-0">
                  <h2
                    className="text-sm font-medium truncate"
                    title={file.name}
                  >
                    {file.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {friendlyType}
                  </p>
                </div>
              </div>

              <Separator className="mb-4" />

              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Size</dt>
                  <dd className="font-mono text-xs tabular-nums">
                    {formatBytes(file.size)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Modified</dt>
                  <dd className="text-xs">{formatDate(file.updatedAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Uploaded</dt>
                  <dd className="text-xs">{formatDate(file.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground shrink-0">Type</dt>
                  <dd
                    className="text-xs font-mono truncate"
                    title={file.mimeType}
                  >
                    {file.mimeType}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Actions */}
            <div className="rounded-lg border bg-card p-3 space-y-1">
              <Button
                className="w-full justify-start"
                size="sm"
                onClick={handleDownload}
              >
                <Download className="size-4" />
                Download
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                size="sm"
                onClick={() =>
                  setShareTarget({
                    id: file.id,
                    name: file.name,
                    type: "file",
                  })
                }
              >
                <Share2 className="size-4" />
                Share
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                size="sm"
                onClick={() =>
                  setTrackTarget({
                    id: file.id,
                    name: file.name,
                    type: "file",
                  })
                }
              >
                <BarChart3 className="size-4" />
                Create tracked link
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                size="sm"
                onClick={() =>
                  setRenameTarget({
                    id: file.id,
                    name: file.name,
                    type: "file",
                  })
                }
              >
                <Pencil className="size-4" />
                Rename
              </Button>

              {/* Plugin actions */}
              {filePluginActions.length > 0 && (
                <>
                  <Separator className="!my-2" />
                  {filePluginActions.map((action) => (
                    <Button
                      key={`${action.workspacePluginId}:${action.actionId}`}
                      variant="ghost"
                      className="w-full justify-start"
                      size="sm"
                      onClick={() => handlePluginAction(action)}
                    >
                      <Sparkles className="size-4" />
                      {action.label}
                    </Button>
                  ))}
                </>
              )}

              {/* Transcription actions */}
              {(() => {
                if (tStatus === "ready") {
                  return (
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      size="sm"
                      onClick={() =>
                        setTranscriptionTarget({
                          id: file.id,
                          name: file.name,
                        })
                      }
                    >
                      <FileText className="size-4" />
                      View Transcription
                    </Button>
                  );
                }
                if (tStatus === "processing") {
                  return (
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      size="sm"
                      disabled
                    >
                      <Loader2 className="size-4 animate-spin" />
                      Transcription in progress...
                    </Button>
                  );
                }
                if (tStatus === "failed") {
                  return (
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      size="sm"
                      onClick={() =>
                        generateTranscription.mutate({ fileId: file.id })
                      }
                    >
                      <FileText className="size-4" />
                      Retry Transcription
                    </Button>
                  );
                }
                if (!tStatus && !isTextIndexable(file.mimeType)) {
                  return (
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      size="sm"
                      onClick={() =>
                        generateTranscription.mutate({ fileId: file.id })
                      }
                    >
                      <FileText className="size-4" />
                      Generate Transcription
                    </Button>
                  );
                }
                return null;
              })()}

              <Separator className="!my-2" />

              <Button
                variant="ghost"
                className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
                size="sm"
                onClick={() => deleteFile.mutate({ id: file.id })}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          </aside>
        </div>
      </div>

      {/* Dialogs */}
      {renameTarget && (
        <RenameDialog
          open={!!renameTarget}
          onOpenChange={(open) => {
            if (!open) {
              setRenameTarget(null);
              utils.files.get.invalidate({ id: fileId });
            }
          }}
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

/* ------------------------------------------------------------------ */
/*  Preview                                                            */
/* ------------------------------------------------------------------ */

function PreviewArea({
  viewerType,
  previewUrl,
  textContent,
  file,
  loading,
  onDownload,
}: {
  viewerType: ViewerType;
  previewUrl: string | null;
  textContent: string | null;
  file: { name: string; mimeType: string; size: number };
  loading: boolean;
  onDownload: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border bg-muted/30 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  switch (viewerType) {
    case "image":
      return <ImagePreview url={previewUrl} name={file.name} />;
    case "video":
      return <VideoPreview url={previewUrl} />;
    case "audio":
      return <AudioPreview url={previewUrl} file={file} />;
    case "pdf":
      return <PdfPreview url={previewUrl} name={file.name} />;
    case "markdown":
      return <MarkdownPreview content={textContent} name={file.name} />;
    case "text":
      return <TextPreview content={textContent} name={file.name} />;
    case "unsupported":
      return <UnsupportedPreview file={file} onDownload={onDownload} />;
  }
}

/* ---- Image ---- */

function ImagePreview({ url, name }: { url: string | null; name: string }) {
  if (!url) return null;
  return (
    <div
      className="rounded-lg border flex items-center justify-center min-h-[60vh] p-4"
      style={{
        backgroundImage:
          "repeating-conic-gradient(#80808012 0% 25%, transparent 0% 50%)",
        backgroundSize: "20px 20px",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={name}
        className="max-w-full max-h-[75vh] object-contain rounded"
      />
    </div>
  );
}

/* ---- Video ---- */

function VideoPreview({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <div className="rounded-lg border bg-black flex items-center justify-center min-h-[60vh]">
      <video src={url} controls className="max-w-full max-h-[75vh] rounded">
        Your browser does not support the video element.
      </video>
    </div>
  );
}

/* ---- Audio ---- */

function AudioPreview({
  url,
  file,
}: {
  url: string | null;
  file: { name: string; mimeType: string };
}) {
  if (!url) return null;
  return (
    <div className="rounded-lg border bg-muted/30 flex flex-col items-center justify-center min-h-[40vh] gap-6 p-8">
      <div className="size-24 rounded-2xl bg-muted flex items-center justify-center">
        <FileIcon
          name={file.name}
          mimeType={file.mimeType}
          className="size-10"
        />
      </div>
      <p className="text-sm font-medium">{file.name}</p>
      <audio src={url} controls className="w-full max-w-md">
        Your browser does not support the audio element.
      </audio>
    </div>
  );
}

/* ---- PDF ---- */

function PdfPreview({ url }: { url: string | null; name: string }) {
  if (!url) return null;
  return (
    <div style={{ height: "75vh" }}>
      <PDFViewer url={url} showThumbnails={false} />
    </div>
  );
}

/* ---- Markdown ---- */

function MarkdownPreview({
  content,
  name,
}: {
  content: string | null;
  name: string;
}) {
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const text = content ?? "";
  const lines = text.split("\n");
  const gutterWidth = `${String(lines.length).length + 1}ch`;

  if (!text) {
    return (
      <div className="rounded-lg border bg-muted/30 flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-muted-foreground">Empty file</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden flex flex-col">
      {/* Toolbar — mirrors pdf-viewer style */}
      <TooltipProvider>
        <div
          className={cn(
            "flex items-center justify-between px-3 py-1.5",
            "border-b bg-background/95 backdrop-blur-sm",
            "supports-[backdrop-filter]:bg-background/80",
            "shrink-0 z-10",
          )}
        >
          <span className="text-xs text-muted-foreground font-mono truncate">
            {name}
          </span>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </span>

            <div className="flex items-center rounded-full border bg-muted/50 p-0.5">
              <button
                onClick={() => setMode("rendered")}
                className={cn(
                  "relative flex items-center justify-center size-7 rounded-full transition-all duration-200",
                  mode === "rendered"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Eye className="size-3.5" />
              </button>
              <button
                onClick={() => setMode("source")}
                className={cn(
                  "relative flex items-center justify-center size-7 rounded-full transition-all duration-200",
                  mode === "source"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Code className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </TooltipProvider>

      {/* Content */}
      <div className="overflow-auto max-h-[72vh]">
        {mode === "rendered" ? (
          <div className="p-6 md:px-10 md:py-8 prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-img:rounded-lg">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        ) : (
          <pre className="text-sm font-mono leading-6">
            {lines.map((line, i) => (
              <div key={i} className="flex hover:bg-muted/30 transition-colors">
                <span
                  className="text-muted-foreground/40 select-none text-right px-3 shrink-0 border-r border-border/50"
                  style={{ minWidth: gutterWidth }}
                >
                  {i + 1}
                </span>
                <span className="px-4 whitespace-pre-wrap break-all flex-1">
                  {line || " "}
                </span>
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ---- Text / Code ---- */

function TextPreview({
  content,
  name,
}: {
  content: string | null;
  name: string;
}) {
  const text = content ?? "";
  const lines = text.split("\n");
  const gutterWidth = `${String(lines.length).length + 1}ch`;

  if (!text) {
    return (
      <div className="rounded-lg border bg-muted/30 flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-muted-foreground">Empty file</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
        <span className="text-xs text-muted-foreground font-mono">{name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
      </div>
      <div className="overflow-auto max-h-[72vh]">
        <pre className="text-sm font-mono leading-6">
          {lines.map((line, i) => (
            <div key={i} className="flex hover:bg-muted/30 transition-colors">
              <span
                className="text-muted-foreground/40 select-none text-right px-3 shrink-0 border-r border-border/50"
                style={{ minWidth: gutterWidth }}
              >
                {i + 1}
              </span>
              <span className="px-4 whitespace-pre-wrap break-all flex-1">
                {line || " "}
              </span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

/* ---- Unsupported ---- */

function UnsupportedPreview({
  file,
  onDownload,
}: {
  file: { name: string; mimeType: string; size: number };
  onDownload: () => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8 text-center">
      <div className="size-20 rounded-2xl bg-muted flex items-center justify-center">
        <FileIcon
          name={file.name}
          mimeType={file.mimeType}
          className="size-9"
        />
      </div>
      <div>
        <p className="text-sm font-medium mb-1">{file.name}</p>
        <p className="text-sm text-muted-foreground">
          Preview is not available for this file type
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {formatBytes(file.size)}
        </p>
      </div>
      <Button size="sm" onClick={onDownload}>
        <Download className="size-4" />
        Download to view
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function ViewerSkeleton() {
  return (
    <div>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
        <Skeleton className="h-4 w-48" />
      </header>
      <div className="p-6">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0">
            <Skeleton className="min-h-[60vh] w-full rounded-lg" />
          </div>
          <div className="w-full lg:w-72 shrink-0 space-y-4">
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <div className="flex items-start gap-3">
                <Skeleton className="size-10 rounded-lg" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
            <div className="rounded-lg border bg-card p-3 space-y-1">
              <Skeleton className="h-8 w-full rounded" />
              <Skeleton className="h-8 w-full rounded" />
              <Skeleton className="h-8 w-full rounded" />
              <Skeleton className="h-8 w-full rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
