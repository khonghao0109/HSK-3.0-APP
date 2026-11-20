import { expect, test, type Page } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';
import {
  readCspViolations,
  readyLessonId,
  registerReadyLearner,
  watchCsp,
} from './support/learner-fixtures';

// Pha C (N3, N4, N8): one Từ vựng unit learned step by step. Its own topic
// and words on the HSK 7–9 seed lesson, idempotent per disposable DB.
// Pha F: the unit h1 is the unit label · the lesson title (seed HSK 7–9 lesson).
const SEED_LESSON = 'Academic discourse & literature';
const TOPIC = 'Gia đình e2e từng bước';
// One WordMeaning row per meaning: the quiz shows them all ("nhà; gia
// đình"), the result list only the first.
const WORDS = [
  { hanzi: '家', tone: 'jia1', vi: ['nhà', 'gia đình'], pos: 'danh từ' },
  { hanzi: '有', tone: 'you3', vi: ['có'], pos: null },
  { hanzi: '口', tone: 'kou3', vi: ['miệng', 'nhân khẩu'], pos: null },
] as const;
const EXAMPLE = {
  hanzi: '我家有四口人。',
  pinyin: 'wǒ jiā yǒu sì kǒu rén.',
  vi: 'Nhà tôi có bốn người.',
};

async function seedVocabularyUnit(): Promise<{
  lessonId: number;
  topicId: number;
}> {
  const lessonId = await readyLessonId('HSK7_9');
  if (!lessonId) throw new Error('seed has no ready HSK7_9 lesson');
  const readTopic = () =>
    queryDisposableDb(
      `SELECT id FROM "Topic" WHERE "lessonId" = ${lessonId} AND title = ${sqlLiteral(TOPIC)}`,
    );
  if (!readTopic()) {
    queryDisposableDb(
      [
        `INSERT INTO "Topic" ("lessonId", title, type, content, "orderIndex", status, "updatedAt")
          VALUES (${lessonId}, ${sqlLiteral(TOPIC)}, 'vocabulary'::"TopicType", '[]', 26,
            'published'::"ContentStatus", now());`,
        `INSERT INTO "DataSource" (code, name, version, "updatedAt")
          VALUES ('e2e-pha-c-examples', 'Kho câu kiểm thử Pha C', '0.1.0', now())
          ON CONFLICT (code) DO NOTHING;`,
        ...WORDS.map(
          (word, index) => `WITH w AS (
            INSERT INTO "Word" (hanzi, pinyin, "pinyinNormalized", "pinyinTone", status, "isPure", "publishedAt", "updatedAt")
            VALUES (${sqlLiteral(word.hanzi)}, ${sqlLiteral(word.tone)}, ${sqlLiteral(word.tone.replace(/\d/gu, ''))},
              ${sqlLiteral(word.tone)}, 'published'::"ContentStatus", true, now(), now())
            ON CONFLICT (hanzi, pinyin, "pinyinTone") DO UPDATE SET "updatedAt" = now()
            RETURNING id),
          m AS (INSERT INTO "WordMeaning" ("wordId", "meaningOrder", "meaningVi", "meaningViNormalized", "partOfSpeech", "updatedAt")
            ${word.vi
              .map(
                (vi, order) =>
                  `SELECT id, ${order + 1}, ${sqlLiteral(vi)}, ${sqlLiteral(vi)}, ${order === 0 && word.pos ? sqlLiteral(word.pos) : 'NULL'}, now() FROM w`,
              )
              .join(' UNION ALL ')}
            ON CONFLICT ("wordId", "meaningOrder") DO NOTHING),
          l AS (INSERT INTO "WordLevel" ("wordId", "levelId")
            SELECT w.id, lv.id FROM w, "Level" lv WHERE lv.code = 'HSK7_9'
            ON CONFLICT DO NOTHING)
          INSERT INTO "LessonWord" ("lessonId", "wordId", "topicId", "orderIndex")
            SELECT ${lessonId}, w.id, t.id, ${31 + index} FROM w, "Topic" t
            WHERE t."lessonId" = ${lessonId} AND t.title = ${sqlLiteral(TOPIC)}
            ON CONFLICT ("lessonId", "wordId") DO NOTHING;`,
        ),
        `INSERT INTO "WordExample" ("wordId", "orderIndex", hanzi, pinyin, "translationVi", "dataSourceId", status, "publishedAt", "updatedAt")
          SELECT w.id, 0, ${sqlLiteral(EXAMPLE.hanzi)}, ${sqlLiteral(EXAMPLE.pinyin)}, ${sqlLiteral(EXAMPLE.vi)},
            s.id, 'published'::"ContentStatus", now(), now()
          FROM "Word" w, "DataSource" s
          WHERE w.hanzi = '家' AND w."pinyinTone" = 'jia1' AND s.code = 'e2e-pha-c-examples'
            AND NOT EXISTS (SELECT 1 FROM "WordExample" e WHERE e."wordId" = w.id AND e."orderIndex" = 0);`,
      ].join('\n'),
    );
  }
  return { lessonId, topicId: Number(readTopic()) };
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectTargets44(page: Page, selector: string) {
  for (const control of await page.locator(selector).all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box?.height ?? 0, await control.innerText()).toBeGreaterThanOrEqual(
      44,
    );
    expect(box?.width ?? 0, await control.innerText()).toBeGreaterThanOrEqual(
      44,
    );
  }
}

