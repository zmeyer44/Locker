import type { Database } from "@locker/database";
import type { StorageProvider } from "@locker/storage";
import type { PluginManifest } from "@locker/common";
import type { ModelMessage } from "ai";
import type { PluginStorage } from "./plugin-storage";

/** Scoped context passed to every plugin handler invocation. */
export interface PluginContext {
  workspaceId: string;
  userId: string;
  db: Database;
  storage: StorageProvider;
  /** Scoped storage for this plugin's private files (under .plugins/<slug>/). */
  pluginStorage: PluginStorage;
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

export interface IngestResult {
  status: "success" | "partial" | "error";
  pagesCreated: string[];
  pagesUpdated: string[];
  message: string;
}

export interface LintIssue {
  type: "contradiction" | "orphan" | "stale" | "missing_link";
  page: string;
  description: string;
  severity: "info" | "warning" | "error";
}

export interface LintResult {
  issues: LintIssue[];
  summary: string;
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

  /**
   * Stream a chat response using the knowledge base wiki as context.
   * Called when the plugin has the `conversational_panel` capability.
   * Returns a streamText result — caller uses toUIMessageStreamResponse().
   */
  chat?(
    ctx: PluginContext,
    params: {
      knowledgeBaseId: string;
      messages: ModelMessage[];
      wikiStoragePath: string;
      schemaPrompt: string;
    },
  ): Promise<unknown>;

  /**
   * Ingest a source file into the knowledge base wiki.
   * Reads the file content, calls the LLM to extract knowledge,
   * and creates/updates wiki pages in storage.
   */
  ingest?(
    ctx: PluginContext,
    params: {
      knowledgeBaseId: string;
      fileId: string;
      fileName: string;
      fileContent: string;
      wikiStoragePath: string;
      schemaPrompt: string;
    },
  ): Promise<IngestResult>;

  /**
   * Lint the wiki for contradictions, orphans, stale claims, and missing links.
   */
  lint?(
    ctx: PluginContext,
    params: {
      knowledgeBaseId: string;
      wikiStoragePath: string;
      schemaPrompt: string;
    },
  ): Promise<LintResult>;
}
