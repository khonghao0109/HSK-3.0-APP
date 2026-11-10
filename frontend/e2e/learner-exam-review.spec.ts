import AxeBuilder from '@axe-core/playwright';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import {
  disposableDbUrl,
  queryDisposableDb,
  sqlLiteral,
} from './support/disposable-db';
import {
  call,
  registerReadyLearner,
  seedExamReviewFixtures,
  watchCsp,
  type ExamReviewFixture,
} from './support/learner-fixtures';

/**
 * M4.5 B2b: the post-submit review page on the real backend + disposable DB.
 * The fixture has all four objective formats, one real audio question and a
 * group image; q1 is answered correctly, q2 wrongly and flagged, q3-q5 blank.
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SHOT_DIR = process.env.HSK_SHOTS_DIR;
const REVIEW_TITLE = 'Xem lại bài thi';

/**
 * The heavy audio/image fixture is seeded once per disposable DB and reused by
 * the remaining projects of a run, instead of letting every project re-seed it
 * (the admin CMS rejects a full re-seed with 429). The default cache file is
 * keyed by the DB URL and every read is validated against that same DB, so a
 * fresh DB — or a run that re-seeded — never reads a stale file.
 */
function reviewFixtureFile(): string {
  const override = process.env.HSK_REVIEW_FIXTURE_FILE;
  if (override) return override;
  const dbKey = createHash('sha256')
    .update(disposableDbUrl())
    .digest('hex')
    .slice(0, 16);
  return path.join('/tmp', `hsk-m45b2b-review-${dbKey}.json`);
}

/** True only while the cached fixture's published test still exists as-is. */
function cachedReviewFixtureMatchesDb(cached: ExamReviewFixture): boolean {
  if (!Number.isInteger(cached.publishedTestId)) return false;
  if (typeof cached.title !== 'string' || cached.title === '') return false;
  try {
    const row = queryDisposableDb(
      `SELECT id FROM "Test" WHERE id = ${String(cached.publishedTestId)} AND title = ${sqlLiteral(cached.title)} LIMIT 1`,
    );
    return row !== '';
  } catch {
    return false;
  }
}

