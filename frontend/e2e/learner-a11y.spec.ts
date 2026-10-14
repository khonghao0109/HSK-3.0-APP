import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  request as playwrightRequest,
  test,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';
import {
  BACKEND,
  backendLogin,
  call,
  LISTENING_PROMPT,
  PASSWORD,
  publishLockedLesson,
  publishPracticeExercises,
  readyLessonId,
  registerReadyLearner,
} from './support/learner-fixtures';

// M2.7e: axe (WCAG 2.1 AA) on every learner route and state, a keyboard-only
// run through the core loop, and the loading / empty / error / offline
// states. Data comes from the disposable e2e DB; page.route only fakes a
// slow, failing or offline BFF call.

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** document.title of each route; distinct across routes (WCAG 2.4.2). */
const TITLES = {
  welcome: 'Hán Lộ — Con đường chinh phục tiếng Trung',
  signIn: 'Đăng nhập · Hán Lộ',
  signUp: 'Tạo tài khoản · Hán Lộ',
  forgot: 'Quên mật khẩu · Hán Lộ',
  reset: 'Đặt lại mật khẩu · Hán Lộ',
  verify: 'Xác thực email · Hán Lộ',
  privacy: 'Chính sách bảo mật · Hán Lộ',
  terms: 'Điều khoản sử dụng · Hán Lộ',
  goal: 'Mục tiêu học tập · Hán Lộ',
  plan: 'Kế hoạch học mỗi ngày · Hán Lộ',
  home: 'Trang chủ · Hán Lộ',
  path: 'Lộ trình học · Hán Lộ',
  profile: 'Hồ sơ · Hán Lộ',
  dictionary: 'Từ điển · Hán Lộ',
  word: 'Chi tiết từ vựng · Hán Lộ',
  lesson: 'Bài học · Hán Lộ',
  practice: 'Luyện tập · Hán Lộ',
  complete: 'Hoàn thành bài học · Hán Lộ',
} as const;

// A word of its own, so the dictionary spec's fixture stays untouched.
const WORD = { hanzi: '无障碍测试', pinyin: 'wu2 zhang4 ai4 ce4 shi4' };
const TOKEN = 'a'.repeat(43);
const GENERIC_ERROR = 'Không thực hiện được lúc này. Vui lòng thử lại.';

function wordId(): number {
  const read = () =>
    queryDisposableDb(
      `SELECT id FROM "Word" WHERE hanzi = ${sqlLiteral(WORD.hanzi)}`,
    );
  if (!read()) {
    queryDisposableDb(`WITH w AS (
        INSERT INTO "Word" (hanzi, pinyin, "pinyinNormalized", "pinyinTone", example, status, "isPure", "publishedAt", "updatedAt")
        VALUES (${sqlLiteral(WORD.hanzi)}, ${sqlLiteral(WORD.pinyin)}, 'wu zhang ai ce shi', 'wúzhàng ài cèshì',
          '这是无障碍测试。', 'published'::"ContentStatus", true, now(), now())
        RETURNING id),
      m AS (INSERT INTO "WordMeaning" ("wordId", "meaningOrder", "meaningVi", "meaningEn", "meaningViNormalized", "meaningEnNormalized", "updatedAt")
        SELECT id, 1, 'kiểm thử tiếp cận', 'accessibility probe', 'kiem thu tiep can', 'accessibility probe', now() FROM w),
      l AS (INSERT INTO "WordLevel" ("wordId", "levelId") SELECT w.id, lv.id FROM w, "Level" lv WHERE lv.code = 'HSK1')
      SELECT id FROM w;`);
  }
  const id = Number(read());
  if (!id) throw new Error('a11y fixture word missing');
  return id;
}

/** Axe plus the page-level checks, as soft assertions so every state runs. */
async function audit(page: Page, state: string, title: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  // Axe reads colours mid fade-in (toast-in, ex-pop) as low contrast; wait
  // for the finite animations (the confetti float loops forever).
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
  // M2.10b: Tra từ carries an app-bar h1 (mobile) and a page-head h1 (web);
  // exactly one of them is rendered per viewport, so count the visible one.
  expect.soft(await page.locator('h1:visible').count(), `h1 ${state}`).toBe(1);
  expect.soft(await page.locator('main').count(), `main ${state}`).toBe(1);
  expect.soft(await page.title(), `title ${state}`).toBe(title);
}

