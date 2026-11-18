import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { FORBIDDEN_KEYS } from '../src/features/learner-exam/exam-forbidden-keys';
import { queryDisposableDb } from './support/disposable-db';
import {
  readCspViolations,
  registerReadyLearner,
  seedExamTakeFixtures,
  watchCsp,
  type ExamTakeFixture,
} from './support/learner-fixtures';

/**
 * M4.2b 2b-2 (F16-F20, F23, F24-F28): the exam-taking island on the real
 * backend. Fixtures come from the disposable e2e DB through the Admin CMS.
 * Screenshots are written only when HSK_SHOTS_DIR is set (CI leaves it unset).
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const SHOTS_DIR = process.env.HSK_SHOTS_DIR;

/** Saves `<project>-<state>.png` under HSK_SHOTS_DIR when it is configured. */
async function shot(
  page: Page,
  testInfo: TestInfo,
  state: string,
  // M4.5 B2c: ảnh so mockup phải ở CSS pixel (mobile-390 chạy DPR 3) nên
  // truyền `css: true`; mặc định giữ ảnh device-scale của các state 2b-6.
  options: { css?: boolean } = {},
): Promise<void> {
  if (!SHOTS_DIR) return;
  await mkdir(SHOTS_DIR, { recursive: true });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  // 2b-6: chụp viewport thật (fullPage dán footer sticky giữa ảnh gây ảo giác
  // che khuất — M3); scroll về đỉnh để ảnh nhất quán giữa các state.
  await page.screenshot({
    path: path.join(
      SHOTS_DIR,
      `${testInfo.project.name}-${state}${options.css ? '-css' : ''}.png`,
    ),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    ...(options.css ? { scale: 'css' as const } : {}),
  });
}

