import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import {
  BACKEND,
  backendLogin,
  call,
  PASSWORD,
  readCspViolations,
  readyLessonId,
  registerReadyLearner,
  watchCsp,
} from './support/learner-fixtures';

// Pha E: ghép cặp in the practice player (Kiểm tra) of the HSK 7–9 seed
// lesson. Each test publishes its own exercise and archives it afterwards;
// the learner's other exercises are answered through the API first, so the
// player opens on the matching one.

const ADMIN = {
  email: 'admin.frontend@example.test',
  password: 'FrontendTest-Admin-123',
};
const PAIRS = [
  { id: 'p1', left: '家', leftReading: 'jiā', right: 'nhà; gia đình' },
  { id: 'p2', left: '爸爸', leftReading: 'bàba', right: 'bố' },
  { id: 'p3', left: '妈妈', leftReading: 'māma', right: 'mẹ' },
] as const;

type ActivityExercise = {
  id: number;
  type: string;
  content: Record<string, unknown>;
  latestAttempt: { isCorrect: boolean; score: number } | null;
};
type Activity = {
  topics: Array<{ exercises: ActivityExercise[] }>;
  standaloneExercises: ActivityExercise[];
};

const toArchive = new Set<number>();
let lessonId = 0;

function promptFor(testInfo: TestInfo, label: string): string {
  return `Ghép cặp e2e ${label} ${testInfo.project.name}`;
}

async function adminApi() {
  const api = await playwrightRequest.newContext();
  return { api, token: await backendLogin(api, ADMIN.email, ADMIN.password) };
}

/** Publishes one matching exercise through the CMS API (validator runs). */
async function publishMatching(prompt: string): Promise<number> {
  const { api, token } = await adminApi();
  try {
    const draft = await call<{
      exercise: { id: number };
      revision: { id: number };
    }>(api, 'POST', '/admin/cms/exercises', token, {
      lessonId,
      type: 'matching',
      prompt,
      content: { pairs: PAIRS },
      answer: {},
      explanation: null,
      orderIndex: 900_000 + (Date.now() % 90_000),
    });
    const base = `/admin/cms/exercises/${draft.exercise.id}/revisions/${draft.revision.id}`;
    await call(api, 'POST', `${base}/reviews`, token, { decision: 'approved' });
    await call(api, 'POST', `${base}/publish`, token);
    toArchive.add(draft.exercise.id);
    return draft.exercise.id;
  } finally {
    await api.dispose();
  }
}

/** Any well-formed answer, only to move the player past an exercise. */
function anyAnswer(exercise: ActivityExercise): unknown {
  const ids = (key: string) =>
    ((exercise.content[key] as Array<{ id: string }> | undefined) ?? []).map(
      (item) => item.id,
    );
  switch (exercise.type) {
    case 'mcq':
    case 'listening_choice':
      return { optionId: ids('options')[0] };
    case 'arrange_sentence':
      return { tokenIds: ids('tokens') };
    case 'matching':
      return { moves: ids('pairs').map((id) => ({ leftId: id, rightId: id })) };
    default:
      return { text: 'x' };
  }
}

async function learnerApi(email: string) {
  const api = await playwrightRequest.newContext();
  return { api, token: await backendLogin(api, email, PASSWORD) };
}

async function post(
  api: APIRequestContext,
  token: string,
  route: string,
  key: string,
  data: unknown,
) {
  const response = await api.post(`${BACKEND}${route}`, {
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    data,
  });
  expect(response.ok(), `POST ${route} → ${response.status()}`).toBe(true);
}

async function activity(api: APIRequestContext, token: string) {
  const data = await call<Activity>(
    api,
    'GET',
    `/learning/lessons/${lessonId}/activity`,
    token,
  );
  return [
    ...data.topics.flatMap((topic) => topic.exercises),
    ...data.standaloneExercises,
  ];
}

/** New learner whose only open exercise of the lesson is `exerciseId`. */
async function learnerAt(
  page: Page,
  baseURL: string | undefined,
  exerciseId: number,
): Promise<string> {
  const email = await registerReadyLearner(page, baseURL);
  const { api, token } = await learnerApi(email);
  try {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await post(
      api,
      token,
      `/learning/lessons/${lessonId}/start`,
      `start-${stamp}`,
      {},
    );
    for (const exercise of await activity(api, token)) {
      if (exercise.id === exerciseId || exercise.latestAttempt) continue;
      await post(
        api,
        token,
        `/learning/exercises/${exercise.id}/attempts`,
        `pre-${exercise.id}-${stamp}`,
        { answer: anyAnswer(exercise), durationSeconds: 1 },
      );
    }
  } finally {
    await api.dispose();
  }
  return email;
}

