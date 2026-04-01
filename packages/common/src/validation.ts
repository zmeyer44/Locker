import { z } from 'zod';
import { MAX_FILE_SIZE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants';

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const sortSchema = z.object({
  field: z.enum(['name', 'size', 'createdAt', 'updatedAt']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
});

export const uuidSchema = z.string().uuid();

export const fileUploadSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().min(1).max(MAX_FILE_SIZE),
  mimeType: z.string().min(1).max(255),
  folderId: z.string().uuid().nullable().optional(),
});

export const createFolderSchema = z.object({
  name: z.string().min(1).max(255).regex(/^[^/\\:*?"<>|]+$/, 'Invalid folder name'),
  parentId: z.string().uuid().nullable().optional(),
});

export const renameFolderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).regex(/^[^/\\:*?"<>|]+$/, 'Invalid folder name'),
});

export const renameFileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
});

export const moveItemSchema = z.object({
  id: z.string().uuid(),
  targetFolderId: z.string().uuid().nullable(),
});

export const createShareLinkSchema = z.object({
  fileId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  access: z.enum(['view', 'download']).default('view'),
  password: z.string().min(1).max(255).optional(),
  expiresAt: z.coerce.date().optional(),
  maxDownloads: z.number().int().min(1).optional(),
});

export const createUploadLinkSchema = z.object({
  folderId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  maxFiles: z.number().int().min(1).optional(),
  maxFileSize: z.number().int().min(1).max(MAX_FILE_SIZE).optional(),
  allowedMimeTypes: z.array(z.string()).optional(),
  expiresAt: z.coerce.date().optional(),
  password: z.string().min(1).max(255).optional(),
});

// ── Workspace schemas ──────────────────────────────────────────────────────

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).trim(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens').optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']).default('member'),
});

export const updateMemberRoleSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(['admin', 'member']),
});

// ── Slug utility ───────────────────────────────────────────────────────────

// ── Upload schemas ─────────────────────────────────────────────────────

export const initiateUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().min(1).max(MAX_FILE_SIZE),
  contentType: z.string().min(1).max(255),
  folderId: z.string().uuid().nullable().optional(),
});

export const completeUploadSchema = z.object({
  fileId: z.string().uuid(),
  uploadId: z.string().optional(),
  parts: z.array(z.object({
    partNumber: z.number().int().min(1),
    etag: z.string().min(1),
  })).optional(),
});

export const abortUploadSchema = z.object({
  fileId: z.string().uuid(),
  uploadId: z.string().optional(),
});

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
}
