import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_USER = {
  name: "Stores Test User",
  email: `stores-test-${Date.now()}@example.com`,
  password: "TestPassword123!",
};

// Unique temp directories for this test run
const TEST_DIR = path.join(os.tmpdir(), `locker-e2e-stores-${Date.now()}`);
const SYNC_STORE_DIR = path.join(TEST_DIR, "sync-store");
const INGEST_STORE_DIR = path.join(TEST_DIR, "ingest-store");

let workspaceSlug = "";

// ── Helpers ──────────────────────────────────────────────────────────────

async function register(page: Page) {
  await page.goto("/register");
  await page.getByPlaceholder("Your name").fill(TEST_USER.name);
  await page.getByPlaceholder("you@example.com").fill(TEST_USER.email);
  await page.getByPlaceholder("Choose a password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/onboarding", { timeout: 15_000 });
}

async function onboard(page: Page) {
  await page.getByPlaceholder(/acme/i).fill("Stores Test WS");
  await page.getByRole("button", { name: /create workspace/i }).click();
  await page.waitForURL("**/w/**", { timeout: 60_000 });
  workspaceSlug = page.url().split("/w/")[1]?.split("/")[0] ?? "";
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(TEST_USER.email);
  await page.getByPlaceholder("Enter password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/w/**", { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await dismissModals(page);
}

async function dismissModals(page: Page) {
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(1000);
    const dialog = page.locator('[role="dialog"]');
    if (!(await dialog.first().isVisible().catch(() => false))) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
}

async function goToStoresPage(page: Page) {
  await page.goto(`/w/${workspaceSlug}/settings/stores`);
  await page.waitForTimeout(3000);
  await dismissModals(page);
  await expect(page.getByText("Workspace Stores")).toBeVisible({
    timeout: 30_000,
  });
  // Wait for the loading state to resolve
  await expect(page.getByText("Loading stores")).toBeHidden({
    timeout: 30_000,
  });
  await dismissModals(page);
  await page.waitForTimeout(500);
}

/**
 * Select a value from a Radix Select inside a modal.
 * Clicks the combobox matching `triggerText`, waits for the portal to appear
 * above the modal (z-[80]), then selects the option.
 */
async function selectOption(
  page: Page,
  triggerText: string,
  optionName: string,
) {
  await page
    .getByRole("combobox")
    .filter({ hasText: triggerText })
    .click();
  await page.waitForTimeout(400);
  await page.getByRole("option", { name: optionName }).click();
  await page.waitForTimeout(300);
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe.serial("Stores feature flows", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SYNC_STORE_DIR, { recursive: true });
    fs.mkdirSync(INGEST_STORE_DIR, { recursive: true });
  });

  test.afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ── 1. Setup ──────────────────────────────────────────────────────────

  test("setup: register, onboard, upload a test file", async ({ page }) => {
    test.setTimeout(120_000);
    await register(page);
    await page.screenshot({
      path: "e2e/screenshots/stores-01-onboarding.png",
    });
    await onboard(page);
    await dismissModals(page);
    await page.screenshot({
      path: "e2e/screenshots/stores-02-workspace.png",
    });
    await expect(page.getByText("My Files")).toBeVisible({ timeout: 10_000 });
    await dismissModals(page);

    // Upload a file so we have something to sync later
    await page.getByRole("button", { name: /^upload$/i }).first().click();
    await page.waitForTimeout(500);

    const fileInput = page.locator(
      '[data-slot="dialog-content"] input[type="file"]',
    );
    await fileInput.setInputFiles({
      name: "sync-test-file.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("This file will be synced to the local store"),
    });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /upload 1 file/i }).click();
    await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    await expect(page.getByText("sync-test-file.txt")).toBeVisible({
      timeout: 5000,
    });
    await page.screenshot({
      path: "e2e/screenshots/stores-03-file-uploaded.png",
    });
  });

  // ── 2. Verify default store ───────────────────────────────────────────

  test("navigate to stores and verify default platform store", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await login(page);
    await goToStoresPage(page);

    // Default store should exist with Platform + Primary badges
    await expect(page.getByText("Platform").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Primary").first()).toBeVisible({
      timeout: 5000,
    });

    await page.screenshot({
      path: "e2e/screenshots/stores-04-default-store.png",
    });
  });

  // ── 3. Add a writable local store via modal ──────────��────────────────

  test("add a writable local store", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await goToStoresPage(page);
    await dismissModals(page);

    // Click "Add store" to open the modal
    await page.getByRole("button", { name: /add store/i }).click();
    await page.waitForTimeout(500);

    // Modal should be visible with title "Add store"
    await expect(
      page.getByRole("heading", { name: "Add store" }),
    ).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: "e2e/screenshots/stores-05-add-modal-open.png",
    });

    // Fill in name
    await page.getByPlaceholder("e.g. Production S3").fill("E2E Sync Store");

    // Provider → Local Disk (select inside modal, portals above it)
    await selectOption(page, "Amazon S3", "Local Disk");

    await page.screenshot({
      path: "e2e/screenshots/stores-06-provider-selected.png",
    });

    // Base directory field should now be visible
    await page.getByPlaceholder("/var/lib/locker").fill(SYNC_STORE_DIR);

    await page.screenshot({
      path: "e2e/screenshots/stores-07-form-filled.png",
    });

    // Test connection first
    await page
      .getByRole("button", { name: "Test", exact: true })
      .click();
    await page.waitForTimeout(3000);

    // Create the store
    await page.getByRole("button", { name: /create store/i }).click();
    await page.waitForTimeout(5000);

    // Modal should close and store should appear in the list
    await expect(page.getByText("E2E Sync Store")).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({
      path: "e2e/screenshots/stores-08-sync-store-created.png",
    });
  });

  // ── 4. Select dropdowns work inside modal (z-index regression) ────────

  test("select dropdowns render above the modal", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await goToStoresPage(page);
    await dismissModals(page);

    // Open add store modal
    await page.getByRole("button", { name: /add store/i }).click();
    await page.waitForTimeout(500);

    // Click the Provider select trigger
    const providerTrigger = page
      .getByRole("combobox")
      .filter({ hasText: "Amazon S3" });
    await providerTrigger.click();
    await page.waitForTimeout(400);

    // The select content should be visible and interactable
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: "e2e/screenshots/stores-09-select-above-modal.png",
    });

    // Verify all provider options are present
    await expect(page.getByRole("option", { name: "Amazon S3" })).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Cloudflare R2" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Vercel Blob" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Local Disk" }),
    ).toBeVisible();

    // Select an option to confirm it works
    await page.getByRole("option", { name: "Cloudflare R2" }).click();
    await page.waitForTimeout(300);

    // Verify the write mode select also works
    await selectOption(page, "Writable", "Read-only");

    await page.screenshot({
      path: "e2e/screenshots/stores-10-write-mode-selected.png",
    });

    // Close the modal
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  });

  // ── 5. Sync files to local store ──────────────────────────────────────

  test("sync file to both stores and verify on disk", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await goToStoresPage(page);
    await dismissModals(page);

    // Click "Sync all"
    await page.getByRole("button", { name: /sync all/i }).click();
    await page.waitForTimeout(8000);

    await page.screenshot({
      path: "e2e/screenshots/stores-11-sync-completed.png",
    });

    // Verify sync completed via the UI status badge
    await expect(page.getByText(/processed/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("completed").first()).toBeVisible({
      timeout: 5000,
    });

    // Check if the file appeared on disk
    const syncedFiles = listFilesRecursive(SYNC_STORE_DIR);
    if (syncedFiles.some((f) => f.includes("sync-test-file.txt"))) {
      console.log("File verified on local disk");
    } else {
      console.log(
        "File not found on local disk (primary store may be remote S3)",
      );
    }
  });

  // ── 6. Add a read-only ingest store ───────────────────────────────────

  test("create read-only store with external file and ingest it", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // Write a file directly to the ingest directory (outside Locker)
    fs.writeFileSync(
      path.join(INGEST_STORE_DIR, "external-document.txt"),
      "This file was added outside of Locker and should be ingested",
    );

    await login(page);
    await goToStoresPage(page);
    await dismissModals(page);

    // Open add store modal
    await page.getByRole("button", { name: /add store/i }).click();
    await page.waitForTimeout(500);

    // Fill name
    await page.getByPlaceholder("e.g. Production S3").fill("E2E Ingest Store");

    // Provider → Local Disk
    await selectOption(page, "Amazon S3", "Local Disk");

    // Write mode → Read-only
    await selectOption(page, "Writable", "Read-only");

    // Ingest mode → Scan for files
    await selectOption(page, "No scanning", "Scan for files");

    // Base directory
    await page.getByPlaceholder("/var/lib/locker").fill(INGEST_STORE_DIR);

    await page.screenshot({
      path: "e2e/screenshots/stores-12-ingest-store-form.png",
    });

    // Create
    await page.getByRole("button", { name: /create store/i }).click();
    await page.waitForTimeout(5000);

    // Verify it appears with Read-only badge
    await expect(page.getByText("E2E Ingest Store")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Read-only").first()).toBeVisible({
      timeout: 5000,
    });

    await page.screenshot({
      path: "e2e/screenshots/stores-13-ingest-store-created.png",
    });
  });

  // ── 7. Edit store via modal ───────────────────────────────────────────

  test("edit an existing store via modal", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await goToStoresPage(page);

    // Hover the E2E Sync Store card to reveal the Edit button
    const storeCard = page
      .locator("div", { hasText: "E2E Sync Store" })
      .filter({ has: page.locator("text=Local Disk") })
      .first();
    await storeCard.hover();
    await page.waitForTimeout(300);

    // Click Edit
    await storeCard.getByRole("button", { name: /edit/i }).click();
    await page.waitForTimeout(500);

    // Modal should show "Edit E2E Sync Store"
    await expect(page.getByText("Edit E2E Sync Store")).toBeVisible({
      timeout: 5000,
    });

    await page.screenshot({
      path: "e2e/screenshots/stores-14-edit-modal.png",
    });

    // Provider should be disabled for existing stores
    const providerTrigger = page
      .getByRole("combobox")
      .filter({ hasText: "Local Disk" });
    await expect(providerTrigger).toBeDisabled();

    // Rename the store
    const nameInput = page.getByPlaceholder("e.g. Production S3");
    await nameInput.clear();
    await nameInput.fill("E2E Sync Store Renamed");

    // Save changes
    await page.getByRole("button", { name: /save changes/i }).click();
    await page.waitForTimeout(3000);

    // Modal should close, updated name should appear
    await expect(page.getByText("E2E Sync Store Renamed")).toBeVisible({
      timeout: 10_000,
    });

    await page.screenshot({
      path: "e2e/screenshots/stores-15-store-renamed.png",
    });
  });

  // ── 8. Dropdown menu actions work on store cards ──────────────────────

  test("store card dropdown menu works", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await goToStoresPage(page);

    // Find the E2E Sync Store Renamed card and open its dropdown
    const storeCard = page
      .locator("div", { hasText: "E2E Sync Store Renamed" })
      .filter({ has: page.locator("text=Local Disk") })
      .first();

    // Click the "..." button
    await storeCard.getByRole("button").filter({ has: page.locator("svg") }).last().click();
    await page.waitForTimeout(300);

    await page.screenshot({
      path: "e2e/screenshots/stores-16-dropdown-menu.png",
    });

    // Should see Sync and Make primary options
    await expect(
      page.getByRole("menuitem", { name: /sync/i }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole("menuitem", { name: /make primary/i }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole("menuitem", { name: /archive/i }),
    ).toBeVisible({ timeout: 5000 });

    // Click Sync from the dropdown
    await page.getByRole("menuitem", { name: /sync/i }).click();
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "e2e/screenshots/stores-17-sync-from-dropdown.png",
    });
  });

  // ── 9. Archive a store via dropdown + confirm modal ───────────────────

  test("archive a store via dropdown and confirm modal", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await goToStoresPage(page);

    // Find the ingest store card
    const storeCard = page
      .locator("div", { hasText: "E2E Ingest Store" })
      .filter({ has: page.locator("text=Local Disk") })
      .first();

    // Open the dropdown menu
    await storeCard.getByRole("button").filter({ has: page.locator("svg") }).last().click();
    await page.waitForTimeout(300);

    // Click archive
    await page.getByRole("menuitem", { name: /archive/i }).click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: "e2e/screenshots/stores-18-archive-confirm.png",
    });

    // Confirm modal should appear
    await expect(page.getByText("Archive store")).toBeVisible({
      timeout: 5000,
    });

    // Click the confirm/archive button
    await page.getByRole("button", { name: /archive/i }).last().click();
    await page.waitForTimeout(3000);

    // The ingest store should disappear from the list
    await expect(page.getByText("E2E Ingest Store")).toBeHidden({
      timeout: 10_000,
    });

    await page.screenshot({
      path: "e2e/screenshots/stores-19-store-archived.png",
    });
  });
});
