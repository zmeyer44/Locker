import { getFileExtension } from "@/lib/utils";
import { isTextIndexable } from "@locker/common";
import type { ViewerType } from "../file-viewer/types";

export const CODE_EXTENSIONS = new Set([
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

export function getViewerType(mimeType: string, name: string): ViewerType {
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

export function getFriendlyTypeName(mimeType: string, name: string): string {
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
