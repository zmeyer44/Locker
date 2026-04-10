"use client";

import { useState } from "react";
import {
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FolderPlus,
  Search,
  FileText,
  Link,
  Tag,
  Info,
  Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FilePreviewCard, type FilePreviewData } from "./file-preview-card";
import { ShareLinkCard, type ShareLinkData } from "./share-link-card";
import { FileIcon } from "@/components/file-icon";
import { formatBytes } from "@/lib/utils";

interface ToolInvocationData {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  input?: Record<string, unknown>;
  state: string;
  result?: unknown;
  output?: unknown;
}

const TOOL_META: Record<string, { label: string; icon: React.ElementType }> = {
  searchFiles: { label: "Searched files", icon: Search },
  listFiles: { label: "Listed files", icon: FileText },
  getFile: { label: "Retrieved file details", icon: FileText },
  renameFile: { label: "Renamed file", icon: FileText },
  moveFile: { label: "Moved file", icon: FileText },
  deleteFile: { label: "Deleted file", icon: AlertCircle },
  getFileDownloadUrl: { label: "Generated download link", icon: Link },
  listFolders: { label: "Listed folders", icon: FolderPlus },
  createFolder: { label: "Created folder", icon: FolderPlus },
  renameFolder: { label: "Renamed folder", icon: FolderPlus },
  moveFolder: { label: "Moved folder", icon: FolderPlus },
  deleteFolder: { label: "Deleted folder", icon: AlertCircle },
  shareFile: { label: "Created share link", icon: Link },
  shareFolder: { label: "Created share link", icon: Link },
  listShareLinks: { label: "Listed share links", icon: Link },
  revokeShareLink: { label: "Revoked share link", icon: Link },
  listTags: { label: "Listed tags", icon: Tag },
  createTag: { label: "Created tag", icon: Tag },
  tagFile: { label: "Tagged file", icon: Tag },
  getWorkspaceInfo: { label: "Retrieved workspace info", icon: Info },
  listMembers: { label: "Listed members", icon: Info },
  listPlugins: { label: "Listed plugins", icon: Plug },
};

/** Tools that surface a file as the primary deliverable (user asked for it). */
const FILE_CARD_TOOLS = new Set(["getFile"]);

/** Tools that return files as intermediate search/browse results. */
const FILE_LIST_TOOLS = new Set(["searchFiles", "listFiles"]);

function getToolMeta(toolName: string) {
  return TOOL_META[toolName] ?? { label: toolName, icon: Info };
}

function formatToolResult(toolName: string, result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;

  if (r.error) return `Error: ${r.error}`;

  switch (toolName) {
    case "createFolder": {
      const folder = r.folder as any;
      return folder ? `Created folder "${folder.name}"` : null;
    }
    case "shareFile":
    case "shareFolder":
      return r.shareUrl ? "Created share link" : null;
    case "searchFiles":
    case "listFiles": {
      const files = r.files as any[];
      if (!files) return null;
      return `Found ${files.length} file${files.length === 1 ? "" : "s"}`;
    }
    case "listFolders": {
      const folders = r.folders as any[];
      if (!folders) return null;
      return `Found ${folders.length} folder${folders.length === 1 ? "" : "s"}`;
    }
    case "deleteFile":
      return r.deletedFile ? `Deleted "${r.deletedFile}"` : "File deleted";
    case "deleteFolder":
      return r.deletedFolder
        ? `Deleted folder "${r.deletedFolder}"`
        : "Folder deleted";
    case "renameFile":
    case "renameFolder": {
      const item = (r.file ?? r.folder) as any;
      return item ? `Renamed to "${item.name}"` : null;
    }
    case "revokeShareLink":
      return "Share link revoked";
    case "createTag": {
      const tag = r.tag as any;
      return tag ? `Created tag "${tag.name}"` : null;
    }
    case "tagFile": {
      const tags = r.tags as any[];
      if (!tags) return null;
      return `Applied ${tags.length} tag${tags.length === 1 ? "" : "s"}`;
    }
    case "getFileDownloadUrl":
      return r.downloadUrl ? "Download URL ready" : null;
    default:
      return r.success ? "Done" : null;
  }
}

