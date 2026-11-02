import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import {
  expect,
  request as playwrightRequest,
  test,
  type Page,
  type TestInfo,
} from '@playwright/test';

import {
  PASSWORD,
  backendLogin,
  call,
  readCspViolations,
  registerReadyLearner,
  seedExamIntroFixtures,
  watchCsp,
  type ExamIntroFixture,
} from './support/learner-fixtures';

// M4.5 B1: learner exam list (WB-10a web + MB-10 mobile) on the real backend,
// disposable database seeded through the Admin CMS (same harness as the intro
// spec). The learner's goal is HSK 3, so the default chip is HSK 3 (Q209) and
// the seeded tests are visible without a manual filter.

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const TITLE = 'Thi thử HSK · Hán Lộ';
const SHOT_DIR = '/tmp/hsk-m45b1';

async function audit(page: Page, state: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getComputedTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .analyze();
  const found = violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'n/a'}): ${violation.nodes
        .map((node) => node.target.join(' '))
        .join(' | ')}`,
  );
  expect.soft(found, `axe ${state}`).toEqual([]);
  expect
    .soft(await page.locator('html').getAttribute('lang'), `lang ${state}`)
    .toBe('vi');
  expect.soft(await page.locator('h1:visible').count(), `h1 ${state}`).toBe(1);
  expect.soft(await page.locator('main').count(), `main ${state}`).toBe(1);
  expect.soft(await page.title(), `title ${state}`).toBe(TITLE);
}

function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(0);
}

async function shot(
  page: Page,
  testInfo: TestInfo,
  state: string,
): Promise<string> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const path = `${SHOT_DIR}/exam-list-${testInfo.project.name}-${state}.png`;
  await page.screenshot({
    path,
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
  return path;
}

function isWebFrame(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

test.describe('Learner exam list (M4.5 B1 / Q209–Q214)', () => {
  let fixtures: ExamIntroFixture;

  test.beforeAll(async ({}, testInfo) => {
    mkdirSync(SHOT_DIR, { recursive: true });
    fixtures = await seedExamIntroFixtures(
      `${testInfo.project.name}-${String(Date.now())}`,
    );
  });

  test('1. list renders with filters, sort links and a clean a11y audit', async ({
    page,
    baseURL,
  }, testInfo) => {
    await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await registerReadyLearner(page, baseURL, 3);
    await page.goto('/learn/exam');

    // Q209: the level chip defaults to the learner's current level.
    await expect(page).toHaveTitle(TITLE);
    await expect(
      page.getByRole('heading', { level: 1, name: /Thi thử/u }),
    ).toBeVisible();
    const levels = page.getByRole('group', { name: /Cấp độ|Chọn cấp độ HSK/u });
    await expect(levels.locator('[aria-current="true"]')).toHaveText('HSK 3');

    const list = page.getByRole('list', { name: 'Danh sách đề thi' });
    await expect(list.getByRole('link').first()).toBeVisible();
    // The published fixture is visible; the draft of the same seed is not.
    const card = list.getByRole('link', {
      name: new RegExp(fixtures.title, 'u'),
    });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute(
      'href',
      `/learn/exam/${String(fixtures.publishedTestId)}`,
    );
    await expect(card).toContainText('Chưa làm');
    await expect(card).toContainText(`${String(fixtures.questionCount)} câu`);
    await expect(card).toContainText(
      `${String(fixtures.durationMinutes)} phút`,
    );
    await expect(page.getByText(new RegExp(`Đề nháp`, 'u'))).toHaveCount(0);
    if (isWebFrame(page)) {
      await expect(page.getByTestId('exam-list-count')).toContainText(
        'đề phù hợp',
      );
    }

    // Q210: the skill chips are links that keep the level in the URL.
    const skills = page.getByRole('group', { name: /Kỹ năng|Chọn kỹ năng/u });
    await skills.getByRole('link', { name: 'Đọc' }).click();
    await expect(page).toHaveURL(/[?&]levelCode=HSK3&skill=reading/u);
    await expect(skills.getByRole('link', { name: 'Đọc' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(card).toBeVisible();

    // Q211: the native sort menu changes the URL, no client island needed.
    await page.locator('.exl-sort__summary').click();
    await page.getByRole('link', { name: 'Cũ nhất' }).click();
    await expect(page).toHaveURL(/[?&]sort=oldest/u);

    await expectNoHorizontalScroll(page);
    await audit(page, 'list');
    await shot(page, testInfo, 'list');
    expect(await readCspViolations(page)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('2. empty state offers a way back and stays accessible', async ({
    page,
    baseURL,
  }, testInfo) => {
    await registerReadyLearner(page, baseURL, 3);
    await page.goto('/learn/exam?levelCode=HSK3');
    const levels = page.getByRole('group', { name: /Cấp độ|Chọn cấp độ HSK/u });
    // HSK 2 has no published test in this DB: Q209's chip stays a link.
    await levels.getByRole('link', { name: 'HSK 2' }).click();
    await expect(page).toHaveURL(/[?&]levelCode=HSK2/u);
    const empty = page.getByTestId('exam-list-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Chưa có đề ở cấp này');
    if (isWebFrame(page)) {
      await expect(page.getByTestId('exam-list-count')).toContainText(
        '0 đề phù hợp',
      );
    }
    await expectNoHorizontalScroll(page);
    await audit(page, 'empty');
    await shot(page, testInfo, 'empty');

    // "Xem tất cả đề" resets to the learner's default level (HSK 3 here).
    await empty.getByRole('link', { name: 'Xem tất cả đề' }).click();
    await expect(page).toHaveURL(/\/learn\/exam$/u);
    await expect(page.getByTestId('exam-list-empty')).toHaveCount(0);
  });

  test('3. card links follow the attempt status (Q212/Q214)', async ({
    page,
    baseURL,
  }, testInfo) => {
    const email = await registerReadyLearner(page, baseURL, 3);
    const api = await playwrightRequest.newContext();
    try {
      const token = await backendLogin(api, email, PASSWORD);
      const attempt = await call<{ id: number }>(
        api,
        'POST',
        `/exam/tests/${String(fixtures.publishedTestId)}/attempts`,
        token,
        { idempotencyKey: randomUUID() },
      );

      await page.goto('/learn/exam?levelCode=HSK3');
      const list = page.getByRole('list', { name: 'Danh sách đề thi' });
      const active = list.getByRole('link', {
        name: new RegExp(`${fixtures.title}.*Đang làm`, 'u'),
      });
      await expect(active).toHaveAttribute(
        'href',
        `/learn/exam/attempts/${String(attempt.id)}`,
      );
      await expect(active).toContainText('Làm tiếp');

      // Submitting with no answers still creates the Result (score 0), so the
      // card switches to "Đã làm" with a score out of maxScore (Q211).
      await call(
        api,
        'POST',
        `/exam/attempts/${String(attempt.id)}/submit`,
        token,
        { idempotencyKey: randomUUID() },
      );
      await page.reload();
      const done = list.getByRole('link', {
        name: new RegExp(`${fixtures.title}.*Đã làm`, 'u'),
      });
      // U1: a finished attempt opens the result page, not the intro.
      await expect(done).toHaveAttribute(
        'href',
        `/learn/exam/attempts/${String(attempt.id)}/result`,
      );
      await expect(done).toContainText(`/${String(fixtures.maxScore)}`);
      await expectNoHorizontalScroll(page);
      await audit(page, 'states');
      await shot(page, testInfo, 'states');
      await done.click();
      await expect(page).toHaveURL(
        new RegExp(`/learn/exam/attempts/${String(attempt.id)}/result$`, 'u'),
      );
      await expect(
        page.getByRole('heading', { name: 'Kết quả bài thi' }),
      ).toBeVisible();
    } finally {
      await api.dispose();
    }
  });

  test('4. sidebar (web) and the home quick action lead to the list and on to the intro', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL, 3);
    await page.goto('/learn');

    if (isWebFrame(page)) {
      // Desktop: the sidebar entry is a real link now, with an active state.
      const nav = page.getByRole('navigation', { name: 'Luyện thêm' });
      const link = nav.getByRole('link', { name: 'Thi thử HSK' });
      await expect(link).toHaveAttribute('href', '/learn/exam');
      await link.click();
      await expect(page).toHaveURL(/\/learn\/exam$/u);
      await expect(
        nav.getByRole('link', { name: 'Thi thử HSK' }),
      ).toHaveAttribute('aria-current', 'page');
    } else {
      // Mobile/tablet: the "Khám phá" quick action is the entry (Q16/Q126).
      const explore = page.getByRole('list', { name: 'Khám phá' });
      await explore.getByRole('link', { name: 'Thi thử' }).click();
      await expect(page).toHaveURL(/\/learn\/exam$/u);
    }

    await page.getByRole('link', { name: 'HSK 3' }).click();
    await expect(page).toHaveURL(/[?&]levelCode=HSK3/u);
    const list = page.getByRole('list', { name: 'Danh sách đề thi' });
    const card = list.getByRole('link', {
      name: new RegExp(fixtures.title, 'u'),
    });
    await card.click();
    await expect(page).toHaveURL(
      new RegExp(`/learn/exam/${String(fixtures.publishedTestId)}$`, 'u'),
    );
    await expect(
      page.getByRole('heading', { level: 2, name: fixtures.title }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Bắt đầu thi' }).click();
    await expect(page).toHaveURL(/\/learn\/exam\/attempts\/\d+$/u);
  });
});
