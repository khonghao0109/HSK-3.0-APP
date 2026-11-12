import { expect, test, type Page } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';
import {
  readCspViolations,
  registerReadyLearner,
  watchCsp,
} from './support/learner-fixtures';

// M3.3a: the flashcard review session against the disposable e2e DB. Three
// published words are inserted once per DB with psql; each test registers a
// fresh learner and saves them, which creates three due cards (A.5, Q251).
const WORDS = [
  { hanzi: '测试复习一', pinyinTone: 'cèshì fùxí yī', vi: 'ôn tập thử một' },
  { hanzi: '测试复习二', pinyinTone: 'cèshì fùxí èr', vi: 'ôn tập thử hai' },
  { hanzi: '测试复习三', pinyinTone: 'cèshì fùxí sān', vi: 'ôn tập thử ba' },
] as const;

function insertWord(word: (typeof WORDS)[number]): string {
  return `WITH w AS (
      INSERT INTO "Word" (hanzi, pinyin, "pinyinNormalized", "pinyinTone", example, status, "isPure", "publishedAt", "updatedAt")
      VALUES (${sqlLiteral(word.hanzi)}, 'ce4 shi4 fu4 xi2', 'ce shi fu xi', ${sqlLiteral(word.pinyinTone)},
        NULL, 'published'::"ContentStatus", true, now(), now())
      RETURNING id),
    m AS (INSERT INTO "WordMeaning" ("wordId", "meaningOrder", "meaningVi", "meaningEn", "meaningViNormalized", "meaningEnNormalized", "updatedAt")
      SELECT id, 1, ${sqlLiteral(word.vi)}, 'review probe', ${sqlLiteral(word.vi)}, 'review probe', now() FROM w)
    SELECT id FROM w;`;
}

function wordIds(): number[] {
  const read = () =>
    queryDisposableDb(
      `SELECT id FROM "Word" WHERE hanzi IN (${WORDS.map((w) => sqlLiteral(w.hanzi)).join(', ')}) ORDER BY id`,
    );
  if (!read()) for (const word of WORDS) queryDisposableDb(insertWord(word));
  const ids = read().split('\n').map(Number);
  if (ids.length !== WORDS.length || ids.some((id) => !id)) {
    throw new Error(`review fixture words missing: ${read()}`);
  }
  return ids;
}

/** Saves through the BFF from the page so the Origin check is real. */
async function saveWords(page: Page, ids: number[]): Promise<void> {
  await page.goto('/learn');
  for (const id of ids) {
    const status = await page.evaluate(
      async (wordId) =>
        (
          await fetch(`/api/learner/dictionary/words/${String(wordId)}/save`, {
            method: 'POST',
          })
        ).status,
      id,
    );
    expect(status).toBe(200);
  }
}

const front = (page: Page) => page.locator('.fc-face--front .fc-hz');
const flip = (page: Page) =>
  page.getByRole('button', { name: /^Lật (thẻ|lại)/ });
const gradeButton = (page: Page, label: string) =>
  page.getByRole('button', { name: new RegExp(`^${label}, gặp lại sau `) });

async function expectCounter(page: Page, text: string): Promise<void> {
  await expect(
    page
      .getByRole('progressbar', { name: 'Tiến độ phiên ôn tập' })
      .filter({ visible: true }),
  ).toHaveAttribute('aria-valuetext', `Thẻ ${text.split(' / ')[0]} trên 3`);
  await expect(
    page
      .locator('.rv-count .tabular, .fc-top__count')
      .filter({ visible: true }),
  ).toHaveText(text);
}

