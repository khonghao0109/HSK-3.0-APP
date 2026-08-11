import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';
const userEmail = process.env.E2E_USER_EMAIL ?? 'user.frontend@example.test';
const userPassword = process.env.E2E_USER_PASSWORD ?? 'FrontendTest-User-123';

async function login(page: Page, email = adminEmail, password = adminPassword) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(admin\/exercises|forbidden)/);
}

test('protects deep links, persists an HttpOnly session, and logs out', async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/admin/exercises');
  await expect(page).toHaveURL(/\/login/);
  await login(page);
  await expect(page).toHaveURL(/\/admin\/exercises/);
  const cookie = (await context.cookies()).find(
    (item) => item.name === 'hsk_admin_session',
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(consoleErrors).toEqual([]);
});

test('routes a current non-admin to forbidden without rendering admin data', async ({
  page,
}) => {
  await login(page, userEmail, userPassword);
  await expect(page).toHaveURL(/\/forbidden/);
  await expect(
    page.getByRole('heading', { name: /access restricted/i }),
  ).toBeVisible();
  await expect(page.getByText('Authoritative answer')).toHaveCount(0);
});

test('uses URL filters and server pagination, then opens a detail', async ({
  page,
}) => {
  await login(page);
  await page.goto('/admin/exercises?limit=1&page=1');
  await expect(page.getByText(/page 1 of 3/i)).toBeVisible();
  await page.getByRole('link', { name: /next/i }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText(/page 2 of 3/i)).toBeVisible();
  await page.getByLabel('Status').selectOption('published');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/status=published/);
  await page
    .getByRole('link', { name: /open exercise/i })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: /exercise \d+/i }),
  ).toBeVisible();
  await expect(page.getByText('Authoritative answer')).toBeVisible();
  await expect(page.getByText('Revision history')).toBeVisible();
});

test('supports keyboard flow, responsive layout, and automated accessibility', async ({
  page,
}) => {
  await page.goto('/login');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.getByLabel('Email').fill(adminEmail);
  await page.keyboard.press('Tab');
  await page.getByLabel('Password').fill(adminPassword);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/exercises/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
