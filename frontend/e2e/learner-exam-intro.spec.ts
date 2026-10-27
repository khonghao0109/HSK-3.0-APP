import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';

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

// M4.2a (TL-120): the exam intro page (WB-10b / MB-10) on the real backend.
// Data comes from the disposable e2e DB through the Admin CMS; there is no
// SQL fixture here.

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const TITLE = 'Giới thiệu đề · Hán Lộ';
// Canvas/bar colours measured from the mockup (tokens: --cream-50,
// --cream-100, --navy-900) — compared as computed rgb strings.
const CANVAS_CREAM_50 = 'rgb(254, 250, 242)';
const CANVAS_CREAM_100 = 'rgb(248, 242, 230)';
const BAR_NAVY_900 = 'rgb(11, 28, 70)';
const START_UNAVAILABLE =
  'Đề thi tạm thời không làm được. Vui lòng thử lại sau.';

/** Axe plus page-level checks, as soft assertions so every state runs. */
async function audit(page: Page, state: string, title = TITLE): Promise<void> {
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
  expect.soft(await page.title(), `title ${state}`).toBe(title);
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
): Promise<void> {
  // The sticky focus bar stays at the top of a full-page shot only when the
  // page is scrolled back to the top first.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath(`exam-intro-${state}.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}

test.describe('Learner exam intro (M4.2a / TL-120)', () => {
  let fixtures: ExamIntroFixture;

  test.beforeAll(async ({ browser }, testInfo) => {
    // Playwright requires the destructuring pattern; beforeAll needs no page.
    void browser;
    fixtures = await seedExamIntroFixtures(
      `${testInfo.project.name}-${String(Date.now())}`,
    );
  });

  test('1. intro shows the structure, the rules and a clean a11y audit', async ({
    page,
    baseURL,
  }, testInfo) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/exam/${String(fixtures.publishedTestId)}`);

    await expect(page).toHaveTitle(TITLE);
    // Exactly one visible h1 per viewport; the title of the test is an h2.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Giới thiệu đề',
    );
    await expect(
      page.getByRole('heading', { level: 2, name: fixtures.title }),
    ).toBeVisible();
    await expect(
      page.getByText('Làm hết các phần trong 80 phút.'),
    ).toBeVisible();

    const meta = page.locator('.exi-meta');
    await expect(meta).toContainText(`${String(fixtures.questionCount)} câu`);
    await expect(meta).toContainText(
      `${String(fixtures.durationMinutes)} phút`,
    );
    await expect(meta).toContainText(`${String(fixtures.sectionCount)} phần`);

    const isWeb = (page.viewportSize()?.width ?? 0) >= 1024;
    if (isWeb) {
      const table = page.getByRole('table');
      await expect(table).toBeVisible();
      const headers = table.getByRole('columnheader');
      await expect(headers).toHaveCount(4);
      for (const header of ['Phần', 'Nội dung', 'Số câu', 'Điểm']) {
        await expect(
          table.getByRole('columnheader', { name: header }),
        ).toBeVisible();
      }
      await expect(table).not.toContainText('Thời gian');
      await expect(table).toContainText('Đọc hiểu');
      await expect(table).toContainText('Viết câu');
      await expect(table).toContainText('Tổng cộng');
      // W8: the cells carry bare numbers; the header owns the unit.
      // Seeded structure: "Đọc hiểu" has 2 questions, "Viết câu" has 1; a
      // section is worth maxScore / sectionCount (Q118).
      const sectionScore = String(fixtures.maxScore / fixtures.sectionCount);
      const sectionRows = table.locator('tbody tr');
      await expect(sectionRows).toHaveCount(fixtures.sectionCount + 1);
      await expect(sectionRows.nth(0).locator('td').nth(2)).toHaveText('2');
      await expect(sectionRows.nth(0).locator('td').nth(3)).toHaveText(
        sectionScore,
      );
      await expect(sectionRows.nth(1).locator('td').nth(2)).toHaveText('1');
      await expect(sectionRows.nth(1).locator('td').nth(3)).toHaveText(
        sectionScore,
      );
      // The total row spans the first two columns, so its cells are
      // [label, questionCount, maxScore].
      const totalRow = sectionRows.last();
      await expect(totalRow.locator('td').nth(0)).toHaveText('Tổng cộng');
      await expect(totalRow.locator('td').nth(1)).toHaveText(
        String(fixtures.questionCount),
      );
      await expect(totalRow.locator('td').nth(2)).toHaveText(
        String(fixtures.maxScore),
      );
      await expect(
        page.getByText(
          `Điểm đạt: ${String(fixtures.passScore)}/${String(fixtures.maxScore)}`,
        ),
      ).toBeVisible();
    } else {
      const parts = page.getByTestId('exam-parts-list');
      await expect(parts).toBeVisible();
      await expect(parts).toContainText('Đọc hiểu');
      await expect(parts).toContainText('Viết câu');
      await expect(parts).toContainText('2 câu · Đọc');
      await expect(parts).toContainText('1 câu · Viết');
      await expect(parts).toContainText(
        `${String(fixtures.maxScore / fixtures.sectionCount)} điểm`,
      );
      await expect(parts).toContainText(
        `${String(fixtures.questionCount)} câu · ${String(fixtures.durationMinutes)} phút`,
      );
      await expect(page.getByRole('table')).toBeHidden();
    }

    const rules = page.getByRole('list', { name: 'Quy định khi thi' });
    await expect(rules.getByRole('listitem')).toHaveCount(3);
    await expect(rules).toContainText('Bài làm được lưu tự động sau mỗi câu.');
    await expect(rules).toContainText(
      'Hết giờ hệ thống tự nộp bài, kể cả khi bạn chưa làm hết câu.',
    );
    await expect(rules).toContainText(
      'Kết quả và giải thích chi tiết có sau khi nộp bài.',
    );
    await expect(
      page.getByRole('button', { name: 'Bắt đầu thi' }),
    ).toBeVisible();
    await expect(page.getByText('Bài đang làm')).toHaveCount(0);

    // The mockup frames, measured on the running app (vòng sửa UI 1):
    // web = cream-100 canvas + one 760px column with a serif h2; mobile =
    // cream-50 canvas with the navy bar and a sans h1.
    const canvas = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector<HTMLElement>('.app')!)
          .backgroundColor,
    );
    // The bar h1 is the sans face (the global h1 rule is serif).
    const barFont = await page
      .locator('h1:visible')
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(barFont).not.toMatch(/Serif/u);
    if (isWeb) {
      expect(canvas).toBe(CANVAS_CREAM_100);
      const cardBox = await page
        .locator('.exi-panel')
        .first()
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, x: rect.x };
        });
      // W5: card is exactly the 760px column of the mockup, centred (x=340 at
      // 1440, x=132 at 1024).
      expect(cardBox.width).toBeCloseTo(760, 0);
      const viewportWidth = page.viewportSize()?.width ?? 0;
      expect(cardBox.x).toBeCloseTo((viewportWidth - 760) / 2, 0);
      // W7: rules read at body size on web.
      expect(
        await page
          .locator('.exi-rules li')
          .first()
          .evaluate((element) => getComputedStyle(element).fontSize),
      ).toBe('15px');
      expect(
        await page
          .locator('.exi-title')
          .evaluate((element) => getComputedStyle(element).fontFamily),
      ).toMatch(/Noto Serif/u);
    } else {
      expect(canvas).toBe(CANVAS_CREAM_50);
      expect(
        await page
          .locator('.exi-mbar')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      ).toBe(BAR_NAVY_900);
    }

    await shot(page, testInfo, 'before');
    await expectNoHorizontalScroll(page);
    await audit(page, 'before');
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('2. starts the attempt and keeps the card after a reload', async ({
    page,
    baseURL,
  }, testInfo) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    const email = await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/exam/${String(fixtures.publishedTestId)}`);

    await page.getByRole('button', { name: 'Bắt đầu thi' }).click();
    await expect(page.getByText('Bài đang làm')).toBeVisible();
    await expect(
      page.getByText(
        new RegExp(
          `Đã làm 0/${String(fixtures.questionCount)} câu · hết giờ lúc \\d{2}:\\d{2}`,
          'u',
        ),
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bắt đầu thi' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Làm tiếp' })).toBeVisible();
    await shot(page, testInfo, 'in-progress');

    await page.reload();
    await expect(page.getByText('Bài đang làm')).toBeVisible();
    await expect(page.getByText('Bắt đầu thi')).toHaveCount(0);

    const api = await playwrightRequest.newContext();
    try {
      const token = await backendLogin(api, email, PASSWORD);
      const intro = await call<{
        activeAttempt: { id: number } | null;
      }>(api, 'GET', `/exam/tests/${String(fixtures.publishedTestId)}`, token);
      expect(intro.activeAttempt).not.toBeNull();
    } finally {
      await api.dispose();
    }

    // Vòng UI 2 (M5–M7): mockup mobile rhythm and the resume card without an
    // icon; web keeps the icon layout.
    const isWeb = (page.viewportSize()?.width ?? 0) >= 1024;
    if (!isWeb) {
      // M5: the parts list is a grid with the panel's --sp-3 rhythm, and the
      // 2nd row keeps the mockup's padding-top + hairline; the top-to-top
      // pitch is the measured 52.5px (row 40.5 + 12 gap + 12 padding + 1px).
      expect(
        await page
          .locator('.exi-parts')
          .evaluate((element) => getComputedStyle(element).rowGap),
      ).toBe('12px');
      const partRow = await page
        .locator('.exi-part')
        .nth(1)
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            paddingTop: style.paddingTop,
            borderTop: style.borderTopWidth,
          };
        });
      expect(partRow.paddingTop).toBe('12px');
      expect(partRow.borderTop).toBe('1px');
      const partPitch = await page.locator('.exi-part').evaluateAll((rows) => {
        const first = rows[0]?.getBoundingClientRect();
        const second = rows[1]?.getBoundingClientRect();
        return first && second ? second.top - first.top : null;
      });
      // Mockup MB-10 at 390: top-to-top = 52.5px.
      expect(partPitch).toBeCloseTo(52.5, 1);
      // M6: 30px back icon, 1.7 stroke, button nudged -2px (m04.css), while
      // the `.icon-btn` touch box stays ≥44px.
      const backIcon = await page
        .locator('.exi-mbar .icon-btn .icon')
        .evaluate((element) => ({
          width: element.getBoundingClientRect().width,
          stroke: getComputedStyle(element).strokeWidth,
        }));
      expect(backIcon.width).toBeCloseTo(30, 1);
      expect(backIcon.stroke).toBe('1.7px');
      const backButton = await page
        .locator('.exi-mbar .icon-btn')
        .evaluate((element) => ({
          marginLeft: getComputedStyle(element).marginLeft,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        }));
      expect(backButton.marginLeft).toBe('-2px');
      expect(backButton.width).toBeGreaterThanOrEqual(44);
      expect(backButton.height).toBeGreaterThanOrEqual(44);
      // M7: the in-progress card has no icon square on mobile.
      expect(
        await page
          .locator('.exi-resume__ico')
          .evaluate((element) => getComputedStyle(element).display),
      ).toBe('none');
    } else {
      expect(
        await page
          .locator('.exi-resume__ico')
          .evaluate((element) => getComputedStyle(element).display),
      ).not.toBe('none');
    }

    await expectNoHorizontalScroll(page);
    await audit(page, 'in-progress');
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('3. draft and unknown tests render the not-found page', async ({
    page,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await registerReadyLearner(page, baseURL);
    for (const testId of [fixtures.draftTestId, 2_147_483_647]) {
      const response = await page.goto(`/learn/exam/${String(testId)}`);
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Không tìm thấy đề thi' }),
      ).toBeVisible();
      await expect(
        page.getByText('Đề thi này không tồn tại hoặc chưa mở.'),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Về trang học' }),
      ).toBeVisible();
      await audit(page, 'not-found');
      await expectNoHorizontalScroll(page);
      expect(await readCspViolations(page)).toEqual([]);
    }
    expect(cspConsole).toEqual([]);
    // The browser logs the document's own 404 as a resource error; anything
    // else on the console is a real problem.
    const unexpectedConsole = consoleErrors.filter(
      (message) => !/status of 404 \(Not Found\)/u.test(message),
    );
    expect(unexpectedConsole).toEqual([]);
  });

  test('4. sends an anonymous learner to sign-in', async ({ page }) => {
    await page.goto(`/learn/exam/${String(fixtures.publishedTestId)}`);
    await expect(page).toHaveURL(/\/sign-in$/u);
  });

  test('5. explains an unavailable test on a 409 answer', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.route('**/api/learner/exam/tests/*/attempts', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: {
            kind: 'conflict',
            message: 'conflict',
            code: 'EXAM_TEST_UNAVAILABLE',
          },
        }),
      }),
    );
    await page.goto(`/learn/exam/${String(fixtures.publishedTestId)}`);

    const start = page.getByRole('button', { name: 'Bắt đầu thi' });
    await start.click();
    await expect(page.locator('.toast-region .toast')).toHaveText(
      START_UNAVAILABLE,
    );
    await expect(start).toBeEnabled();
    await expect(page.getByText('Bài đang làm')).toHaveCount(0);
  });

  test('6. rejects a BFF start without an origin header', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const response = await page
      .context()
      .request.post(
        `/api/learner/exam/tests/${String(fixtures.publishedTestId)}/attempts`,
        {
          headers: { 'content-type': 'application/json' },
          data: { idempotencyKey: randomUUID() },
        },
      );
    expect(response.status()).toBe(403);
  });
});