test.describe('Learner review session (M3.3a)', () => {
  let ids: number[];

  test.beforeAll(() => {
    ids = wordIds();
  });

  test('flips and grades three cards, then shows the summary', async ({
    page,
    baseURL,
  }) => {
    const csp = await watchCsp(page);
    await registerReadyLearner(page, baseURL);
    await saveWords(page, ids);
    await page.goto('/learn/review/session');
    await expect(page).toHaveTitle('Ôn tập · Hán Lộ');

    await expect(front(page)).toHaveText(WORDS[0].hanzi);
    await expect(page.getByText('Chạm vào thẻ để lật mặt sau')).toBeVisible();
    await expectCounter(page, '1 / 3');
    // Q261: a new card's again/hard/good previews are minutes away.
    await expect(gradeButton(page, 'Chưa nhớ')).toHaveAccessibleName(/phút$/);

    await flip(page).click();
    await expect(flip(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.fc-back__vi')).toHaveText(WORDS[0].vi);
    await expect(page.locator('.fc-back__py')).toContainText(
      WORDS[0].pinyinTone,
    );
    await gradeButton(page, 'Chưa nhớ').click();

    await expect(front(page)).toHaveText(WORDS[1].hanzi);
    await expectCounter(page, '2 / 3');
    await flip(page).click();
    await gradeButton(page, 'Tốt').click();

    await expect(front(page)).toHaveText(WORDS[2].hanzi);
    await expectCounter(page, '3 / 3');
    await page.keyboard.press('4');

    await expect(
      page.getByRole('heading', { name: 'Ôn tập hôm nay' }),
    ).toBeVisible();
    const stat = (title: string) =>
      page.locator('.rv-stat', {
        has: page.getByRole('heading', { name: title, exact: true }),
      });
    await expect(stat('Thẻ đã ôn').locator('b')).toHaveText('3');
    await expect(stat('Nhớ').locator('b')).toHaveText('2');
    await expect(stat('Chưa nhớ').locator('b')).toHaveText('1');
    await expect(page.locator('.rv-meta')).toContainText('Tỷ lệ ghi nhớ 67%');
    await expect(page.locator('.rv-meta')).toContainText(
      /Thời gian \d+ phút \d+ giây/,
    );
    await expect(
      page.getByText('Phiên ôn không cộng XP hay huy hiệu', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Về trang chủ' }),
    ).toHaveAttribute('href', '/learn');
    expect(await readCspViolations(page)).toEqual(csp);
  });

  test('resumes after a reload without the graded card', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await saveWords(page, ids);
    await page.goto('/learn/review/session');
    await expect(front(page)).toHaveText(WORDS[0].hanzi);
    await gradeButton(page, 'Khó').click();
    await expect(front(page)).toHaveText(WORDS[1].hanzi);

    await page.reload();
    await expect(front(page)).toHaveText(WORDS[1].hanzi);
    await expectCounter(page, '2 / 3');
    await expect(
      page.locator('.fc-hz', { hasText: WORDS[0].hanzi }),
    ).toHaveCount(0);
  });

  test('shows the empty state when nothing is due', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/review/session');
    await expect(page.getByText('Không có thẻ đến hạn')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Lộ trình học' }),
    ).toHaveAttribute('href', '/learn/path');
    await expect(
      page.locator('.rv-state').getByRole('link', { name: 'Tra từ' }),
    ).toHaveAttribute('href', '/learn/dictionary');
  });

  test('can be flipped and graded with the keyboard only', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await saveWords(page, ids);
    await page.goto('/learn/review/session');
    await expect(front(page)).toHaveText(WORDS[0].hanzi);

    // Tab from the close link reaches the card.
    await page.getByRole('link', { name: 'Đóng phiên ôn tập' }).focus();
    await page.keyboard.press('Tab');
    await expect(flip(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(flip(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(flip(page)).toHaveAttribute('aria-pressed', 'false');

    const keys = ['3', '1', '2'] as const;
    for (const [index, word] of WORDS.entries()) {
      await expect(front(page)).toHaveText(word.hanzi);
      await page.keyboard.press(keys[index] ?? '3');
      if (index < WORDS.length - 1) await expect(flip(page)).toBeFocused();
    }
    await expect(
      page.getByRole('heading', { name: 'Ôn tập hôm nay' }),
    ).toBeVisible();
  });
});
