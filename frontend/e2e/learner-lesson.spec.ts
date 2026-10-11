import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';

const PASSWORD = 'StrongPassword123!';
const TOAST_COMING_SOON = 'Tính năng sắp ra mắt.';
const TOAST_LOCKED = 'Hoàn thành bài trước để mở khoá.';
const FIRST_LESSON = 'Greetings & first meetings';
const LOCKED_SLUG = 'm25a-e2e-locked';
const BACKEND =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://127.0.0.1:3100/api/v1';
const ADMIN = {
  email: 'admin.frontend@example.test',
  password: 'FrontendTest-Admin-123',
};

function uniqueEmail(tag: string): string {
  return `learner.lesson.${tag}.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
}

function appOrigin(baseURL: string | undefined): string {
  return new URL(baseURL ?? 'http://127.0.0.1:3200').origin;
}

/** Registers through the BFF and completes onboarding for HSK 1. */
async function registerReadyLearner(
  page: Page,
  baseURL: string | undefined,
): Promise<void> {
  const origin = appOrigin(baseURL);
  const register = await page.request.post('/api/learner/session/register', {
    headers: { origin, 'content-type': 'application/json' },
    data: { email: uniqueEmail('band1'), password: PASSWORD },
  });
  expect(register.status()).toBe(201);

  await page.goto('/sign-in');
  const completeStatus = await page.evaluate(async () => {
    const now = new Date();
    const startDate = [
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const res = await fetch('/api/learner/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        learningPurpose: 'hsk_exam',
        targetBand: 1,
        dailyMinutes: 15,
        reminderEnabled: true,
        reminderTime: '07:00',
        startDate,
      }),
    });
    return res.status;
  });
  expect(completeStatus).toBe(200);
}

type Envelope<T> = { data: T };

async function call<T>(
  api: APIRequestContext,
  method: 'GET' | 'POST',
  route: string,
  token?: string,
  data?: unknown,
): Promise<T> {
  const response = await api.fetch(`${BACKEND}${route}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    data,
  });
  if (response.status() === 409 && route === '/admin/cms/lessons') {
    throw new Error(
      'A draft m25a-e2e-locked lesson is left from an aborted run: use a new disposable DB.',
    );
  }
  expect(response.ok(), `${method} ${route} → ${response.status()}`).toBe(true);
  return ((await response.json()) as Envelope<T>).data;
}

/**
 * Publishes a second ready lesson on HSK 3 through the Admin CMS: for a new
 * learner it sits behind the level's first lesson, so it is locked (Q18).
 * One grammar topic: the Từ vựng row needs words, which the CMS cannot add.
 * HSK 3 keeps its single path grid, so the path specs are unaffected.
 */
async function publishLockedLesson(): Promise<number> {
  const api = await playwrightRequest.newContext();
  try {
    const admin = (
      await call<{ accessToken: string }>(
        api,
        'POST',
        '/auth/login',
        undefined,
        ADMIN,
      )
    ).accessToken;
    const levels = await call<Array<{ id: number; code: string }>>(
      api,
      'GET',
      '/learning/levels',
    );
    const hsk3 = levels.find((level) => level.code === 'HSK3');
    if (!hsk3) throw new Error('seed has no published HSK3');
    // Idempotent per DB: every project's worker runs beforeAll again, and
    // (levelId, orderIndex) is unique.
    const ready = await call<Array<{ id: number; slug: string }>>(
      api,
      'GET',
      `/learning/lessons?levelId=${hsk3.id}`,
    );
    const existing = ready.find((lesson) => lesson.slug === LOCKED_SLUG);
    if (existing) return existing.id;
    type Draft = {
      lesson?: { id: number };
      topic?: { id: number };
      revision: { id: number };
    };
    const lesson = await call<Draft>(api, 'POST', '/admin/cms/lessons', admin, {
      levelId: hsk3.id,
      title: 'Bài khoá e2e',
      orderIndex: 900,
      slug: LOCKED_SLUG,
    });
    const lessonId = lesson.lesson?.id;
    if (!lessonId) throw new Error('lesson draft has no id');
    const topic = await call<Draft>(api, 'POST', '/admin/cms/topics', admin, {
      lessonId,
      title: 'Ngữ pháp e2e',
      subtitle: 'Fixture e2e',
      type: 'grammar',
      content: [{ type: 'text', value: 'Nội dung fixture.' }],
      orderIndex: 1,
      isPremium: false,
      isLocked: false,
    });
    const topicId = topic.topic?.id;
    if (!topicId) throw new Error('topic draft has no id');
    for (const [kind, id, revision] of [
      ['topics', topicId, topic.revision.id],
      ['lessons', lessonId, lesson.revision.id],
    ] as const) {
      await call(
        api,
        'POST',
        `/admin/cms/${kind}/${id}/revisions/${revision}/reviews`,
        admin,
        { decision: 'approved' },
      );
      await call(
        api,
        'POST',
        `/admin/cms/${kind}/${id}/revisions/${revision}/publish`,
        admin,
      );
    }
    return lessonId;
  } finally {
    await api.dispose();
  }
}

function tabBar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Điều hướng chính' });
}

function toasts(page: Page): Locator {
  return page.locator('.toast-region[role="status"] .toast');
}

async function watchCsp(page: Page): Promise<string[]> {
  const cspConsole: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes('Content Security Policy')) cspConsole.push(text);
  });
  page.on('pageerror', (error) =>
    cspConsole.push(`pageerror ${error.message}`),
  );
  await page.addInitScript(() => {
    const store: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: store });
    document.addEventListener('securitypolicyviolation', (event) => {
      store.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return cspConsole;
}

async function readCspViolations(page: Page): Promise<string[] | null> {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(window, '__cspViolations');
    return Array.isArray(value) ? value.map(String) : null;
  });
}

