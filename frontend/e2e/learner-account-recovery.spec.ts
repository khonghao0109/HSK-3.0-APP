import { createHash, randomBytes, randomInt } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';
import {
  PASSWORD,
  readCspViolations,
  watchCsp,
} from './support/learner-fixtures';

// M2.1c/M2.1d: forgot, reset and verify against the disposable e2e DB. The
// one-time tokens are inserted with psql the way the backend stores them
// (sha256 hex of the raw 43-character base64url token); no email is read.
const NEW_PASSWORD = 'MatKhauMoi#2026';

test.use({ viewport: { width: 390, height: 844 } });

function appOrigin(baseURL: string | undefined): string {
  return new URL(baseURL ?? 'http://127.0.0.1:3200').origin;
}

// Each test speaks for its own client IP: the backend's fixed per-IP limits
// (password-reset 5/15 min, confirm 10/min) would otherwise add up across the
// four Playwright projects. The BFF forwards X-Forwarded-For.
async function ownClientIp(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`,
  });
}

async function registerLearner(
  page: Page,
  baseURL: string | undefined,
  tag: string,
): Promise<string> {
  const email = `learner.recovery.${tag}.${Date.now()}.${randomInt(1e6)}@example.test`;
  const response = await page.request.post('/api/learner/session/register', {
    headers: { origin: appOrigin(baseURL) },
    data: { email, password: PASSWORD },
  });
  expect(response.status()).toBe(201);
  return email;
}

function insertToken(
  table: 'PasswordResetToken' | 'EmailVerificationToken',
  email: string,
  ttl: string,
): string {
  // The columns hold UTC without a zone (the backend session runs in UTC) and
  // psql's session zone may differ: a local createdAt breaks usedAt >= createdAt.
  const raw = randomBytes(32).toString('base64url');
  expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const hash = createHash('sha256').update(raw).digest('hex');
  const inserted = queryDisposableDb(
    `WITH t AS (INSERT INTO "${table}" ("userId", "tokenHash", "expiresAt", "createdAt")
      SELECT id, ${sqlLiteral(hash)}, now_utc + interval '${ttl}', now_utc FROM "User",
        (SELECT now() AT TIME ZONE 'UTC' AS now_utc) n WHERE email = ${sqlLiteral(email)}
      RETURNING id) SELECT count(*) FROM t`,
  );
  expect(inserted).toBe('1');
  return raw;
}

function emailVerified(email: string): boolean {
  return (
    queryDisposableDb(
      `SELECT "emailVerifiedAt" IS NOT NULL FROM "User" WHERE email = ${sqlLiteral(email)}`,
    ) === 't'
  );
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

test.describe('Learner account recovery (M2.1c, M2.1d)', () => {
  test('forgot password shows the sent view for the canonical email (Q71)', async ({
    page,
  }) => {
    await ownClientIp(page);
    const csp = await watchCsp(page);
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Quên mật khẩu?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page).toHaveTitle('Quên mật khẩu · Hán Lộ');

    await page.getByLabel('Email', { exact: true }).fill('  Ban@HanLo.VN ');
    await page.getByRole('button', { name: 'Gửi liên kết' }).click();

    const heading = page.getByRole('heading', {
      level: 1,
      name: 'Kiểm tra email của bạn',
    });
    await expect(heading).toBeFocused();
    await expect(page.locator('main.auth .auth__subtitle')).toHaveText(
      'Nếu ban@hanlo.vn có tài khoản Hán Lộ, chúng tôi đã gửi liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong 30 phút.',
    );
    await expect(
      page.getByRole('link', { name: 'Về đăng nhập' }),
    ).toHaveAttribute('href', '/sign-in');
    expect(csp).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('resets the password, signs in with the new one, and a reused link is no longer valid', async ({
    page,
    baseURL,
  }) => {
    await ownClientIp(page);
    const email = await registerLearner(page, baseURL, 'reset');
    const token = insertToken('PasswordResetToken', email, '30 minutes');

    await page.goto(`/reset-password#token=${token}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Đặt mật khẩu mới' }),
    ).toBeVisible();
    expect(page.url()).not.toContain(token);
    expect(new URL(page.url()).hash).toBe('');

    await page.getByLabel('Mật khẩu mới', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Đặt lại mật khẩu' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Đã đặt lại mật khẩu' }),
    ).toBeFocused();

    await page.getByRole('link', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await signIn(page, email, PASSWORD);
    await expect(page.locator('#auth-alert')).toHaveText(
      'Email hoặc mật khẩu không đúng.',
    );
    await signIn(page, email, NEW_PASSWORD);
    // A new learner without onboarding lands on its first step.
    await expect(page).toHaveURL(/\/onboarding\/goal$/);

    await page.goto(`/reset-password#token=${token}`);
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('KhacNua#2026');
    await page.getByRole('button', { name: 'Đặt lại mật khẩu' }).click();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Liên kết không còn hiệu lực',
      }),
    ).toBeFocused();
    await expect(
      page.getByRole('link', { name: 'Gửi liên kết mới' }),
    ).toHaveAttribute('href', '/forgot-password');
  });

  test('verifies the email only after the button is pressed (Q72)', async ({
    page,
    baseURL,
  }) => {
    await ownClientIp(page);
    const email = await registerLearner(page, baseURL, 'verify');
    const token = insertToken('EmailVerificationToken', email, '24 hours');
    expect(emailVerified(email)).toBe(false);

    const confirmCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/learner/email-verification/confirm'))
        confirmCalls.push(request.url());
    });
    await page.goto(`/verify-email#token=${token}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Xác thực email' }),
    ).toBeVisible();
    expect(page.url()).not.toContain(token);
    await page.waitForTimeout(1000);
    expect(confirmCalls).toEqual([]);
    expect(emailVerified(email)).toBe(false);

    await page.getByRole('button', { name: 'Xác thực email' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Email đã được xác thực' }),
    ).toBeFocused();
    expect(confirmCalls).toHaveLength(1);
    expect(emailVerified(email)).toBe(true);
  });

  test('an anonymous learner signs in from the invalid link and comes back to resend (Q73)', async ({
    page,
    baseURL,
  }) => {
    await ownClientIp(page);
    const email = await registerLearner(page, baseURL, 'resend');
    await page.context().clearCookies();

    await page.goto('/verify-email');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Liên kết không còn hiệu lực',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Gửi lại email xác thực' }),
    ).toHaveCount(0);
    await page.getByRole('link', { name: 'Đăng nhập để gửi lại' }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=verify-email$/);

    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/verify-email$/);
    await page.getByRole('button', { name: 'Gửi lại email xác thực' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Đã gửi lại email' }),
    ).toBeFocused();
  });
});
