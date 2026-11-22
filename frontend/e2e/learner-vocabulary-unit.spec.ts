import { expect, test, type Page } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';
import {
  readCspViolations,
  readyLessonId,
  registerReadyLearner,
  watchCsp,
} from './support/learner-fixtures';

// Pha C (N3, N8) + Pha G2a (thẻ mới, chọn nghĩa báo ngay): one Từ vựng unit learned step by step. Its own topic
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

// Pha G2c: a second unit with words of bài 01 (backend/content/hsk1): parts of
// speech and examples for all four review drills. Both units are seeded
// together so the fill distractors (every lesson word with a part of speech)
// are the same whichever test runs first.
const REVIEW_TOPIC = 'Chào hỏi e2e ôn tập';
type SeedWord = {
  hanzi: string;
  tone: string;
  vi: readonly string[];
  pos: string | null;
  example?: { hanzi: string; pinyin: string; vi: string };
};
const REVIEW_WORDS: readonly SeedWord[] = [
  {
    hanzi: '我',
    tone: 'wo3',
    vi: ['tôi, mình'],
    pos: 'đại từ',
    example: {
      hanzi: '我是学生。',
      pinyin: 'Wǒ shì xuéshēng.',
      vi: 'Tôi là học sinh.',
    },
  },
  {
    hanzi: '是',
    tone: 'shi4',
    vi: ['là'],
    pos: 'động từ',
    example: {
      hanzi: '他是我的老师。',
      pinyin: 'Tā shì wǒ de lǎoshī.',
      vi: 'Anh ấy là thầy giáo của tôi.',
    },
  },
  {
    hanzi: '他',
    tone: 'ta1',
    vi: ['anh ấy, ông ấy, nó (nam)'],
    pos: 'đại từ',
    example: {
      hanzi: '我们都是学生。',
      pinyin: 'Wǒmen dōu shì xuéshēng.',
      vi: 'Chúng tôi đều là học sinh.',
    },
  },
  { hanzi: '你', tone: 'ni3', vi: ['bạn'], pos: 'đại từ' },
  {
    hanzi: '老师',
    tone: 'lao3shi1',
    vi: ['thầy giáo, cô giáo'],
    pos: 'danh từ',
  },
];

function seedTopic(
  lessonId: number,
  title: string,
  order: number,
  firstWordOrder: number,
  words: readonly SeedWord[],
): string[] {
  return [
    `INSERT INTO "Topic" ("lessonId", title, type, content, "orderIndex", status, "updatedAt")
      VALUES (${lessonId}, ${sqlLiteral(title)}, 'vocabulary'::"TopicType", '[]', ${order},
        'published'::"ContentStatus", now());`,
    ...words.map(
      (word, index) => `WITH w AS (
        INSERT INTO "Word" (hanzi, pinyin, "pinyinNormalized", "pinyinTone", status, "isPure", "publishedAt", "updatedAt")
        VALUES (${sqlLiteral(word.hanzi)}, ${sqlLiteral(word.tone)}, ${sqlLiteral(word.tone.replace(/\d/gu, ''))},
          ${sqlLiteral(word.tone)}, 'published'::"ContentStatus", true, now(), now())
        ON CONFLICT (hanzi, pinyin, "pinyinTone") DO UPDATE SET "updatedAt" = now()
        RETURNING id),
      m AS (INSERT INTO "WordMeaning" ("wordId", "meaningOrder", "meaningVi", "meaningViNormalized", "partOfSpeech", "updatedAt")
        ${word.vi
          .map(
            (vi, meaningOrder) =>
              `SELECT id, ${meaningOrder + 1}, ${sqlLiteral(vi)}, ${sqlLiteral(vi)}, ${meaningOrder === 0 && word.pos ? sqlLiteral(word.pos) : 'NULL'}, now() FROM w`,
          )
          .join(' UNION ALL ')}
        ON CONFLICT ("wordId", "meaningOrder") DO NOTHING),
      l AS (INSERT INTO "WordLevel" ("wordId", "levelId")
        SELECT w.id, lv.id FROM w, "Level" lv WHERE lv.code = 'HSK7_9'
        ON CONFLICT DO NOTHING)
      INSERT INTO "LessonWord" ("lessonId", "wordId", "topicId", "orderIndex")
        SELECT ${lessonId}, w.id, t.id, ${firstWordOrder + index} FROM w, "Topic" t
        WHERE t."lessonId" = ${lessonId} AND t.title = ${sqlLiteral(title)}
        ON CONFLICT ("lessonId", "wordId") DO NOTHING;`,
    ),
    ...words.flatMap((word) =>
      word.example
        ? [
            `INSERT INTO "WordExample" ("wordId", "orderIndex", hanzi, pinyin, "translationVi", "dataSourceId", status, "publishedAt", "updatedAt")
              SELECT w.id, 0, ${sqlLiteral(word.example.hanzi)}, ${sqlLiteral(word.example.pinyin)}, ${sqlLiteral(word.example.vi)},
                s.id, 'published'::"ContentStatus", now(), now()
              FROM "Word" w, "DataSource" s
              WHERE w.hanzi = ${sqlLiteral(word.hanzi)} AND w."pinyinTone" = ${sqlLiteral(word.tone)} AND s.code = 'e2e-pha-c-examples'
                AND NOT EXISTS (SELECT 1 FROM "WordExample" e WHERE e."wordId" = w.id AND e."orderIndex" = 0);`,
          ]
        : [],
    ),
  ];
}

