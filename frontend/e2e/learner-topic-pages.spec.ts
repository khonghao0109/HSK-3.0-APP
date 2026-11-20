import { expect, request as playwrightRequest, test } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';
import {
  backendLogin,
  call,
  readyLessonId,
  registerReadyLearner,
  sharedExamMedia,
} from './support/learner-fixtures';

// M2.5f (Q175): the Từ vựng / Ngữ pháp pages of a real lesson, through the BFF
// and the backend (no mocked service). Fixture: the HSK 7–9 seed lesson gets a
// vocabulary topic (text + vocabulary_list), a grammar and a key_text topic
// through the Admin CMS, and one word through the disposable DB (the CMS
// cannot add lesson words). Idempotent per DB.

const ADMIN = {
  email: 'admin.frontend@example.test',
  password: 'FrontendTest-Admin-123',
};
const VOCAB_TITLE = 'Từ vựng e2e M2.5f';
const GRAMMAR_TITLE = 'Ngữ pháp e2e M2.5f';
const KEY_TEXT_TITLE = 'Bài khoá e2e M2.5f';
const WORD = {
  hanzi: '文学评论',
  pinyin: 'wen xue ping lun',
  tone: 'wen2 xue2 ping2 lun4',
};

type Draft = { topic?: { id: number }; revision: { id: number } };

async function publishTopic(
  api: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  admin: string,
  lessonId: number,
  body: { title: string; type: string; content: unknown[]; orderIndex: number },
): Promise<void> {
  const draft = await call<Draft>(api, 'POST', '/admin/cms/topics', admin, {
    lessonId,
    subtitle: null,
    isPremium: false,
    isLocked: false,
    ...body,
  });
  const id = draft.topic?.id;
  if (!id) throw new Error('topic draft has no id');
  const base = `/admin/cms/topics/${id}/revisions/${draft.revision.id}`;
  await call(api, 'POST', `${base}/reviews`, admin, { decision: 'approved' });
  await call(api, 'POST', `${base}/publish`, admin);
}

async function seedTopicLesson(): Promise<number> {
  const lessonId = await readyLessonId('HSK7_9');
  if (!lessonId) throw new Error('seed has no ready HSK7_9 lesson');
  const api = await playwrightRequest.newContext();
  try {
    const detail = await call<{ topics: Array<{ title: string }> }>(
      api,
      'GET',
      `/learning/lessons/${lessonId}`,
    );
    if (!detail.topics.some((topic) => topic.title === VOCAB_TITLE)) {
      const admin = await backendLogin(api, ADMIN.email, ADMIN.password);
      await publishTopic(api, admin, lessonId, {
        title: VOCAB_TITLE,
        type: 'vocabulary',
        content: [
          { type: 'text', value: 'Đọc to từng từ trước khi luyện tập.' },
          { type: 'vocabulary_list', value: 'lesson_words' },
        ],
        orderIndex: 11,
      });
      await publishTopic(api, admin, lessonId, {
        title: GRAMMAR_TITLE,
        type: 'grammar',
        content: [{ type: 'text', value: 'Chủ ngữ + 是 + danh từ.' }],
        orderIndex: 12,
      });
      await publishTopic(api, admin, lessonId, {
        title: KEY_TEXT_TITLE,
        type: 'key_text',
        content: [{ type: 'text', value: 'A: 你好！ B: 你好！' }],
        orderIndex: 13,
      });
    }
  } finally {
    await api.dispose();
  }
  // English row first, Vietnamese row after it (P2): the page shows Vietnamese.
  queryDisposableDb(`WITH w AS (
      INSERT INTO "Word" (hanzi, pinyin, "pinyinNormalized", "pinyinTone", status, "isPure", "publishedAt", "updatedAt")
      VALUES (${sqlLiteral(WORD.hanzi)}, ${sqlLiteral(WORD.pinyin)}, ${sqlLiteral(WORD.pinyin)}, ${sqlLiteral(WORD.tone)},
        'published'::"ContentStatus", true, now(), now())
      ON CONFLICT (hanzi, pinyin, "pinyinTone") DO UPDATE SET "updatedAt" = now()
      RETURNING id),
    m AS (INSERT INTO "WordMeaning" ("wordId", "meaningOrder", "meaningEn", "meaningVi", "updatedAt")
      SELECT id, 1, 'literary criticism', NULL, now() FROM w
      UNION ALL SELECT id, 2, NULL, 'phê bình văn học', now() FROM w
      ON CONFLICT ("wordId", "meaningOrder") DO NOTHING)
    INSERT INTO "LessonWord" ("lessonId", "wordId", "orderIndex")
      SELECT ${lessonId}, id, 1 FROM w
      ON CONFLICT ("lessonId", "wordId") DO NOTHING;`);
  return lessonId;
}

