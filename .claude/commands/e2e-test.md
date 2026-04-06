---
description: Write and run a full Playwright E2E test suite for the current feature branch
argument-hint: <feature description> - e.g. "document tagging", "file sharing", "workspace settings"
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent]
---

# Write & Run E2E Tests for a Feature

You are writing a comprehensive Playwright end-to-end test suite for the following feature:

**$ARGUMENTS**

## Your Task

1. **Understand the feature** — Read the code changes on the current branch to understand what was built
2. **Write the test file** — Create a Playwright test at `e2e/<feature-name>.spec.ts`
3. **Run the tests** — Execute them and iterate until they all pass
4. **Report results** — Show the user the final test output and any screenshots

## Step 1: Understand What Changed

Before writing any tests, understand the feature:

```bash
# See what files changed on this branch vs main
git diff main --name-only
git diff main --stat
```

Read the changed files to understand:

- What new UI components were added?
- What new API routes/tRPC endpoints were added?
- What new database tables or schema changes exist?
- What user-facing flows were introduced?

## Step 2: Write the Test

Create `e2e/<feature-name>.spec.ts` following these patterns exactly.

### Project Context

- **Stack**: Next.js 16 + tRPC + Drizzle ORM + React 19 + Shadcn UI
- **Config**: `playwright.config.ts` — testDir: `./e2e`, baseURL: `http://localhost:3000`, single chromium browser, serial execution, 30s timeout
- **Dev server**: Configured to auto-start via `pnpm dev` but reuses existing server if running

### Test Structure Template

```typescript
import { test, expect, type Page } from "@playwright/test";

const TEST_USER = {
  name: "Feature Test User",
  email: `feature-test-${Date.now()}@example.com`,
  password: "TestPassword123!",
};

test.describe.serial("Feature name flows", () => {
  // First test MUST register, onboard, and set up test data
  test("setup: register and create test data", async ({ page }) => {
    // Register
    await page.goto("/register");
    await page.getByPlaceholder("Your name").fill(TEST_USER.name);
    await page.getByPlaceholder("you@example.com").fill(TEST_USER.email);
    await page.getByPlaceholder("Choose a password").fill(TEST_USER.password);
    await page.getByRole("button", { name: /create account/i }).click();

    // Onboard — create workspace (REQUIRED for new users)
    await page.waitForURL("/onboarding", { timeout: 15000 });
    await page.getByPlaceholder("e.g. Acme Inc").fill("Test Workspace");
    await page.getByRole("button", { name: /create workspace/i }).click();
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    // ... set up test data (upload files, create folders, etc.) ...
  });

  // Subsequent tests log in and exercise the feature
  test("test name", async ({ page }) => {
    await loginAs(page);
    // ... test steps ...
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function loginAs(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(TEST_USER.email);
  await page.getByPlaceholder("Enter password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/w\//, { timeout: 15000 });
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
```

### Critical Rules

**Test lifecycle:**

- ALL tests use `test.describe.serial()` — they share state and run in order
- First test registers a fresh user (unique email via `Date.now()`) and creates a workspace
- Subsequent tests call `loginAs(page)` which navigates to `/login` and waits for `/w/` redirect
- If one test fails, all subsequent tests are skipped (serial dependency)

**Locator strategies (in priority order):**

1. `page.getByRole("button", { name: /text/i })` — buttons, links, headings, menu items
2. `page.getByPlaceholder("placeholder text")` — form inputs (works with React controlled inputs)
3. `page.locator('[data-slot="dialog-content"]')` — dialog wrappers
4. `page.locator('[data-sidebar="menu-button"]', { hasText: "Label" })` — sidebar nav items
5. `page.locator("div.grid", { hasText: "filename" }).first()` — file/folder rows in file explorer
6. `page.getByText("exact text")` — visible text content (use `.first()` if ambiguous)

**NEVER do these:**

- NEVER use `input[value="..."]` selectors — React controlled inputs don't reflect value in DOM attributes
- NEVER use `page.getByText()` for text that appears in both a heading and description — use `page.getByRole("heading", { name: "..." })` instead
- NEVER use `{ hasText: "Tags" }` when a workspace is named "Tags Test Workspace" — use `{ name: "Tags", exact: true }` or a more specific locator
- NEVER assume dialogs auto-close — explicitly press `Escape` or click a close/done button

**Timing patterns:**

- `waitForTimeout(300)` — after hover (dropdown triggers need time to appear)
- `waitForTimeout(500)` — after dialog open/close animations
- `waitForTimeout(1000)` — after page navigation or login (async state settling)
- `waitForTimeout(2000)` — after mutations that update the list (API round-trip)
- `waitForTimeout(3000)` — after file upload completion
- Always use `{ timeout: 5000 }` on `toBeVisible()` assertions for dynamic content
- Always use `{ timeout: 15000 }` on `waitForURL()` for page navigation

**File upload pattern:**

```typescript
await page
  .getByRole("button", { name: /^upload$/i })
  .first()
  .click();
await page.waitForTimeout(500);
const fileInput = page.locator(
  '[data-slot="dialog-content"] input[type="file"]',
);
await fileInput.setInputFiles({
  name: "test-file.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("File content"),
});
await page.waitForTimeout(500);
await page.getByRole("button", { name: /upload 1 file/i }).click();
await page.waitForTimeout(3000);
await page.keyboard.press("Escape");
await page.waitForTimeout(1000);
```

**Context menu pattern:**

```typescript
await openFileContextMenu(page, "filename.txt");
await page.getByRole("menuitem", { name: /action name/i }).click();
```

**Screenshots:**

- Take screenshots at every major step for debugging
- Use a consistent prefix: `e2e/screenshots/<feature>-NN-description.png`
- Example: `await page.screenshot({ path: "e2e/screenshots/share-03-link-created.png" })`

**Dialog interactions:**

- Scope queries to dialog: `const dialog = page.locator('[data-slot="dialog-content"]');`
- Find inputs in dialog: `dialog.locator("input").first()` or `dialog.getByPlaceholder("...")`
- Close with: `page.keyboard.press("Escape")` or click a close button

### What to Test

For every feature, cover these scenarios:

1. **Happy path** — The main user flow works end-to-end
2. **CRUD operations** — Create, read, update, delete (if applicable)
3. **UI state** — Elements appear/disappear correctly, loading states, empty states
4. **Filtering/search** — If the feature adds filtering, test that it narrows results correctly
5. **Edge cases** — Empty inputs, duplicate names, cascading deletes
6. **Cross-feature interaction** — E.g., if tagging a file, verify the tag appears in the file list

## Step 3: Run the Tests

```bash
npx playwright test e2e/<feature-name>.spec.ts
```

- If a test fails, **read the error message and screenshot** carefully
- Common fixes:
  - Locator not found → Check the screenshot, adjust the selector
  - Timeout → Add more wait time or fix the navigation URL pattern
  - Strict mode violation (multiple elements) → Make selector more specific with `.first()`, exact match, or role-based query
  - React infinite loop → Check for `useEffect` depending on default array values (`= []`)
- **Iterate** until all tests pass — fix the test code, not the feature code (unless you find a real bug)

## Step 4: Report

When all tests pass, show the user:

- The final `npx playwright test` output
- A summary of what was tested (list of test names)
- The test file path