test.describe('Learner exam review (M4.5 B2b)', () => {
  let fixtures: ExamReviewFixture;

  test.beforeAll(async () => {
    if (SHOT_DIR) await mkdir(SHOT_DIR, { recursive: true });
    const fixtureFile = reviewFixtureFile();
    try {
      const cached = JSON.parse(
        await readFile(fixtureFile, 'utf8'),
      ) as ExamReviewFixture;
      if (cachedReviewFixtureMatchesDb(cached)) {
        fixtures = cached;
        return;
      }
    } catch {
      // Missing, unreadable or stale cache: this project seeds the fixture.
    }
    fixtures = await seedExamReviewFixtures(`shared-${String(Date.now())}`);
    await writeFile(fixtureFile, JSON.stringify(fixtures), 'utf8');
  });

  async function shot(page: Page, testInfo: TestInfo, state: string) {
    if (!SHOT_DIR) return;
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: path.join(SHOT_DIR, `${testInfo.project.name}-review-${state}.png`),
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });
  }

  function isWebFrame(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) >= 1024;
  }

  async function audit(page: Page, state: string): Promise<void> {
    await page.waitForLoadState('networkidle');
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
    expect
      .soft(await page.locator('h1:visible').count(), `h1 ${state}`)
      .toBe(1);
  }

  async function expectNoHorizontalScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(0);
  }

  async function learnerToken(page: Page): Promise<string> {
    const cookies = await page.context().cookies();
    const cookie = cookies.find((item) => item.name === 'hsk_learner_session');
    if (cookie === undefined) throw new Error('missing learner session cookie');
    return cookie.value;
  }

  async function startAndSubmit(api: APIRequestContext, token: string) {
    const attempt = await call<{ id: number }>(
      api,
      'POST',
      `/exam/tests/${String(fixtures.publishedTestId)}/attempts`,
      token,
      { idempotencyKey: randomUUID() },
    );
    const answer = async (
      questionKey: string,
      body: Record<string, unknown>,
      isFlagged = false,
    ) =>
      call(
        api,
        'PUT',
        `/exam/attempts/${String(attempt.id)}/answers/${questionKey}`,
        token,
        {
          answer: body,
          isFlagged,
          expectedVersion: null,
          idempotencyKey: randomUUID(),
        },
      );
    await answer('q1', { choice: 'a' });
    await answer('q2', { value: false }, true);
    await call(
      api,
      'POST',
      `/exam/attempts/${String(attempt.id)}/submit`,
      token,
      { idempotencyKey: randomUUID() },
    );
    return attempt.id;
  }

  test('1. result → review shows the four formats, filters, status and media', async ({
    page,
    baseURL,
  }, testInfo) => {
    await watchCsp(page);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) =>
      consoleErrors.push(`pageerror: ${error.message}`),
    );

    await registerReadyLearner(page, baseURL, 3);
    const token = await learnerToken(page);
    const api = await playwrightRequest.newContext();
    let attemptId: number;
    try {
      attemptId = await startAndSubmit(api, token);
    } finally {
      await api.dispose();
    }

    // ---- Result page entry (Q219 / web "Xem lại bài") ----
    await page.goto(`/learn/exam/attempts/${String(attemptId)}/result`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Kết quả bài thi' }),
    ).toBeVisible();
    if (isWebFrame(page)) {
      const reviewLink = page.getByRole('link', { name: 'Xem lại bài' });
      await expect(reviewLink).toHaveAttribute(
        'href',
        `/learn/exam/attempts/${String(attemptId)}/review`,
      );
      await reviewLink.click();
    } else {
      const explain = page.locator('.exr-explain');
      await expect(explain.getByText('Giải thích chi tiết')).toBeVisible();
      await expect(explain.getByText(`Câu 2`)).toBeVisible();
      await expect(explain.getByText(fixtures.wrongPrompt)).toBeVisible();
      const all = explain.getByRole('link', { name: 'Xem tất cả' });
      await expect(all).toHaveAttribute(
        'href',
        `/learn/exam/attempts/${String(attemptId)}/review`,
      );
      await all.click();
    }
    await expect(page).toHaveURL(
      new RegExp(`/learn/exam/attempts/${String(attemptId)}/review`, 'u'),
    );
    await expect(
      page.getByRole('heading', { level: 1, name: REVIEW_TITLE }),
    ).toBeVisible();

    // ---- Summary + 4 formats + icon+text statuses + flag + grouping ----
    await expect(page.getByText('Đã trả lời')).toBeVisible();
    await expect(page.getByText('Chưa trả lời').first()).toBeVisible();
    await expect(page.getByText('Đánh dấu').first()).toBeVisible();
    await expect(page.locator('.exv-q')).toHaveCount(5);
    await expect(page.getByText('Đọc · Phần 1')).toBeVisible();
    if (isWebFrame(page)) {
      await expect(page.locator('.exv-q:visible')).toHaveCount(1);
      await expect(page.getByText('Nghe · Phần 2')).toBeHidden();
    } else {
      await expect(page.locator('.exv-q:visible')).toHaveCount(5);
      await expect(page.getByText('Nghe · Phần 2')).toBeVisible();
      await expect(page.locator('.exv-nav')).toBeHidden();
    }

    const panels = page.locator('.exv-q');
    await expect(panels.nth(0)).toContainText(fixtures.mcqPrompt);
    await expect(panels.nth(0)).toContainText(fixtures.mcqOptionText);
    await expect(panels.nth(0)).toContainText('Đáp án đúng');
    await expect(panels.nth(1)).toContainText(fixtures.wrongPrompt);
    await expect(panels.nth(2)).toContainText(fixtures.blankPrompt);
    await expect(panels.nth(3)).toContainText(fixtures.arrangePrompt);
    await expect(panels.nth(4)).toContainText(fixtures.listeningPrompt);
    await expect(panels.nth(3)).toContainText('我想买');
    await expect(panels.nth(0)).toContainText('Chọn A vì đáp án A đúng.');

    // R14: the status is icon + text, and the flag marker says "Đánh dấu".
    await expect(panels.nth(0).locator('.exv-status')).toHaveText(/Đúng/u);
    await expect(panels.nth(1).locator('.exv-status')).toHaveText(/Sai/u);
    await expect(panels.nth(1).locator('.exv-flag')).toContainText('Đánh dấu');
    await expect(panels.nth(2).locator('.exv-status')).toHaveText(
      /Chưa trả lời/u,
    );

    // CSS state is never colour-only: the text is asserted above; the colour
    // assertion pins the token used by the mockup.
    await expect(panels.nth(0).locator('.exv-status')).toHaveCSS(
      'color',
      'rgb(6, 122, 96)',
    );
    await expect(panels.nth(1).locator('.exv-status')).toHaveCSS(
      'color',
      'rgb(179, 38, 30)',
    );
    await expect(panels.nth(1)).toHaveCSS(
      'border-left-color',
      'rgb(179, 38, 30)',
    );

    // Q222: no mistake-book link.
    await expect(page.getByText('Sổ lỗi')).toHaveCount(0);

    // ---- Media: the existing BFF grants terminal attempts (Q158) ----
    if (isWebFrame(page)) {
      await page.getByRole('link', { name: 'Xem kết quả' }).isVisible();
    }
    const grantsResponse = await page.evaluate(async (id) => {
      const response = await fetch(
        `/api/learner/exam/attempts/${String(id)}/media-grants`,
      );
      return {
        status: response.status,
        body: (await response.json()) as {
          data: { grants: Array<{ mediaId: number; src: string }> };
        },
      };
    }, attemptId);
    expect(grantsResponse.status).toBe(200);
    expect(grantsResponse.body.data.grants.length).toBeGreaterThanOrEqual(2);

    const audio = page.locator('audio').first();
    await expect(audio).toHaveAttribute(
      'src',
      /\/api\/learner\/media\/\d+\/content/u,
    );
    const image = page.locator('.exv-media__image').first();
    await expect(image).toHaveAttribute(
      'src',
      /\/api\/learner\/media\/\d+\/content/u,
    );
    await expect
      .poll(async () =>
        image.evaluate(
          (element) => (element as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    // Actually start playback (muted keeps headless Chromium policy happy).
    const played = await audio.evaluate(async (element) => {
      const media = element as HTMLAudioElement;
      media.muted = true;
      try {
        await media.play();
        return true;
      } catch {
        return false;
      }
    });
    expect(typeof played).toBe('boolean');

    // ---- Grid cells show visible ✓ / ✕ alongside colour while keeping aria-label (Q240) ----
    const gridCells = page.locator('.exv-cell');
    await expect(gridCells).toHaveCount(5);
    await expect(gridCells.nth(0)).toHaveAttribute('aria-label', 'Câu 1, Đúng');
    await expect(gridCells.nth(0)).toContainText('✓');
    await expect(gridCells.nth(1)).toHaveAttribute(
      'aria-label',
      'Câu 2, Sai, đánh dấu',
    );
    await expect(gridCells.nth(1)).toContainText('✕');
    await expect(gridCells.nth(0)).toHaveAttribute('aria-current', 'true');
    const activeCellColors = await gridCells.nth(0).evaluate((cell) => {
      const app = cell.closest('.learner-app') ?? document.body;
      const probe = document.createElement('span');
      probe.style.background = 'var(--navy-900)';
      app.appendChild(probe);
      const navyBg = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      const cellBg = window.getComputedStyle(cell).backgroundColor;
      return { cellBg, navyBg };
    });
    if (isWebFrame(page)) {
      expect(activeCellColors.cellBg).toBe(activeCellColors.navyBg);
    } else {
      expect(activeCellColors.cellBg).not.toBe(activeCellColors.navyBg);
    }

    // ---- Q239: single-question step navigation on web (>=1024) vs full list scroll (<1024) ----
    if (isWebFrame(page)) {
      await expect(page.getByRole('link', { name: 'Câu trước' })).toHaveCount(
        0,
      );
      await expect(
        page.locator('.exv-nav__btn[aria-disabled="true"]', {
          hasText: 'Câu trước',
        }),
      ).toBeVisible();
      const nextLink = page.getByRole('link', { name: 'Câu sau' });
      await expect(nextLink).toBeVisible();
      await expect(nextLink).toHaveAttribute(
        'href',
        `/learn/exam/attempts/${String(attemptId)}/review?q=2`,
      );

      await nextLink.click();
      await expect(page).toHaveURL(
        new RegExp(
          `/learn/exam/attempts/${String(attemptId)}/review\\?q=2$`,
          'u',
        ),
      );
      await expect(page.locator('.exv-q:visible')).toHaveCount(1);
      await expect(panels.nth(1)).toBeVisible();
      await expect(panels.nth(0)).toBeHidden();
      await expect(gridCells.nth(1)).toHaveAttribute('aria-current', 'true');
      await expect(page.getByRole('link', { name: 'Câu trước' })).toBeVisible();

      // Keyboard navigation through next link
      await page.getByRole('link', { name: 'Câu sau' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        new RegExp(
          `/learn/exam/attempts/${String(attemptId)}/review\\?q=3$`,
          'u',
        ),
      );
      await expect(page.locator('.exv-q:visible')).toHaveCount(1);
      await expect(panels.nth(2)).toBeVisible();

      // Grid cell jumps to last question; end of list disables "Câu sau" link
      await gridCells.nth(4).click();
      await expect(page).toHaveURL(
        new RegExp(
          `/learn/exam/attempts/${String(attemptId)}/review\\?q=5#q-5$`,
          'u',
        ),
      );
      await expect(page.locator('.exv-q:visible')).toHaveCount(1);
      await expect(panels.nth(4)).toBeVisible();
      await expect(page.getByText('Nghe · Phần 2')).toBeVisible();
      await expect(page.getByText('Đọc · Phần 1')).toBeHidden();
      await expect(gridCells.nth(4)).toHaveAttribute('aria-current', 'true');
      await expect(page.getByRole('link', { name: 'Câu sau' })).toHaveCount(0);
      await expect(
        page.locator('.exv-nav__btn[aria-disabled="true"]', {
          hasText: 'Câu sau',
        }),
      ).toBeVisible();
      await expectNoHorizontalScroll(page);
    } else {
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await gridCells.nth(4).click();
      await expect(page).toHaveURL(
        new RegExp(
          `/learn/exam/attempts/${String(attemptId)}/review\\?q=5#q-5$`,
          'u',
        ),
      );
      await expect(page.locator('.exv-q:visible')).toHaveCount(5);
      await expect
        .poll(async () => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(50);
      const q5Top = await panels
        .nth(4)
        .evaluate((element) => element.getBoundingClientRect().top);
      expect(q5Top).toBeLessThan(page.viewportSize()?.height ?? 800);

      await gridCells.nth(1).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        new RegExp(
          `/learn/exam/attempts/${String(attemptId)}/review\\?q=2#q-2$`,
          'u',
        ),
      );
    }

    // ---- Filters through the URL (changing filter drops q and resets to first question) ----
    await page.getByRole('link', { name: /^Đúng/u }).click();
    await expect(page).toHaveURL(/filter=correct$/u);
    await expect(page).not.toHaveURL(/q=/u);
    await expect(page.locator('.exv-q')).toHaveCount(1);
    await expect(page.locator('.exv-q').first()).toContainText(
      fixtures.mcqPrompt,
    );

    await page.getByRole('link', { name: /^Sai/u }).click();
    await expect(page).toHaveURL(/filter=wrong$/u);
    await expect(page).not.toHaveURL(/q=/u);
    await expect(page.locator('.exv-q')).toHaveCount(1);
    await expect(page.locator('.exv-q').first()).toContainText(
      fixtures.wrongPrompt,
    );

    await page.getByRole('link', { name: /^Đánh dấu/u }).click();
    await expect(page).toHaveURL(/filter=flagged$/u);
    await expect(page).not.toHaveURL(/q=/u);
    await expect(page.locator('.exv-q')).toHaveCount(1);

    await page.getByRole('link', { name: /^Tất cả/u }).click();
    await expect(page).toHaveURL(/\/review$/u);
    await expect(page.locator('.exv-q')).toHaveCount(5);
    await expect(gridCells.nth(0)).toHaveAttribute('aria-current', 'true');
    if (isWebFrame(page)) {
      await expect(page.locator('.exv-q:visible')).toHaveCount(1);
      await expect(panels.nth(0)).toBeVisible();
    }

    await expectNoHorizontalScroll(page);
    await audit(page, 'review');
    await shot(page, testInfo, 'states');
    expect(consoleErrors, 'console errors').toEqual([]);
  });

  test('2. a review unknown to the learner is a 404 and a bad id is not-found', async ({
    page,
  }) => {
    await registerReadyLearner(page, undefined, 3);
    await page.goto('/learn/exam/attempts/99999999/review');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Không tìm thấy bài thi' }),
    ).toBeVisible();
  });

  test('3. an expired attempt is timed out lazily by the review read', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL, 3);
    const token = await learnerToken(page);
    const api = await playwrightRequest.newContext();
    let attemptId: number;
    try {
      const attempt = await call<{ id: number }>(
        api,
        'POST',
        `/exam/tests/${String(fixtures.publishedTestId)}/attempts`,
        token,
        { idempotencyKey: randomUUID() },
      );
      attemptId = attempt.id;
    } finally {
      await api.dispose();
    }
    // The column stores UTC wall time (Prisma writes UTC); use the same frame
    // so the app clock sees the attempt as expired, not 7h in the future.
    queryDisposableDb(
      `UPDATE "ExamAttempt" SET "startedAt" = (now() at time zone 'utc') - interval '91 minutes', "expiresAt" = (now() at time zone 'utc') - interval '10 seconds' WHERE "id" = ${String(attemptId)}`,
    );
    expect(
      queryDisposableDb(
        `SELECT "status" FROM "ExamAttempt" WHERE "id" = ${String(attemptId)}`,
      ),
    ).toBe('in_progress');

    // The review read applies the lazy timeout itself and serves the terminal
    // review in the same request (Q147/Q156), so the page opens even though the
    // attempt was still in_progress before the read.
    await page.goto(`/learn/exam/attempts/${String(attemptId)}/review`);
    await expect(
      page.getByRole('heading', { level: 1, name: REVIEW_TITLE }),
    ).toBeVisible();
    await expect(page.locator('.exv-q')).toHaveCount(5);
    expect(
      queryDisposableDb(
        `SELECT "status" FROM "ExamAttempt" WHERE "id" = ${String(attemptId)}`,
      ),
    ).toBe('timed_out');
    await expect(page.getByText('Chưa trả lời').first()).toBeVisible();
  });
});
