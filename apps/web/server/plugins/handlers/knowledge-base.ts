import { generateText, streamText } from "ai";
import type { StorageProvider } from "@locker/storage";
import { gateway, DEFAULT_MODEL } from "../../ai/gateway";
import { getBuiltinPluginBySlug } from "../catalog";
import type {
  PluginHandler,
  PluginContext,
  IngestResult,
  LintResult,
} from "../types";

const manifest = getBuiltinPluginBySlug("knowledge-base")!;

// ---------------------------------------------------------------------------
// Wiki file helpers
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

async function readWikiFile(
  storage: StorageProvider,
  path: string,
): Promise<string | null> {
  try {
    const { data } = await storage.download(path);
    return await streamToString(data);
  } catch {
    return null;
  }
}

async function writeWikiFile(
  storage: StorageProvider,
  path: string,
  content: string,
): Promise<void> {
  await storage.upload({
    path,
    data: Buffer.from(content, "utf-8"),
    contentType: "text/markdown",
  });
}

interface WikiPageEntry {
  path: string;
  title: string;
}

async function listWikiPages(
  storage: StorageProvider,
  basePath: string,
): Promise<WikiPageEntry[]> {
  const indexContent = await readWikiFile(storage, `${basePath}index.md`);
  if (!indexContent) return [];

  const pages: WikiPageEntry[] = [];
  const linkRegex = /^- \[(.+?)\]\((.+?)\)/gm;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(indexContent)) !== null) {
    pages.push({ title: match[1], path: match[2] });
  }
  return pages;
}

async function appendToLog(
  storage: StorageProvider,
  basePath: string,
  entry: string,
): Promise<void> {
  const logPath = `${basePath}log.md`;
  const existing = (await readWikiFile(storage, logPath)) ?? "# Ingestion Log\n";
  const timestamp = new Date().toISOString();
  await writeWikiFile(storage, logPath, `${existing}\n- **${timestamp}**: ${entry}`);
}

function getModel(ctx: PluginContext): string {
  return (ctx.config.model as string) || process.env.AI_GATEWAY_MODEL || DEFAULT_MODEL;
}

