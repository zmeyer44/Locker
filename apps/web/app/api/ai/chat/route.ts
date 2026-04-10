import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { auth } from "../../../../server/auth";
import { getDb } from "@locker/database/client";
import {
  workspaces,
  workspaceMembers,
  assistantConversations,
  assistantMessages,
} from "@locker/database";
import { gateway, DEFAULT_MODEL } from "../../../../server/ai/gateway";
import { createAssistantTools } from "../../../../server/ai/tools";
import { buildAssistantSystemPrompt } from "../../../../server/ai/system-prompt";

const ALLOWED_MODELS = [
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.6",
  "openai/gpt-5.4",
  "google/gemini-3-flash",
  "xai/grok-4.1-fast-reasoning",
];

export async function POST(req: NextRequest) {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { messages, conversationId, model } = body as {
    messages: UIMessage[];
    conversationId: string;
    model?: string;
  };

  if (!conversationId || !messages?.length) {
    return NextResponse.json(
      { error: "Missing conversationId or messages" },
      { status: 400 },
    );
  }

  const db = getDb();

  // Resolve workspace from header
  const slug = reqHeaders.get("x-workspace-slug");
  if (!slug) {
    return NextResponse.json(
      { error: "Missing workspace context" },
      { status: 400 },
    );
  }

  const [membership] = await db
    .select({
      workspaceId: workspaces.id,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaces.slug, slug),
        eq(workspaceMembers.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!membership) {
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 403 },
    );
  }

  // Verify conversation belongs to user and workspace
  const [conversation] = await db
    .select()
    .from(assistantConversations)
    .where(
      and(
        eq(assistantConversations.id, conversationId),
        eq(assistantConversations.workspaceId, membership.workspaceId),
        eq(assistantConversations.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  // Save the latest user message
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === "user");

  if (lastUserMessage) {
    await db
      .insert(assistantMessages)
      .values({
        id: lastUserMessage.id,
        conversationId,
        role: "user",
        parts: lastUserMessage.parts as any,
        attachments: (lastUserMessage as any).experimental_attachments ?? null,
        metadata: (lastUserMessage.metadata as any) ?? null,
      })
      .onConflictDoNothing();

    // Auto-title from first user message (strip attachment metadata)
    if (!conversation.title) {
      const firstTextPart = (lastUserMessage.parts as any[])?.find(
        (p: any) => p.type === "text",
      );
      if (firstTextPart?.text) {
        let rawTitle = firstTextPart.text;
        const attachIdx = rawTitle.indexOf("\n\n[Attached files");
        if (attachIdx !== -1) rawTitle = rawTitle.slice(0, attachIdx);
        const title = rawTitle.trim().slice(0, 100);
        if (title) {
          await db
            .update(assistantConversations)
            .set({ title, updatedAt: new Date() })
            .where(eq(assistantConversations.id, conversationId));
        }
      }
    }
  }

  // Build system prompt
  const systemPrompt = await buildAssistantSystemPrompt({
    db,
    workspaceId: membership.workspaceId,
    workspaceSlug: membership.slug,
    userId: session.user.id,
    userName: session.user.name ?? "User",
  });

  // Build tool context
  const tools = createAssistantTools({
    db,
    workspaceId: membership.workspaceId,
    userId: session.user.id,
    workspaceSlug: membership.slug,
  });

  const requestedModel = model ?? conversation.model ?? DEFAULT_MODEL;
  const modelId = ALLOWED_MODELS.includes(requestedModel)
    ? requestedModel
    : DEFAULT_MODEL;

  try {
    // Strip tool-invocation parts from persisted messages before converting.
    // The LLM only needs the text output; tool call details are UI-only and
    // their format doesn't survive the UIMessage → ModelMessage conversion.
    const cleanedMessages = messages.map((msg) => {
      if (msg.role !== "assistant" || !Array.isArray(msg.parts)) return msg;
      const textParts = msg.parts.filter(
        (p: any) => p.type === "text" && p.text,
      );
      if (textParts.length === 0) return null;
      return { ...msg, parts: textParts };
    }).filter(Boolean) as UIMessage[];

    const modelMessages = await convertToModelMessages(cleanedMessages);

    const result = streamText({
      model: gateway(modelId),
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(10),
    });

    // Ensure stream is consumed server-side even if client disconnects
    result.consumeStream();

    // Persist assistant response after streaming completes (fire-and-forget).
    // Use result.text which resolves with the full generated text after the
    // stream finishes. We also capture tool call steps for richer persistence.
    Promise.resolve(result.text)
      .then(async (fullText) => {
        try {
          const parts: any[] = [];

          if (fullText) {
            parts.push({ type: "text", text: fullText });
          }

          // Capture tool invocations from steps
          const steps = await result.steps;
          for (const step of steps) {
            if (step.toolCalls) {
              for (const tc of step.toolCalls) {
                const tcAny = tc as any;
                const tr = step.toolResults?.find(
                  (r: any) => r.toolCallId === tcAny.toolCallId,
                );
                parts.push({
                  type: "tool-invocation",
                  toolInvocation: {
                    toolCallId: tcAny.toolCallId,
                    toolName: tcAny.toolName,
                    args: tcAny.args,
                    state: "result",
                    result: (tr as any)?.result ?? null,
                  },
                });
              }
            }
          }

          if (parts.length > 0) {
            await db.insert(assistantMessages).values({
              conversationId,
              role: "assistant",
              parts,
              metadata: null,
            });
          }

          await db
            .update(assistantConversations)
            .set({ updatedAt: new Date() })
            .where(eq(assistantConversations.id, conversationId));
        } catch (err) {
          console.error("[ai/chat] Failed to persist assistant message:", err);
        }
      })
      .catch((err) => {
        console.error("[ai/chat] Failed to get text:", err);
      });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Chat generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