/** A BFF call held for 1.5 s, then passed on. */
async function slow(page: Page, url: string): Promise<void> {
  await page.route(url, async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue().catch(() => undefined);
  });
}

async function fail(page: Page, url: string, status = 503): Promise<void> {
  await page.route(url, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'unavailable' },
      }),
    }),
  );
}

/** While a request is held: a busy region or a status text, no alert. */
async function expectBusy(page: Page, state: string): Promise<void> {
  await expect
    .soft(
      page.locator('[aria-busy="true"], [role="status"]:not(:empty)'),
      `busy ${state}`,
    )
    .not.toHaveCount(0, { timeout: 1000 });
  await expect
    .soft(page.locator('[role="alert"]:visible:not(:empty)'), `alert ${state}`)
    .toHaveCount(0);
}

/** The message is shown, inside role="alert", in plain Vietnamese. */
async function expectAlert(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible();
  await expect
    .soft(page.getByRole('alert').filter({ hasText: text }), `alert: ${text}`)
    .toBeVisible({ timeout: 1000 });
  const shown = await page.getByRole('alert').allInnerTexts();
  for (const message of shown) {
    expect(message).not.toMatch(/[A-Z_]{6,}|Error|HTTP \d|at \w+ \(/u);
  }
}

async function signedOutPage(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/** Registers a learner who has not done onboarding (cookies on the page). */
async function registerNewLearner(
  page: Page,
  baseURL: string | undefined,
): Promise<void> {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:3200').origin;
  const response = await page.request.post('/api/learner/session/register', {
    headers: { origin, 'content-type': 'application/json' },
    data: {
      email: `learner.a11y.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`,
      password: PASSWORD,
    },
  });
  expect(response.status()).toBe(201);
}

async function exerciseCount(lessonId: number): Promise<number> {
  const api = await playwrightRequest.newContext();
  try {
    const detail = await call<{ exercises: unknown[] }>(
      api,
      'GET',
      `/learning/lessons/${lessonId}`,
    );
    return detail.exercises.length;
  } finally {
    await api.dispose();
  }
}

/** Answers the HSK 3 arrange and fill_blank items (mouse, not E3). */
async function reachListening(page: Page, lessonId: number): Promise<void> {
  await page.goto(`/learn/lessons/${lessonId}/practice`);
  for (const word of ['我', '想', '买']) {
    await page.getByRole('button', { name: `Thêm ${word}` }).click();
  }
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.getByLabel('Câu trả lời của bạn').fill('买');
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(
    page.getByRole('radiogroup', { name: LISTENING_PROMPT }),
  ).toBeVisible();
}

// ---------- E3 helpers: keyboard only ----------

type FocusInfo = {
  desc: string;
  inView: boolean;
  ring: boolean;
} | null;

async function focusInfo(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const label = el.getAttribute('aria-label');
    return {
      desc: `${el.tagName.toLowerCase()}${label ? `[${label}]` : ''} ${(el.textContent ?? '').trim().slice(0, 40)}`,
      inView:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth,
      // A 3px spread ring (Q12 jade-700; white on the jade app bar), also
      // inset, or an outline in forced colors.
      ring:
        /0px 0px 0px [2-9](?:\.\d+)?px/u.test(style.boxShadow) ||
        (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0),
    };
  });
}

/** Presses `key` until `target` has focus; every stop must show its ring. */
async function tabTo(
  page: Page,
  target: Locator,
  key: 'Tab' | 'Shift+Tab' = 'Tab',
): Promise<void> {
  for (let presses = 0; presses < 60; presses += 1) {
    await page.keyboard.press(key);
    const info = await focusInfo(page);
    if (info) {
      expect.soft(info.inView, `in view: ${info.desc}`).toBe(true);
      // The ring may still be in its 150 ms transition.
      await expect.soft
        .poll(
          async () => (await focusInfo(page))?.ring,
          `focus ring: ${info.desc}`,
        )
        .toBe(true);
    }
    // evaluateAll does not wait for a missing target, so a trap fails fast.
    if (
      await target.evaluateAll((els) =>
        els.some((el) => el === document.activeElement),
      )
    ) {
      return;
    }
  }
  throw new Error(`focus never reached ${String(target)} (trap or missing)`);
}