async function latestAttempt(email: string, exerciseId: number) {
  const { api, token } = await learnerApi(email);
  try {
    return (await activity(api, token)).find(
      (exercise) => exercise.id === exerciseId,
    )?.latestAttempt;
  } finally {
    await api.dispose();
  }
}

function cell(page: Page, column: 'Từ' | 'Nghĩa', name: RegExp) {
  return page.getByRole('list', { name: column }).getByRole('button', { name });
}

function live(page: Page) {
  return page.locator('.mt-live');
}

async function expectPairsOnRows(page: Page) {
  // PO 20/11/2026: once done, each row holds a word and its own meaning.
  const rows = await page.evaluate(() =>
    ['Từ', 'Nghĩa'].map((name) => {
      const label = [...document.querySelectorAll('.mt-col__label')].find(
        (node) => node.textContent === name,
      );
      const list = document.querySelector(`ul[aria-labelledby="${label?.id}"]`);
      return [...(list?.querySelectorAll<HTMLElement>('.mt-cell') ?? [])].map(
        (cell) => cell.textContent?.trim() ?? '',
      );
    }),
  );
  expect(rows).toEqual([
    PAIRS.map((pair) => `${pair.leftReading}${pair.left}`),
    PAIRS.map((pair) => pair.right),
  ]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('Ghép cặp trong Kiểm tra (Pha E)', () => {
  test.beforeAll(async () => {
    lessonId = (await readyLessonId('HSK7_9')) ?? 0;
    if (!lessonId) throw new Error('seed has no ready HSK7_9 lesson');
  });

  test.afterAll(async () => {
    const { api, token } = await adminApi();
    try {
      for (const id of toArchive) {
        const response = await api.post(
          `${BACKEND}/admin/cms/exercises/${id}/archive`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        expect([200, 201, 409]).toContain(response.status());
      }
      toArchive.clear();
    } finally {
      await api.dispose();
    }
  });

  test('one wrong pair, then all pairs: the attempt is saved as wrong with score 0', async ({
    page,
    baseURL,
  }, testInfo) => {
    const prompt = promptFor(testInfo, 'chuột');
    const exerciseId = await publishMatching(prompt);
    const email = await learnerAt(page, baseURL, exerciseId);
    await watchCsp(page);

    await page.goto(`/learn/lessons/${lessonId}/practice`);
    await expect(
      page.getByRole('heading', { level: 2, name: prompt }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kiểm tra' })).toHaveCount(0);
    for (const button of await page.locator('.mt-cell').all()) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalScroll(page);

    await cell(page, 'Từ', /爸爸/u).click();
    await expect(cell(page, 'Từ', /爸爸/u)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await cell(page, 'Nghĩa', /^mẹ$/u).click();
    await expect(cell(page, 'Nghĩa', /^mẹ$/u)).toHaveClass(/is-wrong/u);
    await expect(live(page)).toHaveText(
      'Chưa đúng: 爸爸 bàba không phải mẹ. Chọn lại.',
    );
    await expect(cell(page, 'Từ', /爸爸/u)).not.toHaveClass(/is-wrong/u);

    for (const [left, right] of [
      [/家/u, /^nhà; gia đình$/u],
      [/爸爸/u, /^bố$/u],
      [/妈妈/u, /^mẹ$/u],
    ] as const) {
      await cell(page, 'Từ', left).click();
      await cell(page, 'Nghĩa', right).click();
      await expect(cell(page, 'Từ', left)).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }

    const next = page.getByRole('button', { name: 'Tiếp tục' });
    await expect(next).toBeFocused();
    await expectPairsOnRows(page);
    await expect(page.locator('.m02-feedback__title')).toHaveText(
      'Hoàn thành · Sai 1 lần',
    );
    await expect(page.locator('.m02-feedback')).toHaveClass(
      /m02-feedback--neutral/u,
    );
    // Neutral on every layout: the web result bar is not tinted jade or red.
    const bar = await page.locator('.ex-foot').evaluate((foot) => {
      const probe = document.createElement('span');
      probe.style.background = 'var(--paper)';
      foot.append(probe);
      const paper = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { bar: getComputedStyle(foot).backgroundColor, paper };
    });
    expect([bar.paper, 'rgba(0, 0, 0, 0)']).toContain(bar.bar);
    await expect
      .poll(() => latestAttempt(email, exerciseId))
      .toMatchObject({ isCorrect: false, score: 0 });
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('CMS: tạo ghép cặp bằng form, duyệt, xuất bản, rồi học viên thấy bài', async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const prompt = promptFor(testInfo, 'CMS');
    await page.goto('/login');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Mật khẩu').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.waitForURL(/\/admin\/exercises/u);

    await page.goto(`/admin/exercises/new?lessonId=${lessonId}`);
    await page.getByLabel(/Loại bài tập/u).selectOption({ label: 'Ghép cặp' });
    await page.getByLabel(/Đề bài/u).fill(prompt);
    await page
      .getByLabel(/Thứ tự/u)
      .fill(String(900_000 + (Date.now() % 90_000)));
    for (const [index, pair] of PAIRS.entries()) {
      const row = index + 1;
      await page.getByLabel(`Chữ Hán / từ ${row}`).fill(pair.left);
      await page
        .getByLabel(`Phiên âm (tuỳ chọn) ${row}`)
        .fill(pair.leftReading);
      await page.getByLabel(`Nghĩa ${row}`).fill(pair.right);
    }
    await page.getByRole('button', { name: 'Tạo bài tập' }).click();
    await page.waitForURL(/\/admin\/exercises\/\d+/u);
    const exerciseId = Number(
      /\/admin\/exercises\/(\d+)/u.exec(page.url())![1],
    );
    toArchive.add(exerciseId);

    await page.getByRole('radio', { name: 'Duyệt' }).check();
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    const publish = page.getByRole('button', { name: 'Xuất bản' });
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(
      page.locator('.adm-flow-current__state', { hasText: 'Đã xuất bản' }),
    ).toBeVisible();

    const learnerContext = await browser.newContext({ baseURL });
    try {
      const learner = await learnerContext.newPage();
      await learnerAt(learner, baseURL, exerciseId);
      await learner.goto(`/learn/lessons/${lessonId}/practice`);
      await expect(
        learner.getByRole('heading', { level: 2, name: prompt }),
      ).toBeVisible();
      for (const pair of PAIRS) {
        await expect(
          cell(learner, 'Nghĩa', new RegExp(`^${pair.right}$`, 'u')),
        ).toBeVisible();
      }
    } finally {
      await learnerContext.close();
    }
  });

  test('keyboard only: Tab to a cell, Enter and Space pair it, every pair is spoken', async ({
    page,
    baseURL,
  }, testInfo) => {
    const prompt = promptFor(testInfo, 'bàn phím');
    const exerciseId = await publishMatching(prompt);
    const email = await learnerAt(page, baseURL, exerciseId);

    await page.goto(`/learn/lessons/${lessonId}/practice`);
    await expect(
      page.getByRole('heading', { level: 2, name: prompt }),
    ).toBeVisible();

    const tabTo = async (target: ReturnType<typeof cell>) => {
      for (let step = 0; step < 40; step += 1) {
        if (await target.evaluate((node) => node === document.activeElement)) {
          return;
        }
        await page.keyboard.press('Tab');
      }
      throw new Error('Tab never reached the cell');
    };

    const pairs = [
      [/家/u, /^nhà; gia đình$/u, 'Đúng: 家 jiā là nhà; gia đình. Còn 2 cặp.'],
      [/爸爸/u, /^bố$/u, 'Đúng: 爸爸 bàba là bố. Còn 1 cặp.'],
      [/妈妈/u, /^mẹ$/u, 'Đúng: 妈妈 māma là mẹ. Đã ghép xong cả 3 cặp.'],
    ] as const;
    for (const [index, [left, right, spoken]] of pairs.entries()) {
      await tabTo(cell(page, 'Từ', left));
      await page.keyboard.press(index % 2 === 0 ? 'Enter' : 'Space');
      await expect(cell(page, 'Từ', left)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await tabTo(cell(page, 'Nghĩa', right));
      await page.keyboard.press(index % 2 === 0 ? 'Space' : 'Enter');
      await expect(live(page)).toHaveText(spoken);
    }

    await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeFocused();
    await expectPairsOnRows(page);
    await expect(page.locator('.m02-feedback__title')).toHaveText('Chính xác');
    await expect(
      page.getByText('Bạn đã ghép đúng cả 3 cặp.', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => latestAttempt(email, exerciseId))
      .toMatchObject({ isCorrect: true, score: 100 });
  });
});
