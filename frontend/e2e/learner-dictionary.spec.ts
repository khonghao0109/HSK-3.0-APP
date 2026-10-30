import { expect, test, type Page } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';
import {
  readCspViolations,
  registerReadyLearner,
  watchCsp,
} from './support/learner-fixtures';

// M2.6b: Tra từ and Chi tiết từ against the disposable e2e DB. The fixture
// words are inserted once per DB with psql (the Admin CMS has no word API);
// each Playwright project re-runs beforeAll and reuses them.
const WORD = {
  hanzi: '测试词典',
  traditional: '測試詞典',
  pinyin: 'ce4 shi4 ci2 dian3',
  pinyinNormalized: 'ce shi ci dian',
  pinyinTone: 'cèshì cídiǎn',
  example: '我用测试词典学习。',
  vi: 'từ điển kiểm thử',
  viNormalized: 'tu dien kiem thu',
  en: 'e2e dictionary probe',
};
const DRAFT_HANZI = '测试词典草稿';

function insertWord(options: {
  hanzi: string;
  traditional: string | null;
  example: string | null;
  status: 'published' | 'draft';
}): string {
  const published = options.status === 'published';
  return `WITH w AS (
      INSERT INTO "Word" (hanzi, traditional, pinyin, "pinyinNormalized", "pinyinTone", example, status, "isPure", "publishedAt", "updatedAt")
      VALUES (${sqlLiteral(options.hanzi)}, ${options.traditional === null ? 'NULL' : sqlLiteral(options.traditional)},
        ${sqlLiteral(WORD.pinyin)}, ${sqlLiteral(WORD.pinyinNormalized)}, ${sqlLiteral(WORD.pinyinTone)},
        ${options.example === null ? 'NULL' : sqlLiteral(options.example)},
        '${options.status}'::"ContentStatus", true, ${published ? 'now()' : 'NULL'}, now())
      RETURNING id),
    m AS (INSERT INTO "WordMeaning" ("wordId", "meaningOrder", "meaningVi", "meaningEn", "meaningViNormalized", "meaningEnNormalized", "updatedAt")
      SELECT id, 1, ${sqlLiteral(WORD.vi)}, ${sqlLiteral(WORD.en)}, ${sqlLiteral(WORD.viNormalized)}, ${sqlLiteral(WORD.en)}, now() FROM w),
    l AS (INSERT INTO "WordLevel" ("wordId", "levelId") SELECT w.id, lv.id FROM w, "Level" lv WHERE lv.code = 'HSK1')
    SELECT id FROM w;`;
}

function fixtureIds(): { word: number; draft: number } {
  const read = () =>
    queryDisposableDb(
      `SELECT hanzi || '|' || id FROM "Word" WHERE hanzi IN (${sqlLiteral(WORD.hanzi)}, ${sqlLiteral(DRAFT_HANZI)}) ORDER BY id`,
    );
  if (!read()) {
    queryDisposableDb(
      insertWord({
        hanzi: WORD.hanzi,
        traditional: WORD.traditional,
        example: WORD.example,
        status: 'published',
      }),
    );
    queryDisposableDb(
      insertWord({
        hanzi: DRAFT_HANZI,
        traditional: null,
        example: null,
        status: 'draft',
      }),
    );
  }
  const ids = Object.fromEntries(
    read()
      .split('\n')
      .map((row) => row.split('|'))
      .map(([hanzi, id]) => [hanzi, Number(id)]),
  );
  const word = ids[WORD.hanzi];
  const draft = ids[DRAFT_HANZI];
  if (!word || !draft) throw new Error(`fixture words missing: ${read()}`);
  return { word, draft };
}

function searchBox(page: Page) {
  return page.getByRole('searchbox', {
    name: 'Tra từ: chữ Hán, pinyin hoặc nghĩa tiếng Việt',
  });
}

function rowFor(page: Page, hanzi: string) {
  return page.locator('.dict-item', {
    has: page.locator('.dict-item__hz', { hasText: hanzi }),
  });
}