async function expectToast(page: Page, control: Locator, message: string) {
  const all = toasts(page);
  await expect(all).toHaveCount(0, { timeout: 5000 });
  const url = page.url();
  // Playwright treats aria-disabled="true" as not enabled and would wait; a
  // locked control must still take the click (Q44), so check it is the top
  // element at its centre, then click it.
  if ((await control.getAttribute('aria-disabled')) === 'true') {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    if (!box) throw new Error('locked control has no box');
    const onTop = await control.evaluate(
      (element, point) =>
        element.contains(document.elementFromPoint(point.x, point.y)),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(onTop).toBe(true);
    await control.click({ force: true });
  } else {
    await control.click();
  }
  await expect(all).toHaveCount(1);
  await expect(all).toHaveText(message);
  expect(page.url()).toBe(url);
}

test.describe('Learner lesson page (M2.5a)', () => {
  let lockedLessonId = 0;

  test.beforeAll(async () => {
    lockedLessonId = await publishLockedLesson();
  });

  test('current tile on Lộ trình opens its lesson page', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    const current = page.locator('a.topic.is-current');
    await expect(current).toHaveCount(1);
    const href = await current.getAttribute('href');
    expect(href).toMatch(/^\/learn\/lessons\/\d+$/);

    await current.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page).toHaveTitle('Bài học · Hán Lộ');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      FIRST_LESSON,
    );
    await expect(
      tabBar(page).getByRole('link', { name: 'Học', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(toasts(page)).toHaveCount(0);
  });

  test('next-lesson button and Trang chủ card open the lesson', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    await page.locator('a.path-next__btn').click();
    await expect(page).toHaveURL(/\/learn\/lessons\/\d+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      FIRST_LESSON,
    );

    await page.goto('/learn');
    const card = page.locator('a.home-lesson');
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page).toHaveURL(/\/learn\/lessons\/\d+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      FIRST_LESSON,
    );
  });

  test('back button returns to Lộ trình', async ({ page, baseURL }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    await page.locator('a.topic.is-current').click();
    await expect(page).toHaveURL(/\/learn\/lessons\/\d+$/);
    const back = page.getByRole('link', { name: 'Quay lại lộ trình' });
    await expect(back).toHaveAttribute('href', '/learn/path');
    await back.click();
    await expect(page).toHaveURL(/\/learn\/path$/);
  });

  test('rows, heart and CTA of an open lesson show the coming-soon toast', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    await page.locator('a.topic.is-current').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      FIRST_LESSON,
    );
    const rows = page.locator('.lesson-rows .lrow');
    expect(await rows.count()).toBeGreaterThan(0);
    for (let index = 0; index < (await rows.count()); index += 1) {
      const row = rows.nth(index);
      await expect(row).not.toHaveAttribute('aria-disabled');
      await expectToast(page, row, TOAST_COMING_SOON);
    }
    await expectToast(
      page,
      page.getByRole('button', { name: 'Yêu thích bài học' }),
      TOAST_COMING_SOON,
    );
    await expectToast(
      page,
      page.getByRole('button', { name: 'Tiếp tục học' }),
      TOAST_COMING_SOON,
    );
  });

  test('deep link to a locked lesson shows it locked and toasts why (Q40, Q44)', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const response = await page.goto(`/learn/lessons/${lockedLessonId}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Bài khoá e2e',
    );
    await expect(page.locator('.lesson-hero__badge')).toHaveText(/HSK 3/u);
    const rows = page.locator('.lesson-rows .lrow');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveClass(/is-locked/u);
    await expect(rows.first()).toHaveAttribute('aria-disabled', 'true');
    await expect(rows.first().locator('.lrow__lock')).toBeVisible();
    const cta = page.getByRole('button', { name: 'Tiếp tục học' });
    await expect(cta).toHaveAttribute('aria-disabled', 'true');
    await expect(cta).not.toHaveAttribute('disabled');

    await expectToast(page, rows.first(), TOAST_LOCKED);
    await expectToast(page, cta, TOAST_LOCKED);
    await expectToast(
      page,
      page.getByRole('button', { name: 'Yêu thích bài học' }),
      TOAST_COMING_SOON,
    );
  });

  for (const id of ['999999', 'abc', '0', '99999999999']) {
    test(`/learn/lessons/${id} is a Vietnamese 404 with the tab bar (Q41)`, async ({
      page,
      baseURL,
    }) => {
      await registerReadyLearner(page, baseURL);
      const response = await page.goto(`/learn/lessons/${id}`);
      expect(response?.status()).toBe(404);
      expect(new URL(page.url()).pathname).toBe(`/learn/lessons/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Không tìm thấy bài học',
      );
      await expect(
        page.getByText('Bài học này không tồn tại hoặc chưa mở.'),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Về lộ trình' }),
      ).toHaveAttribute('href', '/learn/path');
      await expect(
        tabBar(page).getByRole('link', { name: 'Học', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    });
  }

  test('lesson, locked lesson and 404 raise no CSP violation', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const cspConsole = await watchCsp(page);

    await page.goto('/learn/path');
    await page.locator('a.topic.is-current').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      FIRST_LESSON,
    );
    expect(await readCspViolations(page)).toEqual([]);

    await page.goto(`/learn/lessons/${lockedLessonId}`);
    await expect(page.locator('.lrow.is-locked')).toHaveCount(1);
    expect(await readCspViolations(page)).toEqual([]);

    await page.goto('/learn/lessons/999999');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Không tìm thấy bài học',
    );
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });
});