const CONTROLS =
  'main button, main a, footer button, footer a, header a, header button';

test.describe('Từ vựng unit, step by step (Pha C: N3, N4, N8)', () => {
  test('card → example → quiz with Kiểm tra → result marks the unit done', async ({
    page,
    baseURL,
  }) => {
    const { lessonId, topicId } = await seedVocabularyUnit();
    await registerReadyLearner(page, baseURL);
    const cspConsole = await watchCsp(page);
    const lessonPath = `/learn/lessons/${lessonId}`;
    await page.goto(lessonPath);

    const row = page.locator('.lu-rows a.lu-row', { hasText: '家 · 有 · 口' });
    await expect(row).toHaveAttribute(
      'href',
      `${lessonPath}/vocabulary?unit=${topicId}`,
    );
    await expect(row).not.toHaveClass(/is-done/u);
    await row.click();
    await expect(page).toHaveURL(
      new RegExp(`${lessonPath}/vocabulary\\?unit=${topicId}$`, 'u'),
    );

    // 家: card, example, quiz; 有 and 口: card, quiz.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      new RegExp(`^Từ vựng \\d+ · ${SEED_LESSON}$`, 'u'),
    );
    await expect(page.locator('.m02-bar__count')).toHaveText('1/7');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('家');
    await expect(page.locator('.lu-py')).toHaveText('jiā');
    await expect(page.locator('.lu-pos')).toHaveText('Danh từ');
    await expect(page.locator('.lu-vi')).toHaveText('nhà; gia đình');
    await expect(page.getByRole('button', { name: /Nghe/u })).toHaveCount(0);
    await expectTargets44(page, CONTROLS);
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      'Câu ví dụ với 家',
    );
    await expect(page.locator('.lu-tok__py')).toHaveText([
      'wǒ',
      'jiā',
      'yǒu',
      'sì',
      'kǒu',
      'rén',
    ]);
    await expect(page.locator('.lu-tok.is-target .lu-tok__hz')).toHaveText(
      '家',
    );
    await expect(page.getByText(EXAMPLE.vi)).toBeVisible();
    await expectTargets44(page, CONTROLS);

    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    const group = page.getByRole('radiogroup', {
      name: 'Chọn nghĩa đúng của 家',
    });
    await expect(group.getByRole('radio')).toHaveCount(3);
    const check = page.getByRole('button', { name: 'Kiểm tra' });
    await expect(check).toHaveAttribute('aria-disabled', 'true');
    // N4: picking does not grade; Kiểm tra does.
    await group.getByRole('radio', { name: 'nhà; gia đình' }).click();
    await expect(page.locator('.m02-feedback')).toHaveCount(0);
    await expectTargets44(page, CONTROLS);
    await check.click();
    await expect(page.locator('.m02-feedback__title')).toHaveText('Chính xác');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // 有: answer wrong.
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    // Distractors come from the lesson's other words (other specs add some).
    await page.getByRole('radio', { name: 'có', exact: true }).waitFor();
    await page
      .getByRole('radio')
      .filter({ hasNotText: /^có$/u })
      .first()
      .click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.locator('.m02-feedback__title')).toHaveText('Chưa đúng');
    await expect(page.locator('.m02-feedback__text')).toHaveText(
      'Đáp án đúng: 有 yǒu là có.',
    );
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // 口: answer right.
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await page.getByRole('radio', { name: 'miệng; nhân khẩu' }).click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    const completed = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/learner/topics/${topicId}/complete`) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    expect((await completed).ok()).toBe(true);

    await expect(page.locator('.done-kicker')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      new RegExp(`^Từ vựng \\d+ · ${SEED_LESSON}$`, 'u'),
    );
    await expect(page.getByLabel('Trả lời đúng 67%')).toBeVisible();
    await expect(page.locator('.lu-words li')).toHaveText([
      /家\s*jiā\s*nhà\s*Đúng/u,
      /有\s*yǒu\s*có\s*Sai 1 lần/u,
      /口\s*kǒu\s*miệng\s*Đúng/u,
    ]);
    await expect(page.locator('.done-medal, .done-main img')).toHaveCount(0);
    await expectTargets44(page, '.done-actions a, .done-actions button');
    await expectNoHorizontalScroll(page);

    const saved = page.waitForResponse(
      (response) =>
        /\/api\/learner\/dictionary\/words\/\d+\/save$/u.test(response.url()) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Lưu để ôn' }).click();
    expect((await saved).ok()).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Đã lưu để ôn' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Về bài' }).click();
    await expect(page).toHaveURL(new RegExp(`${lessonPath}$`, 'u'));
    await expect(
      page.locator('.lu-rows .lu-row', { hasText: '家 · 有 · 口' }),
    ).toHaveClass(/is-done/u);

    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });

  test('saved words are in the review list (N3: Lưu để ôn on the result)', async ({
    page,
    baseURL,
  }) => {
    const { lessonId, topicId } = await seedVocabularyUnit();
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${lessonId}/vocabulary?unit=${topicId}`);
    // Through every step with the first option, then save.
    for (let step = 0; step < 7; step += 1) {
      const next = page.getByRole('button', { name: 'Tiếp', exact: true });
      if (await next.isVisible()) {
        await next.click();
        continue;
      }
      await page.getByRole('radio').first().click();
      await page.getByRole('button', { name: 'Kiểm tra' }).click();
      await page.getByRole('button', { name: 'Tiếp tục' }).click();
    }
    await page.getByRole('button', { name: 'Lưu để ôn' }).click();
    await expect(
      page.getByRole('button', { name: 'Đã lưu để ôn' }),
    ).toBeVisible();
    for (const word of WORDS) {
      const id = queryDisposableDb(
        `SELECT id FROM "Word" WHERE hanzi = ${sqlLiteral(word.hanzi)} AND "pinyinTone" = ${sqlLiteral(word.tone)}`,
      );
      await page.goto(`/learn/dictionary/${id}`);
      await expect(page.getByRole('button', { name: /Đã lưu/u })).toBeVisible();
    }
  });

  test('an unknown unit goes back to the lesson page', async ({
    page,
    baseURL,
  }) => {
    const { lessonId } = await seedVocabularyUnit();
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${lessonId}/vocabulary?unit=999999`);
    await expect(page).toHaveURL(
      new RegExp(`/learn/lessons/${lessonId}$`, 'u'),
    );
    await expect(page.locator('#lesson-content-title')).toHaveText(
      'Đơn vị học',
    );
  });
});
