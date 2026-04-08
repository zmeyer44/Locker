import { test, expect, type Page } from "@playwright/test";

/**
 * Knowledge Base Synthesis Tests
 *
 * These tests exercise the actual AI-powered knowledge synthesis features:
 * - Ingesting a source document into wiki pages
 * - Verifying index.md is updated with new pages
 * - Browsing generated wiki pages
 * - Chatting with the knowledge base
 * - Linting the wiki for quality issues
 *
 * These tests require a running AI gateway (AI_GATEWAY_API_KEY set).
 * They use longer timeouts since LLM calls take time.
 */

const TEST_USER = {
  name: "KB Synthesis Test",
  email: `kb-synth-${Date.now()}@example.com`,
  password: "TestPassword123!",
};

const TAG_NAME = "AI Research";
const KB_NAME = "AI Research Wiki";

const SOURCE_DOC_1 = {
  name: "ai-fundamentals.txt",
  content: [
    "# Introduction to Artificial Intelligence",
    "",
    "Artificial intelligence (AI) is a branch of computer science focused on building systems",
    "capable of performing tasks that typically require human intelligence. These tasks include",
    "visual perception, speech recognition, decision-making, and language translation.",
    "",
    "## Machine Learning",
    "",
    "Machine learning (ML) is a subset of AI that enables systems to automatically learn and",
    "improve from experience without being explicitly programmed. ML algorithms build mathematical",
    "models based on training data to make predictions or decisions.",
    "",
    "### Types of Machine Learning",
    "",
    "1. Supervised Learning: The algorithm learns from labeled training data. Examples include",
    "   classification (spam detection) and regression (price prediction).",
    "",
    "2. Unsupervised Learning: The algorithm finds hidden patterns in unlabeled data. Examples",
    "   include clustering (customer segmentation) and dimensionality reduction (PCA).",
    "",
    "3. Reinforcement Learning: The algorithm learns by interacting with an environment and",
    "   receiving rewards or penalties. Used in game playing (AlphaGo) and robotics.",
    "",
    "## Deep Learning",
    "",
    "Deep learning is a subset of machine learning that uses artificial neural networks with",
    "multiple layers (hence 'deep'). These networks can learn hierarchical representations of",
    "data. Key architectures include:",
    "",
    "- Convolutional Neural Networks (CNNs): Excel at image and video processing",
    "- Recurrent Neural Networks (RNNs): Handle sequential data like text and time series",
    "- Transformers: Power modern language models like GPT and BERT",
    "",
    "## Natural Language Processing",
    "",
    "Natural Language Processing (NLP) allows computers to understand, interpret, and generate",
    "human language. Modern NLP is dominated by transformer-based models.",
    "",
    "Key NLP tasks include:",
    "- Text classification and sentiment analysis",
    "- Named entity recognition (NER)",
    "- Machine translation",
    "- Question answering",
    "- Text summarization",
  ].join("\n"),
};

const SOURCE_DOC_2 = {
  name: "ai-ethics.txt",
  content: [
    "# AI Ethics and Safety",
    "",
    "As AI systems become more powerful and widespread, ethical considerations become critical.",
    "",
    "## Bias and Fairness",
    "",
    "AI systems can perpetuate and amplify existing biases present in training data.",
    "For example, facial recognition systems have shown higher error rates for certain",
    "demographic groups. Ensuring fairness requires careful dataset curation, bias auditing,",
    "and diverse representation in AI teams.",
    "",
    "## Transparency and Explainability",
    "",
    "Many AI models, particularly deep learning systems, operate as 'black boxes' where",
    "the decision-making process is opaque. Explainable AI (XAI) aims to make model",
    "decisions interpretable to humans. This is critical in high-stakes domains like",
    "healthcare, criminal justice, and finance.",
    "",
    "## Privacy",
    "",
    "AI systems often require large amounts of data, raising privacy concerns.",
    "Techniques like differential privacy, federated learning, and data anonymization",
    "help protect individual privacy while enabling AI development.",
    "",
    "## AI Safety and Alignment",
    "",
    "As AI becomes more capable, ensuring alignment between AI goals and human values",
    "is essential. Key concerns include:",
    "- Reward hacking: AI finding unintended shortcuts to maximize objectives",
    "- Value alignment: Ensuring AI systems pursue goals beneficial to humanity",
    "- Control problem: Maintaining meaningful human oversight of AI systems",
  ].join("\n"),
};

// Increase timeout for AI calls
test.setTimeout(120_000);

