import { expect, test } from '@playwright/test';

test('protected routes redirect unauthenticated users to login', async ({ page }) => {
  await page.goto('/collections');
  await expect(page).toHaveURL(/\/login/);
});

test('auth screens render bilingual private-beta flows', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /Sign in to Nexora/i })).toBeVisible();
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByRole('heading', { name: /登录 Nexora/i })).toBeVisible();

  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: /Reset password/i })).toBeVisible();

  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: /Set new password/i })).toBeVisible();
});

test('setup page blocks unauthenticated first-admin setup', async ({ page }) => {
  await page.goto('/setup');
  await expect(page.getByText(/Please sign in before setup/i)).toBeVisible();
});
