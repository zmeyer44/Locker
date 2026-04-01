import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../server/auth';
import { headers } from 'next/headers';
import { getDb } from '@openstore/database/client';
import { files, folders, workspaces, workspaceMembers } from '@openstore/database';
import { createStorage } from '@openstore/storage';
import { MAX_FILE_SIZE } from '@openstore/common';
import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const folderId = formData.get('folderId') as string | null;
  const existingFileId = formData.get('fileId') as string | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 });
  }

  const db = getDb();
  const userId = session.user.id;

  // Resolve workspace from header
  const reqHeaders = await headers();
  const workspaceSlug = reqHeaders.get('x-workspace-slug');
  if (!workspaceSlug) {
    return NextResponse.json({ error: 'Workspace required' }, { status: 400 });
  }

  const [membership] = await db
    .select({
      workspaceId: workspaces.id,
      storageUsed: workspaces.storageUsed,
      storageLimit: workspaces.storageLimit,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaces.slug, workspaceSlug),
        eq(workspaceMembers.userId, userId),
      ),
    );

  if (!membership) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const { workspaceId, storageUsed, storageLimit } = membership;

  // Check storage quota
  if ((storageUsed ?? 0) + file.size > (storageLimit ?? 0)) {
    return NextResponse.json({ error: 'Storage quota exceeded' }, { status: 507 });
  }

  // Validate folder belongs to workspace if provided
  if (folderId) {
    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)));
    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }
  }

  const storage = createStorage();
  const fileId = existingFileId || randomUUID();
  const storagePath = `${workspaceId}/${fileId}/${file.name}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  await storage.upload({
    path: storagePath,
    data: buffer,
    contentType: file.type || 'application/octet-stream',
  });

  let newFile;
  if (existingFileId) {
    // Update existing record created by uploads.initiate
    [newFile] = await db
      .update(files)
      .set({
        storagePath,
        status: 'ready',
        updatedAt: new Date(),
      })
      .where(and(eq(files.id, existingFileId), eq(files.workspaceId, workspaceId)))
      .returning();
  } else {
    [newFile] = await db
      .insert(files)
      .values({
        id: fileId,
        workspaceId,
        userId,
        folderId: folderId || null,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        storagePath,
        storageProvider: process.env.BLOB_STORAGE_PROVIDER ?? 'local',
        status: 'ready',
      })
      .returning();
  }

  // Update workspace storage usage
  await db
    .update(workspaces)
    .set({ storageUsed: sql`${workspaces.storageUsed} + ${file.size}` })
    .where(eq(workspaces.id, workspaceId));

  return NextResponse.json({ file: newFile });
}
