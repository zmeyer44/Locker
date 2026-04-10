import { test, expect, type Page } from "@playwright/test";

const TEST_USER = {
  name: "AI Chat Test User",
  email: `ai-chat-${Date.now()}@example.com`,
  password: "TestPassword123!",
};

// Workspace slug gets captured during setup
let workspaceSlug = "";

test.describe.serial("AI Assistant chat flows", () => {
  // ── Setup: register, onboard, create test data ────────────────────────
  test("setup: register, onboard, and create a test folder + file", async ({
    page,
  }) => {
    // Pre-dismiss KB announcement modal via localStorage override
    await dismissKBAnnouncementViaStorage(page);

    // Register
    await page.goto("/register");
    await page.getByPlaceholder("Your name").fill(TEST_USER.name);
    await page.getByPlaceholder("you@example.com").fill(TEST_USER.email);
    await page.getByPlaceholder("Choose a password").fill(TEST_USER.password);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL("/onboarding", { timeout: 15000 });
    await page.screenshot({
      path: "e2e/screenshots/ai-chat-01-onboarding.png",
    });

    // Onboard — create workspace
    await page.getByPlaceholder("e.g. Acme Inc").fill("AI Chat Test WS");
    await page.getByRole("button", { name: /create workspace/i }).click();
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Capture the workspace slug from the URL
    const url = page.url();
    const match = url.match(/\/w\/([^/]+)/);
    workspaceSlug = match?.[1] ?? "";
    expect(workspaceSlug).toBeTruthy();

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-02-workspace-created.png",
    });

    // Create a test folder so AI tools have data to work with
    await page.getByRole("button", { name: /new folder/i }).click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder("Folder name").fill("Test Folder");
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText("Test Folder")).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    // Upload a test file
    await page
      .getByRole("button", { name: /^upload$/i })
      .first()
      .click();
    await page.waitForTimeout(500);
    const fileInput = page.locator(
      '[data-slot="dialog-content"] input[type="file"]',
    );
    await fileInput.setInputFiles({
      name: "hello-world.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hello, this is a test file for the AI assistant."),
    });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /upload 1 file/i }).click();
    await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-03-test-data-ready.png",
    });
  });

  // ── Navigate to AI Assistant page ─────────────────────────────────────
  test("navigate to AI Assistant via sidebar", async ({ page }) => {
    await loginAs(page);

    // Click the AI Assistant nav item in the sidebar
    await page.locator("a", { hasText: "AI Assistant" }).click();
    await page.waitForURL(/\/chat/, { timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-04-chat-page.png",
    });

    // Verify the empty state is visible
    await expect(
      page.getByRole("heading", { name: "Locker Assistant" }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText("I can help you manage your files"),
    ).toBeVisible({ timeout: 5000 });
  });

  // ── Empty state shows suggestion buttons ──────────────────────────────
  test("empty state shows suggestion buttons", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(1000);

    await expect(page.getByText("Search my files")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Organize files")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Share a file")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Manage tags")).toBeVisible({
      timeout: 5000,
    });

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-05-suggestions.png",
    });
  });

  // ── Chat input UI elements ────────────────────────────────────────────
  test("chat input has textarea and attach button", async ({
    page,
  }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(1000);

    // Textarea
    const textarea = page.getByPlaceholder("Reply...");
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Attach button (+ icon)
    const attachButton = page.locator("button[title='Attach files']");
    await expect(attachButton).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-06-input-elements.png",
    });
  });

  // ── Model selector exists in DOM ────────────────────────────────────
  test("model selector exists with correct default model", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(1000);

    // The model selector label is in the DOM (may be below visible fold on small viewports)
    await expect(page.locator("span", { hasText: "Claude Sonnet 4.6" })).toBeAttached();

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-07-model-selector.png",
    });
  });

  // ── Conversation sidebar UI ───────────────────────────────────────────
  test("conversation sidebar shows 'Chats' heading and new button", async ({
    page,
  }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(1000);

    // Sidebar heading
    await expect(
      page.getByRole("heading", { name: "Chats" }),
    ).toBeVisible({ timeout: 5000 });

    // No conversations yet message
    await expect(
      page.getByText("No conversations yet"),
    ).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-08-conversation-sidebar.png",
    });
  });

  // ── Create a new conversation via the + button ────────────────────────
  test("create conversation via sidebar + button", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(1000);

    // Click the + button in the conversation sidebar header
    // The sidebar has a heading "Chats" and a + button next to it
    const sidebar = page.locator("div", { hasText: "Chats" }).first();
    const plusButton = sidebar.locator("button").filter({ hasText: "" }).first();

    // Find the + button more specifically - it's a size-8 Button in the sidebar header
    await page
      .locator("h2", { hasText: "Chats" })
      .locator("..")
      .locator("button")
      .click();
    await page.waitForTimeout(2000);

    // A "New conversation" item should appear in the sidebar
    await expect(page.getByText("New conversation").first()).toBeVisible({
      timeout: 5000,
    });

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-09-conversation-created.png",
    });
  });

  // ── Send a message and see it in the chat ─────────────────────────────
  test("send a message and see it rendered in chat", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(2000);

    // Type a message in the textarea
    const textarea = page.getByPlaceholder("Reply...");
    await textarea.fill("Hello, this is a test message!");

    // Send with Enter key
    await textarea.press("Enter");
    await page.waitForTimeout(2000);

    // The user message should appear in the chat (also appears in sidebar auto-title)
    await expect(
      page.getByText("Hello, this is a test message!").first(),
    ).toBeVisible({ timeout: 10000 });

    // The user message should be in a bubble (right-aligned)
    await expect(
      page.locator("div.rounded-2xl", { hasText: "Hello, this is a test message!" }),
    ).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-10-message-sent.png",
    });

    // Wait for the assistant response (it will either stream or error,
    // but the user message should persist regardless)
    await page.waitForTimeout(5000);

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-11-after-response.png",
    });
  });

  // ── Conversation appears in sidebar after sending ─────────────────────
  test("conversation appears in sidebar with auto-title", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(2000);

    // There should be at least one conversation in the sidebar now
    // (from the previous test sending a message)
    const conversationItems = page.locator("div.group\\/item");
    const count = await conversationItems.count();
    expect(count).toBeGreaterThanOrEqual(1);

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-12-sidebar-with-conversations.png",
    });
  });

  // ── Toggle sidebar open/close ─────────────────────────────────────────
  test("toggle conversation sidebar visibility", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(1000);

    // Sidebar should be open initially (Chats heading visible)
    await expect(
      page.getByRole("heading", { name: "Chats" }),
    ).toBeVisible({ timeout: 5000 });

    // Click the toggle button — it's the first button inside the chat area's header bar
    // The chat area header contains the sidebar toggle button + h1 title
    const toggleBtn = page.locator("div.flex.flex-1.flex-col h1").locator("..").locator("button").first();
    await toggleBtn.click();
    await page.waitForTimeout(500);

    // Sidebar should be hidden now
    await expect(
      page.getByRole("heading", { name: "Chats" }),
    ).not.toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-13-sidebar-closed.png",
    });

    // Toggle it back open
    await toggleBtn.click();
    await page.waitForTimeout(500);

    await expect(
      page.getByRole("heading", { name: "Chats" }),
    ).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-14-sidebar-reopened.png",
    });
  });

  // ── Delete a conversation ─────────────────────────────────────────────
  test("delete a conversation from sidebar", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(2000);

    // First, create a new conversation to delete
    await page
      .locator("h2", { hasText: "Chats" })
      .locator("..")
      .locator("button")
      .click();
    await page.waitForTimeout(2000);

    // Count conversations before deletion
    const itemsBefore = page.locator("div.group\\/item");
    const countBefore = await itemsBefore.count();

    // Hover over the first conversation item to reveal the menu
    const firstConv = page.locator("div.group\\/item").first();
    await firstConv.hover();
    await page.waitForTimeout(300);

    // Click the three-dot menu button
    await firstConv.locator("button").last().click();
    await page.waitForTimeout(300);

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-15-conversation-menu.png",
    });

    // Click Delete
    await page.getByRole("menuitem", { name: /delete/i }).click();
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-16-conversation-deleted.png",
    });
  });

  // ── Rename a conversation ─────────────────────────────────────────────
  test("rename a conversation from sidebar", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(2000);

    // Create a conversation if none exist
    const items = page.locator("div.group\\/item");
    const count = await items.count();
    if (count === 0) {
      await page
        .locator("h2", { hasText: "Chats" })
        .locator("..")
        .locator("button")
        .click();
      await page.waitForTimeout(2000);
    }

    // Hover over conversation to reveal menu
    const convItem = page.locator("div.group\\/item").first();
    await convItem.hover();
    await page.waitForTimeout(300);

    // Click three-dot menu
    await convItem.locator("button").last().click();
    await page.waitForTimeout(300);

    // Click Rename
    await page.getByRole("menuitem", { name: /rename/i }).click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-17-rename-inline.png",
    });

    // An inline input should appear — type the new name
    const renameInput = convItem.locator("input");
    await renameInput.fill("Renamed Chat");
    await renameInput.press("Enter");
    await page.waitForTimeout(2000);

    // Verify the name updated
    await expect(page.getByText("Renamed Chat").first()).toBeVisible({
      timeout: 5000,
    });

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-18-renamed.png",
    });
  });

  // ── File attachment button shows file input ───────────────────────────
  test("file attachment button opens file picker", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(1000);

    // The attach button (paperclip icon) should be visible in the input area
    const attachButton = page.locator("button[title='Attach files']");
    await expect(attachButton).toBeVisible({ timeout: 5000 });

    // There should be a hidden file input
    const fileInput = page.locator("input[type='file']");
    await expect(fileInput).toBeAttached();

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-19-attach-button.png",
    });
  });

  // ── Attach file shows preview in input area ───────────────────────────
  test("attaching a file shows preview before sending", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(1000);

    // Attach a file via the hidden input
    const fileInput = page.locator("input[type='file']");
    await fileInput.setInputFiles({
      name: "attachment-test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Attachment content for testing"),
    });
    await page.waitForTimeout(500);

    // The attachment preview should appear
    await expect(page.getByText("attachment-test.txt")).toBeVisible({
      timeout: 5000,
    });

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-20-attachment-preview.png",
    });

    // Remove the attachment via the X button — it's the small button
    // inside the attachment preview chip (the flex container with the filename)
    const attachmentChip = page
      .locator("span", { hasText: "attachment-test.txt" })
      .locator("..");
    await attachmentChip.locator("button").click();
    await page.waitForTimeout(500);

    // Attachment should be gone
    await expect(
      page.locator("span", { hasText: "attachment-test.txt" }),
    ).not.toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-21-attachment-removed.png",
    });
  });

  // ── tRPC conversation endpoints work ──────────────────────────────────
  test("tRPC: create and list conversations via API", async ({ page }) => {
    await loginAs(page);

    // Use page.evaluate to call the tRPC endpoints via fetch
    // Create a conversation
    const createResult = await page.evaluate(
      async ({ slug }) => {
        const res = await fetch(`/api/trpc/assistant.createConversation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-slug": slug,
          },
          body: JSON.stringify({ json: { title: "API Test Chat" } }),
        });
        return { status: res.status, ok: res.ok };
      },
      { slug: workspaceSlug },
    );

    expect(createResult.ok).toBeTruthy();

    // List conversations
    const listResult = await page.evaluate(
      async ({ slug }) => {
        const res = await fetch(`/api/trpc/assistant.conversations`, {
          headers: {
            "x-workspace-slug": slug,
          },
        });
        const data = await res.json();
        return {
          status: res.status,
          count: data?.result?.data?.json?.length ?? 0,
        };
      },
      { slug: workspaceSlug },
    );

    expect(listResult.status).toBe(200);
    expect(listResult.count).toBeGreaterThanOrEqual(1);

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-22-trpc-api.png",
    });
  });

  // ── Chat API endpoint responds ────────────────────────────────────────
  test("POST /api/ai/chat returns a response (or auth error)", async ({
    page,
  }) => {
    await loginAs(page);

    // First create a conversation to get a valid ID
    const convResult = await page.evaluate(
      async ({ slug }) => {
        const res = await fetch(`/api/trpc/assistant.createConversation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-slug": slug,
          },
          body: JSON.stringify({ json: {} }),
        });
        const data = await res.json();
        return data?.result?.data?.json?.id ?? null;
      },
      { slug: workspaceSlug },
    );

    expect(convResult).toBeTruthy();

    // Call the chat API — this will fail with 502 if no AI_GATEWAY_API_KEY,
    // but should NOT fail with 401/403/400 (auth/validation should pass)
    const chatResult = await page.evaluate(
      async ({ slug, conversationId }) => {
        const res = await fetch(`/api/ai/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-slug": slug,
          },
          body: JSON.stringify({
            conversationId,
            messages: [
              {
                id: "test-msg-1",
                role: "user",
                parts: [{ type: "text", text: "Hello" }],
              },
            ],
          }),
        });
        return { status: res.status };
      },
      { slug: workspaceSlug, conversationId: convResult },
    );

    // 200 = AI responded, 502 = no API key configured (expected in test env)
    // Should NOT be 400, 401, 403, 404
    expect([200, 502]).toContain(chatResult.status);

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-23-chat-api.png",
    });
  });

  // ── Multi-conversation switching ──────────────────────────────────────
  test("switch between conversations in sidebar", async ({ page }) => {
    await loginAs(page);
    await page.goto(`/w/${workspaceSlug}/chat`);
    await page.waitForTimeout(2000);

    // Create two conversations
    await page
      .locator("h2", { hasText: "Chats" })
      .locator("..")
      .locator("button")
      .click();
    await page.waitForTimeout(2000);

    await page
      .locator("h2", { hasText: "Chats" })
      .locator("..")
      .locator("button")
      .click();
    await page.waitForTimeout(2000);

    // There should be at least 2 conversations
    const items = page.locator("div.group\\/item");
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Click the second conversation
    await items.nth(1).click();
    await page.waitForTimeout(1000);

    // Click back to the first
    await items.first().click();
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: "e2e/screenshots/ai-chat-24-conversation-switching.png",
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function loginAs(page: Page) {
  await dismissKBAnnouncementViaStorage(page);
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(TEST_USER.email);
  await page.getByPlaceholder("Enter password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/w\//, { timeout: 15000 });
  await page.waitForTimeout(1000);
}

async function dismissKBAnnouncementViaStorage(page: Page) {
  await page.addInitScript(() => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (key.startsWith("locker:kb-announcement-dismissed")) return "1";
      return orig.call(this, key);
    };
  });
}
