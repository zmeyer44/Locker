import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";
import { convertToModelMessages, type UIMessage } from "ai";
import { auth } from "../../../../server/auth";
import { getDb } from "@locker/database/client";
import {
  knowledgeBases,
  kbConversations,
  kbMessages,
  workspaceMembers,
} from "@locker/database";
import { getHandler, buildPluginContext } from "../../../../server/plugins/runtime";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    messages,
    knowledgeBaseId,
    conversationId,
    model,
  } = body as {
    messages: UIMessage[];
    knowledgeBaseId: string;
    conversationId: string;
    model?: string;
  };

  if (!knowledgeBaseId || !conversationId || !messages?.length) {
    return NextResponse.json(
      { error: "Missing knowledgeBaseId, conversationId, or messages" },
      { status: 400 },
    );
  }

  const db = getDb();

  // Verify KB exists and user has workspace access
  const [kb] = await db
    .select({
      id: knowledgeBases.id,
      workspaceId: knowledgeBases.workspaceId,
      wikiStoragePath: knowledgeBases.wikiStoragePath,
      schemaPrompt: knowledgeBases.schemaPrompt,
    })
    .from(knowledgeBases)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, knowledgeBases.workspaceId),
        eq(workspaceMembers.userId, session.user.id),
      ),
    )
    .where(eq(knowledgeBases.id, knowledgeBaseId))
    .limit(1);

  if (!kb) {
    return NextResponse.json(
      { error: "Knowledge base not found" },
      { status: 404 },
    );
  }

  // Verify conversation belongs to user and KB
  const [conversation] = await db
    .select()
    .from(kbConversations)
    .where(
      and(
        eq(kbConversations.id, conversationId),
        eq(kbConversations.knowledgeBaseId, knowledgeBaseId),
        eq(kbConversations.userId, session.user.id),
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
      .insert(kbMessages)
      .values({
        id: lastUserMessage.id,
        conversationId,
        role: "user",
        parts: lastUserMessage.parts as any,
        metadata: (lastUserMessage.metadata as any) ?? null,
      })
      .onConflictDoNothing();

    // Auto-title: if conversation has no title, set from first user message
    if (!conversation.title) {
      const firstTextPart = (lastUserMessage.parts as any[])?.find(
        (p: any) => p.type === "text",
      );
      if (firstTextPart?.text) {
        const title = firstTextPart.text.slice(0, 100);
        await db
          .update(kbConversations)
          .set({ title, updatedAt: new Date() })
          .where(eq(kbConversations.id, conversationId));
      }
    }
  }

  // Get the handler
  const handler = getHandler("knowledge-base");
  if (!handler?.chat) {
    return NextResponse.json(
      { error: "Knowledge base handler not available" },
      { status: 500 },
    );
  }

  // Build plugin context — pass model override if the client specified one
  const pluginCtx = await buildPluginContext({
    db,
    workspaceId: kb.workspaceId,
    userId: session.user.id,
    pluginId: kb.id,
    pluginSlug: "knowledge-base",
    config: model ? { model } : {},
  });

  // Convert UIMessages to ModelMessages for the LLM
  const modelMessages = await convertToModelMessages(messages);

  try {
    const result = await handler.chat(pluginCtx, {
      knowledgeBaseId: kb.id,
      messages: modelMessages,
      wikiStoragePath: kb.wikiStoragePath,
      schemaPrompt: kb.schemaPrompt,
    });

    // The handler returns a streamText() result.
    // Use consumeStream to ensure the stream is fully read (enabling
    // the .text promise to resolve even if the client disconnects).
    const streamResult = result as Awaited<ReturnType<typeof import("ai").streamText>>;
    streamResult.consumeStream();

    // Save assistant message once streaming completes.
    // The .text promise resolves with the full generated text after
    // the stream finishes. We fire-and-forget but the Next.js runtime
    // keeps the function alive because the response stream is still open.
    Promise.resolve(streamResult.text)
      .then(async (fullText) => {
        await db
          .insert(kbMessages)
          .values({
            conversationId,
            role: "assistant",
            parts: [{ type: "text", text: fullText }],
            metadata: null,
          });

        await db
          .update(kbConversations)
          .set({ updatedAt: new Date() })
          .where(eq(kbConversations.id, conversationId));
      })
      .catch((err) => {
        console.error("[kb/chat] Failed to persist assistant message:", err);
      });

    return streamResult.toUIMessageStreamResponse({
      originalMessages: messages,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Chat generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