async function seedVocabularyUnit(): Promise<{
  lessonId: number;
  topicId: number;
  reviewTopicId: number;
}> {
  const lessonId = await readyLessonId('HSK7_9');
  if (!lessonId) throw new Error('seed has no ready HSK7_9 lesson');
  const readTopic = (title: string) =>
    queryDisposableDb(
      `SELECT id FROM "Topic" WHERE "lessonId" = ${lessonId} AND title = ${sqlLiteral(title)}`,
    );
  if (!readTopic(TOPIC)) {
    queryDisposableDb(
      [
        `INSERT INTO "DataSource" (code, name, version, "updatedAt")
          VALUES ('e2e-pha-c-examples', 'Kho câu kiểm thử Pha C', '0.1.0', now())
          ON CONFLICT (code) DO NOTHING;`,
        ...seedTopic(
          lessonId,
          TOPIC,
          26,
          31,
          WORDS.map((word, index) => ({
            ...word,
            example: index === 0 ? EXAMPLE : undefined,
          })),
        ),
        ...seedTopic(lessonId, REVIEW_TOPIC, 27, 51, REVIEW_WORDS),
      ].join('\n'),
    );
  }
  return {
    lessonId,
    topicId: Number(readTopic(TOPIC)),
    reviewTopicId: Number(readTopic(REVIEW_TOPIC)),
  };
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

const leftCells = (page: Page) =>
  page.locator('.mt-col[aria-labelledby="mt-col-left"] .mt-cell');
const rightCell = (page: Page, pair: string) =>
  page.locator(
    `.mt-col[aria-labelledby="mt-col-right"] .mt-cell[data-pair="${pair}"]`,
  );

/** Pairs every open word with its meaning. */
async function finishMatching(page: Page) {
  const pairs = await leftCells(page).evaluateAll((cells) =>
    cells
      .filter((cell) => !cell.classList.contains('is-done'))
      .map((cell) => cell.getAttribute('data-pair') ?? ''),
  );
  for (const pair of pairs) {
    await leftCells(page)
      .and(page.locator(`[data-pair="${pair}"]`))
      .click();
    await rightCell(page, pair).click();
  }
}

/** Pha G2c: through the review drills with right answers, to the result. */
async function finishDrills(page: Page) {
  for (let drill = 0; drill < 4; drill += 1) {
    const screen = page
      .locator('.mt-grid, .g-fill, .g-bank, .done-kicker')
      .first();
    await screen.waitFor();
    if (await page.locator('.done-kicker').isVisible()) return;
    if (await page.locator('.mt-grid').isVisible()) {
      await finishMatching(page);
    } else if (await page.locator('.g-fill').isVisible()) {
      await page.getByRole('radio').first().click();
    } else {
      const open = page.locator('.g-bank .g-tok:not(.is-used)');
      while ((await open.count()) > 0) await open.first().click();
      await page.getByRole('button', { name: 'Xác nhận' }).click();
    }
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
  }
}

test.describe('Từ vựng unit, step by step (Pha C: N3, N8; Pha G2a)', () => {
  test('card → example → quiz graded on choice → result marks the unit done', async ({
    page,
    baseURL,
  }) => {
    const { lessonId, topicId } = await seedVocabularyUnit();
    // A device without a zh voice (Linux CI has none; macOS ships some).
    await page.addInitScript(() => {
      speechSynthesis.getVoices = () => [];
    });
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

    // 家: card, example, quiz; 有 and 口: card, quiz; G2c: ghép cặp, điền,
    // sắp xếp (no zh voice: no "nghe rồi sắp xếp").
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      new RegExp(`^Từ vựng \\d+ · ${SEED_LESSON}$`, 'u'),
    );
    await expect(page.locator('.m02-bar__count')).toHaveText('1/10');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('家');
    // Pha G2a (mẫu vu-card-noimg): no image, so the big-hanzi card.
    await expect(page.locator('.g-card')).toHaveClass(/g-card--noimg/u);
    await expect(page.locator('.g-py')).toHaveText('jiā');
    await expect(page.locator('.g-pos')).toHaveText('danh từ');
    await expect(page.locator('.g-vi')).toHaveText('nhà; gia đình');
    // No zh voice: Nghe is hidden; Chromium records, so Nói (Pha G2b);
    // Viết is G2d.
    await expect(
      page.getByRole('group', { name: 'Luyện từ này' }).getByRole('button'),
    ).toHaveText(['Nói', 'Tiếp']);
    await expectTargets44(page, CONTROLS);
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    const example = page.getByRole('region', { name: 'Câu ví dụ với 家' });
    await expect(example.locator('.g-ex__cn')).toHaveText(EXAMPLE.hanzi);
    await expect(example.locator('.g-ex__cn mark')).toHaveText('家');
    await expect(example.locator('.g-ex__py')).toHaveText(EXAMPLE.pinyin);
    await expect(example.locator('.g-ex__vi')).toHaveText(EXAMPLE.vi);
    await expect(page.getByRole('button', { name: /Nghe/u })).toHaveCount(0);
    await expectTargets44(page, CONTROLS);

    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    const group = page.getByRole('radiogroup', {
      name: 'Chọn nghĩa đúng của 家',
    });
    await expect(group.getByRole('radio')).toHaveCount(3);
    // PO 20/11/2026 (thay N4/Q51): no Kiểm tra; the arrows only move focus,
    // choosing grades at once.
    await expect(page.getByRole('button', { name: 'Kiểm tra' })).toHaveCount(0);
    await expectTargets44(page, CONTROLS);
    await group.getByRole('radio').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.g-fb')).toHaveCount(0);
    await group.getByRole('radio', { name: 'nhà; gia đình' }).click();
    await expect(page.locator('.g-fb__title')).toHaveText('Chính xác');
    await expect(page.locator('.g-fb__text')).toHaveText(
      '家 jiā nghĩa là nhà, gia đình.',
    );
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
    await expect(page.locator('.g-fb__title')).toHaveText('Chưa đúng');
    await expect(page.locator('.g-fb__text')).toHaveText(
      'Đáp án đúng: 有 yǒu là có.',
    );
    await expect(page.locator('.ex-foot button')).toHaveText(['Tiếp tục']);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // 口: answer right.
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await page.getByRole('radio', { name: 'miệng; nhân khẩu' }).click();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // Pha G2c: the review drills end the unit; their answers are not scored.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      'Ôn tập 1/3 · Ghép từ với nghĩa',
    );
    const completed = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/learner/topics/${topicId}/complete`) &&
        response.request().method() === 'POST',
    );
    await finishDrills(page);
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
      await page.getByRole('button', { name: 'Tiếp tục' }).click();
    }
    await finishDrills(page);
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

  test('a unit ends with the four review drills, graded on the device (Pha G2c)', async ({
    page,
    baseURL,
  }) => {
    const { lessonId, reviewTopicId } = await seedVocabularyUnit();
    // A zh voice that records what it is asked to say (Linux CI has none).
    await page.addInitScript(() => {
      const spoken: Array<{ text: string; rate: number }> = [];
      Reflect.set(window, '__spoken', spoken);
      class Utterance {
        text: string;
        rate = 1;
        lang = '';
        voice: unknown = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      Reflect.set(window, 'SpeechSynthesisUtterance', Utterance);
      const voice = { lang: 'zh-CN', localService: true, name: 'e2e zh' };
      Object.defineProperty(speechSynthesis, 'getVoices', {
        value: () => [voice],
      });
      Object.defineProperty(speechSynthesis, 'cancel', { value: () => {} });
      Object.defineProperty(speechSynthesis, 'speak', {
        value: (utterance: Utterance) =>
          spoken.push({ text: utterance.text, rate: utterance.rate }),
      });
    });
    await registerReadyLearner(page, baseURL);
    const cspConsole = await watchCsp(page);
    await page.goto(
      `/learn/lessons/${lessonId}/vocabulary?unit=${reviewTopicId}`,
    );
    // 我, 是, 他: card, example, quiz; 你, 老师: card, quiz; then 4 drills.
    await expect(page.locator('.m02-bar__count')).toHaveText('1/17');
    const drillScreen = page.locator('.mt-grid, .g-fill, .g-bank').first();
    const tiep = page.getByRole('button', { name: 'Tiếp', exact: true });
    const meaning = page.getByRole('radiogroup');
    for (let step = 0; step < 13; step += 1) {
      await expect(tiep.or(meaning).first()).toBeVisible();
      if (await meaning.isVisible()) {
        await meaning.getByRole('radio').first().click();
        await page.getByRole('button', { name: 'Tiếp tục' }).click();
      } else {
        await tiep.click();
      }
    }
    await expect(drillScreen).toBeVisible();
    // Q-G8: graded here, nothing is written while the drills run.
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(request.url());
    });
    const footButtons = page.locator('.ex-foot button');

    // 1/4 ghép cặp (mẫu vu-matching): ✕ on a wrong pair, then every pair.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      'Ôn tập 1/4 · Ghép từ với nghĩa',
    );
    await expect(page.locator('.m02-bar__count')).toHaveText('14/17');
    await expect(leftCells(page)).toHaveCount(5);
    await expectTargets44(page, CONTROLS);
    await expectNoHorizontalScroll(page);
    await leftCells(page)
      .filter({ hasText: /^wǒ我$/u })
      .click();
    await page
      .locator('.mt-col[aria-labelledby="mt-col-right"] .mt-cell', {
        hasText: /^là$/u,
      })
      .click();
    await expect(page.locator('.mt-cell.is-wrong')).toHaveCount(2);
    await expect(page.locator('.mt-cell.is-wrong')).toHaveCount(0);
    await finishMatching(page);
    await expect(page.locator('.g-fb__title')).toHaveText(
      'Hoàn thành · Sai 1 lần',
    );
    await expect(footButtons).toHaveText(['Tiếp tục']);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // 2/4 điền chỗ trống (mẫu vu-fill): distractors of another part of
    // speech, each with its pinyin (Q-G3, Q-G6); graded on choice.
    await expect(page.locator('.g-kicker')).toHaveText(
      'Ôn tập 2/4 · Điền chỗ trống',
    );
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      'Chọn từ điền vào chỗ trống',
    );
    await expect(page.locator('.g-fill')).toHaveText(/^\s*是学生。$/u);
    await expect(page.locator('.g-sub')).toHaveText('Tôi là học sinh.');
    const options = page.getByRole('radio');
    await expect(options).toHaveCount(4);
    await expect(page.locator('.g-opt .g-chip__py')).toHaveCount(4);
    await expect(
      page.getByRole('button', { name: /Kiểm tra|Xác nhận/u }),
    ).toHaveCount(0);
    await expectTargets44(page, CONTROLS);
    await expectNoHorizontalScroll(page);
    await options.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.g-fb')).toHaveCount(0);
    await options.filter({ hasNotText: '我' }).first().click();
    await expect(page.locator('.g-fb__title')).toHaveText('Chưa đúng');
    await expect(page.locator('.g-fb__text')).toHaveText(
      'Câu đúng: 我是学生。',
    );
    await expect(options.filter({ hasText: '我' })).toHaveClass(/is-right/u);
    await expect(footButtons).toHaveText(['Tiếp tục']);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // 3/4 sắp xếp theo nghĩa (mẫu vu-arrange-vi): Xác nhận once every chip
    // is placed (Q-G4).
    await expect(page.locator('.g-kicker')).toHaveText('Ôn tập 3/4 · Sắp xếp');
    await expect(page.locator('.g-prompt')).toHaveText(
      'Anh ấy là thầy giáo của tôi.',
    );
    const confirm = page.getByRole('button', { name: 'Xác nhận' });
    await expect(confirm).toBeDisabled();
    await expect(page.locator('.g-note')).toHaveText(
      'Còn 5 mảnh. Xếp đủ rồi bấm Xác nhận.',
    );
    await expectTargets44(page, CONTROLS);
    await expectNoHorizontalScroll(page);
    for (const chip of ['他', '是', '我', '的', '老师']) {
      await page.getByRole('button', { name: `Thêm ${chip}` }).click();
    }
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.locator('.g-fb__title')).toHaveText('Chính xác');
    await expect(page.locator('.g-fb__text')).toHaveText('他是我的老师。');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // 4/4 nghe rồi sắp xếp (mẫu vu-listen-arrange): spoken only on request.
    await expect(page.locator('.g-kicker')).toHaveText(
      'Ôn tập 4/4 · Nghe và sắp xếp',
    );
    await page.getByRole('button', { name: 'Nghe câu' }).click();
    await page.getByRole('button', { name: 'Nghe chậm' }).click();
    expect(await page.evaluate(() => Reflect.get(window, '__spoken'))).toEqual([
      { text: '我们都是学生。', rate: 0.9 },
      { text: '我们都是学生。', rate: 0.6 },
    ]);
    await expectTargets44(page, CONTROLS);
    await expectNoHorizontalScroll(page);
    for (const chip of ['我们', '都', '是', '学生']) {
      await page.getByRole('button', { name: `Thêm ${chip}` }).click();
    }
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.locator('.g-fb__title')).toHaveText('Chính xác');
    await expect(page.locator('.g-reveal')).toHaveText(
      'Wǒmen dōu shì xuéshēng. Chúng tôi đều là học sinh.',
    );
    expect(writes).toEqual([]);

    const completed = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/learner/topics/${reviewTopicId}/complete`) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    expect((await completed).ok()).toBe(true);
    await expect(page.locator('.done-kicker')).toBeVisible();
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
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

// Pha G2b: Nói records the learner's own voice and plays it back, nothing
// graded or sent. A Web Audio tone stands in for the microphone, so the real
// MediaRecorder records it without a device or a permission prompt.
test.describe('Từ vựng unit: Nói (Pha G2b)', () => {
  test('records the word for at most 5 s and the sentence for 10 s, in the page only', async ({
    page,
    baseURL,
  }) => {
    const { lessonId, topicId } = await seedVocabularyUnit();
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async () => {
          const audio = new AudioContext();
          const tone = audio.createOscillator();
          const out = audio.createMediaStreamDestination();
          tone.connect(out);
          tone.start();
          return out.stream;
        },
      });
    });
    await registerReadyLearner(page, baseURL);
    const cspConsole = await watchCsp(page);
    const response = await page.goto(
      `/learn/lessons/${lessonId}/vocabulary?unit=${topicId}`,
    );
    // Q-G2: the microphone for this origin only, nothing else opened.
    expect(response?.headers()['permissions-policy']).toBe(
      'camera=(), microphone=(self), geolocation=()',
    );
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(request.url());
    });

    const say = page.getByRole('button', { name: 'Nói', exact: true });
    await expect(say).toHaveAttribute('aria-pressed', 'false');
    await say.click();
    await expect(say).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.g-sheet__text')).toHaveText(
      'Đọc to 家 (jiā). Tự dừng sau 5 giây.',
    );
    await expect(page.locator('.g-dock [role="status"]')).toHaveText(
      'Đang ghi âm',
    );
    await expectTargets44(page, CONTROLS);
    // Stops by itself at 5 s.
    await expect(page.getByText('Đã ghi xong', { exact: true })).toBeVisible({
      timeout: 8000,
    });
    await expect(say).toHaveAttribute('aria-pressed', 'false');
    const take = await page.evaluate(
      () => document.querySelectorAll('audio').length,
    );
    expect(take).toBe(0);
    await page.getByRole('button', { name: 'Bạn đọc' }).click();
    await expect(
      page.getByText(
        'Bản ghi chỉ nằm trên máy này, không gửi đi và mất khi rời màn hình.',
      ),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await expect(page.getByText('Đã ghi xong', { exact: true })).toHaveCount(0);
    await say.click();
    await expect(page.locator('.g-sheet__text')).toHaveText(
      'Đọc to 我家有四口人。 (wǒ jiā yǒu sì kǒu rén.). Tự dừng sau 10 giây.',
    );
    await page.getByRole('button', { name: 'Dừng ghi' }).click();
    await expect(page.getByText('Đã ghi xong', { exact: true })).toBeVisible();

    expect(writes).toEqual([]);
    expect(
      await page.evaluate(async () => ({
        local: localStorage.length,
        session: sessionStorage.length,
        databases: (await indexedDB.databases()).length,
      })),
    ).toEqual({ local: 0, session: 0, databases: 0 });
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });
});