/** Strip markdown code fences (```json ... ```) from LLM output. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return raw.trim();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const knowledgeBaseHandler: PluginHandler = {
  manifest,

  async ingest(ctx, params) {
    const { storage } = ctx;
    const { fileName, wikiStoragePath, schemaPrompt } = params;
    // Truncate to ~100k chars to stay within model context limits
    const fileContent = params.fileContent.slice(0, 100_000);
    const modelId = getModel(ctx);

    const indexContent =
      (await readWikiFile(storage, `${wikiStoragePath}index.md`)) ??
      "# Wiki Index\n\nNo pages yet.\n";

    // Load existing pages so the model knows what to cross-link to
    const knownPages = await listWikiPages(storage, wikiStoragePath);
    const pageSummaries: string[] = [];
    for (const page of knownPages.slice(0, 60)) {
      const content = await readWikiFile(storage, `${wikiStoragePath}${page.path}`);
      if (content) {
        const firstLine = content.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
        pageSummaries.push(`  - [[${page.path.replace(/\.md$/, "")}]] — ${page.title}: ${firstLine.slice(0, 150)}`);
      }
    }

    const systemPrompt = [
      "You are a knowledge base wiki builder.",
      "Your job is to read the provided source document and integrate its key information into wiki pages.",
      schemaPrompt
        ? `The user has provided these instructions for structuring the wiki:\n${schemaPrompt}`
        : "Organize information into clear, focused topic pages.",
      "",
      "Current wiki index:",
      indexContent,
      "",
      ...(pageSummaries.length > 0
        ? [
            "Existing pages available for cross-linking:",
            ...pageSummaries,
            "",
          ]
        : []),
      "Output a JSON object with this structure:",
      '{ "actions": [{ "type": "create" | "update", "path": "page-slug.md", "title": "Page Title", "content": "Full markdown content" }] }',
      "",
      "Rules:",
      "- CROSS-LINK HEAVILY using [[page-slug]] syntax (without the .md extension). Every page should link to related pages wherever a concept, term, person, or topic overlaps with another page. Think of this like an Obsidian vault — the goal is a densely interconnected graph where readers can navigate naturally between related ideas.",
      "- When mentioning a concept that has its own page (or should have one), always wrap it in [[double brackets]]. Err on the side of more links rather than fewer.",
      "- If the source document introduces concepts that relate to existing pages listed above, link to those pages. Also update existing pages to link back to new pages when relevant (use \"update\" actions for this).",
      "- When updating a page, provide the complete new content (not a diff).",
      "- Keep pages focused on single topics. Create new pages for distinct concepts.",
      "- Preserve existing information when updating — merge, don't replace.",
      "- Output ONLY valid JSON, no markdown fences.",
    ].join("\n");

    const { text } = await generateText({
      model: gateway(modelId),
      system: systemPrompt,
      prompt: `Source document "${fileName}":\n\n${fileContent}`,
    });

    let actions: Array<{
      type: "create" | "update";
      path: string;
      title: string;
      content: string;
    }>;

    try {
      const parsed = JSON.parse(extractJson(text));
      actions = parsed.actions ?? [];
    } catch {
      return {
        status: "error",
        pagesCreated: [],
        pagesUpdated: [],
        message: "Failed to parse LLM response as JSON",
      };
    }

    const pagesCreated: string[] = [];
    const pagesUpdated: string[] = [];

    for (const action of actions) {
      if (
        action.path.includes("..") ||
        action.path.startsWith("/") ||
        !action.path.endsWith(".md")
      ) {
        continue;
      }
      const pagePath = `${wikiStoragePath}${action.path}`;
      await writeWikiFile(storage, pagePath, action.content);
      if (action.type === "create") {
        pagesCreated.push(action.path);
      } else {
        pagesUpdated.push(action.path);
      }
    }

    // Rebuild index
    const existingPages = await listWikiPages(storage, wikiStoragePath);
    const pageMap = new Map(existingPages.map((p) => [p.path, p.title]));
    for (const action of actions) {
      pageMap.set(action.path, action.title);
    }

    const indexLines = ["# Wiki Index\n"];
    for (const [path, title] of pageMap) {
      indexLines.push(`- [${title}](${path})`);
    }
    await writeWikiFile(storage, `${wikiStoragePath}index.md`, indexLines.join("\n"));

    await appendToLog(
      storage,
      wikiStoragePath,
      `Ingested "${fileName}" — created ${pagesCreated.length}, updated ${pagesUpdated.length} pages`,
    );

    return {
      status: "success" as const,
      pagesCreated,
      pagesUpdated,
      message: `Ingested "${fileName}": ${pagesCreated.length} created, ${pagesUpdated.length} updated`,
    };
  },

  async chat(ctx, params) {
    const { storage } = ctx;
    const { messages, wikiStoragePath, schemaPrompt } = params;
    const modelId = getModel(ctx);

    const indexContent =
      (await readWikiFile(storage, `${wikiStoragePath}index.md`)) ?? "";
    const pages = await listWikiPages(storage, wikiStoragePath);

    // Phase 1: Select relevant pages
    const lastUserMessage =
      [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const lastUserText =
      typeof lastUserMessage === "string"
        ? lastUserMessage
        : Array.isArray(lastUserMessage)
          ? lastUserMessage
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join(" ")
          : "";

    let selectedPaths: string[] = [];

    if (pages.length > 0) {
      const { text: selectionJson } = await generateText({
        model: gateway(modelId),
        system: [
          "You select wiki pages relevant to a user question.",
          "Given the wiki index and a question, return a JSON array of page paths that are relevant.",
          "Return ONLY a JSON array of strings, e.g. [\"page-a.md\", \"page-b.md\"]. No other text.",
          "",
          "Wiki index:",
          indexContent,
        ].join("\n"),
        prompt: lastUserText,
      });

      try {
        const parsed = JSON.parse(extractJson(selectionJson));
        if (Array.isArray(parsed)) {
          selectedPaths = parsed.filter((p): p is string => typeof p === "string");
        }
      } catch {
        // Fall back to all pages if parsing fails
        selectedPaths = pages.map((p) => p.path);
      }
    }

    // Phase 2: Load selected pages
    const pageContents: string[] = [];
    for (const pagePath of selectedPaths.slice(0, 20)) {
      const content = await readWikiFile(storage, `${wikiStoragePath}${pagePath}`);
      if (content) {
        pageContents.push(`--- ${pagePath} ---\n${content}`);
      }
    }

    // Phase 3: Stream answer
    const systemPrompt = [
      "You are a knowledgeable assistant answering questions based on a curated knowledge base wiki.",
      schemaPrompt ? `Wiki structure notes: ${schemaPrompt}` : "",
      "",
      "Use the following wiki pages as your primary source of information.",
      "Cite specific pages when referencing information using [[page-slug]] notation.",
      "If the wiki doesn't contain relevant information, say so honestly.",
      "",
      ...pageContents,
    ].join("\n");

    const result = await streamText({
      model: gateway(modelId),
      system: systemPrompt,
      messages,
    });

    return result;
  },

  async lint(ctx, params) {
    const { storage } = ctx;
    const { wikiStoragePath, schemaPrompt } = params;
    const modelId = getModel(ctx);

    const pages = await listWikiPages(storage, wikiStoragePath);
    const allContent: string[] = [];

    for (const page of pages.slice(0, 50)) {
      const content = await readWikiFile(storage, `${wikiStoragePath}${page.path}`);
      if (content) {
        allContent.push(`--- ${page.path} (${page.title}) ---\n${content}`);
      }
    }

    if (allContent.length === 0) {
      return { issues: [], summary: "No wiki pages to lint." };
    }

    const { text } = await generateText({
      model: gateway(modelId),
      system: [
        "You are a wiki quality auditor. Analyze the following wiki pages for issues.",
        schemaPrompt ? `Wiki structure notes: ${schemaPrompt}` : "",
        "",
        'Return a JSON object: { "issues": [{ "type": "contradiction"|"orphan"|"stale"|"missing_link", "page": "page-slug.md", "description": "...", "severity": "info"|"warning"|"error" }], "summary": "..." }',
        "",
        "Issue types:",
        "- contradiction: Two pages make conflicting claims",
        "- orphan: A page is not linked from any other page",
        "- stale: Information appears outdated or incomplete",
        "- missing_link: A [[link]] references a page that doesn't exist",
        "",
        "Output ONLY valid JSON, no markdown fences.",
      ].join("\n"),
      prompt: allContent.join("\n\n"),
    });

    try {
      const parsed = JSON.parse(extractJson(text));
      return {
        issues: parsed.issues ?? [],
        summary: parsed.summary ?? "Lint complete.",
      };
    } catch {
      return {
        issues: [],
        summary: "Failed to parse lint results from LLM.",
      };
    }
  },
};
