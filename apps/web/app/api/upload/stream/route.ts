import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../server/auth';
import { headers } from 'next/headers';
import { getDb } from '@openstore/database/client';
import { files, workspaces, workspaceMembers } from '@openstore/database';
import { createStorage } from '@openstore/storage';
import { eq, and, sql } from 'drizzle-orm';
import { Writable } from 'node:stream';

export const runtime = 'nodejs';

// Disable body parser — we stream the raw request body
export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Read metadata from headers instead of FormData
  const reqHeaders = await headers();
  const fileId = reqHeaders.get('x-file-id');
  const workspaceSlug = reqHeaders.get('x-workspace-slug');
  const contentType = req.headers.get('content-type') ?? 'application/octet-stream';
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);

  if (!fileId || !workspaceSlug) {
    return NextResponse.json(
      { error: 'Missing x-file-id or x-workspace-slug headers' },
      { status: 400 },
    );
  }

  if (!req.body) {
    return NextResponse.json({ error: 'No body' }, { status: 400 });
  }

  const db = getDb();
  const userId = session.user.id;

  // Verify workspace membership
  const [membership] = await db
    .select({ workspaceId: workspaces.id })
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

  // Verify the file record exists and belongs to this workspace
  const [fileRecord] = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.workspaceId, membership.workspaceId),
        eq(files.status, 'uploading'),
      ),
    );

  if (!fileRecord) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
  }

  // Stream the request body to storage
  const storage = createStorage();

  try {
    await storage.upload({
      path: fileRecord.storagePath,
      data: req.body as unknown as ReadableStream,
      contentType,
    });

    // Mark file as ready
    await db
      .update(files)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(eq(files.id, fileId));

    // Update storage usage
    await db
      .update(workspaces)
      .set({
        storageUsed: sql`${workspaces.storageUsed} + ${fileRecord.size}`,
      })
      .where(eq(workspaces.id, membership.workspaceId));

    return NextResponse.json({ success: true, fileId });
  } catch (err) {
    // Clean up on failure
    try {
      await storage.delete(fileRecord.storagePath);
    } catch {
      // best effort
    }
    await db.delete(files).where(eq(files.id, fileId));

    return NextResponse.json(
      { error: (err as Error).message ?? 'Upload failed' },
      { status: 500 },
    );
  }
}