test.describe('Learner dictionary (M2.6b)', () => {
  let ids: { word: number; draft: number };

  test.beforeAll(() => {
    ids = fixtureIds();
  });

  test('searches by hanzi as the learner types and keeps ?q=', async ({
    page,
    baseURL,
  }) => {
    const csp = await watchCsp(page);
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn');
    const tab = page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Tra từ' });
    await expect(tab).toHaveAttribute('href', '/learn/dictionary');
    await tab.click();
    await expect(page).toHaveURL(/\/learn\/dictionary$/);
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle('Từ điển · Hán Lộ');
    await expect(page.locator('.dict__count')).toHaveText('Nhập từ cần tra');

    await searchBox(page).pressSequentially(WORD.hanzi, { delay: 30 });
    const row = rowFor(page, WORD.hanzi).first();
    await expect(row).toBeVisible();
    await expect(row.locator('.dict-item__vi')).toHaveText(WORD.vi);
    await expect(page).toHaveURL(
      `/learn/dictionary?q=${encodeURIComponent(WORD.hanzi)}`,
    );
    await expect(page.locator('.dict-results')).not.toContainText(WORD.en);

    await page.getByRole('button', { name: 'Xoá nội dung tìm kiếm' }).click();
    await expect(searchBox(page)).toHaveValue('');
    await expect(searchBox(page)).toBeFocused();
    await expect(page.locator('.dict__count')).toHaveText('Nhập từ cần tra');
    await expect(page).toHaveURL(/\/learn\/dictionary$/);
    expect(csp).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('searches by Vietnamese meaning without accents', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/dictionary');
    await searchBox(page).fill('kiem thu');
    const row = rowFor(page, WORD.hanzi).first();
    await expect(row).toBeVisible();
    await expect(row.locator('.dict-item__vi')).toHaveText(WORD.vi);
  });

  test('opens the word, switches script, saves and keeps it after reload', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/dictionary?q=${encodeURIComponent(WORD.hanzi)}`);
    await rowFor(page, WORD.hanzi).first().locator('.dict-item__link').click();
    await expect(page).toHaveURL(`/learn/dictionary/${ids.word}`);
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveText(WORD.hanzi);
    await expect(page.locator('.word__py')).toHaveText(WORD.pinyinTone);
    await expect(page.locator('.word__vi')).toHaveText(WORD.vi);
    await expect(page.locator('.word-ex__cn')).toHaveText(WORD.example);
    await expect(page.locator('.tabbar')).toBeHidden();

    await page.getByRole('button', { name: 'Phồn thể' }).click();
    await expect(h1).toHaveText(WORD.traditional);
    await expect(h1).toHaveAttribute('lang', 'zh-Hant');
    await expect(page.locator('.word-ex__cn')).toHaveText(WORD.example);

    const save = page.locator('.word-save');
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await expect(save).toHaveText('Đã lưu');
    await expect(page.locator('.toast')).toHaveText(
      `Đã lưu ${WORD.hanzi} vào danh sách ôn tập`,
    );
    await page.reload();
    await expect(save).toHaveAttribute('aria-pressed', 'true');

    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await expect(save).toHaveText('Lưu để ôn');

    await page.getByRole('link', { name: 'Quay lại' }).click();
    await expect(page).toHaveURL(
      `/learn/dictionary?q=${encodeURIComponent(WORD.hanzi)}`,
    );
    await expect(rowFor(page, WORD.hanzi).first()).toBeVisible();
  });

  test('a missing, malformed or draft word is a 404 page', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    for (const id of [
      '999999999',
      'abc',
      '0',
      '2147483648',
      String(ids.draft),
    ]) {
      const response = await page.goto(`/learn/dictionary/${id}`);
      expect(response?.status(), id).toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Không tìm thấy từ',
      );
      await expect(
        page.getByRole('link', { name: 'Về Tra từ' }),
      ).toHaveAttribute('href', '/learn/dictionary');
    }
  });

  test('a visitor without a session goes to sign-in', async ({ page }) => {
    for (const path of ['/learn/dictionary', `/learn/dictionary/${ids.word}`]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in$/);
    }
    const bff = await page.request.get(
      `/api/learner/dictionary?q=${encodeURIComponent(WORD.hanzi)}`,
    );
    expect(bff.status()).toBe(401);
  });
});