async function pressOn(
  page: Page,
  target: Locator,
  key = 'Enter',
): Promise<void> {
  await tabTo(page, target);
  await page.keyboard.press(key);
}

/** Focus on a radio of the group, then arrows until `name` is checked. */
async function chooseRadio(
  page: Page,
  group: Locator,
  name: string | null,
): Promise<void> {
  const radios = group.getByRole('radio');
  await tabTo(page, group.locator('[role="radio"][tabindex="0"]'));
  if (name === null) {
    await page.keyboard.press('Space');
    return;
  }
  const count = await radios.count();
  for (let step = 0; step <= count; step += 1) {
    const focused = group.locator('[role="radio"]:focus');
    if ((await focused.innerText()).trim() === name) {
      await page.keyboard.press('Space');
      await expect(group.getByRole('radio', { name })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      return;
    }
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`radio ${name} not found`);
}

/** Answers the current choice item with Kiểm tra, then Tiếp tục. */
async function answerChoice(
  page: Page,
  group: Locator,
  name: string | null,
): Promise<void> {
  await chooseRadio(page, group, name);
  await pressOn(page, page.getByRole('button', { name: 'Kiểm tra' }));
  const next = page.getByRole('button', { name: 'Tiếp tục' });
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
}

test.describe('Learner accessibility (M2.7e)', () => {
  let hsk1Lesson = 0;
  let hsk3Lesson = 0;
  let lockedLesson = 0;
  let word = 0;

  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    const hsk1 = await readyLessonId('HSK1');
    if (!hsk1) throw new Error('seed has no ready HSK1 lesson');
    hsk1Lesson = hsk1;
    hsk3Lesson = await publishPracticeExercises();
    lockedLesson = await publishLockedLesson();
    word = wordId();
  });

  test('titles are distinct per route', () => {
    const titles = Object.values(TITLES);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('axe: welcome, sign-in, sign-up, privacy, terms', async ({ page }) => {
    await signedOutPage(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Bắt đầu học' })).toBeVisible();
    await audit(page, 'welcome', TITLES.welcome);

    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
    await audit(page, 'sign-in', TITLES.signIn);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Vui lòng nhập email hợp lệ.' }),
    ).toBeVisible();
    await audit(page, 'sign-in invalid email', TITLES.signIn);
    await page.route('**/api/learner/session/login', (route) =>
      route.fulfill({ status: 401, body: '{}' }),
    );
    await page.getByLabel('Email').fill('a11y@example.test');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Email hoặc mật khẩu không đúng.' }),
    ).toBeVisible();
    await audit(page, 'sign-in 401', TITLES.signIn);

    await page.goto('/sign-up');
    await expect(
      page.getByRole('button', { name: 'Tạo tài khoản' }),
    ).toBeVisible();
    await audit(page, 'sign-up', TITLES.signUp);
    await page.route('**/api/learner/session/register', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: '{"success":false,"error":{"code":"EMAIL_ALREADY_EXISTS"}}',
      }),
    );
    await page.getByLabel('Email').fill('a11y@example.test');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Email này đã được đăng ký.' }),
    ).toBeVisible();
    await audit(page, 'sign-up 409', TITLES.signUp);

    for (const [path, title, heading] of [
      ['/privacy', TITLES.privacy, 'Chính sách bảo mật'],
      ['/terms', TITLES.terms, 'Điều khoản sử dụng'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await audit(page, path, title);
    }
  });

  test('axe: forgot, reset and verify password and email', async ({ page }) => {
    await signedOutPage(page);
    await page.goto('/forgot-password');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Quên mật khẩu' }),
    ).toBeVisible();
    await audit(page, 'forgot form', TITLES.forgot);
    await page.route('**/api/learner/password-reset/request', (route) =>
      route.fulfill({ status: 204 }),
    );
    await page.getByLabel('Email').fill('a11y@example.test');
    await page.getByRole('button', { name: 'Gửi liên kết' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Kiểm tra email của bạn' }),
    ).toBeVisible();
    await audit(page, 'forgot sent', TITLES.forgot);

    await page.goto('/reset-password');
    await expect(
      page.getByRole('heading', { name: 'Liên kết không còn hiệu lực' }),
    ).toBeVisible();
    await audit(page, 'reset no token', TITLES.reset);
    await page.goto(`/reset-password#token=${TOKEN}`);
    await expect(
      page.getByRole('heading', { name: 'Đặt mật khẩu mới' }),
    ).toBeVisible();
    await audit(page, 'reset form', TITLES.reset);
    await page.route('**/api/learner/password-reset/confirm', (route) =>
      route.fulfill({ status: 204 }),
    );
    await page.getByLabel('Mật khẩu mới').fill(PASSWORD);
    await page.getByRole('button', { name: 'Đặt lại mật khẩu' }).click();
    await expect(
      page.getByRole('heading', { name: 'Đã đặt lại mật khẩu' }),
    ).toBeVisible();
    await audit(page, 'reset done', TITLES.reset);

    await page.goto('/verify-email');
    await expect(
      page.getByRole('heading', { name: 'Liên kết không còn hiệu lực' }),
    ).toBeVisible();
    await audit(page, 'verify no token', TITLES.verify);
    await page.goto(`/verify-email#token=${TOKEN}`);
    await expect(
      page.getByRole('button', { name: 'Xác thực email' }),
    ).toBeVisible();
    await audit(page, 'verify confirm', TITLES.verify);
    await page.route('**/api/learner/email-verification/confirm', (route) =>
      route.fulfill({ status: 204 }),
    );
    await page.getByRole('button', { name: 'Xác thực email' }).click();
    await expect(
      page.getByRole('heading', { name: 'Email đã được xác thực' }),
    ).toBeVisible();
    await audit(page, 'verify done', TITLES.verify);
  });

  test('axe: onboarding goal and plan', async ({ page, baseURL }) => {
    await registerNewLearner(page, baseURL);
    await page.goto('/onboarding/goal');
    await expect(
      page.getByRole('heading', { name: 'Mục tiêu học tập của bạn là gì?' }),
    ).toBeVisible();
    await audit(page, 'goal', TITLES.goal);
    await page
      .getByRole('radiogroup', { name: 'Cấp độ HSK mục tiêu' })
      .getByRole('radio', { name: '5' })
      .click();
    await expect(page.getByText('HSK 5 chưa mở.')).toBeVisible();
    await audit(page, 'goal level unavailable', TITLES.goal);
    await page.goto(
      '/onboarding/goal?purpose=communication&band=2&notice=content_unavailable',
    );
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Cấp độ bạn chọn hiện chưa có bài học.' }),
    ).toBeVisible();
    await audit(page, 'goal content unavailable', TITLES.goal);

    await page.goto('/onboarding/plan?purpose=hsk_exam&band=1');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Bạn muốn học mỗi ngày',
    );
    await audit(page, 'plan', TITLES.plan);
    await fail(page, '**/api/learner/onboarding/complete');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expectAlert(page, GENERIC_ERROR);
    await audit(page, 'plan 503', TITLES.plan);
  });

  test('axe: home, path, profile', async ({ page, baseURL }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn');
    await expect(page.getByRole('heading', { name: 'Khám phá' })).toBeVisible();
    await audit(page, 'home', TITLES.home);
    await page.getByRole('button', { name: 'Thông báo' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Thông báo sẽ có khi tính năng ra mắt.',
    );
    await audit(page, 'home toast', TITLES.home);

    await page.goto('/learn/path');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Lộ trình HSK 1',
    );
    await audit(page, 'path', TITLES.path);
    await page.getByRole('tab', { name: 'HSK 2' }).click();
    await expect(
      page.getByText('HSK 2 chưa mở.', { exact: true }),
    ).toBeVisible();
    await audit(page, 'path empty level', TITLES.path);

    await page.goto('/learn/profile');
    await expect(page.getByRole('heading', { name: 'Hồ sơ' })).toBeVisible();
    await audit(page, 'profile', TITLES.profile);
    await fail(page, '**/api/learner/session/logout', 500);
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expectAlert(page, GENERIC_ERROR);
    await audit(page, 'profile logout 500', TITLES.profile);
  });

  test('axe: lesson, locked lesson, not found', async ({ page, baseURL }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${hsk1Lesson}`);
    await expect(page.getByText('Nội dung bài học')).toBeVisible();
    await audit(page, 'lesson', TITLES.lesson);
    await page.goto(`/learn/lessons/${lockedLesson}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Bài khoá e2e' }),
    ).toBeVisible();
    await audit(page, 'lesson locked', TITLES.lesson);
    for (const id of ['99999999', 'abc']) {
      await page.goto(`/learn/lessons/${id}`);
      await expect(
        page.getByRole('heading', { name: 'Không tìm thấy bài học' }),
      ).toBeVisible();
      await audit(page, `lesson 404 ${id}`, TITLES.lesson);
    }
  });

  test('axe: practice mcq, right, wrong, listening, complete', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const total = await exerciseCount(hsk1Lesson);
    await page.goto(`/learn/lessons/${hsk1Lesson}/practice`);
    const mcq = page.getByRole('radiogroup', {
      name: 'Choose the meaning of 你好',
    });
    await expect(mcq).toBeVisible();
    await audit(page, 'practice mcq', TITLES.practice);
    await mcq.getByRole('radio', { name: 'Hello' }).click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.getByText('Chính xác!', { exact: true })).toBeVisible();
    await audit(page, 'practice right', TITLES.practice);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    for (let item = 1; item < total; item += 1) {
      await page.getByRole('radio').first().click();
      await page.getByRole('button', { name: 'Kiểm tra' }).click();
      await page.getByRole('button', { name: 'Tiếp tục' }).click();
    }
    await expect(page).toHaveURL(/\/complete$/u);
    await expect(
      page.getByText('Chúc mừng! Bạn đã hoàn thành bài học'),
    ).toBeVisible();
    await audit(page, 'complete', TITLES.complete);

    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${hsk1Lesson}/practice`);
    await mcq.getByRole('radio', { name: 'Thank you' }).click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.getByText('Chưa đúng', { exact: true })).toBeVisible();
    await audit(page, 'practice wrong', TITLES.practice);

    await reachListening(page, hsk3Lesson);
    await audit(page, 'practice listening', TITLES.practice);
  });

  test('axe: practice start, submit and finish errors', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await fail(page, '**/api/learner/lessons/*/start');
    await page.goto(`/learn/lessons/${hsk1Lesson}/practice`);
    await expectAlert(page, 'Chưa mở được bài luyện tập. Vui lòng thử lại.');
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    await audit(page, 'practice start 503', TITLES.practice);
    await page.unroute('**/api/learner/lessons/*/start');
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByRole('button', { name: 'Kiểm tra' })).toBeVisible();

    await fail(page, '**/api/learner/exercises/*/attempts');
    await page.getByRole('radio', { name: 'Hello' }).click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expectAlert(page, 'Không gửi được câu trả lời. Vui lòng thử lại.');
    await audit(page, 'practice submit 503', TITLES.practice);
    await page.unroute('**/api/learner/exercises/*/attempts');

    const total = await exerciseCount(hsk1Lesson);
    await fail(page, '**/api/learner/lessons/*/complete');
    for (let item = 0; item < total; item += 1) {
      if (item > 0) await page.getByRole('radio').first().click();
      await page.getByRole('button', { name: 'Kiểm tra' }).click();
      await page.getByRole('button', { name: 'Tiếp tục' }).click();
    }
    await expectAlert(page, 'Chưa lưu được kết quả bài học. Vui lòng thử lại.');
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    await audit(page, 'practice finish 503', TITLES.practice);
  });

  test('axe: dictionary and word', async ({ page, baseURL }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/dictionary');
    await expect(page.getByText('Nhập từ cần tra')).toBeVisible();
    await audit(page, 'dictionary empty', TITLES.dictionary);
    await page.goto(`/learn/dictionary?q=${encodeURIComponent(WORD.hanzi)}`);
    await expect(page.locator('.dict-item')).toHaveCount(1);
    await audit(page, 'dictionary results', TITLES.dictionary);
    await page.goto('/learn/dictionary?q=zzqqxxnone');
    await expect(page.getByText('Không tìm thấy kết quả')).toBeVisible();
    await audit(page, 'dictionary no results', TITLES.dictionary);
    await fail(page, '**/api/learner/dictionary?q=*');
    await page.getByRole('searchbox').fill('无障');
    await expectAlert(page, 'Không tra được lúc này');
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    await audit(page, 'dictionary 503', TITLES.dictionary);

    await page.goto(`/learn/dictionary/${word}`);
    await expect(
      page.getByRole('heading', { level: 1, name: WORD.hanzi }),
    ).toBeVisible();
    await audit(page, 'word', TITLES.word);
    await page.getByRole('button', { name: 'Tuỳ chọn khác' }).click();
    await expect(
      page.getByRole('button', { name: 'Sao chép từ' }),
    ).toBeVisible();
    await audit(page, 'word menu', TITLES.word);
    await page.keyboard.press('Escape');
    await fail(page, '**/api/learner/dictionary/words/*/save');
    await page.getByRole('button', { name: 'Lưu để ôn' }).click();
    await expectAlert(page, 'Chưa lưu được. Vui lòng thử lại.');
    await audit(page, 'word save 503', TITLES.word);

    for (const id of ['99999999', 'abc']) {
      await page.goto(`/learn/dictionary/${id}`);
      await expect(
        page.getByRole('heading', { name: 'Không tìm thấy từ' }),
      ).toBeVisible();
      await audit(page, `word 404 ${id}`, TITLES.word);
    }
  });

  test('axe: server error boundary (backend 429 on home)', async ({
    page,
    baseURL,
  }) => {
    const email = await registerReadyLearner(page, baseURL);
    // The default per-user, per-route bucket is 1 000/minute in test: spend
    // it on GET /learning/home so the server render of /learn fails.
    const api = await playwrightRequest.newContext();
    try {
      const token = await backendLogin(api, email, PASSWORD);
      for (let sent = 0; sent < 1000; sent += 50) {
        await Promise.all(
          Array.from({ length: 50 }, () =>
            api.get(`${BACKEND}/learning/home`, {
              headers: { authorization: `Bearer ${token}` },
            }),
          ),
        );
      }
      const last = await api.get(`${BACKEND}/learning/home`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(last.status()).toBe(429);
    } finally {
      await api.dispose();
    }
    await page.goto('/learn');
    await expect(
      page.getByRole('heading', { name: 'Đã có lỗi xảy ra' }),
    ).toBeVisible();
    await expectAlert(page, 'Không thể kết nối hoặc máy chủ đang gặp sự cố.');
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    await audit(page, 'error boundary', TITLES.home);
  });

  // ---------- E4 ----------

  test('loading: slow BFF calls are busy, not errors', async ({
    page,
    baseURL,
  }) => {
    await signedOutPage(page);
    await page.goto('/sign-in');
    await slow(page, '**/api/learner/session/login');
    await page.getByLabel('Email').fill('a11y.slow@example.test');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expectBusy(page, 'sign-in');

    await page.goto('/forgot-password');
    await slow(page, '**/api/learner/password-reset/request');
    await page.getByLabel('Email').fill('a11y.slow@example.test');
    await page.getByRole('button', { name: 'Gửi liên kết' }).click();
    await expectBusy(page, 'forgot');

    await page.goto(`/verify-email#token=${TOKEN}`);
    await slow(page, '**/api/learner/email-verification/confirm');
    await page.getByRole('button', { name: 'Xác thực email' }).click();
    await expectBusy(page, 'verify');

    await registerNewLearner(page, baseURL);
    await page.goto('/onboarding/plan?purpose=hsk_exam&band=1');
    await slow(page, '**/api/learner/onboarding/complete');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expectBusy(page, 'plan');
    await expect(page).toHaveURL(/\/learn$/u);

    await page.goto(`/learn/lessons/${hsk1Lesson}/practice`);
    await expect(page.getByRole('button', { name: 'Kiểm tra' })).toBeVisible();
    await slow(page, '**/api/learner/exercises/*/attempts');
    await page.getByRole('radio', { name: 'Hello' }).click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expectBusy(page, 'practice');
    await expect(page.getByText('Chính xác!', { exact: true })).toBeVisible();

    await page.goto('/learn/dictionary');
    await slow(page, '**/api/learner/dictionary?q=*');
    await page.getByRole('searchbox').fill(WORD.hanzi);
    await expectBusy(page, 'dictionary');
    await expect(page.locator('.dict-item')).toHaveCount(1);

    await page.goto(`/learn/dictionary/${word}`);
    await slow(page, '**/api/learner/dictionary/words/*/save');
    await page.getByRole('button', { name: 'Lưu để ôn' }).click();
    await expectBusy(page, 'word save');
    await expect(page.getByRole('button', { name: 'Đã lưu' })).toBeVisible();

    await page.goto('/learn/profile');
    await slow(page, '**/api/learner/session/logout');
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expectBusy(page, 'logout');
  });

  test('offline: answer, search and save keep the input, then retry', async ({
    page,
    baseURL,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror ${error.message}`));
    page.on('console', (message) => {
      // The browser logs each failed request itself; that is not a bug.
      if (
        message.type() === 'error' &&
        !message.text().startsWith('Failed to load resource')
      ) {
        errors.push(message.text());
      }
    });
    const context = page.context();
    await registerReadyLearner(page, baseURL);

    await page.goto(`/learn/lessons/${hsk1Lesson}/practice`);
    const hello = page.getByRole('radio', { name: 'Hello' });
    await hello.click();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expectAlert(page, 'Không gửi được câu trả lời. Vui lòng thử lại.');
    await expect(hello).toHaveAttribute('aria-checked', 'true');
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.getByText('Chính xác!', { exact: true })).toBeVisible();

    await page.goto('/learn/dictionary');
    await context.setOffline(true);
    await page.getByRole('searchbox').fill(WORD.hanzi);
    await expectAlert(page, 'Không tra được lúc này');
    await expect(page.getByRole('searchbox')).toHaveValue(WORD.hanzi);
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.locator('.dict-item')).toHaveCount(1);

    await page.goto(`/learn/dictionary/${word}`);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Lưu để ôn' }).click();
    await expectAlert(page, 'Chưa lưu được. Vui lòng thử lại.');
    await expect(
      page.getByRole('button', { name: 'Lưu để ôn' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Lưu để ôn' }).click();
    await expect(page.getByRole('button', { name: 'Đã lưu' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('reduced motion: no animation or transition over 0.01s', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      await registerReadyLearner(page, baseURL);
      const longest = () =>
        page.evaluate(() => {
          const seconds = (value: string) =>
            Math.max(
              ...value
                .split(',')
                .map((part) =>
                  part.trim().endsWith('ms')
                    ? parseFloat(part) / 1000
                    : parseFloat(part),
                ),
            );
          const slowest: string[] = [];
          for (const el of document.querySelectorAll('*')) {
            for (const pseudo of [null, '::before', '::after']) {
              const style = getComputedStyle(el, pseudo);
              const longestRun = Math.max(
                style.animationName === 'none'
                  ? 0
                  : seconds(style.animationDuration),
                seconds(style.transitionDuration),
              );
              if (longestRun > 0.01) {
                slowest.push(
                  `${el.tagName.toLowerCase()}.${el.className}${pseudo ?? ''} ${longestRun}s`,
                );
              }
            }
          }
          return slowest;
        });
      for (const path of [
        '/learn',
        '/learn/path',
        '/learn/dictionary',
        `/learn/lessons/${hsk1Lesson}`,
        `/learn/lessons/${hsk1Lesson}/practice`,
      ]) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect.soft(await longest(), path).toEqual([]);
      }
      await page.getByRole('radio', { name: 'Hello' }).click();
      await page.getByRole('button', { name: 'Kiểm tra' }).click();
      await expect(page.getByText('Chính xác!', { exact: true })).toBeVisible();
      expect.soft(await longest(), 'practice feedback').toEqual([]);
      await page.context().clearCookies();
      for (const path of ['/sign-in', '/forgot-password']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect.soft(await longest(), path).toEqual([]);
      }
    } finally {
      await context.close();
    }
  });

  // ---------- E3: keyboard only (desktop-1440, mobile-390) ----------

  test('keyboard: sign in, path, lesson, mcq, complete, dictionary, profile @keyboard', async ({
    page,
    baseURL,
  }) => {
    const email = await registerReadyLearner(page, baseURL);
    await signedOutPage(page);
    const total = await exerciseCount(hsk1Lesson);
    await page.goto('/sign-in');
    await tabTo(page, page.getByLabel('Email'));
    await page.keyboard.type(email);
    await tabTo(page, page.getByLabel('Mật khẩu', { exact: true }));
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/learn$/u);

    const tabs = page.getByRole('navigation', { name: 'Điều hướng chính' });
    // M2.10a: from 1024px the sidebar replaces the tab bar.
    const web = (page.viewportSize()?.width ?? 0) >= 1024;
    // Bell toast: opened with Enter, it leaves by itself (Q15).
    await pressOn(page, page.getByRole('button', { name: 'Thông báo' }));
    await expect(page.getByRole('status')).toContainText(
      'Thông báo sẽ có khi tính năng ra mắt.',
    );
    await expect(page.getByRole('button', { name: 'Thông báo' })).toBeFocused();
    await pressOn(
      page,
      tabs.getByRole('link', { name: web ? 'Lộ trình học' : 'Học' }),
    );
    await expect(page).toHaveURL(/\/learn\/path$/u);

    await pressOn(
      page,
      // M2.10d F4: the "Bài tiếp theo" card exists twice with the same href
      // (`.path-mid` hidden outside 1024–1279px), so target the lesson tile
      // inside the grid instead of the first href match.
      page.locator(`.path-grid a[href="/learn/lessons/${hsk1Lesson}"]`).first(),
    );
    await expect(page).toHaveURL(
      new RegExp(`/learn/lessons/${hsk1Lesson}$`, 'u'),
    );
    await pressOn(page, page.getByRole('link', { name: 'Tiếp tục học' }));
    await expect(page).toHaveURL(/\/practice$/u);

    await answerChoice(
      page,
      page.getByRole('radiogroup', { name: 'Choose the meaning of 你好' }),
      'Hello',
    );
    for (let item = 1; item < total; item += 1) {
      await answerChoice(page, page.getByRole('radiogroup'), null);
    }
    await expect(page).toHaveURL(/\/complete$/u);
    await expect(
      page.getByText('Chúc mừng! Bạn đã hoàn thành bài học'),
    ).toBeVisible();

    // The completion screen has no tab bar: its next step leads back.
    await pressOn(page, page.locator('.done-btn--primary'));
    await expect(page).not.toHaveURL(/\/complete$/u);
    await pressOn(page, tabs.getByRole('link', { name: 'Tra từ' }));
    await expect(page).toHaveURL(/\/learn\/dictionary$/u);
    await tabTo(page, page.getByRole('searchbox'));
    await page.keyboard.type(WORD.hanzi);
    const row = page.locator('.dict-item__link');
    await expect(row).toHaveCount(1);
    await pressOn(page, row);
    await expect(page).toHaveURL(new RegExp(`/learn/dictionary/${word}$`, 'u'));

    const more = page.getByRole('button', { name: 'Tuỳ chọn khác' });
    await pressOn(page, more);
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();

    // The word page has no tab bar: back to Tra từ first.
    await pressOn(page, page.getByRole('link', { name: 'Quay lại' }), 'Enter');
    await expect(page).toHaveURL(/\/learn\/dictionary/u);
    await pressOn(
      page,
      (web ? page.locator('.w-side') : tabs).getByRole('link', {
        name: 'Hồ sơ',
      }),
    );
    await expect(page).toHaveURL(/\/learn\/profile$/u);
    await expect(page.getByRole('heading', { name: 'Hồ sơ' })).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: 'Đăng xuất' }));
  });

  test('keyboard: HSK 3 tab, arrange, fill and listening @keyboard', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    await tabTo(page, page.getByRole('tab', { name: 'HSK 1' }));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'HSK 3' })).toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Lộ trình HSK 3',
    );
    await pressOn(
      page,
      // Same M2.10d F4 note as above: the tile inside the grid, not the
      // duplicated card link.
      page.locator(`.path-grid a[href="/learn/lessons/${hsk3Lesson}"]`).first(),
    );
    await expect(page).toHaveURL(
      new RegExp(`/learn/lessons/${hsk3Lesson}$`, 'u'),
    );
    await pressOn(page, page.getByRole('link', { name: 'Tiếp tục học' }));
    await expect(page).toHaveURL(/\/practice$/u);

    for (const part of ['我', '想', '买']) {
      await pressOn(page, page.getByRole('button', { name: `Thêm ${part}` }));
    }
    await pressOn(page, page.getByRole('button', { name: 'Kiểm tra' }));
    await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeFocused();
    await page.keyboard.press('Enter');

    await tabTo(page, page.getByLabel('Câu trả lời của bạn'));
    await page.keyboard.type('买');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeFocused();
    await page.keyboard.press('Enter');

    await answerChoice(
      page,
      page.getByRole('radiogroup', { name: LISTENING_PROMPT }),
      '超市',
    );
    await expect(page).toHaveURL(/\/complete$/u);
    // Backwards with Shift+Tab: no trap either way.
    await tabTo(page, page.locator('.done-btn--primary'), 'Shift+Tab');
  });
});
