import { test, expect, type Page } from '@playwright/test';

const TEST_USER = {
  name: 'Workspace Test User',
  email: `ws-test-${Date.now()}@example.com`,
  password: 'TestPassword123!',
};

const WORKSPACE_NAME = 'Test Workspace';

test.describe.serial('Workspace flows', () => {
  // ── Registration redirects to onboarding ──────────────────────────────
  test('new user is redirected to onboarding after registration', async ({
    page,
  }) => {
    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        console.log(`HTTP ${response.status()}: ${response.url()}`);
      }
    });

    await page.goto('/register');
    await page.getByPlaceholder('Your name').fill(TEST_USER.name);
    await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
    await page.getByPlaceholder('Choose a password').fill(TEST_USER.password);
    await page.getByRole('button', { name: /create account/i }).click();

    // Wait for navigation away from register page
    await page.waitForURL((url) => !url.pathname.includes('/register'), { timeout: 15000 });
    await page.screenshot({ path: 'e2e/screenshots/ws-01-onboarding.png' });

    await expect(page.getByText('Create your workspace')).toBeVisible();
  });

  // ── Create workspace ──────────────────────────────────────────────────
  test('create workspace from onboarding', async ({ page }) => {
    await loginAs(page);
    // Should redirect to onboarding since no workspace exists yet
    await page.waitForURL('/onboarding', { timeout: 15000 });

    await page.getByPlaceholder('e.g. Acme Inc').fill(WORKSPACE_NAME);
    await page.getByRole('button', { name: /create workspace/i }).click();

    // Should redirect to the new workspace
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/ws-02-workspace-created.png' });

    // Verify workspace sidebar shows correctly
    await expect(page.getByText('My Files')).toBeVisible();
    await expect(page.getByText('Settings')).toBeVisible();
  });

  // ── Dashboard with workspace sidebar ──────────────────────────────────
  test('workspace dashboard shows sidebar with nav', async ({ page }) => {
    await loginAs(page);
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    await expect(page.getByText('My Files')).toBeVisible();
    await expect(page.getByText('Share Links')).toBeVisible();
    await expect(page.getByText('Upload Links')).toBeVisible();
    await expect(page.getByText('Settings')).toBeVisible();
    await expect(page.getByText('Members')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/ws-03-dashboard-sidebar.png' });
  });

  // ── Create folder in workspace ────────────────────────────────────────
  test('create folder in workspace', async ({ page }) => {
    await loginAs(page);
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: /new folder/i }).click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder('Folder name').fill('Workspace Docs');
    await page.getByRole('button', { name: /^create$/i }).click();

    await expect(page.getByText('Workspace Docs')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'e2e/screenshots/ws-04-folder-created.png' });
  });

  // ── Upload file in workspace ──────────────────────────────────────────
  test('upload file in workspace', async ({ page }) => {
    await loginAs(page);
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: /^upload$/i }).first().click();
    await page.waitForTimeout(500);

    const fileInput = page.locator('[data-slot="dialog-content"] input[type="file"]');
    await fileInput.setInputFiles({
      name: 'workspace-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Workspace test file content'),
    });

    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /upload 1 file/i }).click();
    await page.waitForTimeout(3000);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    await expect(page.getByText('workspace-file.txt')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'e2e/screenshots/ws-05-file-uploaded.png' });
  });

  // ── Navigate to settings ──────────────────────────────────────────────
  test('workspace settings page', async ({ page }) => {
    await loginAs(page);
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.locator('[data-sidebar="menu-button"]', { hasText: 'Settings' }).click();
    await page.waitForURL(/\/settings$/);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/ws-06-settings.png' });

    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Danger zone' })).toBeVisible();
  });

  // ── Navigate to members ───────────────────────────────────────────────
  test('members page shows current user as owner', async ({ page }) => {
    await loginAs(page);
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.locator('[data-sidebar="menu-button"]', { hasText: 'Members' }).click();
    await page.waitForURL(/\/settings\/members/);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/ws-07-members.png' });

    // Should show the user as owner in the main content area
    const main = page.getByRole('main');
    await expect(main.getByText(TEST_USER.email, { exact: false })).toBeVisible();
    await expect(main.getByText('owner')).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Invite members' })).toBeVisible();
  });

  // ── Invite member (form submission) ───────────────────────────────────
  test('invite member form works', async ({ page }) => {
    await loginAs(page);
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(500);

    await page.locator('[data-sidebar="menu-button"]', { hasText: 'Members' }).click();
    await page.waitForURL(/\/settings\/members/);
    await page.waitForTimeout(1000);

    await page.getByPlaceholder('colleague@company.com').fill('invited@example.com');
    await page.getByRole('button', { name: /invite/i }).click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/ws-08-invite-sent.png' });

    // Should show pending invitation
    await expect(page.getByText('invited@example.com')).toBeVisible({ timeout: 5000 });
  });

  // ── Workspace switcher ────────────────────────────────────────────────
  test('workspace switcher dropdown opens', async ({ page }) => {
    await loginAs(page);
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Click the workspace switcher (the "Test Workspace" button in sidebar header)
    await page.getByRole('button', { name: /Test Workspace/i }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/ws-09-workspace-switcher.png' });

    // Should show "Create workspace" option in the dropdown
    await expect(page.getByText('Create workspace')).toBeVisible();
  });

  // ── Mobile sidebar with workspace ─────────────────────────────────────
  test('mobile workspace view works', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page);
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/ws-10-mobile.png' });

    const trigger = page.locator('[data-sidebar="trigger"]');
    if (await trigger.isVisible()) {
      await trigger.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'e2e/screenshots/ws-11-mobile-sidebar.png' });
    }
  });
});

async function loginAs(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
  await page.getByPlaceholder('Enter password').fill(TEST_USER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // After login, user should be redirected somewhere (workspace or onboarding)
  await page.waitForTimeout(2000);
}
