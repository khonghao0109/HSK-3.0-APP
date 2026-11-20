import {
  expect,
  type Page,
  request as playwrightRequest,
  test,
} from '@playwright/test';

import {
  backendLogin,
  call,
  readCspViolations,
  readyLessonId,
  registerReadyLearner,
  watchCsp,
} from './support/learner-fixtures';

// Pha D: a Ngữ pháp unit (one card per grammar_point) and a Bài khoá unit (a
// conversation), published through the Admin CMS (the content validator
// runs) on the HSK 7–9 seed lesson. Idempotent per disposable DB.

const ADMIN = {
  email: 'admin.frontend@example.test',
  password: 'FrontendTest-Admin-123',
};
const GRAMMAR = 'Câu hỏi e2e Pha D';
const KEY_TEXT = 'Nhà bạn có mấy người? (e2e Pha D)';
const KEY_TEXT_SUB = 'Đọc hội thoại giữa An và Bình.';

const point = (title: string, zh: string, hanzi: string) => ({
  type: 'grammar_point',
  title,
  formula: [
    { role: 'subj', zh: '主语', vi: 'Chủ ngữ' },
    { role: 'verb', zh: '有', vi: 'Động từ' },
    { role: 'key', zh, vi: 'Từ hỏi' },
    { role: 'mw', zh: '量词', vi: 'Lượng từ' },
    { role: 'other', zh: '名词', vi: 'Danh từ' },
  ],
  explanation: `Dùng ${zh} để hỏi số lượng nhỏ.`,
  examples: [
    {
      hanzi,
      pinyin: 'Nǐ jiā yǒu jǐ kǒu rén?',
      vi: 'Nhà bạn có mấy người?',
      highlight: zh,
    },
    {
      hanzi: `你有${zh}个哥哥？`,
      pinyin: 'Nǐ yǒu jǐ gè gēge?',
      vi: 'Bạn có mấy anh trai?',
    },
  ],
});

