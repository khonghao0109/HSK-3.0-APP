import { createHash } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  disposableDbUrl,
  queryDisposableDb,
  sqlLiteral,
} from './support/disposable-db';
import {
  backendLogin,
  call,
  PASSWORD,
  readyLessonId,
  registerReadyLearner,
} from './support/learner-fixtures';

/**
 * M1.7b2 B2a: the consent gate. Versions are this spec's own rows (prefix
 * `pw-g-`), removed after each test, so no other spec ever sees them.
 */
const RUN = `pw-g-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}-`;
const AGREE = /Tôi đã đọc và đồng ý/;

// `effectiveAt` is `timestamp without time zone` read as UTC; psql's session
// zone may be local, so `now()` alone would land hours off.
const EFFECTIVE_NOW = "(now() AT TIME ZONE 'UTC')";

type Version = { type: 'terms' | 'privacy'; version: string; sha256: string };

/** `offset` from now, e.g. `- interval '1 day'`. */
function insertVersions(tag: string, offset: string): Version[] {
  const versions = (['terms', 'privacy'] as const).map((type) => ({
    type,
    version: `${RUN}${tag}-${type[0]}`,
    sha256: createHash('sha256').update(`${RUN}${tag}${type}`).digest('hex'),
  }));
  queryDisposableDb(
    [
      'INSERT INTO "LegalDocumentVersion" ("type", "version", "sha256", "effectiveAt") VALUES',
      versions
        .map(
          (v) =>
            `(${sqlLiteral(v.type)}::"LegalDocumentType", ${sqlLiteral(v.version)}, ${sqlLiteral(v.sha256)}, ${EFFECTIVE_NOW} ${offset})`,
        )
        .join(', '),
      ';',
    ].join(' '),
  );
  return versions;
}

function removeVersions(): void {
  queryDisposableDb(
    `DELETE FROM "LegalDocumentVersion" WHERE "version" LIKE ${sqlLiteral(`${RUN}%`)};`,
  );
}

async function learnerCookie(page: Page) {
  return (await page.context().cookies()).find(
    (cookie) => cookie.name === 'hsk_learner_session',
  );
}

/** Every `/consent` document load, to prove there is no redirect loop. */
function countConsentLoads(page: Page): () => number {
  let loads = 0;
  page.on('request', (request) => {
    if (
      request.isNavigationRequest() &&
      new URL(request.url()).pathname === '/consent'
    )
      loads += 1;
  });
  return () => loads;
}

async function acceptOnConsentPage(page: Page): Promise<void> {
  const submit = page.getByRole('button', { name: 'Đồng ý và tiếp tục' });
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('checkbox', { name: AGREE }).check();
  await expect(submit).toHaveAttribute('aria-disabled', 'false');
  await submit.click();
}

test.describe('consent gate (M1.7b2 B2a)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(() => {
    disposableDbUrl();
  });
  test.afterEach(() => removeVersions());
  test.afterAll(() => removeVersions());

  test('blocked learner on /learn is sent to /consent, accepts and lands on /learn once', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    insertVersions('b', "- interval '1 day'");
    const consentLoads = countConsentLoads(page);

    await page.goto('/learn');
    await expect(page).toHaveURL(/\/consent\?returnTo=%2Flearn$/u);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Chúng tôi đã cập nhật điều khoản',
    );
    await expect(page.locator('.consent__doc')).toHaveCount(2);
    for (const name of [/Xuất dữ liệu/, /Xoá tài khoản/]) {
      await expect(page.getByRole('button', { name })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    await expect(page.getByRole('button', { name: 'Để sau' })).toHaveCount(0);

    // The button stays inert until the box is ticked.
    // A mouse click does nothing (`.btn[aria-disabled='true']` has
    // `pointer-events: none` in learner.css); a keyboard user gets the hint.
    const submit = page.getByRole('button', { name: 'Đồng ý và tiếp tục' });
    await expect(async () => {
      await submit.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('status')).toHaveText(
        'Tick ô xác nhận để đồng ý.',
        { timeout: 1_000 },
      );
    }).toPass();
    await expect(page).toHaveURL(/\/consent/u);

    await acceptOnConsentPage(page);
    await expect(page).toHaveURL(/\/learn$/u);
    await page.reload();
    await expect(page).toHaveURL(/\/learn$/u);
    expect(consentLoads()).toBe(1);
  });

  test('a version that takes effect mid-lesson keeps the session and returns to the same lesson', async ({
    page,
    baseURL,
  }) => {
    const lessonId = await readyLessonId('HSK1');
    if (!lessonId) throw new Error('seed has no ready HSK1 lesson');
    await registerReadyLearner(page, baseURL);
    const practice = `/learn/lessons/${lessonId}/practice`;
    await page.goto(practice);
    const mcq = page.getByRole('radiogroup', {
      name: 'Choose the meaning of 你好',
    });
    await expect(mcq).toBeVisible();
    const before = await learnerCookie(page);
    expect(before).toBeDefined();

    insertVersions('m', "- interval '1 minute'");
    const attempt = page.waitForResponse(
      (response) =>
        response.url().includes('/api/learner/') &&
        response.request().method() === 'POST' &&
        response.status() === 403,
    );
    await mcq.getByRole('radio', { name: 'Hello' }).click();
    const blocked = await attempt;
    expect(blocked.headers()['x-hsk-consent']).toBe('required');
    expect(blocked.headers()['set-cookie'] ?? '').not.toContain(
      'hsk_learner_session=',
    );

    await expect(page).toHaveURL(
      `/consent?returnTo=${encodeURIComponent(practice)}`,
    );
    expect((await learnerCookie(page))?.value).toBe(before?.value);

    await acceptOnConsentPage(page);
    await expect(page).toHaveURL(practice);
    await expect(mcq).toBeVisible();
  });

  test('pending learner sees the banner, hides it with "Để sau" and keeps learning', async ({
    page,
    baseURL,
  }) => {
    const lessonId = await readyLessonId('HSK1');
    if (!lessonId) throw new Error('seed has no ready HSK1 lesson');
    const email = await registerReadyLearner(page, baseURL);
    const inForce = insertVersions('p1', "- interval '1 day'");
    const token = await backendLogin(page.request, email, PASSWORD);
    await call(page.request, 'POST', '/users/me/consents/accept', token, {
      documents: inForce,
    });
    insertVersions('p2', "+ interval '3 days'");

    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn$/u);
    const banner = page.getByRole('region', { name: 'Điều khoản đã cập nhật' });
    await expect(banner).toBeVisible();
    await expect(
      banner.getByRole('link', { name: 'Xem và đồng ý' }),
    ).toHaveAttribute('href', '/consent?returnTo=%2Flearn');

    await banner.getByRole('button', { name: 'Để sau' }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(banner).toHaveCount(0);

    await page.goto(`/learn/lessons/${lessonId}/practice`);
    const mcq = page.getByRole('radiogroup', {
      name: 'Choose the meaning of 你好',
    });
    await mcq.getByRole('radio', { name: 'Hello' }).click();
    await expect(page.getByText('Chính xác', { exact: true })).toBeVisible();
  });

  test('a blocked learner can sign out from the consent screen', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    insertVersions('o', "- interval '1 day'");
    await page.goto('/learn/review');
    await expect(page).toHaveURL(/\/consent\?returnTo=%2Flearn%2Freview$/u);
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/\/$/u);
    expect(await learnerCookie(page)).toBeUndefined();
  });
});
