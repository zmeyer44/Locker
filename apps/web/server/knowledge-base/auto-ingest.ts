import { eq, and } from "drizzle-orm";
import {
  knowledgeBases,
  kbTags,
  kbFileIngestions,
  files,
  fileTags,
  fileTranscriptions,
} from "@locker/database";
import type { Database } from "@locker/database";
import { isTextIndexable } from "@locker/common";
import { createStorageForFile } from "../storage";
import { getHandler, buildPluginContext } from "../plugins/runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function streamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function getFileContent(
  db: Database,
  file: { id: string; mimeType: string; storagePath: string; storageConfigId: string | null },
): Promise<string | null> {
  if (isTextIndexable(file.mimeType)) {
    const storage = await createStorageForFile(file.storageConfigId);
    const { data } = await storage.download(file.storagePath);
    return streamToString(data);
  }

  // Non-text file: check for a completed transcription
  const [transcription] = await db
    .select({ content: fileTranscriptions.content })
    .from(fileTranscriptions)
    .where(
      and(
        eq(fileTranscriptions.fileId, file.id),
        eq(fileTranscriptions.status, "ready"),
      ),
    )
    .limit(1);

  return transcription?.content ?? null;
}

// ---------------------------------------------------------------------------
// Core single-file ingest (used by tRPC endpoint and auto-ingest)
// ---------------------------------------------------------------------------

export async function ingestFileIntoKB(params: {
  db: Database;
  workspaceId: string;
  userId: string;
  knowledgeBaseId: string;
  fileId: string;
}): Promise<{ status: string; message: string }> {
  const { db, workspaceId, userId, knowledgeBaseId, fileId } = params;

  const [kb] = await db
    .select()
    .from(knowledgeBases)
    .where(
      and(
        eq(knowledgeBases.id, knowledgeBaseId),
        eq(knowledgeBases.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!kb) return { status: "error", message: "Knowledge base not found" };

  const [file] = await db
    .select({
      id: files.id,
      name: files.name,
      mimeType: files.mimeType,
      storagePath: files.storagePath,
      storageConfigId: files.storageConfigId,
    })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.workspaceId, workspaceId)))
    .limit(1);

  if (!file) return { status: "error", message: "File not found" };

  const fileContent = await getFileContent(db, file);
  if (!fileContent) return { status: "skipped", message: "No content available" };

  const handler = getHandler("knowledge-base");
  if (!handler?.ingest) return { status: "error", message: "Handler not available" };

  const pluginCtx = await buildPluginContext({
    db,
    workspaceId,
    userId,
    pluginId: kb.id,
    pluginSlug: "knowledge-base",
    config: {},
  });

  const result = await handler.ingest(pluginCtx, {
    knowledgeBaseId: kb.id,
    fileId: file.id,
    fileName: file.name,
    fileContent,
    wikiStoragePath: kb.wikiStoragePath,
    schemaPrompt: kb.schemaPrompt,
  });

  // Record ingestion
  await db
    .insert(kbFileIngestions)
    .values({
      knowledgeBaseId: kb.id,
      fileId: file.id,
      status: "ingested",
      ingestedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [kbFileIngestions.knowledgeBaseId, kbFileIngestions.fileId],
      set: { status: "ingested", ingestedAt: new Date() },
    });

  // Update KB-level timestamp
  await db
    .update(knowledgeBases)
    .set({ lastIngestedAt: new Date(), updatedAt: new Date() })
    .where(eq(knowledgeBases.id, kb.id));

  return { status: "success", message: result.message };
}

// ---------------------------------------------------------------------------
// Auto-ingest: find all KBs that care about a file and ingest into each
// ---------------------------------------------------------------------------

/**
 * Finds all knowledge bases whose tag matches one of the file's tags,
 * then ingests the file into each KB. Fire-and-forget safe.
 */
export async function autoIngestFile(params: {
  db: Database;
  workspaceId: string;
  userId: string;
  fileId: string;
}): Promise<void> {
  const { db, workspaceId, userId, fileId } = params;

  // Find KBs linked (via kbTags) to any tag assigned to this file
  const kbs = await db
    .select({
      id: knowledgeBases.id,
    })
    .from(kbTags)
    .innerJoin(fileTags, eq(kbTags.tagId, fileTags.tagId))
    .innerJoin(
      knowledgeBases,
      eq(kbTags.knowledgeBaseId, knowledgeBases.id),
    )
    .where(
      and(
        eq(fileTags.fileId, fileId),
        eq(knowledgeBases.workspaceId, workspaceId),
        eq(knowledgeBases.status, "active"),
      ),
    );

  // Deduplicate: a file may match multiple tags linked to the same KB
  const seen = new Set<string>();
  const uniqueKbs = kbs.filter((kb) => {
    if (seen.has(kb.id)) return false;
    seen.add(kb.id);
    return true;
  });

  for (const kb of uniqueKbs) {
    try {
      await ingestFileIntoKB({
        db,
        workspaceId,
        userId,
        knowledgeBaseId: kb.id,
        fileId,
      });
    } catch {
      // Auto-ingest is best-effort; don't propagate errors
    }
  }
}