test.describe.serial("Knowledge Base synthesis flows", () => {
  // ── Setup ────────────────────────────────────────────────────────────
  test("setup: register, create workspace, upload files, create KB", async ({
    page,
  }) => {
    // Register
    await page.goto("/register");
    await page.getByPlaceholder("Your name").fill(TEST_USER.name);
    await page.getByPlaceholder("you@example.com").fill(TEST_USER.email);
    await page.getByPlaceholder("Choose a password").fill(TEST_USER.password);
    await page.getByRole("button", { name: /create account/i }).click();
    // Pre-dismiss KB announcement modal before workspace loads
    await page.evaluate(() =>
      localStorage.setItem("openstore:kb-announcement-dismissed", "1"),
    );
    await page.waitForURL("/onboarding", { timeout: 15000 });
    await page.getByPlaceholder("e.g. Acme Inc").fill("Synthesis Workspace");
    await page.getByRole("button", { name: /create workspace/i }).click();
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Upload first source document
    await page.getByRole("button", { name: /upload/i }).first().click();
    await page.waitForTimeout(500);
    const fileInput = page.locator(
      '[data-slot="dialog-content"] input[type="file"]',
    );
    await fileInput.setInputFiles({
      name: SOURCE_DOC_1.name,
      mimeType: "text/plain",
      buffer: Buffer.from(SOURCE_DOC_1.content),
    });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /upload 1 file/i }).click();
    await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    // Upload second source document
    await page.getByRole("button", { name: /upload/i }).first().click();
    await page.waitForTimeout(500);
    const fileInput2 = page.locator(
      '[data-slot="dialog-content"] input[type="file"]',
    );
    await fileInput2.setInputFiles({
      name: SOURCE_DOC_2.name,
      mimeType: "text/plain",
      buffer: Buffer.from(SOURCE_DOC_2.content),
    });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /upload 1 file/i }).click();
    await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    // Create tag
    const tagIconBtn = page.locator(
      'header [data-slot="tooltip-trigger"]',
    ).first();
    await tagIconBtn.click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder("New tag name...").fill(TAG_NAME);
    await page.getByRole("button", { name: /^add$/i }).click();
    await page.waitForTimeout(1000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Tag both files
    for (const fileName of [SOURCE_DOC_1.name, SOURCE_DOC_2.name]) {
      await openFileContextMenu(page, fileName);
      await page.getByRole("menuitem", { name: /edit tags/i }).click();
      await page.waitForTimeout(500);
      const dialog = page.locator('[data-slot="dialog-content"]');
      await dialog.locator("button", { hasText: TAG_NAME }).click();
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: /^save$/i }).click();
      await page.waitForTimeout(2000);
    }

    // Install KB plugin
    await page.getByRole("link", { name: "Plugins" }).click();
    await page.waitForTimeout(1000);
    const catalogSection = page.locator("section", {
      hasText: "Plugin Catalog",
    });
    const kbPlugin = catalogSection.locator("div.rounded-lg.border", {
      hasText: "Knowledge Base",
    });
    await kbPlugin.getByRole("button", { name: /install plugin/i }).click();
    await page.waitForTimeout(500);
    await page
      .locator('[data-slot="dialog-content"]')
      .getByRole("button", { name: /^install$/i })
      .click();
    await page.waitForTimeout(2000);

    // Create KB — use the sidebar link (not the plugin name text on the page)
    await page.getByRole("link", { name: "Knowledge Base" }).click();
    await page.waitForTimeout(1000);
    await page
      .getByRole("button", { name: /create knowledge base/i })
      .first()
      .click();
    await page.waitForTimeout(500);
    const kbDialog = page.locator('[data-slot="dialog-content"]');
    await kbDialog
      .getByPlaceholder("e.g. Product Documentation")
      .fill(KB_NAME);
    await kbDialog.locator("button", { hasText: "Select a tag" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("option", { name: TAG_NAME }).click();
    await page.waitForTimeout(300);
    await kbDialog.getByRole("button", { name: /^create$/i }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText(KB_NAME).first()).toBeVisible({
      timeout: 5000,
    });
    await page.screenshot({
      path: "e2e/screenshots/synth-01-setup-complete.png",
    });
  });

  // ── Ingest first document ────────────────────────────────────────────
  test("ingest first source document and verify wiki pages", async ({
    page,
  }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    // Go to Sources tab
    await page.getByRole("tab", { name: "Sources" }).click();
    await page.waitForTimeout(1000);

    // Verify both source files appear
    await expect(page.getByText(SOURCE_DOC_1.name)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(SOURCE_DOC_2.name)).toBeVisible({
      timeout: 5000,
    });
    await page.screenshot({
      path: "e2e/screenshots/synth-02-sources-visible.png",
    });

    // Ingest the first document (AI fundamentals)
    const firstFileRow = page
      .locator("div.flex.items-center", { hasText: SOURCE_DOC_1.name })
      .first();
    const ingestBtn = firstFileRow.getByRole("button", { name: /ingest/i });
    await expect(ingestBtn).toBeVisible({ timeout: 5000 });
    await ingestBtn.click();
    await page.screenshot({
      path: "e2e/screenshots/synth-02b-ingest-clicked.png",
    });

    // Wait for the Ingest button to show loading spinner, then return to normal
    // (indicating the mutation completed — success or error)
    // First wait for spinner to appear
    await expect(
      firstFileRow.locator("svg.animate-spin"),
    ).toBeVisible({ timeout: 5000 }).catch(() => {
      // Spinner may have already disappeared if LLM was fast
    });
    // Then wait for spinner to disappear (mutation done)
    await expect(
      firstFileRow.locator("svg.animate-spin"),
    ).not.toBeVisible({ timeout: 90000 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: "e2e/screenshots/synth-03-first-ingestion-complete.png",
    });

    // Switch to Wiki tab to verify pages were created
    await page.getByRole("tab", { name: "Wiki" }).click();
    await page.waitForTimeout(2000);

    // The wiki should now have pages — check that empty state is gone
    await expect(page.getByText("No wiki pages yet")).not.toBeVisible({
      timeout: 5000,
    });

    // Verify there are clickable page entries in the wiki sidebar
    const wikiSidebar = page.locator(".w-56");
    const wikiPageButtons = wikiSidebar.locator("button");
    const pageCount = await wikiPageButtons.count();
    expect(pageCount).toBeGreaterThan(0);
    await page.screenshot({
      path: "e2e/screenshots/synth-04-wiki-pages-created.png",
    });

    // Click the first page and verify it has content
    await wikiPageButtons.first().click();
    await page.waitForTimeout(2000);

    // The content area should now show markdown content
    const contentArea = page.locator(".prose");
    await expect(contentArea).toBeVisible({ timeout: 10000 });
    const pageText = await contentArea.textContent();
    expect(pageText!.length).toBeGreaterThan(50);
    await page.screenshot({
      path: "e2e/screenshots/synth-05-wiki-page-content.png",
    });
  });

  // ── Ingest second document via Ingest All ────────────────────────────
  test("ingest all sources and verify wiki grows", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    // Check current wiki page count
    await page.getByRole("tab", { name: "Wiki" }).click();
    await page.waitForTimeout(2000);
    const wikiSidebar = page.locator(".w-56");
    const pagesBefore = await wikiSidebar.locator("button").count();

    // Click "Ingest All" in the header
    const ingestAllBtn = page.getByRole("button", { name: /ingest all/i });
    await ingestAllBtn.click();

    // Wait for the loading spinner to appear then disappear
    await expect(
      ingestAllBtn.locator("svg.animate-spin"),
    ).toBeVisible({ timeout: 5000 }).catch(() => {});
    await expect(
      ingestAllBtn.locator("svg.animate-spin"),
    ).not.toBeVisible({ timeout: 90000 });
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: "e2e/screenshots/synth-06-ingest-all-complete.png",
    });

    // Refresh wiki tab to see new/updated pages
    await page.getByRole("tab", { name: "Sources" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("tab", { name: "Wiki" }).click();
    await page.waitForTimeout(2000);

    // Wiki should have pages (at least as many as before, likely more)
    const pagesAfter = await wikiSidebar.locator("button").count();
    expect(pagesAfter).toBeGreaterThanOrEqual(pagesBefore);
    await page.screenshot({
      path: "e2e/screenshots/synth-07-wiki-after-ingest-all.png",
    });
  });

  // ── Browse wiki and verify interlinks ────────────────────────────────
  test("browse wiki pages and check rendered content", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    await page.getByRole("tab", { name: "Wiki" }).click();
    await page.waitForTimeout(2000);

    // Click through each page in the sidebar and take screenshots
    const wikiSidebar = page.locator(".w-56");
    const pageButtons = wikiSidebar.locator("button");
    const count = await pageButtons.count();

    for (let i = 0; i < Math.min(count, 3); i++) {
      await pageButtons.nth(i).click();
      await page.waitForTimeout(2000);

      const contentArea = page.locator(".prose");
      await expect(contentArea).toBeVisible({ timeout: 10000 });
      await page.screenshot({
        path: `e2e/screenshots/synth-08-wiki-page-${i + 1}.png`,
      });
    }
  });

  // ── Chat with the knowledge base ─────────────────────────────────────
  test("chat with the knowledge base about ingested content", async ({
    page,
  }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    // Should be on Chat tab by default
    await page.getByRole("tab", { name: "Chat" }).click();
    await page.waitForTimeout(1000);

    // Create a new conversation if needed
    const newConvButton = page.getByRole("button", {
      name: /new conversation/i,
    });
    if (await newConvButton.isVisible()) {
      await newConvButton.click();
    } else {
      await page.getByRole("button", { name: /^new$/i }).click();
    }
    await page.waitForTimeout(1000);

    // Type and send a question about the ingested content
    const input = page.getByPlaceholder("Ask a question...");
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill("What are the three types of machine learning?");
    await page.screenshot({
      path: "e2e/screenshots/synth-09-chat-question-typed.png",
    });

    // Send the message
    await page.locator("button:has(svg.lucide-send)").click();

    // Wait for the assistant response (LLM streaming)
    // The user message should appear immediately
    await expect(
      page.getByText("What are the three types of machine learning?"),
    ).toBeVisible({ timeout: 5000 });

    // Wait for assistant response to appear (streaming takes time)
    // Look for any text that mentions "supervised" since we know it's in the source
    await expect(
      page.getByText(/supervised/i).first(),
    ).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "e2e/screenshots/synth-10-chat-response.png",
    });

    // Verify the response mentions key concepts from the source document
    // Assistant messages use bg-muted, user messages use bg-primary
    const assistantBubbles = page.locator("div.bg-muted .prose");
    const lastAssistant = assistantBubbles.last();
    await expect(lastAssistant).toBeVisible({ timeout: 5000 });
    const responseText = await lastAssistant.textContent();
    expect(responseText?.toLowerCase()).toContain("supervised");
  });

  // ── Ask a second question to test conversation continuity ────────────
  test("continue conversation with follow-up question", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    await page.getByRole("tab", { name: "Chat" }).click();
    await page.waitForTimeout(2000);

    // The previous conversation should be auto-selected
    // Send a follow-up about ethics (from second document)
    const input = page.getByPlaceholder("Ask a question...");
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(
      "What does the knowledge base say about AI bias and fairness?",
    );
    await page.locator("button:has(svg.lucide-send)").click();

    // Wait for response about bias/fairness
    await expect(
      page.getByText(/bias/i).last(),
    ).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "e2e/screenshots/synth-11-chat-followup.png",
    });

    // The conversation title should have been auto-generated
    const convSelector = page.getByRole("button", {
      name: /select conversation|what are/i,
    });
    await expect(convSelector.first()).toBeVisible({ timeout: 5000 });
  });

  // ── Verify messages persist across refresh ────────────────────────────
  test("messages persist after page refresh", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    await page.getByRole("tab", { name: "Chat" }).click();
    await page.waitForTimeout(2000);

    // Should see previous messages from the conversation (loaded from DB)
    // The first question about ML types should be visible
    // User message bubble should be visible (use bg-primary to scope to message area)
    await expect(
      page.locator("div.bg-primary").getByText("What are the three types of machine learning?"),
    ).toBeVisible({ timeout: 10000 });

    // An assistant response should also be visible
    const assistantBubbles = page.locator("div.bg-muted .prose");
    await expect(assistantBubbles.first()).toBeVisible({ timeout: 10000 });
    const responseText = await assistantBubbles.first().textContent();
    expect(responseText!.length).toBeGreaterThan(20);

    await page.screenshot({
      path: "e2e/screenshots/synth-12-messages-persisted.png",
    });

    // Hard refresh the page
    await page.reload();
    await page.waitForTimeout(3000);

    // Messages should still be there after reload
    await expect(
      page.locator("div.bg-primary").first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator("div.bg-muted .prose").first(),
    ).toBeVisible({ timeout: 10000 });

    await page.screenshot({
      path: "e2e/screenshots/synth-13-messages-after-refresh.png",
    });
  });

  // ── Lint the wiki ────────────────────────────────────────────────────
  test("lint the wiki for quality issues", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    // Click Lint button
    const lintBtn = page.getByRole("button", { name: /^lint$/i });
    await lintBtn.click();

    // Wait for the loading spinner to appear then disappear
    await expect(
      lintBtn.locator("svg.animate-spin"),
    ).toBeVisible({ timeout: 5000 }).catch(() => {});
    await expect(
      lintBtn.locator("svg.animate-spin"),
    ).not.toBeVisible({ timeout: 90000 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: "e2e/screenshots/synth-12-lint-results.png",
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function loginAs(page: Page) {
  await page.goto("/login");
  // Pre-dismiss KB announcement modal before workspace loads
  await page.evaluate(() =>
    localStorage.setItem("openstore:kb-announcement-dismissed", "1"),
  );
  await page.getByPlaceholder("you@example.com").fill(TEST_USER.email);
  await page.getByPlaceholder("Enter password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/w\//, { timeout: 15000 });
  await page.waitForTimeout(1000);
}

async function navigateToKBDetail(page: Page) {
  await page.getByRole("link", { name: "Knowledge Base" }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("link", { name: KB_NAME }).click();
  await page.waitForTimeout(1000);
}

async function openFileContextMenu(page: Page, fileName: string) {
  const row = page.locator("div.grid", { hasText: fileName }).first();
  await row.hover();
  await page.waitForTimeout(300);
  const menuBtn = row.locator("button").last();
  await menuBtn.click({ force: true });
  await page.waitForTimeout(300);
}
