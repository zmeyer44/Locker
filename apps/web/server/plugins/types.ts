import type { Database } from "@locker/database";
import type { StorageProvider } from "@locker/storage";
import type { PluginManifest } from "@locker/common";

/** Scoped context passed to every plugin handler invocation. */
export interface PluginContext {
  workspaceId: string;
  userId: string;
  db: Database;
  storage: StorageProvider;
  /** Non-secret configuration values from the workspace plugin record. */
  config: Record<string, string | number | boolean | null>;
  /** Decrypted secret values for this plugin installation. */
  secrets: Record<string, string>;
}

export interface ActionResult {
  status: "success" | "queued";
  message: string;
  downloadUrl?: string;
  filename?: string;
}

export interface ActionTarget {
  type: "file" | "folder" | "workspace";
  id: string;
  name: string;
}

export interface SearchResult {
  fileId: string;
  score: number;
  snippet?: string;
}

export interface TranscriptionResult {
  content: string;
}

/**
 * The interface every plugin handler implements.
 *
 * Built-in plugins export an object conforming to this interface.
 * The runtime resolves handlers by slug and dispatches to them.
 */
export interface PluginHandler {
  manifest: PluginManifest;

  /** Execute a declared action (context menu items, toolbar actions, etc.). */
  executeAction?(
    ctx: PluginContext,
    actionId: string,
    target: ActionTarget,
  ): Promise<ActionResult>;

  /**
   * Enhanced search — called when user searches and the plugin has
   * the `workspace_search` capability and `search.enhance` permission.
   */
  search?(
    ctx: PluginContext,
    params: { query: string; folderId?: string | null; limit?: number },
  ): Promise<SearchResult[]>;

  /**
   * Generate a markdown transcription of a non-text file's content.
   * Called when the plugin has the `document_transcription` capability.
   */
  transcribe?(
    ctx: PluginContext,
    params: {
      fileId: string;
      fileName: string;
      mimeType: string;
      storagePath: string;
      storageConfigId: string | null;
    },
  ): Promise<TranscriptionResult>;
}
