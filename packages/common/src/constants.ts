// ── File size limits ────────────────────────────────────────────────────────

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
export const MULTIPART_THRESHOLD = 10 * 1024 * 1024; // 10MB - use multipart above this
export const MULTIPART_PART_SIZE = 10 * 1024 * 1024; // 10MB per part
export const MULTIPART_MAX_CONCURRENCY = 4;
export const MAX_STORAGE_PER_USER = 5 * 1024 * 1024 * 1024; // 5GB
export const MAX_STORAGE_PER_WORKSPACE = 5 * 1024 * 1024 * 1024; // 5GB

// ── Pagination ──────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

// ── Share links ─────────────────────────────────────────────────────────────

export const SHARE_TOKEN_LENGTH = 32;
export const UPLOAD_TOKEN_LENGTH = 32;
export const DEFAULT_SHARE_EXPIRY_DAYS = 7;
export const INVITE_TOKEN_LENGTH = 32;
export const INVITE_EXPIRY_DAYS = 7;

// ── Allowed MIME types (permissive — we allow most file types) ──────────────

export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
] as const;

export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
] as const;

export const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
] as const;

export const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
] as const;

export const ARCHIVE_MIME_TYPES = [
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
] as const;

// ── File type categories ────────────────────────────────────────────────────

export type FileCategory = 'image' | 'document' | 'video' | 'audio' | 'archive' | 'other';

export function getFileCategory(mimeType: string): FileCategory {
  if (IMAGE_MIME_TYPES.includes(mimeType as (typeof IMAGE_MIME_TYPES)[number])) return 'image';
  if (DOCUMENT_MIME_TYPES.includes(mimeType as (typeof DOCUMENT_MIME_TYPES)[number])) return 'document';
  if (VIDEO_MIME_TYPES.includes(mimeType as (typeof VIDEO_MIME_TYPES)[number])) return 'video';
  if (AUDIO_MIME_TYPES.includes(mimeType as (typeof AUDIO_MIME_TYPES)[number])) return 'audio';
  if (ARCHIVE_MIME_TYPES.includes(mimeType as (typeof ARCHIVE_MIME_TYPES)[number])) return 'archive';
  return 'other';
}

// ── File extensions to icons mapping ────────────────────────────────────────

export const FILE_ICON_MAP: Record<FileCategory, string> = {
  image: 'Image',
  document: 'FileText',
  video: 'Video',
  audio: 'Music',
  archive: 'Archive',
  other: 'File',
} as const;
