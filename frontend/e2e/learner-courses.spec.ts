import { expect, request as playwrightRequest, test } from '@playwright/test';

import {
  BACKEND,
  PASSWORD,
  backendLogin,
  call,
  readyLessonId,
  registerReadyLearner,
} from './support/learner-fixtures';

// C3b-UI (ADR-009): course list, detail and the Home block against the real
// backend. HSK3_TOPIC comes from `content:course:backfill` on the disposable
// e2e DB; the textbook course is created here through the Admin CMS
// (idempotent per DB), never from seeddata/.

const TEXTBOOK = {
  code: 'E2E_TEXTBOOK',
  kind: 'textbook',
  curriculumVersion: 'HSK_2_0',
  title: 'Giáo trình E2E',
  description: 'Khoá giáo trình của bộ kiểm thử.',
  orderIndex: 90,
};
const TOPIC_TITLE = 'Chủ đề HSK 3.0';

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext();
  try {
    const admin = await backendLogin(
      api,
      'admin.frontend@example.test',
      'FrontendTest-Admin-123',
    );
    const existing = await call<
      Array<{ id: number; code: string; status: string }>
    >(api, 'GET', '/admin/cms/courses?kind=textbook', admin);
    let course = existing.find((item) => item.code === TEXTBOOK.code);
    course ??= await call<{ id: number; code: string; status: string }>(
      api,
      'POST',
      '/admin/cms/courses',
      admin,
      TEXTBOOK,
    );
    if (course.status !== 'published') {
      await call(api, 'POST', `/admin/cms/courses/${course.id}/publish`, admin);
    }
  } finally {
    await api.dispose();
  }
});

const card = (page: import('@playwright/test').Page, title: string) =>
  page.getByRole('article', { name: title });

test('a new learner studies HSK3_TOPIC by default', async ({
  page,
  baseURL,
}) => {
  await registerReadyLearner(page, baseURL);
  await page.goto('/learn/courses');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(card(page, TOPIC_TITLE).getByText('Đang học')).toBeVisible();
  await expect(card(page, TEXTBOOK.title).getByText('Chưa theo')).toBeVisible();
  await expect(
    card(page, TOPIC_TITLE).getByRole('button', { name: /Bỏ theo dõi/ }),
  ).toHaveCount(0);

  await page.goto('/learn');
  const block = page.getByRole('region', { name: TOPIC_TITLE });
  await expect(block.getByText('Khoá đang học')).toBeVisible();
  await expect(block.getByRole('link', { name: 'Đổi khoá' })).toHaveAttribute(
    'href',
    '/learn/courses',
  );
});

test('picking another course updates Home with one PUT', async ({
  page,
  baseURL,
}) => {
  await registerReadyLearner(page, baseURL);
  await page.goto('/learn/courses');
  const puts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT') puts.push(request.url());
  });
  await card(page, TEXTBOOK.title)
    .getByRole('button', { name: 'Học khoá này' })
    .click();
  await expect(
    page.getByText(
      `Đã đặt “${TEXTBOOK.title}” làm khoá đang học. Tiến độ các khoá giữ nguyên.`,
    ),
  ).toBeVisible();
  await expect(card(page, TEXTBOOK.title).getByText('Đang học')).toBeVisible();
  await expect(card(page, TOPIC_TITLE).getByText('Đang học')).toHaveCount(0);
  expect(
    puts.filter((url) => url.endsWith('/api/learner/current-course')),
  ).toHaveLength(1);

  await page.goto('/learn');
  await expect(
    page.getByRole('region', { name: TEXTBOOK.title }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: TOPIC_TITLE })).toHaveCount(0);
});

test('unfollowing and following again keeps the progress', async ({
  page,
  baseURL,
}) => {
  const email = await registerReadyLearner(page, baseURL);
  const lessonId = await readyLessonId('HSK1');
  expect(lessonId).not.toBeNull();
  const api = await playwrightRequest.newContext();
  try {
    const token = await backendLogin(api, email, PASSWORD);
    const started = await api.post(
      `${BACKEND}/learning/lessons/${String(lessonId)}/start`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': crypto.randomUUID(),
        },
        data: {},
      },
    );
    expect(started.ok()).toBe(true);

    await page.goto('/learn/courses');
    await card(page, TEXTBOOK.title)
      .getByRole('button', { name: 'Học khoá này' })
      .click();
    const topic = card(page, TOPIC_TITLE);
    await expect(topic.getByText('Đang học')).toHaveCount(0);
    // A learner may or may not have an HSK3_TOPIC enrollment after onboarding.
    const follow = topic.getByRole('button', { name: 'Theo dõi' });
    if ((await follow.count()) > 0) await follow.click();
    await expect(topic.getByText('Đang theo')).toBeVisible();
    const before = (await topic.locator('.crs-prog').textContent()) ?? '';

    const opener = topic.getByRole('button', {
      name: `Bỏ theo dõi ${TOPIC_TITLE}`,
    });
    await opener.click();
    const dialog = page.getByRole('dialog', {
      name: `Bỏ theo dõi “${TOPIC_TITLE}”?`,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Giữ lại' }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await dialog.getByRole('button', { name: 'Bỏ theo dõi' }).click();
    await expect(topic.getByText('Chưa theo')).toBeVisible();
    await topic.getByRole('button', { name: 'Theo dõi' }).click();
    await expect(topic.getByText('Đang theo')).toBeVisible();
    await page.reload();
    await expect(card(page, TOPIC_TITLE).locator('.crs-prog')).toHaveText(
      before,
    );

    const progress = await call<{ status: string }>(
      api,
      'GET',
      `/progress/lessons/${String(lessonId)}`,
      token,
    );
    expect(progress.status).toBe('learning');
  } finally {
    await api.dispose();
  }
});

test('the course detail opens only the current unit', async ({
  page,
  baseURL,
}) => {
  await registerReadyLearner(page, baseURL);
  await page.goto('/learn/courses/HSK3_TOPIC');
  await expect(
    page.getByRole('heading', { level: 1, name: TOPIC_TITLE }),
  ).toBeVisible();
  const heads = page.locator('.crs-unit__head');
  expect(await heads.count()).toBeGreaterThan(1);
  await expect(
    page.locator('.crs-unit__head[aria-expanded="true"]'),
  ).toHaveCount(1);
  // A topic course has a current lesson per unit; only the open unit shows it.
  const current = page.locator('a.crs-lesson[aria-current="step"]:visible');
  await expect(current).toHaveCount(1);
  const href = await current.getAttribute('href');
  expect(href).toMatch(/^\/learn\/lessons\/\d+$/u);
  await current.click();
  await expect(page).toHaveURL(new RegExp(`${href ?? ''}$`, 'u'));
});