// The learner says no to the microphone (headless Chromium would leave the
// prompt open, so the refusal is what getUserMedia answers).
test.describe('Từ vựng unit: Nói without the microphone (Pha G2b)', () => {
  test('a refused microphone says so and the unit goes on', async ({
    page,
    baseURL,
  }) => {
    const { lessonId, topicId } = await seedVocabularyUnit();
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: () =>
          Promise.reject(
            new DOMException('Permission denied', 'NotAllowedError'),
          ),
      });
    });
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${lessonId}/vocabulary?unit=${topicId}`);
    await page.getByRole('button', { name: 'Nói', exact: true }).click();
    await expect(page.locator('.g-sheet[role="alert"]')).toContainText(
      'Chưa có quyền dùng micro',
    );
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Câu ví dụ với 家' }),
    ).toBeVisible();
  });
});

// Pha G2d: Viết on the bài 01 unit. Synthetic two-stroke characters (a
// horizontal, then a vertical line, Make Me a Hanzi coordinates) for 我 and
// 老师; 是 stays without strokes so its card has no Viết. The Pha C unit
// (家, 有, 口) is left without strokes for its Nói · Tiếp assertions.
const STROKE_SOURCE = 'e2e-g2d-strokes';
const STROKE_DATA = {
  strokes: [
    'M 200 450 L 800 450 L 800 550 L 200 550 Z',
    'M 450 800 L 550 800 L 550 200 L 450 200 Z',
  ],
  medians: [
    [
      [200, 500],
      [800, 500],
    ],
    [
      [500, 800],
      [500, 200],
    ],
  ],
};
type Median = Array<[number, number]>;

function seedStrokes() {
  queryDisposableDb(
    [
      `INSERT INTO "DataSource" (code, name, version, license, attribution, "referenceUrl", "updatedAt")
        VALUES ('${STROKE_SOURCE}', 'Nét kiểm thử G2d', '0.1.0', 'Arphic Public License',
          'Dữ liệu nét chữ kiểm thử G2d', 'https://example.test/strokes', now())
        ON CONFLICT (code) DO NOTHING;`,
      ...['我', '老', '师'].map(
        (
          hanzi,
        ) => `INSERT INTO "Character" (hanzi, "strokeCount", "strokeData", "dataSourceId", "updatedAt")
          SELECT ${sqlLiteral(hanzi)}, 2, ${sqlLiteral(JSON.stringify(STROKE_DATA))}::jsonb, s.id, now()
          FROM "DataSource" s WHERE s.code = '${STROKE_SOURCE}'
          ON CONFLICT (hanzi) DO UPDATE SET "strokeCount" = 2,
            "strokeData" = EXCLUDED."strokeData", "dataSourceId" = EXCLUDED."dataSourceId", "updatedAt" = now();`,
      ),
      `UPDATE "Character" SET "strokeData" = NULL, "strokeCount" = NULL WHERE hanzi = '是';`,
    ].join('\n'),
  );
}

/** Draws one stroke along a median with the mouse, in a few moves. */
async function drawStroke(page: Page, median: Median) {
  const box = await page.locator('.g-board svg').boundingBox();
  if (!box) throw new Error('no board');
  const at = ([x, y]: [number, number]) => ({
    x: box.x + (x / 1024) * box.width,
    y: box.y + ((900 - y) / 1024) * box.height,
  });
  const [first, last] = [median[0], median[median.length - 1]];
  if (!first || !last) throw new Error('empty median');
  const start = at(first);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k += 1) {
    const point = at([
      first[0] + ((last[0] - first[0]) * k) / 8,
      first[1] + ((last[1] - first[1]) * k) / 8,
    ]);
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.up();
}

test.describe('Từ vựng unit: Viết (Pha G2d)', () => {
  test('writes a one-character word stroke by stroke, with a hint after a miss', async ({
    page,
    baseURL,
  }) => {
    const { lessonId, reviewTopicId } = await seedVocabularyUnit();
    seedStrokes();
    await registerReadyLearner(page, baseURL);
    const cspConsole = await watchCsp(page);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(request.url());
    });
    const strokesRead = page.waitForResponse((response) =>
      response.url().includes('/api/learner/dictionary/strokes?hanzi='),
    );
    await page.goto(
      `/learn/lessons/${lessonId}/vocabulary?unit=${reviewTopicId}`,
    );
    const read = await strokesRead;
    expect(read.url()).toContain(
      `/api/learner/dictionary/strokes?hanzi=${encodeURIComponent('我')}`,
    );
    // The BFF answers no-store; the backend's one-day cache stays server side.
    expect(read.headers()['cache-control']).toBe('no-store');
    const medians = (
      (await read.json()) as {
        data: { characters: Array<{ medians: Median[] }> };
      }
    ).data.characters[0]?.medians;
    if (!medians) throw new Error('no medians');

    const group = page.getByRole('group', { name: 'Luyện từ này' });
    // Mẫu: Nghe · Nói · Viết · Tiếp (Nghe only with a zh voice).
    expect((await group.getByRole('button').allInnerTexts()).slice(-3)).toEqual(
      ['Nói', 'Viết', 'Tiếp'],
    );
    const write = page.getByRole('button', { name: 'Viết', exact: true });
    await write.click();
    const dialog = page.getByRole('dialog', { name: /^Viết 我/u });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Đóng bảng viết' }),
    ).toBeFocused();
    await expect(
      dialog.getByRole('link', { name: 'Dữ liệu nét chữ kiểm thử G2d' }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.locator('.g-wstat')).toHaveText('Xong 2/2 nét');

    await page.getByRole('button', { name: 'Tự viết' }).click();
    await expect(page.locator('.g-wstat')).toHaveText('Nét 1/2');
    const [first, second] = medians;
    if (!first || !second) throw new Error('two strokes expected');
    await drawStroke(page, second);
    await expect(page.locator('.g-board')).toHaveClass(/is-miss/u);
    await expect(page.locator('.g-board .hint')).toHaveCount(1);
    await expect(page.locator('.g-wstat')).toHaveText('Nét 1/2');
    await expect(dialog.getByRole('status')).toContainText(
      'Chưa khớp, thử lại nét này',
    );
    await drawStroke(page, first);
    await expect(page.locator('.g-wstat')).toHaveText('Nét 2/2');
    await drawStroke(page, second);
    await expect(page.locator('.g-wstat')).toHaveText('Xong 2/2 nét');
    await expectTargets44(page, '.g-dialog button');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(write).toBeFocused();
    await expectNoHorizontalScroll(page);

    // The example step has no Viết.
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await expect(page.locator('.g-ex')).toBeVisible();
    await expect(group.getByRole('button', { name: 'Viết' })).toHaveCount(0);
    expect(writes).toEqual([]);
    // 是 has no strokes: its card has no Viết.
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await page.getByRole('radiogroup').getByRole('radio').first().click();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.locator('.g-hz')).toHaveText('是');
    await expect(group.getByRole('button', { name: 'Tiếp' })).toBeVisible();
    await expect(group.getByRole('button', { name: 'Viết' })).toHaveCount(0);
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });

  test('a two-character word moves to its second character by itself (Q-G5)', async ({
    page,
    baseURL,
  }) => {
    const { lessonId, reviewTopicId } = await seedVocabularyUnit();
    seedStrokes();
    await registerReadyLearner(page, baseURL);
    await page.goto(
      `/learn/lessons/${lessonId}/vocabulary?unit=${reviewTopicId}`,
    );
    // 我, 是, 他: card, example, quiz; 你: card, quiz; then 老师's card.
    const tiep = page.getByRole('button', { name: 'Tiếp', exact: true });
    const meaning = page.getByRole('radiogroup');
    for (let step = 0; step < 11; step += 1) {
      await expect(tiep.or(meaning).first()).toBeVisible();
      if (await meaning.isVisible()) {
        await meaning.getByRole('radio').first().click();
        await page.getByRole('button', { name: 'Tiếp tục' }).click();
      } else {
        await tiep.click();
      }
    }
    await expect(page.locator('.g-hz')).toHaveText('老师');
    const write = page.getByRole('button', { name: 'Viết', exact: true });
    await write.click();
    await expect(page.locator('.g-wstat')).toHaveText('Chữ 1/2 · Xong 2/2 nét');
    await page.getByRole('button', { name: 'Tự viết' }).click();
    const [first, second] = STROKE_DATA.medians as Median[];
    if (!first || !second) throw new Error('two strokes expected');
    await drawStroke(page, first);
    await drawStroke(page, second);
    await expect(page.locator('.g-wstat')).toHaveText('Chữ 2/2 · Nét 1/2');
    await expect(
      page.getByRole('img', { name: 'Lưới chữ điền và chữ 师, 2 nét' }),
    ).toBeVisible();
    await drawStroke(page, first);
    await drawStroke(page, second);
    await expect(page.locator('.g-wstat')).toHaveText('Chữ 2/2 · Xong 2/2 nét');
    await page.getByRole('button', { name: 'Đóng bảng viết' }).click();
    await expect(write).toBeFocused();
  });
});