/** M4.5 B2c: đo computed style của màn xem lại để so mockup (HSK_STYLES_DIR). */
async function measureReview(page: Page, testInfo: TestInfo): Promise<void> {
  const dir = process.env.HSK_STYLES_DIR;
  if (!dir) return;
  const metrics = await page.evaluate(() => {
    const pick = (selector: string) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
        display: style.display,
        background: style.backgroundColor,
        color: style.color,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        borderRadius: style.borderRadius,
        border: style.border,
        padding: style.padding,
        margin: style.margin,
        gap: style.gap,
        gridTemplateColumns: style.gridTemplateColumns,
      };
    };
    return {
      barTitle: pick('.ext-bar__title'),
      card: pick('.extr-card'),
      sum: pick('.extr-sum'),
      sumIco: pick('.extr-sum__ico--answered'),
      sumLabel: pick('.extr-sum__label'),
      sumCount: pick('.extr-sum__body b'),
      heading: pick('.extr-heading'),
      legend: pick('.extr-legend'),
      sectionTitle: pick('.extr-section__title'),
      grid: pick('.extr-grid'),
      cell: pick('.extr-cell'),
      cellDone: pick('.extr-cell.is-done'),
      cellUnanswered: pick('.extr-cell:not(.is-done)'),
      tip: pick('.extr-tip'),
      actions: pick('.extr-actions'),
      submit: pick('.extr-actions__submit'),
      continue: pick('.extr-actions__continue'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${testInfo.project.name}-25-review.json`),
    JSON.stringify(metrics, null, 2),
  );
}

const TAKE_TITLE = 'Làm bài thi · Hán Lộ';
const INTRO_TITLE = 'Giới thiệu đề · Hán Lộ';

async function audit(
  page: Page,
  state: string,
  title = TAKE_TITLE,
): Promise<void> {
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
  expect.soft(await page.locator('h1:visible').count(), `h1 ${state}`).toBe(1);
  expect.soft(await page.locator('main').count(), `main ${state}`).toBe(1);
  expect.soft(await page.title(), `title ${state}`).toBe(title);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(0);
}

function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // 2c-b: G1 đã chặn gọi media-grants khi bài khoá nên KHÔNG còn 409 đúng
    // thiết kế để lọc; mọi console error đều phải là lỗi thật.
    errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/** Kiểm chung mọi ca: axe + title + console + CSP + không scroll ngang. */
async function expectClean(
  page: Page,
  state: string,
  consoleErrors: string[],
  cspConsole: string[],
  title = TAKE_TITLE,
): Promise<void> {
  await audit(page, state, title);
  await expectNoHorizontalScroll(page);
  expect(await readCspViolations(page), `csp ${state}`).toEqual([]);
  expect(cspConsole, `csp-console ${state}`).toEqual([]);
  expect(consoleErrors, `console ${state}`).toEqual([]);
}

function submitPosts(page: Page): { count: () => number } {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (!request.url().includes('/submit')) return;
    count += 1;
  });
  return { count: () => count };
}

async function openSubmitDialog(page: Page) {
  const footer = page
    .getByRole('contentinfo')
    .getByRole('button', { name: 'Nộp bài' });
  const panelList = page.getByRole('complementary', { name: 'Danh sách câu' });
  const panel = panelList.getByRole('button', { name: 'Nộp bài' });
  const nav = page
    .getByRole('navigation', { name: 'Điều hướng câu hỏi' })
    .getByRole('button', { name: 'Nộp bài' });
  // Q124: the footer submit is web-only; on <1024 the panel submit appears
  // when the panel is open, and mobile keeps the nav submit on the last
  // question. `isVisible()` avoids the unbounded click wait on hidden nodes.
  if (await footer.isVisible()) {
    await footer.click();
  } else if (await panel.isVisible()) {
    await panel.click();
  } else {
    // <520: the open panel carries the full-width submit; 520-1023 keeps it
    // hidden, so the last-question nav row is the only entry.
    if (!(await panelList.isVisible())) {
      const opener = page.getByRole('button', {
        name: /Mở danh sách câu hỏi/u,
      });
      if (await opener.isVisible()) await opener.click();
      else await page.getByRole('button', { name: /Mở danh sách/u }).click();
    }
    if (await panel.isVisible()) {
      await panel.click();
    } else {
      await panelList.getByRole('button', { name: /^Câu /u }).last().click();
      await nav.click();
    }
  }
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Nộp bài?' })).toBeVisible();
  return dialog;
}

async function confirmSubmit(page: Page): Promise<void> {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Nộp bài' })
    .click();
}

/**
 * M4.5 B2c (Q225): the pre-submit review is a mode of the take screen, entered
 * from the "Xem lại" button of the "Danh sách câu" panel. Mobile keeps the
 * panel collapsible, so open it first when it is not visible.
 */
async function openReview(page: Page) {
  const panelList = page.getByRole('complementary', { name: 'Danh sách câu' });
  if (!(await panelList.isVisible())) {
    await page.getByRole('button', { name: /Mở danh sách câu hỏi/u }).click();
    await expect(panelList).toBeVisible();
  }
  await panelList.getByRole('button', { name: 'Xem lại' }).click();
  await expect(
    page.getByRole('heading', { name: 'Chọn câu hỏi để xem lại' }),
  ).toBeVisible();
  return page.getByRole('region', { name: 'Chọn câu hỏi để xem lại' });
}

/**
 * Reads a captured response body with a bound: a document body being replaced
 * by a reload must never hang the test on `Promise.all`.
 */
function textWithin(response: {
  text: () => Promise<string>;
}): Promise<string> {
  return Promise.race([
    response.text().catch(() => ''),
    new Promise<string>((resolve) => {
      setTimeout(() => resolve(''), 5_000);
    }),
  ]);
}

async function startAttempt(
  page: Page,
  baseURL: string | undefined,
  fixtures: ExamTakeFixture,
): Promise<void> {
  await registerReadyLearner(page, baseURL);
  await page.goto(`/learn/exam/${String(fixtures.publishedTestId)}`);
  // The grants fetch only fires from a mount effect, so its response proves
  // the island hydrated — clicks before that would hit inert SSR markup.
  const hydrated = page.waitForResponse(
    (response) => response.url().includes('/media-grants'),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: 'Bắt đầu thi' }).click();
  await page.waitForURL(/\/learn\/exam\/attempts\/\d+/u);
  await hydrated;
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}

test.describe('Learner exam taking (M4.2b / TL-141..143)', () => {
  // Forty published questions through the Admin CMS exceed the 30 s default;
  // the @shots walk also plays a 3 s audio clip.
  test.describe.configure({ timeout: 420_000 });
  let fixtures: ExamTakeFixture;

  test.beforeAll(async ({ browser }, testInfo) => {
    void browser;
    // M4.5 B2c Pha 0: audio + ảnh của đề dùng chung theo DB qua
    // sharedExamMedia (Idempotency-Key cố định) — project đầu ingest tối đa 2
    // request, các project sau đọc MediaIngestion đã completed nên 0 request
    // ingest; không còn 4 × 61 s chờ 429. Worst case còn lại là ~60 s publish
    // 40 câu qua CMS (retry 429 theo Retry-After) ⇒ chốt 360 s (mặc định hook
    // 30 s đã từng làm đỏ lần chạy sạch khi 4 project cùng seed).
    testInfo.setTimeout(360_000);
    // Local runs may share one seed across the four projects through
    // HSK_FIXTURE_CACHE: media is already shared per DB (0 ingest after the
    // first project), but a per-project seed still republishes 40 questions
    // through the throttled Admin CMS. CI leaves the env unset and seeds per
    // project.
    const cachePath = process.env.HSK_FIXTURE_CACHE;
    if (cachePath) {
      const cached = await readFile(cachePath, 'utf8').catch(() => null);
      if (cached !== null) {
        fixtures = JSON.parse(cached) as ExamTakeFixture;
        return;
      }
    }
    fixtures = await seedExamTakeFixtures(
      `${testInfo.project.name}-${String(Date.now())}`,
    );
    if (cachePath) {
      await writeFile(cachePath, JSON.stringify(fixtures));
    }
  });

  test('1. intro starts the attempt and the exam page is clean (F16-F20, F28)', async ({
    page,
    baseURL,
  }, testInfo) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);

    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.getByRole('timer')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Thoát bài thi/u }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await audit(page, 'default');
    await shot(page, testInfo, '1-mcq-listening-default');

    expect(consoleErrors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });

  test('2. mcq answer survives a reload; a marked question stays marked', async ({
    page,
    baseURL,
  }, testInfo) => {
    await startAttempt(page, baseURL, fixtures);
    const firstRadio = page.getByRole('radio').first();
    await firstRadio.click();
    await expect(firstRadio).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Đánh dấu' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã lưu' }),
    ).toBeVisible();
    await page.reload();
    // Sau reload đảo mở câu CHƯA làm đầu tiên (Q2) — quay lại Q1 qua panel.
    const panel = page.getByRole('complementary', { name: 'Danh sách câu' });
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: /Mở danh sách câu hỏi/u }).click();
    }
    await panel.getByRole('button', { name: /^Câu 1,/u }).click();
    await expect(page.getByRole('radio').first()).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(
      page.getByRole('button', { name: 'Đánh dấu' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await shot(page, testInfo, '2-answered-and-marked');
    await audit(page, 'answered');
  });

  test('8. @web submit opens the dialog and the last question has no next', async ({
    page,
    baseURL,
  }, testInfo) => {
    await startAttempt(page, baseURL, fixtures);
    await page
      .getByRole('complementary', { name: 'Danh sách câu' })
      .getByRole('button', { name: /^Câu /u })
      .last()
      .click();
    await expect(page.getByRole('button', { name: 'Câu sau' })).toHaveCount(0);
    // @web hides the mobile nav submit (Q124); the footer submit is the entry.
    await page
      .getByRole('contentinfo')
      .getByRole('button', { name: 'Nộp bài' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Nộp bài?' }),
    ).toBeVisible();
    await expect(
      dialog.getByText('Sau khi nộp, bạn không thể sửa bài.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Tiếp tục làm' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await audit(page, 'last-question');
    await shot(page, testInfo, '8-last-question');
  });

  // 2c-b: điều hướng câu qua panel (mở panel nếu <520 rồi đóng lại).
  async function gotoQuestion(page: Page, number: number): Promise<void> {
    const panel = page.getByRole('complementary', { name: 'Danh sách câu' });
    const countButton = page.getByRole('button', {
      name: /Mở danh sách câu hỏi/u,
    });
    if (!(await panel.isVisible())) {
      if (await countButton.isVisible()) await countButton.click();
      else await page.getByRole('button', { name: /Mở danh sách/u }).click();
    }
    await panel
      .getByRole('button', { name: new RegExp(`^Câu ${String(number)},`, 'u') })
      .click();
    await page.waitForTimeout(250);
  }

  async function answerMcq(
    page: Page,
    number: number,
    expected: 'Đã lưu' | 'Chưa lưu' = 'Đã lưu',
  ): Promise<void> {
    await gotoQuestion(page, number);
    await page.getByRole('radio').first().click();
    await expect(
      page.getByRole('status').filter({ hasText: expected }),
    ).toBeVisible({ timeout: 15_000 });
  }

  test('10. true_false, fill_blank and arrange_sentence all save and reload', async ({
    page,
    baseURL,
  }, testInfo) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);

    // true_false (Đúng/Sai) — câu 19 trong fixture (sau 6 listening + 12 mcq).
    const trueFalseNumber = fixtures.listeningCount + 13;
    await gotoQuestion(page, trueFalseNumber);
    await page.getByRole('radio', { name: 'Đúng' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã lưu' }),
    ).toBeVisible({ timeout: 15_000 });

    // fill_blank
    await gotoQuestion(page, fixtures.firstFillNumber);
    const fill = page.getByLabel('Câu trả lời của bạn');
    await fill.fill('买');
    await fill.blur();
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã lưu' }),
    ).toBeVisible({ timeout: 15_000 });

    // arrange_sentence
    await gotoQuestion(page, fixtures.firstArrangeNumber);
    await page.getByRole('button', { name: 'Thêm 我' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã lưu' }),
    ).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.waitForSelector('.ext-question');
    await gotoQuestion(page, trueFalseNumber);
    await expect(page.getByRole('radio', { name: 'Đúng' })).toBeChecked();
    await gotoQuestion(page, fixtures.firstFillNumber);
    await expect(page.getByLabel('Câu trả lời của bạn')).toHaveValue('买');
    await gotoQuestion(page, fixtures.firstArrangeNumber);
    await expect(
      page.locator('.pr-chip').filter({ hasText: '我' }).first(),
    ).toBeVisible();

    await shot(page, testInfo, '10-extended');
    await expectClean(page, 'case-10', consoleErrors, cspConsole);
  });

  test('4. offline answers queue into one PUT batch and survive a reload', async ({
    page,
    baseURL,
    context,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);
    const batches: unknown[][] = [];
    page.on('request', (request) => {
      if (request.method() !== 'PUT') return;
      if (!request.url().endsWith('/answers')) return;
      const body = request.postDataJSON() as { items?: unknown[] };
      batches.push(body.items ?? []);
    });
    await context.setOffline(true);
    await answerMcq(page, 1, 'Chưa lưu');
    await answerMcq(page, 2, 'Chưa lưu');
    await expect(
      page.getByRole('status').filter({ hasText: 'Chưa lưu' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/Bài làm sẽ được lưu khi có mạng lại/u),
    ).toBeVisible();
    await context.setOffline(false);
    await expect.poll(() => batches.length, { timeout: 30_000 }).toBe(1);
    expect(batches[0]).toHaveLength(2);
    await page.reload();
    await page.waitForSelector('.ext-question');
    await gotoQuestion(page, 1);
    await expect(page.getByRole('radio').first()).toBeChecked();
    await gotoQuestion(page, 2);
    await expect(page.getByRole('radio').first()).toBeChecked();
    // Lọc CỤC BỘ đúng thông báo mạng do ca này cố ý tắt mạng
    // (`context.setOffline(true)`): Chromium log mỗi request thất bại bằng
    // chuỗi dưới đây. Không nới expectClean dùng chung.
    const OFFLINE_CONSOLE =
      'Failed to load resource: net::ERR_INTERNET_DISCONNECTED';
    const unexpected = consoleErrors.filter(
      (message) => message !== OFFLINE_CONSOLE,
    );
    await expectClean(page, 'case-4', unexpected, cspConsole);
  });

  test('5. two pages on one attempt: the stale page gets the newest answer and a toast', async ({
    page,
    browser,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);
    const attemptUrl = page.url();
    const second = await browser.newContext();
    const other = await second.newPage();
    // Cùng cookie phiên của learner: mở lại đúng attempt trong context thứ hai
    // sẽ không có session — dùng cùng context trang hiện tại.
    await second.close();
    const stale = await page.context().newPage();
    await stale.goto(attemptUrl);
    await stale.waitForSelector('.ext-question');
    await page.getByRole('radio').first().click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã lưu' }),
    ).toBeVisible({ timeout: 15_000 });
    // Trang "cũ" đã tải bản version trước, trả lời cùng câu → 409 conflict.
    await stale.getByRole('radio').nth(1).click();
    await expect(stale.locator('.toast').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(stale.getByRole('radio').first()).toBeChecked({
      timeout: 20_000,
    });
    await stale.close();
    await audit(page, 'case-5');
    expect(await readCspViolations(page), 'csp case-5').toEqual([]);
    expect(consoleErrors, 'console case-5').toEqual([]);
    expect(cspConsole, 'csp-console case-5').toEqual([]);
  });

  test('6. expiry locks the answers, hides grants and keeps them hidden', async ({
    page,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);
    const attemptId = Number(page.url().match(/attempts\/(\d+)/u)?.[1]);
    const grants: string[] = [];
    const mediaRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/media-grants')) grants.push(request.url());
      if (request.url().includes('/api/learner/media/')) {
        mediaRequests.push(request.url());
      }
    });
    queryDisposableDb(
      `UPDATE "ExamAttempt" SET "expiresAt" = (now() at time zone 'UTC' + interval '15 seconds') WHERE id = ${String(attemptId)}`,
    );
    await page.reload();
    await page.waitForSelector('.ext-question');
    await expect(page.getByText('Hết giờ. Bài làm đã được lưu.')).toBeVisible({
      timeout: 40_000,
    });
    for (const radio of await page.getByRole('radio').all()) {
      await expect(radio).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(
      page.getByRole('button', { name: 'Đánh dấu', exact: true }).first(),
    ).toHaveAttribute('aria-disabled', 'true');
    const timer = page.locator('.ext-timer');
    await expect(timer).toHaveText('00:00');
    // F1.3 (M4.2c): is-low only applies while the attempt is not locked.
    await expect(timer).not.toHaveClass(/is-low/u);
    // Sau ân hạn 5 s, GET attempt trả timed_out.
    await page.waitForTimeout(7_000);
    const state = await page.evaluate(async (id) => {
      const response = await fetch(`/api/learner/exam/attempts/${id}`, {
        cache: 'no-store',
      });
      const payload = (await response.json()) as { data?: { status?: string } };
      return payload.data?.status;
    }, attemptId);
    expect(state).toBe('timed_out');
    // T1: lần reload khi còn hạn PHẢI thật sự gọi media-grants, nếu không thì
    // assert "rỗng" bên dưới xanh giả.
    expect(
      grants.length,
      'reload khi còn hạn phải gọi media-grants',
    ).toBeGreaterThan(0);
    // G1: reload khi attempt ĐÃ khoá không được gọi media-grants nữa.
    grants.length = 0;
    mediaRequests.length = 0;
    await page.reload();
    await expect(page.getByText('Hết giờ. Bài làm đã được lưu.')).toBeVisible({
      timeout: 20_000,
    });
    expect(
      grants,
      'không còn request media-grants sau reload khi đã khoá',
    ).toEqual([]);
    // R12 (TL-148): mount ở trạng thái khoá thì preloader không tải byte nào.
    expect(mediaRequests, 'không tải media content khi bài đã khoá').toEqual(
      [],
    );
    await expectClean(page, 'case-6', consoleErrors, cspConsole);
  });

  test('7. real audio at 0.75x plays to the end and locks the controls', async ({
    page,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);
    await gotoQuestion(page, 1);
    const audio = page.locator('audio');
    // R12 (TL-145): audio đã được tải trước thành blob trước khi bấm Phát.
    await expect(audio).toHaveAttribute('src', /^blob:/u, {
      timeout: 30_000,
    });
    await page.getByRole('button', { name: '0,75×' }).click();
    await page.getByRole('button', { name: 'Phát' }).click();
    await expect
      .poll(
        () => audio.evaluate((el) => (el as HTMLAudioElement).playbackRate),
        { timeout: 10_000 },
      )
      .toBe(0.75);
    await expect
      .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).ended), {
        timeout: 90_000,
        intervals: [250],
      })
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Đã nghe' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: 'Đã nghe' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '1×' })).toBeDisabled();
    await expect(page.getByText('Nghe lại')).toHaveCount(0);
    await expectClean(page, 'case-7', consoleErrors, cspConsole);
  });

  test('15. preloaded audio plays offline from a blob (R12 / TL-145, TL-149)', async ({
    page,
    baseURL,
    context,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);
    // Q1 có audio; Q2 có ảnh nên phải ở Q1.
    await gotoQuestion(page, 1);
    const audio = page.locator('audio');
    await expect(audio).toHaveAttribute('src', /^blob:/u, {
      timeout: 30_000,
    });
    const mediaRequests: string[] = [];
    const failedMediaRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/learner/media/')) {
        mediaRequests.push(request.url());
      }
    });
    page.on('requestfailed', (request) => {
      if (request.url().includes('/api/learner/media/')) {
        failedMediaRequests.push(request.url());
      }
    });
    await context.setOffline(true);
    await page.getByRole('button', { name: '0,75×' }).click();
    await page.getByRole('button', { name: 'Phát' }).click();
    await expect(page.getByRole('button', { name: 'Đang phát' })).toBeVisible();
    await expect
      .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).ended), {
        timeout: 90_000,
        intervals: [250],
      })
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Đã nghe' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: 'Đã nghe' })).toBeDisabled();
    expect(
      await audio.evaluate((el) => (el as HTMLAudioElement).playbackRate),
    ).toBe(0.75);
    await expect(page.getByText('Không tải được âm thanh.')).toHaveCount(0);
    // Phát từ blob: không phát sinh request media nào khi offline.
    expect(mediaRequests, 'offline không request media').toEqual([]);
    await context.setOffline(false);
    // Chromium log ERR_INTERNET_DISCONNECTED không kèm URL, nên thay vì lọc
    // mù ta chứng minh ở tầng network là KHÔNG request media nào thất bại
    // (thanh `failedMediaRequests` ở trên) rồi mới bỏ qua đúng chuỗi đó.
    expect(
      failedMediaRequests,
      'không request media nào thất bại khi offline',
    ).toEqual([]);
    const unexpected = consoleErrors.filter(
      (message) => !message.includes('net::ERR_INTERNET_DISCONNECTED'),
    );
    await audit(page, 'case-15');
    await expectNoHorizontalScroll(page);
    expect(await readCspViolations(page), 'csp case-15').toEqual([]);
    expect(cspConsole, 'csp-console case-15').toEqual([]);
    expect(unexpected, 'console case-15').toEqual([]);
  });

  test('16. fallback streams through the grant when preload is not audio (R12)', async ({
    page,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    let preloadFetches = 0;
    await page.route('**/api/learner/media/**', async (route) => {
      if (route.request().resourceType() === 'fetch') {
        preloadFetches += 1;
        await route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: 'not-audio',
        });
        return;
      }
      await route.continue();
    });
    await startAttempt(page, baseURL, fixtures);
    await gotoQuestion(page, 1);
    await expect
      .poll(() => preloadFetches, { timeout: 30_000 })
      .toBeGreaterThan(0);
    const audio = page.locator('audio');
    await expect(audio).not.toHaveAttribute('src', /^blob:/u);
    await expect(audio).toHaveAttribute(
      'src',
      /\/api\/learner\/media\/\d+\/content/u,
    );
    await page.getByRole('button', { name: 'Phát' }).click();
    await expect
      .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).ended), {
        timeout: 90_000,
        intervals: [250],
      })
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Đã nghe' })).toBeVisible({
      timeout: 10_000,
    });
    await expectClean(page, 'case-16', consoleErrors, cspConsole);
  });

  test('9. the quit dialog keeps working: stay, then leave to the intro with a resume card', async ({
    page,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);
    const attemptUrl = page.url();
    await page.getByRole('button', { name: 'Thoát bài thi' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Tiếp tục làm' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(attemptUrl);
    await page.getByRole('button', { name: 'Thoát bài thi' }).click();
    await dialog.getByRole('button', { name: 'Thoát' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/learn/exam/${String(fixtures.publishedTestId)}$`, 'u'),
    );
    await expect(page.getByText('Bài đang làm')).toBeVisible();
    const resume = page.getByRole('link', { name: /Làm tiếp/u });
    await expect(resume).toHaveAttribute('href', /\/attempts\/\d+/u);
    await expectClean(page, 'case-9', consoleErrors, cspConsole, INTRO_TITLE);
  });

  test('11. @keyboard arrows pick and save, Tab reaches the controls, Esc closes', async ({
    page,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);
    await gotoQuestion(page, 1);
    const first = page.getByRole('radio').first();
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio').nth(1)).toBeFocused();
    await expect(page.getByRole('radio').nth(1)).toBeChecked();
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã lưu' }),
    ).toBeVisible({ timeout: 15_000 });
    // Tab đi qua được các nút chính (thoát, phát, đánh dấu). Bắt đầu từ đầu
    // trang (blur) để thứ tự Tab tính từ phần tử đầu tiên, không phụ thuộc
    // vị trí focus hiện tại trong radiogroup.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    const reached = new Set<string>();
    for (let index = 0; index < 120; index += 1) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? '';
      });
      reached.add(label);
    }
    expect([...reached].some((label) => label.includes('Thoát bài thi'))).toBe(
      true,
    );
    expect([...reached].some((label) => label.includes('Đánh dấu'))).toBe(true);
    await page.getByRole('button', { name: 'Thoát bài thi' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectClean(page, 'case-11', consoleErrors, cspConsole);
  });

  test('13. invalid and foreign attempt ids render not-found without data', async ({
    page,
    browser,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);
    const attemptId = page.url().match(/attempts\/(\d+)/u)?.[1] ?? '';
    const foreign = await browser.newContext();
    const other = await foreign.newPage();
    await registerReadyLearner(other, baseURL);
    // attempt của learner khác
    await other.goto(`/learn/exam/attempts/${attemptId}`);
    await expect(
      other.getByText(/Không tìm thấy|không tồn tại/u).first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(other.locator('.ext-question')).toHaveCount(0);
    // id không hợp lệ
    await other.goto('/learn/exam/attempts/999999999');
    await expect(
      other.getByText(/Không tìm thấy|không tồn tại/u).first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(other.locator('.ext-question')).toHaveCount(0);
    await foreign.close();
    await expectClean(page, 'case-13', consoleErrors, cspConsole);
  });

  test('14. no forbidden keys leak through BFF responses, HTML or RSC payload', async ({
    page,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    const forbidden = [...FORBIDDEN_KEYS];
    expect(forbidden.length).toBeGreaterThan(5);
    // 2c-c (G-code-review): quét đúng thứ spec nói — HTML server-rendered VÀ
    // RSC payload — và await mọi body trước khi assert; bản trước chỉ đọc DOM
    // và đẩy body bất đồng bộ nên có thể pass rỗng.
    const bodies: Promise<string>[] = [];
    let documentResponses = 0;
    let rscResponses = 0;
    page.on('response', (response) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] ?? '';
      const isExamApi = url.includes('/api/learner/exam/');
      const isRsc =
        url.includes('_rsc=') || contentType.includes('text/x-component');
      const isDocument = response.request().resourceType() === 'document';
      if (!isExamApi && !isRsc && !isDocument) return;
      if (isDocument) documentResponses += 1;
      if (isRsc) rscResponses += 1;
      bodies.push(textWithin(response));
    });
    await startAttempt(page, baseURL, fixtures);
    await answerMcq(page, 1);
    await page.waitForLoadState('networkidle');
    const captured = await Promise.all(bodies);
    const html = await page.content();
    expect(
      documentResponses,
      'phải bắt được HTML server-rendered',
    ).toBeGreaterThan(0);
    expect(rscResponses, 'phải bắt được RSC payload').toBeGreaterThan(0);
    const scanned = [html, ...captured].join('\n');
    expect(scanned.length, 'nội dung quét không được rỗng').toBeGreaterThan(
      1_000,
    );
    const leaked = forbidden.filter((key) => scanned.includes(key));
    expect(leaked, 'key cấm rò rỉ').toEqual([]);
    await expectClean(page, 'case-14', consoleErrors, cspConsole);
  });

  test('12. @shots ten UI states for the TL review (F16-F28)', async ({
    page,
    baseURL,
    context,
  }, testInfo) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);
    const attemptId = page.url().match(/attempts\/(\d+)/u)?.[1] ?? '';
    expect(attemptId).not.toBe('');

    const panel = page.getByRole('complementary', { name: 'Danh sách câu' });
    const openPanel = async (): Promise<void> => {
      if (await panel.isVisible()) return;
      await page.getByRole('button', { name: /Mở danh sách câu hỏi/u }).click();
      await expect(panel).toBeVisible();
    };
    const gotoQuestion = async (n: number): Promise<void> => {
      await openPanel();
      await panel
        .getByRole('button', { name: new RegExp(`^Câu ${String(n)},`, 'u') })
        .click();
      await page.waitForTimeout(300);
    };
    // M2 (TL): ảnh state khác 3 không được dính panel đang mở (<520).
    const countButton = page.getByRole('button', {
      name: /Mở danh sách câu hỏi/u,
    });
    const closePanel = async (): Promise<void> => {
      if (
        (await panel.isVisible()) &&
        (await countButton.isVisible()) &&
        (await countButton.getAttribute('aria-expanded')) === 'true'
      ) {
        await countButton.click();
        await expect(panel).toBeHidden();
      }
    };
    const savedStatus = page.getByRole('status').filter({ hasText: 'Đã lưu' });
    // V16: ảnh không được dính toast sót lại từ câu trước.
    const toastGone = async (): Promise<void> => {
      const toast = page.locator('.toast').first();
      if (await toast.count()) await toast.waitFor({ state: 'hidden' });
    };

    // (1) listening mặc định
    await audit(page, 'shots-1');
    await expectNoHorizontalScroll(page);
    await closePanel();
    await shot(page, testInfo, '1-listening-default');

    // (2) đã chọn + đánh dấu
    await page.getByRole('radio').first().click();
    await expect(savedStatus).toBeVisible();
    await page.getByRole('button', { name: 'Đánh dấu' }).click();
    await page.waitForTimeout(400);
    await toastGone(); // V16: toast "Đã đánh dấu" không được dính vào ảnh
    await closePanel();
    await shot(page, testInfo, '2-answered-flagged');

    // (3) panel mở (<520) / panel mặc định (≥520)
    await openPanel();
    // V4 (TL): <520 panel mở PHẢI có nút "Nộp bài" (Q124, bấm hiện toast);
    // 520–1023 ẩn (TL chốt); ≥1024 hiện theo mockup web (W7).
    const panelSubmit = panel.locator('.uxb-takefoot__submit');
    const vw = testInfo.project.use.viewport?.width ?? 0;
    if (vw < 520) {
      await expect(panelSubmit).toBeVisible();
      await panelSubmit.click();
      await expect(
        page.getByRole('dialog').getByRole('heading', { name: 'Nộp bài?' }),
      ).toBeVisible();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Tiếp tục làm' })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } else if (vw < 1024) {
      await expect(panelSubmit).toBeHidden();
    } else {
      await expect(panelSubmit).toBeVisible();
    }
    await shot(page, testInfo, '3-panel-open');

    // (7) audio đã nghe (Q123: phát xong là khoá) — 2c-b: `ended` THẬT, không
    // dispatch tổng hợp (bài học listening đã chứng minh audio chạy headless).
    await gotoQuestion(fixtures.listeningCount > 0 ? 2 : 1);
    await page.getByRole('button', { name: 'Phát' }).click();
    await expect(page.getByRole('button', { name: 'Đang phát' })).toBeVisible({
      timeout: 10_000,
    });
    await expect
      .poll(
        () =>
          page
            .locator('audio')
            .evaluate((el) => (el as HTMLAudioElement).ended),
        { timeout: 60_000, intervals: [250] },
      )
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Đã nghe' })).toBeVisible({
      timeout: 10_000,
    });
    await closePanel();
    await shot(page, testInfo, '7-audio-heard');

    // (8) fill_blank
    await gotoQuestion(fixtures.firstFillNumber);
    await page.getByLabel('Câu trả lời của bạn').fill('买');
    await expect(savedStatus).toBeVisible({ timeout: 10_000 });
    await toastGone();
    await closePanel();
    await shot(page, testInfo, '8-fill-blank');

    // (9) arrange_sentence (draft 1 token, chưa gửi)
    await gotoQuestion(fixtures.firstArrangeNumber);
    await page.getByRole('button', { name: 'Thêm 我' }).click();
    await page.waitForTimeout(300);
    await closePanel();
    await shot(page, testInfo, '9-arrange');

    // (6) dialog thoát (+ axe)
    await page.getByRole('button', { name: 'Thoát bài thi' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await audit(page, 'shots-6');
    await closePanel();
    await shot(page, testInfo, '6-quit-dialog');
    await dialog.getByRole('button', { name: 'Tiếp tục làm' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // (10) banner offline + "Chưa lưu"
    await context.setOffline(true);
    await gotoQuestion(fixtures.listeningCount + 1);
    await page.getByRole('radio').first().click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Chưa lưu' }),
    ).toBeVisible({ timeout: 10_000 });
    await closePanel();
    await shot(page, testInfo, '10-offline');
    await context.setOffline(false);

    // (4) is-low: lùi expiresAt về now+4 phút (Q128)
    queryDisposableDb(
      `UPDATE "ExamAttempt" SET "expiresAt" = (now() at time zone 'utc' + interval '4 minutes') WHERE id = ${attemptId}`,
    );
    await page.reload();
    await page.waitForSelector('.ext-question');
    await expect(page.getByText('Còn dưới 5 phút.')).toBeAttached({
      timeout: 10_000,
    });
    await closePanel();
    await shot(page, testInfo, '4-is-low');

    // (5) hết giờ (Q127) — trạng thái cuối vì attempt bị khoá
    // Check constraint ExamAttempt_time_check đòi expiresAt > startedAt.
    queryDisposableDb(
      `UPDATE "ExamAttempt" SET "expiresAt" = "startedAt" + interval '2 seconds' WHERE id = ${attemptId}`,
    );
    await page.reload();
    await expect(page.getByText('Hết giờ. Bài làm đã được lưu.')).toBeVisible({
      timeout: 15_000,
    });
    await shot(page, testInfo, '5-expired');

    await expectNoHorizontalScroll(page);
    expect(consoleErrors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });

  test('17. submit dialog shows the current counts and cancels without a request', async ({
    page,
    baseURL,
  }, testInfo) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    const posts = submitPosts(page);
    await startAttempt(page, baseURL, fixtures);
    await page.getByRole('radio').first().click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã lưu' }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Đánh dấu' }).click();
    const dialog = await openSubmitDialog(page);
    await expect(
      dialog.getByText(
        `Bạn còn ${String(fixtures.questionCount - 1)} câu chưa làm.`,
      ),
    ).toBeVisible();
    await expect(dialog.getByText('1 câu đã đánh dấu.')).toBeVisible();
    await expect(
      dialog.getByText('Sau khi nộp, bạn không thể sửa bài.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Tiếp tục làm' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(posts.count()).toBe(0);
    // F3 (M4.2c): axe must run while the enabled "Nộp bài" is on screen — the
    // old path navigated back to question 1 and hid the panel submit, which is
    // exactly how the 3,22:1 jade-600 background escaped review.
    const panelList = page.getByRole('complementary', {
      name: 'Danh sách câu',
    });
    const panelSubmit = panelList.locator('.uxb-takefoot__submit');
    const navSubmit = page
      .getByRole('navigation', { name: 'Điều hướng câu hỏi' })
      .getByRole('button', { name: 'Nộp bài' });
    if (!(await panelList.isVisible())) {
      await page.getByRole('button', { name: /Mở danh sách câu hỏi/u }).click();
      await expect(panelList).toBeVisible();
    }
    // Which entry carries the submit is a per-breakpoint design rule (Q124), so
    // assert the exact one instead of "either of the two is fine".
    const vw = testInfo.project.use.viewport?.width ?? 0;
    if (vw >= 520 && vw < 1024) {
      // 520–1023: the panel submit is hidden by design; the nav row carries the
      // submit on the last question.
      if (!(await navSubmit.isVisible())) {
        await panelList.getByRole('button', { name: /^Câu /u }).last().click();
      }
      await expect(
        navSubmit,
        'nav submit on the last question (520–1023)',
      ).toBeVisible();
      // axe skips disabled form controls (WCAG 1.4.3 exempts them), so an
      // enabled assertion is what makes the 0-violation result meaningful.
      await expect(navSubmit).toBeEnabled();
    } else {
      await expect(
        panelSubmit,
        'panel submit visible (390 / ≥1024)',
      ).toBeVisible();
      await expect(panelSubmit).toBeEnabled();
    }
    const contrast = await new AxeBuilder({ page })
      .withTags(AXE_TAGS)
      .withRules(['color-contrast'])
      .analyze();
    expect(
      contrast.violations.map((violation) => violation.id),
      'color-contrast with the submit on screen',
    ).toEqual([]);
    // The other rules keep the known-clean question-1 state from the previous
    // round; the F3 assertion above is what proves the submit button is AA.
    await gotoQuestion(page, 1);
    await expectClean(page, 'case-17', consoleErrors, cspConsole);
  });

  test('18. a successful submit locks the screen, keeps one POST and survives reload', async ({
    page,
    baseURL,
  }) => {
    const posts = submitPosts(page);
    await startAttempt(page, baseURL, fixtures);
    await openSubmitDialog(page);
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/submit'),
    );
    await confirmSubmit(page);
    expect((await submitted).status()).toBe(200);
    await expect(
      page.getByRole('alert').getByText('Bài đã được nộp.'),
    ).toBeVisible({
      timeout: 15_000,
    });
    // F1 (M4.2c): after the submit the clock pill is gone and the footer shows
    // the submitted copy instead of "Còn … phút".
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(page.locator('.uxb-fine')).toHaveText('Bài đã được nộp.');
    expect(posts.count()).toBe(1);
    // The submit entry may live on the last question at tablet/mobile widths;
    // go back to the first (mcq) question to assert the inputs are locked.
    await gotoQuestion(page, 1);
    await expect(page.getByRole('radio').first()).toBeDisabled();

    await page.reload();
    await expect(
      page.getByRole('alert').getByText('Bài đã được nộp.'),
    ).toBeVisible({
      timeout: 15_000,
    });
    // F1 (M4.2c): a remounted submitted attempt is just as clock-less.
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(page.locator('.uxb-fine')).toHaveText('Bài đã được nộp.');
    await expect(
      page.getByRole('link', { name: 'Về màn giới thiệu đề' }),
    ).toBeVisible();
    expect(posts.count()).toBe(1);
    await expectNoHorizontalScroll(page);
  });

  test('19. a second tab gets 409 ALREADY_SUBMITTED and shows the submitted banner', async ({
    page,
    baseURL,
    context,
  }) => {
    const consoleErrors = captureConsoleErrors(page);
    await startAttempt(page, baseURL, fixtures);
    const attemptUrl = page.url();
    const other = await context.newPage();
    await other.goto(attemptUrl);
    await expect(other.locator('.ext-question')).toBeVisible();

    await openSubmitDialog(other);
    await confirmSubmit(other);
    await expect(
      other.getByRole('alert').getByText('Bài đã được nộp.'),
    ).toBeVisible({
      timeout: 15_000,
    });

    await openSubmitDialog(page);
    const conflict = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/submit'),
    );
    await confirmSubmit(page);
    expect((await conflict).status()).toBe(409);
    await expect(
      page.getByRole('alert').getByText('Bài đã được nộp.'),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.querySelectorAll('dialog[open]').length,
      ),
    ).toBe(0);
    // The browser logs the deliberate 409 as a console error; that is the
    // expected second-tab outcome, so only unexpected errors fail this test.
    expect(
      consoleErrors.filter((message) => !/409 \(Conflict\)/u.test(message)),
    ).toEqual([]);
    await other.close();
  });

  test('20. submitting with unanswered questions keeps the saved answers after reload (Q130)', async ({
    page,
    baseURL,
  }) => {
    await startAttempt(page, baseURL, fixtures);
    await answerMcq(page, 1);
    const dialog = await openSubmitDialog(page);
    await expect(
      dialog.getByText(
        `Bạn còn ${String(fixtures.questionCount - 1)} câu chưa làm.`,
      ),
    ).toBeVisible();
    await confirmSubmit(page);
    await expect(
      page.getByRole('alert').getByText('Bài đã được nộp.'),
    ).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();
    await expect(
      page.getByRole('link', { name: 'Về màn giới thiệu đề' }),
    ).toBeVisible({ timeout: 15_000 });
    const panel = page.getByRole('complementary', { name: 'Danh sách câu' });
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: /Mở danh sách câu hỏi/u }).click();
    }
    await panel.getByRole('button', { name: /^Câu 1,/u }).click();
    await expect(page.getByRole('radio').first()).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('21. offline submit shows an error and posts nothing; online retry succeeds', async ({
    page,
    baseURL,
    context,
  }) => {
    const posts = submitPosts(page);
    await startAttempt(page, baseURL, fixtures);
    await context.setOffline(true);
    await openSubmitDialog(page);
    await confirmSubmit(page);
    await expect(
      page
        .getByRole('dialog')
        .getByText('Không có kết nối. Kiểm tra mạng rồi thử lại.'),
    ).toBeVisible({ timeout: 15_000 });
    expect(posts.count()).toBe(0);
    await context.setOffline(false);
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/submit'),
    );
    await confirmSubmit(page);
    expect((await submitted).status()).toBe(200);
    await expect(
      page.getByRole('alert').getByText('Bài đã được nộp.'),
    ).toBeVisible({
      timeout: 15_000,
    });
    expect(posts.count()).toBe(1);
  });

  test('22. an expired attempt refuses the submit with the Q127 copy and posts once', async ({
    page,
    baseURL,
  }) => {
    const posts = submitPosts(page);
    await startAttempt(page, baseURL, fixtures);
    const attemptId = page.url().match(/attempts\/(\d+)/u)?.[1] ?? '';
    expect(attemptId).not.toBe('');
    await openSubmitDialog(page);
    // The constraint requires expiresAt > startedAt, and the submit path only
    // times out beyond the 5 s save grace.
    queryDisposableDb(
      `UPDATE "ExamAttempt" SET "startedAt" = (now() at time zone 'utc' - interval '91 minutes'), "expiresAt" = (now() at time zone 'utc' - interval '10 seconds') WHERE id = ${Number(attemptId)}`,
    );
    await confirmSubmit(page);
    await expect(page.getByText('Hết giờ. Bài làm đã được lưu.')).toBeVisible({
      timeout: 15_000,
    });
    expect(posts.count()).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('23. the submit response and rendered HTML/RSC carry no forbidden key', async ({
    page,
    baseURL,
  }) => {
    await startAttempt(page, baseURL, fixtures);
    await openSubmitDialog(page);
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/submit'),
    );
    await confirmSubmit(page);
    const response = await submitted;
    expect(response.status()).toBe(200);
    const responseText = await textWithin(response);
    await expect(
      page.getByRole('alert').getByText('Bài đã được nộp.'),
    ).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    await expect(
      page.getByRole('alert').getByText('Bài đã được nộp.'),
    ).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForLoadState('networkidle');
    // Next embeds the RSC stream in script tags of the server-rendered
    // document, so the reloaded HTML covers both the HTML and RSC payload.
    const html = await page.content();
    const scanned = [html, responseText].join('\n');
    expect(scanned.length).toBeGreaterThan(1_000);
    const leaked = [...FORBIDDEN_KEYS].filter((key) => scanned.includes(key));
    expect(leaked, 'key cấm rò rỉ').toEqual([]);
  });

  test('24. @shots submit dialog and submitted banner for the TL review', async ({
    page,
    baseURL,
  }, testInfo) => {
    const posts = submitPosts(page);
    await startAttempt(page, baseURL, fixtures);
    await openSubmitDialog(page);
    await audit(page, 'shots-submit-dialog');
    await shot(page, testInfo, '24-submit-dialog');
    await confirmSubmit(page);
    await expect(
      page.getByRole('alert').getByText('Bài đã được nộp.'),
    ).toBeVisible({
      timeout: 15_000,
    });
    // F1 (M4.2c): the shot must show the submitted state — no timer pill and
    // the footer copy swapped to the submitted message.
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(page.locator('.uxb-fine')).toHaveText('Bài đã được nộp.');
    await page.waitForLoadState('networkidle');
    await shot(page, testInfo, '24-submitted');
    await expectNoHorizontalScroll(page);
    expect(posts.count()).toBe(1);
  });

  test('25. pre-submit review: pick a question, answer it, counts update, submit reaches the result', async ({
    page,
    baseURL,
  }, testInfo) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    const posts = submitPosts(page);
    await startAttempt(page, baseURL, fixtures);

    const review = await openReview(page);
    const summary = page.getByRole('list', { name: 'Tổng quan bài làm' });
    const countOf = (label: string) =>
      summary.locator('li').filter({ hasText: label }).locator('b');

    // Q225: dòng mẹo nói "quay lại câu", màn xem lại không hứa đáp án.
    await expect(
      review.getByText('Nhấn số câu để quay lại câu đó.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Đáp án đúng')).toHaveCount(0);
    await expect(countOf('Đã trả lời')).toHaveText('0');
    await expect(countOf('Chưa trả lời')).toHaveText(
      String(fixtures.questionCount),
    );
    await expect(countOf('Đánh dấu')).toHaveText('0');

    // Bàn phím: heading nhận focus, Tab tới ô đầu, Escape quay lại câu đang làm.
    await expect(
      page.getByRole('heading', { name: 'Chọn câu hỏi để xem lại' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      review.getByRole('button', { name: 'Câu 1, chưa trả lời' }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(review).toHaveCount(0);
    await expect(page.locator('#q-part')).toBeFocused();

    const reviewAgain = await openReview(page);
    await expectClean(page, 'review-mode', consoleErrors, cspConsole);
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, '25-review', { css: true });
    await measureReview(page, testInfo);
    // SKILL §7: selector mới (.extr-cell/.extr-grid) phải khớp phần tử thật —
    // ô chưa trả lời viền nét đứt, ô đã trả lời nền jade-700 sau khi trả lời.
    await expect(
      reviewAgain.getByRole('button', { name: 'Câu 1, chưa trả lời' }),
    ).toHaveCSS('border-style', 'dashed');
    await expect(reviewAgain.locator('.extr-grid').first()).toHaveCSS(
      'display',
      'grid',
    );

    // Q225: nhấn số câu chưa trả lời → về đúng câu đó, focus vào câu.
    await reviewAgain
      .getByRole('button', { name: 'Câu 5, chưa trả lời' })
      .click();
    await expect(page.getByTestId('exam-count-live')).toHaveText(
      `Câu 5 trên ${String(fixtures.questionCount)}`,
    );
    await expect(page.locator('#q-part')).toBeFocused();

    // Trả lời câu 5 (listening mcq) → quay lại màn xem lại thấy đếm đổi.
    await page.getByRole('radio').first().click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã lưu' }),
    ).toBeVisible();
    const reviewAfter = await openReview(page);
    await expect(countOf('Đã trả lời')).toHaveText('1');
    await expect(countOf('Chưa trả lời')).toHaveText(
      String(fixtures.questionCount - 1),
    );
    await expect(
      reviewAfter.getByRole('button', { name: 'Câu 5, đã trả lời' }),
    ).toBeVisible();
    await expect(
      reviewAfter.getByRole('button', { name: 'Câu 5, đã trả lời' }),
    ).toHaveCSS('background-color', 'rgb(2, 142, 106)');

    // Nộp bài từ màn xem lại dùng đúng dialog sẵn có rồi sang màn kết quả.
    await reviewAfter.getByRole('button', { name: 'Nộp bài' }).click();
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Nộp bài?' }),
    ).toBeVisible();
    await confirmSubmit(page);
    await expect(
      page.getByRole('alert').getByText('Bài đã được nộp.'),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Xem kết quả' }).click();
    await page.waitForURL(/\/learn\/exam\/attempts\/\d+\/result$/u);
    await expect(
      page.getByRole('heading', { name: 'Kết quả bài thi' }),
    ).toBeVisible();
    expect(posts.count()).toBe(1);
  });
});
