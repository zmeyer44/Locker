import { and, eq } from "drizzle-orm";
import { workspacePlugins, fileTranscriptions, files } from "@locker/database";
import type { Database } from "@locker/database";
import {
  isTextIndexable,
  type PluginManifest,
  type PluginPermission,
} from "@locker/common";
import { getHandler, buildPluginContext } from "./runtime";
import { resolvePluginEndpoint } from "./resolve-endpoint";
import { qmdClient } from "./handlers/qmd-client";
import { ftsClient } from "./handlers/fts-client";
import type { PluginHandler } from "./types";
import { autoIngestFile } from "../knowledge-base/auto-ingest";

export { isTextIndexable };

/**
 * Match a MIME pattern (e.g. `image/*`) against a concrete MIME type.
 * Supports exact matches and wildcard subtypes.
 */
export function matchesMimePattern(pattern: string, mimeType: string): boolean {
  if (pattern === mimeType) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // "image/*" -> "image/"
    return mimeType.startsWith(prefix);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Plugin discovery
// ---------------------------------------------------------------------------

interface TranscriptionPluginMatch {
  pluginSlug: string;
  pluginId: string;
  handler: PluginHandler;
  config: Record<string, string | number | boolean | null>;
  priority: number;
}

/**
 * Find the best active transcription plugin for a given MIME type
 * within a workspace. Returns the highest-priority match, or null.
 */
export async function findTranscriptionPlugin(
  db: Database,
  workspaceId: string,
  mimeType: string,
): Promise<TranscriptionPluginMatch | null> {
  const activePlugins = await db
    .select({
      id: workspacePlugins.id,
      pluginSlug: workspacePlugins.pluginSlug,
      manifest: workspacePlugins.manifest,
      config: workspacePlugins.config,
      grantedPermissions: workspacePlugins.grantedPermissions,
    })
    .from(workspacePlugins)
    .where(
      and(
        eq(workspacePlugins.workspaceId, workspaceId),
        eq(workspacePlugins.status, "active"),
      ),
    );

  let best: TranscriptionPluginMatch | null = null;

  for (const plugin of activePlugins) {
    const manifest = plugin.manifest as PluginManifest;
    if (!manifest.transcription) continue;
    if (!manifest.capabilities?.includes("document_transcription")) continue;

    // Check the plugin has files.read permission granted
    const permissions = Array.isArray(plugin.grantedPermissions)
      ? (plugin.grantedPermissions as PluginPermission[])
      : [];
    if (!permissions.includes("files.read")) continue;

    // Check MIME type match
    const matches = manifest.transcription.supportedMimeTypes.some((pattern) =>
      matchesMimePattern(pattern, mimeType),
    );
    if (!matches) continue;

    const handler = getHandler(plugin.pluginSlug);
    if (!handler?.transcribe) continue;

    const priority = manifest.transcription.priority ?? 50;
    const config =
      plugin.config &&
      typeof plugin.config === "object" &&
      !Array.isArray(plugin.config)
        ? (plugin.config as Record<string, string | number | boolean | null>)
        : {};

    if (!best || priority > best.priority) {
      best = {
        pluginSlug: plugin.pluginSlug,
        pluginId: plugin.id,
        handler,
        config,
        priority,
      };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Transcription orchestration
// ---------------------------------------------------------------------------

/**
 * Full transcription flow: find plugin, process file, store result, index.
 * Safe to call fire-and-forget — errors are caught and stored.
 */
export async function transcribeFile(params: {
  db: Database;
  workspaceId: string;
  userId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  storagePath: string;
  storageConfigId: string | null;
}): Promise<void> {
  const { db, workspaceId, userId, fileId, fileName, mimeType } = params;

  const match = await findTranscriptionPlugin(db, workspaceId, mimeType);
  if (!match) return;

  const { pluginSlug, pluginId, handler, config } = match;

  // Atomic upsert: mark as "processing" (or create if first run)
  await db
    .insert(fileTranscriptions)
    .values({
      fileId,
      workspaceId,
      pluginSlug,
      status: "processing",
    })
    .onConflictDoUpdate({
      target: [fileTranscriptions.fileId, fileTranscriptions.pluginSlug],
      set: {
        status: "processing",
        errorMessage: null,
        updatedAt: new Date(),
      },
    });

  try {
    const ctx = await buildPluginContext({
      db,
      workspaceId,
      userId,
      pluginId,
      pluginSlug,
      config,
    });

    const result = await handler.transcribe!(ctx, {
      fileId,
      fileName,
      mimeType,
      storagePath: params.storagePath,
      storageConfigId: params.storageConfigId,
    });

    // Store the transcription content
    await db
      .update(fileTranscriptions)
      .set({
        content: result.content,
        status: "ready",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fileTranscriptions.fileId, fileId),
          eq(fileTranscriptions.pluginSlug, pluginSlug),
        ),
      );

    // Index the transcription content into FTS/QMD under the source file ID
    await indexTranscriptionContent({
      db,
      workspaceId,
      fileId,
      fileName,
      content: result.content,
    });

    // Auto-ingest into any knowledge bases that include this file
    void autoIngestFile({ db, workspaceId, userId, fileId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown transcription error";
    await db
      .update(fileTranscriptions)
      .set({
        status: "failed",
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fileTranscriptions.fileId, fileId),
          eq(fileTranscriptions.pluginSlug, pluginSlug),
        ),
      );
  }
}

// ---------------------------------------------------------------------------
// Search indexing
// ---------------------------------------------------------------------------

/**
 * Index transcription content into FTS and QMD under the source file's ID.
 * This way search results naturally point to the original file.
 */
async function indexTranscriptionContent(params: {
  db: Database;
  workspaceId: string;
  fileId: string;
  fileName: string;
  content: string;
}): Promise<void> {
  const { db, workspaceId, fileId, fileName, content } = params;

  // Index into QMD
  try {
    const qmdEndpoint = await resolvePluginEndpoint(
      db,
      workspaceId,
      "qmd-search",
      {
        serviceUrl: process.env.QMD_SERVICE_URL,
        apiSecret: process.env.QMD_API_SECRET,
      },
    );
    if (qmdEndpoint) {
      await qmdClient.indexFile(
        {
          workspaceId,
          fileId,
          fileName,
          mimeType: "text/markdown",
          content,
        },
        qmdEndpoint,
      );
    }
  } catch {
    // Best-effort indexing
  }

  // Index into FTS
  try {
    const ftsEndpoint = await resolvePluginEndpoint(
      db,
      workspaceId,
      "fts-search",
      {
        serviceUrl: process.env.FTS_SERVICE_URL,
        apiSecret: process.env.FTS_API_SECRET,
      },
    );
    if (ftsEndpoint) {
      await ftsClient.indexFile(
        {
          workspaceId,
          fileId,
          fileName,
          mimeType: "text/markdown",
          content,
        },
        ftsEndpoint,
      );
    }
  } catch {
    // Best-effort indexing
  }
}
