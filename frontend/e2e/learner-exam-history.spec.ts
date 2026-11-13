import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { queryDisposableDb } from './support/disposable-db';
import {
  PASSWORD,
  backendLogin,
  call,
  registerReadyLearner,
  seedExamIntroFixtures,
  type ExamIntroFixture,
} from './support/learner-fixtures';

// M4.5 B3: the exam history on the real backend. The fixture has no media, so
// this spec stays clear of the media ingest ceiling of the shared database.

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const TITLE = 'Lịch sử thi · Hán Lộ';
const HISTORY = '/learn/exam/history';
const SHOTS_DIR = process.env.HSK_SHOTS_DIR;

async function shot(
  page: Page,
  testInfo: TestInfo,
  state: string,
): Promise<void> {
  if (!SHOTS_DIR) return;
  await mkdir(SHOTS_DIR, { recursive: true });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: path.join(SHOTS_DIR, `${testInfo.project.name}-${state}.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
}

async function audit(page: Page, state: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .analyze();
  expect
    .soft(
      violations.map(
        (violation) =>
          `${violation.id}: ${violation.nodes
            .map((node) => node.target.join(' '))
            .join(' | ')}`,
      ),
      `axe ${state}`,
    )
    .toEqual([]);
  expect.soft(await page.locator('h1:visible').count(), `h1 ${state}`).toBe(1);
  expect.soft(await page.title(), `title ${state}`).toBe(TITLE);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `horizontal overflow ${state}`).toBeLessThanOrEqual(0);
}

function isWeb(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

/** Row text of the visible layout: the table on web, the cards on mobile. */
function rows(page: Page) {
  return isWeb(page)
    ? page.locator('.ehs-table tbody tr:visible')
    : page.locator('.ehs-card:visible');
}

async function start(
  api: APIRequestContext,
  token: string,
  testId: number,
): Promise<number> {
  const started = await call<{ id: number }>(
    api,
    'POST',
    `/exam/tests/${String(testId)}/attempts`,
    token,
    { idempotencyKey: randomUUID() },
  );
  return started.id;
}

async function save(
  api: APIRequestContext,
  token: string,
  attemptId: number,
  questionKey: string,
  choice: string,
): Promise<void> {
  await call(
    api,
    'PUT',
    `/exam/attempts/${String(attemptId)}/answers/${questionKey}`,
    token,
    {
      answer: { choice },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: randomUUID(),
    },
  );
}

async function submit(
  api: APIRequestContext,
  token: string,
  attemptId: number,
): Promise<void> {
  await call(api, 'POST', `/exam/attempts/${String(attemptId)}/submit`, token, {
    idempotencyKey: randomUUID(),
  });
}

test.describe('Learner exam history (M4.5 B3)', () => {
  let fixtures: ExamIntroFixture;

  test.beforeAll(async ({}, testInfo) => {
    fixtures = await seedExamIntroFixtures(
      `history-${testInfo.project.name}-${String(Date.now())}`,
    );
  });

  test('1. a new learner sees the empty state', async ({
    page,
    baseURL,
  }, testInfo) => {
    await registerReadyLearner(page, baseURL, 3);
    await page.goto(HISTORY);

    const empty = page.getByTestId('exam-history-empty');
    await expect(empty).toContainText('Chưa có lần thi nào');
    await expect(
      empty.getByRole('link', { name: 'Chọn đề thi' }),
    ).toHaveAttribute('href', '/learn/exam');
    await audit(page, 'empty');
    await shot(page, testInfo, 'history-empty');
  });

  test('2. attempts list, filter, expired row and result link', async ({
    page,
    baseURL,
  }, testInfo) => {
    const email = await registerReadyLearner(page, baseURL, 3);
    const api = await playwrightRequest.newContext();
    let passedId: number;
    let expiredId: number;
    try {
      const token = await backendLogin(api, email, PASSWORD);
      const testId = fixtures.publishedTestId;

      passedId = await start(api, token, testId);
      // q1 right (half of reading) + q3 right (all of writing): 150/200, pass 120.
      await save(api, token, passedId, 'q1', 'b');
      await save(api, token, passedId, 'q3', 'a');
      await submit(api, token, passedId);

      const failedId = await start(api, token, testId);
      await submit(api, token, failedId);

      expiredId = await start(api, token, testId);
      queryDisposableDb(
        `UPDATE "ExamAttempt" SET "startedAt" = (now() at time zone 'utc' - interval '2 hours'), "expiresAt" = (now() at time zone 'utc' - interval '1 hour') WHERE id = ${String(expiredId)}`,
      );
    } finally {
      await api.dispose();
    }

    await page.goto(HISTORY);
    await expect(rows(page)).toHaveCount(3);
    if (isWeb(page)) {
      const metrics = await page.evaluate(() => {
        const title = document.getElementById('exam-history-title');
        const top = document.querySelector('.w-top');
        const cs = title ? window.getComputedStyle(title) : null;
        return {
          titleFontSize: cs?.fontSize ?? null,
          titleFontWeight: cs?.fontWeight ?? null,
          topHeight: top
            ? Math.round(top.getBoundingClientRect().height)
            : null,
        };
      });
      expect(metrics.titleFontSize).toBe('18px');
      expect(metrics.titleFontWeight).toBe('700');
      expect(metrics.topHeight).toBe(64);
    }
    await expect(rows(page).nth(0)).toContainText('Đang chấm');
    await expect(rows(page).nth(1)).toContainText('Chưa đạt');
    await expect(rows(page).nth(2)).toContainText('Đạt');
    await expect(rows(page).nth(2)).toContainText(/150/u);
    await expect(rows(page).nth(2)).toContainText(/\/200|Tổng 150\/200/u);
    await expect(page.getByTestId('exam-history-note')).toContainText(
      `Điểm đạt HSK 3 là từ ${String(fixtures.passScore)}/${String(fixtures.maxScore)}.`,
    );
    await audit(page, 'list');
    await shot(page, testInfo, 'history-list');

    // Reading the list must not touch the expired attempt.
    expect(
      queryDisposableDb(
        `SELECT status FROM "ExamAttempt" WHERE id = ${String(expiredId)}`,
      ),
    ).toBe('in_progress');

    const chips = page.getByRole('group', {
      name: 'Lọc lịch sử thi theo cấp HSK',
    });
    await chips.getByRole('link', { name: 'HSK 3' }).click();
    await expect(page).toHaveURL(/levelCode=HSK3/u);
    await expect(rows(page)).toHaveCount(3);

    await chips.getByRole('link', { name: 'HSK 1' }).click();
    await expect(page).toHaveURL(/levelCode=HSK1/u);
    const empty = page.getByTestId('exam-history-empty');
    await expect(empty).toBeVisible();
    await audit(page, 'filtered-empty');
    await shot(page, testInfo, 'history-filtered-empty');
    await empty.getByRole('link', { name: 'Xem tất cả' }).click();
    await expect(page).toHaveURL(new RegExp(`${HISTORY}$`, 'u'));
    await expect(rows(page)).toHaveCount(3);

    const link = isWeb(page)
      ? rows(page).nth(2).getByRole('link', { name: fixtures.title })
      : rows(page).nth(2);
    await link.click();
    await page.waitForURL(
      new RegExp(`/learn/exam/attempts/${String(passedId)}/result$`, 'u'),
    );
    const header = isWeb(page) ? '.exr-history' : '.exr-mhistory';
    await expect(page.locator(header)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lịch sử thi' })).toHaveCount(
      1,
    );
    await expect(page.locator('.exr-history-action')).toHaveCount(0);
    await shot(page, testInfo, 'result-after-link');

    await page.goto('/learn/exam');
    if (isWeb(page)) {
      await expect(page.getByRole('link', { name: 'Lịch sử thi' })).toHaveCount(
        1,
      );
      await expect(
        page.getByRole('link', { name: 'Lịch sử thi' }),
      ).toBeVisible();
    } else {
      await expect(page.getByRole('link', { name: 'Lịch sử thi' })).toHaveCount(
        0,
      );
    }
    await shot(page, testInfo, 'exam-list-after-link');

    // Keyboard & 200% zoom (720x450) real measurements on pagination-populated history.
    if (testInfo.project.name === 'desktop-1440') {
      const api2 = await playwrightRequest.newContext();
      try {
        const token = await backendLogin(api2, email, PASSWORD);
        for (let i = 0; i < 18; i += 1) {
          const id = await start(api2, token, fixtures.publishedTestId);
          await submit(api2, token, id);
        }
      } finally {
        await api2.dispose();
      }

      await page.goto(HISTORY);
      await expect(rows(page)).toHaveCount(20);
      await expect(page.getByRole('link', { name: 'Trang sau' })).toBeVisible();

      const tabStops: Array<{
        text: string;
        boxShadow: string;
      }> = [];
      for (let step = 0; step < 50; step += 1) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return null;
          const cs = window.getComputedStyle(el);
          return {
            text: (el.innerText || el.getAttribute('aria-label') || '').trim(),
            boxShadow: cs.boxShadow,
            inMain: Boolean(el.closest('main.ehs')),
          };
        });
        if (info?.inMain) {
          tabStops.push({
            text: info.text,
            boxShadow: info.boxShadow,
          });
          if (info.text.includes('Trang sau')) break;
        }
      }
      expect(
        tabStops.some((s) => s.text === 'Tất cả' && s.boxShadow !== 'none'),
      ).toBe(true);
      expect(
        tabStops.some(
          (s) => s.text === fixtures.title && s.boxShadow !== 'none',
        ),
      ).toBe(true);
      expect(
        tabStops.some(
          (s) => s.text.includes('Trang sau') && s.boxShadow !== 'none',
        ),
      ).toBe(true);

      await page.setViewportSize({ width: 720, height: 450 });
      await page.goto(HISTORY);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await shot(page, testInfo, 'history-zoom-200');
    }
  });
});