async function seedUnits(): Promise<{ lessonId: number; ids: number[] }> {
  const lessonId = await readyLessonId('HSK7_9');
  if (!lessonId) throw new Error('seed has no ready HSK7_9 lesson');
  const api = await playwrightRequest.newContext();
  const read = async () =>
    (
      await call<{ topics: Array<{ id: number; title: string }> }>(
        api,
        'GET',
        `/learning/lessons/${lessonId}`,
      )
    ).topics;
  try {
    if (!(await read()).some((topic) => topic.title === GRAMMAR)) {
      const admin = await backendLogin(api, ADMIN.email, ADMIN.password);
      const publish = async (body: Record<string, unknown>) => {
        const draft = await call<{
          topic?: { id: number };
          revision: { id: number };
        }>(api, 'POST', '/admin/cms/topics', admin, {
          lessonId,
          isPremium: false,
          isLocked: false,
          ...body,
        });
        const base = `/admin/cms/topics/${draft.topic?.id}/revisions/${draft.revision.id}`;
        await call(api, 'POST', `${base}/reviews`, admin, {
          decision: 'approved',
        });
        await call(api, 'POST', `${base}/publish`, admin);
      };
      await publish({
        title: GRAMMAR,
        subtitle: null,
        type: 'grammar',
        orderIndex: 41,
        content: [
          point('Hỏi số lượng với 几', '几', '你家有几口人？'),
          point('Hỏi với 多少', '多少', '你家有多少口人？'),
        ],
      });
      await publish({
        title: KEY_TEXT,
        subtitle: KEY_TEXT_SUB,
        type: 'key_text',
        orderIndex: 42,
        content: [
          {
            type: 'dialogue',
            lines: [
              {
                speaker: 'An',
                hanzi: '你家有几口人？',
                pinyin: 'Nǐ jiā yǒu jǐ kǒu rén?',
                vi: 'Nhà bạn có mấy người?',
              },
              {
                speaker: 'Bình',
                hanzi: '我家有四口人。',
                pinyin: 'Wǒ jiā yǒu sì kǒu rén.',
                vi: 'Nhà tôi có bốn người.',
              },
              {
                speaker: 'An',
                hanzi: '你有哥哥吗？',
                pinyin: 'Nǐ yǒu gēge ma?',
                vi: 'Bạn có anh trai không?',
              },
            ],
          },
        ],
      });
    }
    const topics = await read();
    const ids = [GRAMMAR, KEY_TEXT].map(
      (title) => topics.find((topic) => topic.title === title)?.id ?? 0,
    );
    return { lessonId, ids };
  } finally {
    await api.dispose();
  }
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

test.describe('Ngữ pháp and Bài khoá units (Pha D)', () => {
  let lessonId = 0;
  let grammarId = 0;
  let keyTextId = 0;

  test.beforeAll(async () => {
    const seeded = await seedUnits();
    lessonId = seeded.lessonId;
    [grammarId = 0, keyTextId = 0] = seeded.ids;
  });

  test('grammar row → one card per point → result marks the unit done', async ({
    page,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${lessonId}`);
    const row = page.locator('.lu-rows .lu-row', { hasText: GRAMMAR });
    await expect(row).toHaveAttribute(
      'href',
      `/learn/lessons/${lessonId}/grammar?unit=${grammarId}`,
    );
    await row.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /^Ngữ pháp · /u,
    );
    await expect(page.getByText('Điểm 1 trên 2')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Hỏi số lượng với 几' }),
    ).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Công thức' }).getByRole('listitem'),
    ).toHaveCount(5);
    await expect(page.locator('mark.lu-hl').first()).toHaveText('几');
    await expectNoHorizontalScroll(page);
    await expectTargets44(page, '.lu-foot .btn, .ex-bar .icon-btn, .switch');

    // The switch is the learner's own note: it saves nothing.
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page
      .getByRole('checkbox', { name: 'Đã hiểu Hỏi số lượng với 几' })
      .check({ force: true });
    expect(requests.filter((url) => url.includes('/api/learner/'))).toEqual([]);

    await page.getByRole('button', { name: 'Đã hiểu' }).click();
    await expect(page.getByText('Điểm 2 trên 2')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Hỏi với 多少' }),
    ).toBeFocused();

    const completed = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/learner/topics/${grammarId}/complete`) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Đã hiểu' }).click();
    expect((await completed).ok()).toBe(true);
    await expect(page.locator('.done-kicker')).toBeVisible();
    const next = page.getByRole('link', { name: 'Đơn vị tiếp' });
    await expect(next).toHaveAttribute(
      'href',
      `/learn/lessons/${lessonId}/grammar?unit=${keyTextId}`,
    );
    await expect(next).not.toHaveAttribute('aria-disabled', 'true');

    await page.getByRole('link', { name: 'Về bài' }).click();
    await expect(
      page.locator('.lu-rows .lu-row', { hasText: GRAMMAR }),
    ).toHaveClass(/is-done/u);
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });

  test('key_text unit shows the conversation, Hoàn thành marks it done', async ({
    page,
    baseURL,
  }) => {
    const cspConsole = await watchCsp(page);
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${lessonId}/grammar?unit=${keyTextId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /^Bài khoá · /u,
    );
    await expect(
      page.getByRole('heading', { level: 2, name: KEY_TEXT }),
    ).toBeVisible();
    await expect(page.getByText(KEY_TEXT_SUB)).toBeVisible();
    const lines = page.locator('.lu-dlg > .lu-line');
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0)).toHaveClass(/is-a/u);
    await expect(lines.nth(1)).toHaveClass(/is-b/u);
    await expect(page.getByRole('img', { name: 'Bình' })).toHaveText('B');
    await expectNoHorizontalScroll(page);
    await expectTargets44(page, '.lu-foot .btn, .ex-bar .icon-btn:visible');

    const completed = page.waitForResponse((response) =>
      response.url().endsWith(`/api/learner/topics/${keyTextId}/complete`),
    );
    await page.getByRole('button', { name: 'Hoàn thành' }).click();
    expect((await completed).ok()).toBe(true);
    await expect(page.locator('.done-kicker')).toBeVisible();
    await page.getByRole('link', { name: 'Về bài' }).click();
    await expect(
      page.locator('.lu-rows .lu-row', { hasText: KEY_TEXT }),
    ).toHaveClass(/is-done/u);
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });

  test('the old Ngữ pháp page shows the new blocks read-only (TL 6)', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${lessonId}/grammar`);
    const card = page.locator('.topic-card', { hasText: GRAMMAR });
    await expect(
      card.getByRole('heading', { level: 3, name: 'Hỏi với 多少' }),
    ).toBeVisible();
    const dialogue = page.locator('.topic-card', { hasText: KEY_TEXT });
    await expect(dialogue.locator('.lu-line')).toHaveCount(3);
    await expectNoHorizontalScroll(page);
  });
});
