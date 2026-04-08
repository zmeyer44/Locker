import { test, expect, type Page } from "@playwright/test";

const TEST_USER = {
  name: "KB Test User",
  email: `kb-test-${Date.now()}@example.com`,
  password: "TestPassword123!",
};

const TAG_NAME = "KB Source Docs";
const KB_NAME = "Test Knowledge Base";
const KB_DESCRIPTION = "E2E test knowledge base";
const SOURCE_FILE_NAME = "kb-source-doc.txt";
const SOURCE_FILE_CONTENT =
  "Artificial intelligence (AI) is a branch of computer science that aims to create intelligent machines. " +
  "Machine learning is a subset of AI that enables systems to learn from data. " +
  "Deep learning is a subset of machine learning that uses neural networks with multiple layers. " +
  "Natural language processing (NLP) allows computers to understand human language.";

test.describe.serial("Knowledge Base flows", () => {
  // ── Setup: Register, onboard, create tag, upload file, tag it ────────
  test("setup: register, create tag, upload and tag a source file", async ({
    page,
  }) => {
    // Register
    await page.goto("/register");
    await page.getByPlaceholder("Your name").fill(TEST_USER.name);
    await page.getByPlaceholder("you@example.com").fill(TEST_USER.email);
    await page.getByPlaceholder("Choose a password").fill(TEST_USER.password);
    await page.getByRole("button", { name: /create account/i }).click();

    // Pre-dismiss the KB announcement modal via localStorage before workspace loads
    await page.evaluate(() =>
      localStorage.setItem("openstore:kb-announcement-dismissed", "1"),
    );

    // Onboard
    await page.waitForURL("/onboarding", { timeout: 15000 });
    await page.getByPlaceholder("e.g. Acme Inc").fill("KB Test Workspace");
    await page.getByRole("button", { name: /create workspace/i }).click();
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: "e2e/screenshots/kb-01-workspace-created.png",
    });

    // Upload a source file first (so the file explorer header appears)
    await page.getByRole("button", { name: /upload/i }).first().click();
    await page.waitForTimeout(500);

    const fileInput = page.locator(
      '[data-slot="dialog-content"] input[type="file"]',
    );
    await fileInput.setInputFiles({
      name: SOURCE_FILE_NAME,
      mimeType: "text/plain",
      buffer: Buffer.from(SOURCE_FILE_CONTENT),
    });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /upload 1 file/i }).click();
    await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    await expect(page.getByText(SOURCE_FILE_NAME)).toBeVisible({
      timeout: 5000,
    });
    await page.screenshot({
      path: "e2e/screenshots/kb-02-file-uploaded.png",
    });

    // Open Manage Tags via the tag icon button in the header
    // It's the icon-only button with data-slot="tooltip-trigger" near "New Folder"
    const tagIconBtn = page.locator(
      'header [data-slot="tooltip-trigger"]',
    ).first();
    await expect(tagIconBtn).toBeVisible({ timeout: 5000 });
    await tagIconBtn.click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder("New tag name...").fill(TAG_NAME);
    await page.getByRole("button", { name: /^add$/i }).click();
    await page.waitForTimeout(1000);

    await expect(
      page.locator('[data-slot="dialog-content"]').getByText(TAG_NAME),
    ).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-03-tag-created.png",
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Tag the file with our KB tag
    await openFileContextMenu(page, SOURCE_FILE_NAME);
    await page.getByRole("menuitem", { name: /edit tags/i }).click();
    await page.waitForTimeout(500);

    const dialog = page.locator('[data-slot="dialog-content"]');
    await dialog.locator("button", { hasText: TAG_NAME }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /^save$/i }).click();
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "e2e/screenshots/kb-04-file-tagged.png",
    });
  });

  // ── Install KB plugin so sidebar item appears ────────────────────────
  test("install knowledge base plugin", async ({ page }) => {
    await loginAs(page);

    // Navigate to Plugins page
    await page.getByRole("link", { name: "Plugins" }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByText("Plugin Catalog")).toBeVisible({
      timeout: 5000,
    });
    await page.screenshot({
      path: "e2e/screenshots/kb-05-plugins-page.png",
    });

    // Find the Knowledge Base plugin in the catalog and install it
    const kbCard = page
      .locator("div.rounded-lg.border", { hasText: "Knowledge Base" })
      .filter({ hasText: "Plugin Catalog" })
      .locator("..")
      .locator("div.rounded-lg.border", { hasText: "Knowledge Base" })
      .first();

    // Simpler approach: find the Install Plugin button near "Knowledge Base" text
    const catalogSection = page.locator("section", {
      hasText: "Plugin Catalog",
    });
    const kbPlugin = catalogSection.locator("div.rounded-lg.border", {
      hasText: "Knowledge Base",
    });
    await expect(kbPlugin).toBeVisible({ timeout: 5000 });
    await kbPlugin.getByRole("button", { name: /install plugin/i }).click();
    await page.waitForTimeout(500);

    // Install dialog appears — just click Install (no required config fields)
    await expect(
      page.getByRole("heading", { name: /install knowledge base/i }),
    ).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-06-install-dialog.png",
    });

    await page
      .locator('[data-slot="dialog-content"]')
      .getByRole("button", { name: /^install$/i })
      .click();
    await page.waitForTimeout(2000);

    // Verify it moved to Installed Plugins section
    const installedSection = page.locator("section", {
      hasText: "Installed Plugins",
    });
    await expect(
      installedSection.getByText("Knowledge Base").first(),
    ).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-07-plugin-installed.png",
    });
  });

  // ── Verify KB sidebar item appears after plugin install ──────────────
  test("knowledge base sidebar item appears after plugin install", async ({
    page,
  }) => {
    await loginAs(page);

    // The Knowledge Base sidebar item should now be visible
    const kbSidebarItem = page.getByText("Knowledge Base", { exact: true });
    await expect(kbSidebarItem).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-08-sidebar-item-visible.png",
    });
  });

  // ── Navigate to KB list and see empty state ──────────────────────────
  test("KB list page shows empty state", async ({ page }) => {
    await loginAs(page);

    // Click Knowledge Base in sidebar
    await page.getByText("Knowledge Base", { exact: true }).click();
    await page.waitForTimeout(1000);

    await expect(
      page.getByText("No knowledge bases yet"),
    ).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-09-empty-list.png",
    });
  });

  // ── Create a knowledge base ──────────────────────────────────────────
  test("create a knowledge base", async ({ page }) => {
    await loginAs(page);
    await page.getByText("Knowledge Base", { exact: true }).click();
    await page.waitForTimeout(1000);

    // Click Create Knowledge Base button
    await page
      .getByRole("button", { name: /create knowledge base/i })
      .first()
      .click();
    await page.waitForTimeout(500);

    // Fill in the form
    await expect(
      page.getByRole("heading", { name: /create knowledge base/i }),
    ).toBeVisible({ timeout: 5000 });

    const dialog = page.locator('[data-slot="dialog-content"]');
    await dialog.getByPlaceholder("e.g. Product Documentation").fill(KB_NAME);

    // Select the tag
    await dialog.locator("button", { hasText: "Select a tag" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("option", { name: TAG_NAME }).click();
    await page.waitForTimeout(300);

    // Add description
    await dialog
      .getByPlaceholder("Optional description")
      .fill(KB_DESCRIPTION);

    await page.screenshot({
      path: "e2e/screenshots/kb-10-create-form-filled.png",
    });

    // Click Create
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await page.waitForTimeout(2000);

    // Verify the KB appears in the list
    await expect(page.getByText(KB_NAME).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(TAG_NAME).first()).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-11-kb-created.png",
    });
  });

  // ── Open KB detail page ──────────────────────────────────────────────
  test("open KB detail page and see tabs", async ({ page }) => {
    await loginAs(page);
    await page.getByText("Knowledge Base", { exact: true }).click();
    await page.waitForTimeout(1000);

    // Click the KB card to open detail page
    await page.getByRole("link", { name: KB_NAME }).click();
    await page.waitForTimeout(1000);

    // Verify header shows KB name and tag
    await expect(page.getByText(KB_NAME).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(TAG_NAME).first()).toBeVisible({ timeout: 5000 });

    // Verify all tabs are present
    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Wiki" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sources" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Settings" })).toBeVisible();

    // Verify action buttons
    await expect(
      page.getByRole("button", { name: /ingest all/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /lint/i })).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/kb-12-detail-page.png",
    });
  });

  // ── Check Chat tab — empty state and conversation creation ───────────
  test("chat tab: create a new conversation", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    // Should be on Chat tab by default
    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();

    // Should see empty state or new conversation prompt
    const newConvButton = page.getByRole("button", {
      name: /new conversation/i,
    });
    if (await newConvButton.isVisible()) {
      await newConvButton.click();
    } else {
      // Use the "New" button in the header
      await page.getByRole("button", { name: /^new$/i }).click();
    }
    await page.waitForTimeout(1000);

    // Should see the chat input area
    await expect(
      page.getByPlaceholder("Ask a question..."),
    ).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: "e2e/screenshots/kb-13-chat-conversation-created.png",
    });
  });

  // ── Check Sources tab ────────────────────────────────────────────────
  test("sources tab shows tagged files", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    // Click Sources tab
    await page.getByRole("tab", { name: "Sources" }).click();
    await page.waitForTimeout(1000);

    // Should show our tagged file
    await expect(page.getByText(SOURCE_FILE_NAME)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Source Documents")).toBeVisible();

    // Should have an Ingest button
    await expect(
      page.getByRole("button", { name: /ingest/i }).first(),
    ).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/kb-14-sources-tab.png",
    });
  });

  // ── Check Wiki tab — empty state ─────────────────────────────────────
  test("wiki tab shows empty state before ingestion", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    // Click Wiki tab
    await page.getByRole("tab", { name: "Wiki" }).click();
    await page.waitForTimeout(1000);

    // Should show empty state
    await expect(
      page.getByText("No wiki pages yet"),
    ).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: "e2e/screenshots/kb-15-wiki-empty.png",
    });
  });

  // ── Check Settings tab ───────────────────────────────────────────────
  test("settings tab shows KB configuration", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    // Click Settings tab
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.waitForTimeout(1000);

    // Should show the settings form with pre-filled values
    const nameInput = page.locator("input").first();
    await expect(nameInput).toHaveValue(KB_NAME, { timeout: 5000 });

    // Should show Save button and Delete button
    await expect(
      page.getByRole("button", { name: /save settings/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /delete knowledge base/i }),
    ).toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/kb-16-settings-tab.png",
    });
  });

  // ── Update KB settings ───────────────────────────────────────────────
  test("update KB name via settings", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    await page.getByRole("tab", { name: "Settings" }).click();
    await page.waitForTimeout(1000);

    // Change the description
    const descInput = page.getByPlaceholder("Optional description");
    await descInput.fill("Updated description for testing");
    await page.screenshot({
      path: "e2e/screenshots/kb-17-settings-updated.png",
    });

    await page.getByRole("button", { name: /save settings/i }).click();
    await page.waitForTimeout(2000);

    // Verify success toast or the value persists on reload
    await page.screenshot({
      path: "e2e/screenshots/kb-18-settings-saved.png",
    });
  });

  // ── Delete KB from settings ──────────────────────────────────────────
  test("delete knowledge base from settings", async ({ page }) => {
    await loginAs(page);
    await navigateToKBDetail(page);

    await page.getByRole("tab", { name: "Settings" }).click();
    await page.waitForTimeout(1000);

    // Click Delete KB
    await page
      .getByRole("button", { name: /delete knowledge base/i })
      .click();
    await page.waitForTimeout(500);

    // Confirm deletion
    await expect(
      page.getByRole("heading", { name: /delete knowledge base/i }),
    ).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-19-delete-confirm.png",
    });

    await page
      .locator('[data-slot="alert-dialog-content"]')
      .getByRole("button", { name: /^delete$/i })
      .click();

    // Should redirect back to KB list
    await expect(page).toHaveURL(/\/knowledge-bases$/, { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Should show empty state (may need to wait for cache to refresh)
    await expect(
      page.getByText("No knowledge bases yet"),
    ).toBeVisible({ timeout: 10000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-20-kb-deleted.png",
    });
  });

  // ── Re-create KB for further tests ──────────────────────────────────
  test("re-create KB for chat and wiki tests", async ({ page }) => {
    await loginAs(page);
    await page.getByText("Knowledge Base", { exact: true }).click();
    await page.waitForTimeout(1000);

    await page
      .getByRole("button", { name: /create knowledge base/i })
      .first()
      .click();
    await page.waitForTimeout(500);

    const dialog = page.locator('[data-slot="dialog-content"]');
    await dialog.getByPlaceholder("e.g. Product Documentation").fill(KB_NAME);
    await dialog.locator("button", { hasText: "Select a tag" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("option", { name: TAG_NAME }).click();
    await page.waitForTimeout(300);
    await dialog
      .getByPlaceholder("Optional description")
      .fill(KB_DESCRIPTION);
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText(KB_NAME).first()).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-21-kb-recreated.png",
    });
  });

  // ── Delete KB from the list page ─────────────────────────────────────
  test("delete KB from the list page via trash icon", async ({ page }) => {
    await loginAs(page);
    await page.getByText("Knowledge Base", { exact: true }).click();
    await page.waitForTimeout(1000);

    // Find the KB card and click the trash button
    const kbCard = page.locator("a.rounded-lg", { hasText: KB_NAME }).first();
    await expect(kbCard).toBeVisible({ timeout: 5000 });

    // Click the trash icon (prevent navigation)
    const trashBtn = kbCard.locator("button").first();
    await trashBtn.click();
    await page.waitForTimeout(500);

    // Confirm delete
    await expect(
      page.getByRole("heading", { name: /delete knowledge base/i }),
    ).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-22-list-delete-confirm.png",
    });

    await page
      .locator('[data-slot="alert-dialog-content"]')
      .getByRole("button", { name: /^delete$/i })
      .click();
    await page.waitForTimeout(2000);

    await expect(page.getByText("No knowledge bases yet")).toBeVisible({
      timeout: 5000,
    });
    await page.screenshot({
      path: "e2e/screenshots/kb-23-list-deleted.png",
    });
  });

  // ── Uninstall KB plugin and verify sidebar item disappears ───────────
  test("uninstall KB plugin removes sidebar item", async ({ page }) => {
    await loginAs(page);

    // Verify sidebar item is visible
    await expect(
      page.getByText("Knowledge Base", { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // Navigate to Plugins
    await page.getByRole("link", { name: "Plugins" }).click();
    await page.waitForTimeout(1000);

    // Find installed Knowledge Base plugin and uninstall
    const installedSection = page.locator("section", {
      hasText: "Installed Plugins",
    });
    const kbPlugin = installedSection.locator("div.rounded-lg.border", {
      hasText: "Knowledge Base",
    });
    await expect(kbPlugin).toBeVisible({ timeout: 5000 });

    // Handle the confirm dialog
    page.on("dialog", (dialog) => dialog.accept());
    await kbPlugin.getByRole("button", { name: /uninstall/i }).click();
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "e2e/screenshots/kb-24-plugin-uninstalled.png",
    });

    // Navigate away and back to refresh sidebar
    await page.goto("/login");
    await loginAs(page);

    // Verify Knowledge Base sidebar item is gone
    await expect(
      page.getByText("Knowledge Base", { exact: true }),
    ).not.toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: "e2e/screenshots/kb-25-sidebar-item-gone.png",
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
  await page.getByText("Knowledge Base", { exact: true }).click();
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
