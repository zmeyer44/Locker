import { test, expect, type Page } from '@playwright/test';

const TEST_USER = {
  name: 'Desktop Drop User',
  email: `desktop-drop-${Date.now()}@example.com`,
  password: 'TestPassword123!',
};

test.describe.serial('Desktop file drop upload', () => {
  test('setup: create account and workspace', async ({ page }) => {
    await page.goto('/register');
    await page.getByPlaceholder('Your name').fill(TEST_USER.name);
    await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
    await page.getByPlaceholder('Choose a password').fill(TEST_USER.password);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/register'), {
      timeout: 15000,
    });
    await page.getByPlaceholder('e.g. Acme Inc').fill('Drop Test Workspace');
    await page.getByRole('button', { name: /create workspace/i }).click();
    await page.waitForURL(/\/w\//, { timeout: 15000 });
    await page.waitForTimeout(1000);
  });

  test('dropping files from desktop opens upload dialog with files', async ({
    page,
  }) => {
    await loginAs(page);
    await page.waitForTimeout(1000);

    // Simulate a desktop file drop using the DataTransfer API
    // We create a synthetic drag event with Files in the dataTransfer
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(
        new File(['Desktop file content'], 'dropped-from-desktop.txt', {
          type: 'text/plain',
        }),
      );
      return dt;
    });

    // Dispatch dragenter to show overlay
    await page.dispatchEvent('body', 'dragenter', { dataTransfer });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: 'e2e/screenshots/desktop-drop-01-overlay.png',
    });

    // The overlay should be visible
    await expect(page.getByText('Drop files to upload')).toBeVisible();

    // Dispatch drop to trigger upload dialog
    await page.dispatchEvent('body', 'drop', { dataTransfer });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: 'e2e/screenshots/desktop-drop-02-dialog.png',
    });

    // Upload dialog should be open with the file pre-populated
    await expect(page.getByRole('heading', { name: 'Upload files' })).toBeVisible();
    await expect(page.getByText('dropped-from-desktop.txt')).toBeVisible();
    await expect(page.getByRole('button', { name: /upload 1 file/i })).toBeVisible();
  });

  test('dragging away from window hides overlay', async ({ page }) => {
    await loginAs(page);
    await page.waitForTimeout(1000);

    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(
        new File(['test'], 'test.txt', { type: 'text/plain' }),
      );
      return dt;
    });

    // Show overlay
    await page.dispatchEvent('body', 'dragenter', { dataTransfer });
    await page.waitForTimeout(300);
    await expect(page.getByText('Drop files to upload')).toBeVisible();

    // Hide overlay by dragging away
    await page.dispatchEvent('body', 'dragleave', { dataTransfer });
    await page.waitForTimeout(300);

    // Overlay should be gone
    await expect(page.getByText('Drop files to upload')).not.toBeVisible();
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
