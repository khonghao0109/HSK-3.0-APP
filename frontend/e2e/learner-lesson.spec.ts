import { expect, test, type Locator, type Page } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';
import {
  publishLockedLesson,
  readCspViolations,
  readyLessonId,
  registerReadyLearner,
  watchCsp,
} from './support/learner-fixtures';

const TOAST_COMING_SOON = 'Tính năng sắp ra mắt.';
const TOAST_LOCKED = 'Hoàn thành bài trước để mở khoá.';
const FIRST_LESSON = 'Greetings & first meetings';

// Lesson units (Pha B): extra topics and words on the HSK 7–9 seed lesson,
// through the disposable DB (idempotent per DB, like learner-topic-pages).
const UNIT = {
  vocabulary: 'Từ vựng e2e đơn vị',
  grammar: 'Ngữ pháp e2e đơn vị',
  quiz: 'Kiểm tra e2e đơn vị',
  draft: 'Nháp e2e đơn vị',
  words: ['单元甲', '单元乙'],
  draftWord: '单元丙',
  quizPrompt: 'Chọn đáp án e2e đơn vị',
};

async function seedUnitLesson(): Promise<number> {
  const lessonId = await readyLessonId('HSK7_9');
  if (!lessonId) throw new Error('seed has no ready HSK7_9 lesson');
  const topic = (title: string, type: string, order: number, status: string) =>
    `INSERT INTO "Topic" ("lessonId", title, type, content, "orderIndex", status, "updatedAt")
      VALUES (${lessonId}, ${sqlLiteral(title)}, '${type}'::"TopicType", '[]', ${order},
        '${status}'::"ContentStatus", now())
      ON CONFLICT ("lessonId", "orderIndex") DO NOTHING;`;
  const word = (hanzi: string, order: number, topicTitle: string) =>
    `WITH w AS (
      INSERT INTO "Word" (hanzi, pinyin, "pinyinNormalized", status, "isPure", "publishedAt", "updatedAt")
      VALUES (${sqlLiteral(hanzi)}, 'dan yuan ${order}', 'dan yuan ${order}', 'published'::"ContentStatus", true, now(), now())
      ON CONFLICT (hanzi, pinyin, "pinyinTone") DO UPDATE SET "updatedAt" = now()
      RETURNING id)
    INSERT INTO "LessonWord" ("lessonId", "wordId", "topicId", "orderIndex")
      SELECT ${lessonId}, w.id, t.id, ${order} FROM w, "Topic" t
      WHERE t."lessonId" = ${lessonId} AND t.title = ${sqlLiteral(topicTitle)}
      ON CONFLICT ("lessonId", "wordId") DO NOTHING;`;
  queryDisposableDb(
    [
      topic(UNIT.vocabulary, 'vocabulary', 21, 'published'),
      topic(UNIT.grammar, 'grammar', 22, 'published'),
      topic(UNIT.quiz, 'quiz', 23, 'published'),
      topic(UNIT.draft, 'vocabulary', 24, 'draft'),
      word(UNIT.words[0] ?? '', 21, UNIT.vocabulary),
      word(UNIT.words[1] ?? '', 22, UNIT.vocabulary),
      word(UNIT.draftWord, 23, UNIT.draft),
      // Pha C (debt 5a): Kiểm tra without exercises is hidden, so the quiz
      // topic gets one published exercise.
      `INSERT INTO "LessonExercise" ("lessonId", "topicId", type, prompt, content, answer, version, "orderIndex", status, "publishedAt", "updatedAt")
        SELECT ${lessonId}, t.id, 'mcq'::"ExerciseType", ${sqlLiteral(UNIT.quizPrompt)},
          '{"options":[{"id":"a","text":"A"},{"id":"b","text":"B"}]}', '{"optionId":"a"}',
          1, 21, 'published'::"ContentStatus", now(), now()
        FROM "Topic" t
        WHERE t."lessonId" = ${lessonId} AND t.title = ${sqlLiteral(UNIT.quiz)}
          AND NOT EXISTS (SELECT 1 FROM "LessonExercise" e
            WHERE e."lessonId" = ${lessonId} AND e.prompt = ${sqlLiteral(UNIT.quizPrompt)});`,
    ].join('\n'),
  );
  return lessonId;
}

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
    // M2.10d F4: `.path-mid` (1024–1279px) or `.path-next` (mobile bar /
    // ≥ 1280px); CSS shows exactly one copy per viewport.
    await page
      .locator('a.path-mid__btn:visible, a.path-next__btn:visible')
      .click();
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

  test('unit row and heart toast; the CTA opens the player (Q45, N1)', async ({
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
    await expect(page.locator('#lesson-content-title')).toHaveText(
      'Đơn vị học',
    );
    // Seed HSK 1 lesson: one vocabulary topic (its exercises belong to it),
    // no word and no quiz topic, so one Từ vựng unit and no Kiểm tra (N1).
    const rows = page.locator('.lu-rows .lu-row');
    await expect(rows).toHaveCount(1);
    const vocabulary = page.locator('.lu-rows a.lu-row');
    await expect(vocabulary.locator('.lu-row__title')).toHaveText('Từ vựng 1');
    await expect(vocabulary.locator('.lu-row__meta')).toHaveText(
      'Core social exchange',
    );
    await expect(vocabulary).toHaveAttribute(
      'href',
      new RegExp(`^${lessonPath}/vocabulary\\?unit=\\d+$`, 'u'),
    );
    await expect(page.locator('.lu-rows a[href$="/practice"]')).toHaveCount(0);
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

  test('units follow the topics: words by topicId, draft hidden, Kiểm tra locked (L-units, N2)', async ({
    page,
    baseURL,
  }) => {
    const lessonId = await seedUnitLesson();
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${lessonId}`);
    const rows = page.locator('.lu-rows .lu-row');

    const vocabulary = rows.filter({ hasText: UNIT.words.join(' · ') });
    await expect(vocabulary).toHaveCount(1);
    await expect(vocabulary.locator('.lu-row__title')).toHaveText(
      /^Từ vựng \d+$/u,
    );
    await expect(vocabulary.locator('.lu-row__meta')).toHaveAttribute(
      'lang',
      'zh-Hans',
    );
    await expect(vocabulary).toHaveAttribute(
      'href',
      new RegExp(`^/learn/lessons/${lessonId}/vocabulary\\?unit=\\d+$`, 'u'),
    );
    await expect(vocabulary.locator('.lu-badge')).toHaveText('词');
    // The word of the draft topic is in no unit, the draft topic has no row.
    await expect(rows.filter({ hasText: UNIT.draftWord })).toHaveCount(0);
    await expect(rows.filter({ hasText: UNIT.draft })).toHaveCount(0);

    const grammar = rows.filter({ hasText: UNIT.grammar });
    // Web shows the bar beside the percent (mẫu web lesson-units.html).
    const bar = grammar.locator('.lu-bar');
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(bar).toBeVisible();
      await expect(bar).toHaveCSS('width', '100px');
    } else {
      await expect(bar).toBeHidden();
    }
    await expect(grammar.locator('.lu-row__title')).toHaveText('Ngữ pháp');
    // Pha D: a Ngữ pháp unit opens its own screen.
    const grammarId = queryDisposableDb(
      `SELECT id FROM "Topic" WHERE "lessonId" = ${lessonId} AND title = ${sqlLiteral(UNIT.grammar)}`,
    );
    await expect(grammar).toHaveAttribute(
      'href',
      `/learn/lessons/${lessonId}/grammar?unit=${grammarId}`,
    );

    const quiz = rows.filter({ hasText: 'Kiểm tra' });
    await expect(quiz).toHaveCount(1);
    await expect(quiz).toHaveClass(/is-locked/u);
    await expect(quiz).toHaveAttribute('aria-disabled', 'true');
    await expect(quiz.locator('.lu-row__meta')).toHaveText(
      'Mở khi xong các đơn vị trên',
    );
    expect(await quiz.evaluate((element) => element.tagName)).toBe('DIV');
    // Pha B debt 5b: the locked row is a disabled link named with its reason.
    await expect(quiz).toMatchAriaSnapshot(
      '- link /Kiểm tra\\s*,\\s*Mở khi xong các đơn vị trên\\s*,\\s*đang khoá/ [disabled]',
    );
    // Pha C debt 3c: the keyboard reaches the locked row (and its name).
    for (let presses = 0; presses < 80; presses += 1) {
      if (await quiz.evaluate((row) => row === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(quiz).toBeFocused();
    for (const row of await rows.all()) {
      const box = await row.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // Pha D: a grammar topic without the new blocks (old content) opens
    // the Ngữ pháp page that shows it.
    await grammar.click();
    await expect(page).toHaveURL(
      new RegExp(`/learn/lessons/${lessonId}/grammar$`, 'u'),
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
    const rows = page.locator('.lu-rows .lu-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveClass(/is-locked/u);
    await expect(rows.first()).toHaveAttribute('aria-disabled', 'true');
    await expect(rows.first().locator('.lu-row__lock')).toBeVisible();
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
    await expect(page.locator('.lu-row.is-locked')).toHaveCount(1);
    expect(await readCspViolations(page)).toEqual([]);

    await page.goto('/learn/lessons/999999');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Không tìm thấy bài học',
    );
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });
});