test.describe('Lesson topic pages (M2.5f)', () => {
  let lessonId = 0;

  test.beforeAll(async () => {
    lessonId = await seedTopicLesson();
  });

  test('Từ vựng row opens the vocabulary page with the word list', async ({
    page,
    baseURL,
  }, testInfo) => {
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${lessonId}`);
    const row = page.locator('.lu-rows a.lu-row', { hasText: VOCAB_TITLE });
    // N3: the row opens the unit flow; this seed lesson's words have no
    // topic, so the flow falls back to the word list page.
    await expect(row).toHaveAttribute(
      'href',
      new RegExp(`^/learn/lessons/${lessonId}/vocabulary\\?unit=\\d+$`, 'u'),
    );
    await row.click();
    await expect(page).toHaveURL(
      new RegExp(`/learn/lessons/${lessonId}/vocabulary$`),
    );

    const card = page.getByRole('region', { name: VOCAB_TITLE });
    await expect(
      card.getByText('Đọc to từng từ trước khi luyện tập.'),
    ).toBeVisible();
    const word = card.getByRole('listitem').filter({ hasText: WORD.hanzi });
    await expect(word).toContainText('phê bình văn học');
    // Q354: four syllables are two words (GB/T 16159-2012).
    await expect(word).toContainText('wénxué pínglùn');
    await expect(card).not.toContainText('literary criticism');
    await expect(page.getByText(GRAMMAR_TITLE)).toHaveCount(0);

    // Layout: the title is clear of the top bar and keeps a side gutter.
    const title = page.getByRole('heading', { level: 1 });
    const box = await title.boundingBox();
    if (!box) throw new Error('title has no box');
    expect(box.x).toBeGreaterThanOrEqual(16);
    const bar = page.locator(
      testInfo.project.name.startsWith('desktop') ? '.w-top' : '.m02-bar',
    );
    const barBox = await bar.boundingBox();
    if (barBox) expect(box.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);
    if (testInfo.project.name.startsWith('desktop')) {
      const crumbs = await page.locator('.w-crumbs').boundingBox();
      const top = await page.locator('.w-top').boundingBox();
      if (!crumbs || !top) throw new Error('missing crumbs or top bar');
      expect(crumbs.y).toBeGreaterThanOrEqual(top.y + top.height);
    }
    await page.screenshot({
      path: testInfo.outputPath('vocabulary.png'),
      fullPage: true,
    });
  });

  test('Ngữ pháp page shows grammar then key_text topics', async ({
    page,
    baseURL,
  }, testInfo) => {
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${lessonId}/grammar`);
    const headings = page.getByRole('heading', { level: 2 });
    await expect(headings.filter({ hasText: 'e2e M2.5f' })).toHaveText([
      GRAMMAR_TITLE,
      KEY_TEXT_TITLE,
    ]);
    await expect(page.getByText('Chủ ngữ + 是 + danh từ.')).toBeVisible();
    await expect(page.getByText('A: 你好！ B: 你好！')).toBeVisible();
    await expect(page.getByText(VOCAB_TITLE)).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('grammar.png'),
      fullPage: true,
    });
  });

  // Q350/Q355: cover image on the lesson page, word image on the vocabulary
  // page; a word without an image gets the same square tile with its hanzi.
  test('shows the lesson cover and word images, and a tile without an image', async ({
    page,
    baseURL,
  }) => {
    const api = await playwrightRequest.newContext();
    const admin = await backendLogin(api, ADMIN.email, ADMIN.password);
    const wordId = Number(
      queryDisposableDb(
        `SELECT id FROM "Word" WHERE hanzi = ${sqlLiteral(WORD.hanzi)} AND pinyin = ${sqlLiteral(WORD.pinyin)}`,
      ),
    );
    const setImages = (imageId: number | null) =>
      call(api, 'PUT', `/admin/cms/lessons/${lessonId}/images`, admin, {
        coverImageId: imageId,
        wordImages: [{ wordId, imageId }],
      });
    try {
      const { imageId } = await sharedExamMedia(api, admin);
      await setImages(imageId);
      await registerReadyLearner(page, baseURL);

      await page.goto(`/learn/lessons/${lessonId}`);
      const cover = page.locator('.lesson-hero__img--cover img');
      await expect(cover).toBeVisible();
      await expect
        .poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);

      await page.goto(`/learn/lessons/${lessonId}/vocabulary`);
      const card = page.getByRole('region', { name: VOCAB_TITLE });
      const word = card.getByRole('listitem').filter({ hasText: WORD.hanzi });
      const wordImg = word.locator('img.topic-word__img');
      await expect(wordImg).toBeVisible();
      await expect
        .poll(() =>
          wordImg.evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBeGreaterThan(0);
      await expect(word.locator('.topic-word__tile')).toHaveCount(0);

      await setImages(null);
      await page.reload();
      await expect(word.locator('img')).toHaveCount(0);
      const tile = word.locator('.topic-word__tile');
      await expect(tile).toHaveText(WORD.hanzi);
      const box = await tile.boundingBox();
      if (!box) throw new Error('tile has no box');
      expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
    } finally {
      await setImages(null);
      await api.dispose();
    }
  });
});
