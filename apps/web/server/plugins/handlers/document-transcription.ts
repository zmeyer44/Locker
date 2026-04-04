import { and, eq } from "drizzle-orm";
import { files } from "@locker/database";
import { createStorageForFile } from "../../storage";
import { getBuiltinPluginBySlug } from "../catalog";
import { transcribeFile } from "../transcription";
import type {
  PluginHandler,
  PluginContext,
  ActionResult,
  ActionTarget,
  TranscriptionResult,
} from "../types";

const manifest = getBuiltinPluginBySlug("document-transcription")!;

export const documentTranscriptionHandler: PluginHandler = {
  manifest,

  async executeAction(
    ctx: PluginContext,
    actionId: string,
    target: ActionTarget,
  ): Promise<ActionResult> {
    if (actionId === "transcription.regenerate" && target.type === "file") {
      const [file] = await ctx.db
        .select({
          mimeType: files.mimeType,
          storagePath: files.storagePath,
          storageConfigId: files.storageConfigId,
        })
        .from(files)
        .where(
          and(eq(files.id, target.id), eq(files.workspaceId, ctx.workspaceId)),
        )
        .limit(1);

      if (!file) {
        return { status: "success", message: "File not found" };
      }

      // Fire-and-forget regeneration
      void transcribeFile({
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        fileId: target.id,
        fileName: target.name,
        mimeType: file.mimeType,
        storagePath: file.storagePath,
        storageConfigId: file.storageConfigId,
      }).catch(() => {});

      return {
        status: "queued",
        message: `Transcription queued for "${target.name}"`,
      };
    }

    return { status: "success", message: `${actionId} completed` };
  },

  async transcribe(
    ctx: PluginContext,
    params: {
      fileId: string;
      fileName: string;
      mimeType: string;
      storagePath: string;
      storageConfigId: string | null;
    },
  ): Promise<TranscriptionResult> {
    const serviceUrl = ctx.config.serviceUrl as string;
    if (!serviceUrl) {
      throw new Error("Document transcription service URL is not configured");
    }

    // Download the file from storage
    const storage = await createStorageForFile(params.storageConfigId);
    const { data } = await storage.download(params.storagePath);

    // Read stream into buffer
    const reader = data.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks);

    // Send to the configured transcription service
    const headers: Record<string, string> = {
      "Content-Type": params.mimeType,
      "X-File-Name": params.fileName,
    };

    const apiKey = ctx.secrets.apiKey;
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const model = ctx.config.model as string | undefined;
    if (model) {
      headers["X-Model"] = model;
    }

    const response = await fetch(serviceUrl, {
      method: "POST",
      headers,
      body: buffer,
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Transcription service returned ${response.status}: ${errorText}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    let content: string;

    if (contentType.includes("application/json")) {
      const json = await response.json();
      // Support common response shapes: { content }, { text }, { markdown }, or raw string
      content =
        json.content ?? json.text ?? json.markdown ?? JSON.stringify(json);
    } else {
      content = await response.text();
    }

    if (!content || content.trim().length === 0) {
      throw new Error("Transcription service returned empty content");
    }

    return { content: content.trim() };
  },
};
