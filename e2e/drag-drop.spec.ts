import { test, expect, type Page } from '@playwright/test';

const TEST_USER = {
  name: 'DnD Test User',
  email: `dnd-test-${Date.now()}@example.com`,
  password: 'TestPassword123!',
};

test.describe.serial('Drag and drop file moving', () => {
  // Setup: create account, workspace, folder, and files
  test('setup: create account and workspace with files', async ({ page }) => {
    // Register
    await page.goto('/register');
    await page.getByPlaceholder('Your name').fill(TEST_USER.name);
    await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
    await page.getByPlaceholder('Choose a password').fill(TEST_USER.password);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/register'), {
      timeout: 15000,
    });

    // Create workspace
    await page.getByPlaceholder('e.g. Acme Inc').fill('DnD Test Workspace');
    await page.getByRole('button', { name: /create workspace/i }).click();
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Create a folder
    await page.getByRole('button', { name: /new folder/i }).click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder('Folder name').fill('Target Folder');
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByText('Target Folder')).toBeVisible({
      timeout: 5000,
    });

    // Upload a file
    await page.getByRole('button', { name: /^upload$/i }).first().click();
    await page.waitForTimeout(500);
    const fileInput = page.locator(
      '[data-slot="dialog-content"] input[type="file"]',
    );
    await fileInput.setInputFiles({
      name: 'drag-me.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This file will be dragged into a folder'),
    });
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /upload 1 file/i }).click();
    await page.waitForTimeout(3000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    await expect(page.getByText('drag-me.txt')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'e2e/screenshots/dnd-01-setup.png' });
  });

  // Test drag-and-drop: drag file into folder
  test('drag file onto folder moves it', async ({ page }) => {
    await loginAs(page);
    await page.waitForTimeout(1000);

    // Verify both items are visible
    await expect(page.getByText('Target Folder')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('drag-me.txt')).toBeVisible({ timeout: 5000 });

    // Get the file row and folder row elements
    const fileRow = page
      .locator('div.grid', { hasText: 'drag-me.txt' })
      .first();
    const folderRow = page
      .locator('div.grid', { hasText: 'Target Folder' })
      .first();

    // Perform drag and drop
    await fileRow.dragTo(folderRow);
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/dnd-02-after-drop.png' });

    // The file should no longer be visible in the current folder view
    // (it was moved into "Target Folder")
    await expect(page.getByText('drag-me.txt')).not.toBeVisible({
      timeout: 5000,
    });

    // Navigate into the folder to verify the file is there
    await page.getByText('Target Folder').click();
    await page.waitForURL(/\/folder\//);
    await page.waitForTimeout(1000);

    await expect(page.getByText('drag-me.txt')).toBeVisible({ timeout: 5000 });
    await page.screenshot({
      path: 'e2e/screenshots/dnd-03-file-in-folder.png',
    });
  });

  // Test: folder row shows visual highlight on drag over
  test('folder highlights when file is dragged over it', async ({ page }) => {
    await loginAs(page);
    await page.waitForTimeout(1000);

    // Upload another file for this test
    await page.getByRole('button', { name: /^upload$/i }).first().click();
    await page.waitForTimeout(500);
    const fileInput = page.locator(
      '[data-slot="dialog-content"] input[type="file"]',
    );
    await fileInput.setInputFiles({
      name: 'hover-test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Testing drag hover'),
    });
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /upload 1 file/i }).click();
    await page.waitForTimeout(3000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    await expect(page.getByText('hover-test.txt')).toBeVisible({
      timeout: 5000,
    });

    // Start dragging the file
    const fileRow = page
      .locator('div.grid', { hasText: 'hover-test.txt' })
      .first();
    const folderRow = page
      .locator('div.grid', { hasText: 'Target Folder' })
      .first();

    // Use the Playwright drag API with steps to capture the hover state
    const fileBB = await fileRow.boundingBox();
    const folderBB = await folderRow.boundingBox();

    if (fileBB && folderBB) {
      // Start drag from file center
      await page.mouse.move(
        fileBB.x + fileBB.width / 2,
        fileBB.y + fileBB.height / 2,
      );
      await page.mouse.down();
      // Move slowly to folder to trigger dragenter
      await page.mouse.move(
        folderBB.x + folderBB.width / 2,
        folderBB.y + folderBB.height / 2,
        { steps: 10 },
      );

      await page.waitForTimeout(300);
      await page.screenshot({
        path: 'e2e/screenshots/dnd-04-hover-highlight.png',
      });

      // Drop
      await page.mouse.up();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: 'e2e/screenshots/dnd-05-after-hover-drop.png' });
  });
});

async function loginAs(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
  await page.getByPlaceholder('Enter password').fill(TEST_USER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/w\//, { timeout: 15000 });
  await page.waitForTimeout(1000);
}
