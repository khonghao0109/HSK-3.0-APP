import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  publishLockedLesson,
  readCspViolations,
  registerReadyLearner,
  watchCsp,
} from './support/learner-fixtures';

const TOAST_COMING_SOON = 'Tính năng sắp ra mắt.';
const TOAST_LOCKED = 'Hoàn thành bài trước để mở khoá.';
const FIRST_LESSON = 'Greetings & first meetings';

function tabBar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Điều hướng chính' });
}

function toasts(page: Page): Locator {
  return page.locator('.toast-region[role="status"] .toast');
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
    // M2.10b: from 1024px the sidebar replaces the tab bar and the lesson
    // page marks "Lộ trình học" current (mẫu web/lesson.html).
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(
        page.locator('.w-side').getByRole('link', { name: 'Lộ trình học' }),
      ).toHaveAttribute('aria-current', 'page');
    } else {
      await expect(
        tabBar(page).getByRole('link', { name: 'Học', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    }
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
    // M2.10b: the mobile bar (with the back button) is hidden from 1024px;
    // there the breadcrumbs' "Lộ trình học" link is the way back.
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      const crumb = page
        .locator('.w-crumbs')
        .getByRole('link', { name: 'Lộ trình học' });
      await expect(crumb).toHaveAttribute('href', '/learn/path');
      await crumb.click();
    } else {
      const back = page.getByRole('link', { name: 'Quay lại lộ trình' });
      await expect(back).toHaveAttribute('href', '/learn/path');
      await back.click();
    }
    await expect(page).toHaveURL(/\/learn\/path$/);
  });

  test('rows and heart toast; Luyện tập and the CTA open the player (Q45)', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    await page.locator('a.topic.is-current').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      FIRST_LESSON,
    );
    const lessonPath = new URL(page.url()).pathname;
    const practice = page.locator('.lesson-rows a.lrow');
    await expect(practice).toHaveCount(1);
    await expect(practice.locator('.lrow__title')).toHaveText('Luyện tập');
    await expect(practice).toHaveAttribute('href', `${lessonPath}/practice`);
    // Seed HSK 1 lesson: Luyện tập is its only row today; any other row toasts.
    const rows = page.locator('.lesson-rows button.lrow');
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
    const cta = page.getByRole('link', { name: 'Tiếp tục học' });
    await expect(cta).toHaveAttribute('href', `${lessonPath}/practice`);
    await cta.click();
    await expect(page).toHaveURL(new RegExp(`${lessonPath}/practice$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Luyện tập',
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
      // M2.10b: at 1024px+ the 404 sits in the .w-app frame, so the sidebar
      // carries the current-page marker instead of the (hidden) tab bar.
      if ((page.viewportSize()?.width ?? 0) >= 1024) {
        await expect(
          page.locator('.w-side').getByRole('link', { name: 'Lộ trình học' }),
        ).toHaveAttribute('aria-current', 'page');
      } else {
        await expect(
          tabBar(page).getByRole('link', { name: 'Học', exact: true }),
        ).toHaveAttribute('aria-current', 'page');
      }
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