/** Extract file objects from tool results. */
function extractFiles(
  toolName: string,
  result: unknown,
): FilePreviewData[] | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;

  if (FILE_LIST_TOOLS.has(toolName) && Array.isArray(r.files)) {
    return (r.files as any[])
      .filter((f) => f.id && f.name && f.mimeType)
      .slice(0, 10)
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: Number(f.size ?? 0),
        snippet: f.snippet ?? null,
      }));
  }

  if (FILE_CARD_TOOLS.has(toolName) && r.file && typeof r.file === "object") {
    const f = r.file as any;
    if (f.id && f.name && f.mimeType) {
      return [
        {
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: Number(f.size ?? 0),
        },
      ];
    }
  }

  return null;
}

/** Extract share link data from shareFile/shareFolder results. */
function extractShareLink(
  toolName: string,
  result: unknown,
): ShareLinkData | null {
  if (toolName !== "shareFile" && toolName !== "shareFolder") return null;
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (!r.shareUrl || typeof r.shareUrl !== "string") return null;

  const link = (r.shareLink ?? {}) as Record<string, unknown>;
  return {
    shareUrl: r.shareUrl,
    access: (link.access as "view" | "download") ?? "view",
    hasPassword: (link.hasPassword as boolean) ?? false,
    expiresAt: (link.expiresAt as string) ?? null,
    maxDownloads: (link.maxDownloads as number) ?? null,
  };
}

export function ToolInvocation({
  invocation,
  onFileClick,
}: {
  invocation: ToolInvocationData;
  onFileClick?: (fileId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = getToolMeta(invocation.toolName);

  // AI SDK v6 uses "output-available" + output; our DB uses "result" + result
  const isComplete =
    invocation.state === "result" || invocation.state === "output-available";
  const toolOutput = invocation.output ?? invocation.result;
  const hasResult = toolOutput != null;
  const resultSummary = hasResult
    ? formatToolResult(invocation.toolName, toolOutput)
    : null;
  const hasError =
    hasResult &&
    typeof toolOutput === "object" &&
    (toolOutput as any)?.error;

  // Extract data for rich rendering
  const fileCards = hasResult
    ? extractFiles(invocation.toolName, toolOutput)
    : null;
  const shareLinkData = hasResult
    ? extractShareLink(invocation.toolName, toolOutput)
    : null;

  // getFile → show full card inline (user asked for this file)
  const showFullCards =
    FILE_CARD_TOOLS.has(invocation.toolName) && fileCards && fileCards.length > 0;

  // searchFiles/listFiles → show compact list inside expandable section
  const showCompactList =
    FILE_LIST_TOOLS.has(invocation.toolName) &&
    fileCards &&
    fileCards.length > 0;

  const label = isComplete && resultSummary ? resultSummary : meta.label;

  return (
    <div className="my-3">
      {/* Tool invocation header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="group/tool flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {isComplete ? (
          hasError ? (
            <AlertCircle className="size-3.5 text-destructive shrink-0" />
          ) : (
            <CheckCircle2 className="size-3.5 text-primary/60 shrink-0" />
          )
        ) : (
          <Loader2 className="size-3.5 animate-spin shrink-0" />
        )}
        <span>{label}</span>
        <ChevronRight
          className={cn(
            "size-3 transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 ml-6 space-y-2">
          {/* Compact file list for search/list results */}
          {showCompactList && (
            <div className="space-y-0.5">
              {fileCards.map((file) => (
                <button
                  key={file.id}
                  onClick={() => onFileClick?.(file.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors group/file"
                >
                  <FileIcon
                    name={file.name}
                    mimeType={file.mimeType}
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate text-foreground group-hover/file:text-foreground">
                    {file.name}
                  </span>
                  <span className="ml-auto shrink-0 text-muted-foreground/60">
                    {formatBytes(file.size)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Raw input/output (always available when expanded) */}
          <div className="space-y-2 text-xs">
            {hasResult && !showCompactList && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Output
                </span>
                <pre className="mt-1 rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground overflow-auto max-h-[300px]">
                  {JSON.stringify(toolOutput, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full file preview cards — only for getFile (user asked for this file) */}
      {showFullCards && (
        <div className="mt-3 flex flex-col gap-2">
          {fileCards.map((file) => (
            <FilePreviewCard
              key={file.id}
              file={file}
              onClick={() => onFileClick?.(file.id)}
            />
          ))}
        </div>
      )}

      {/* Share link card — always shown inline (it's a deliverable) */}
      {shareLinkData && (
        <div className="mt-3">
          <ShareLinkCard link={shareLinkData} />
        </div>
      )}
    </div>
  );
}
