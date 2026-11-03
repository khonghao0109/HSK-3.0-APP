import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { FORBIDDEN_KEYS } from '../src/features/learner-exam/exam-forbidden-keys';
import { queryDisposableDb } from './support/disposable-db';
import {
  backendLogin,
  call,
  readCspViolations,
  registerReadyLearner,
  seedExamTakeFixtures,
  sharedExamMedia,
  watchCsp,
  type ExamTakeFixture,
} from './support/learner-fixtures';

/**
 * M4.3 Pha B (TL-172/TL-174, FIX B1): the learner result page on the real
 * backend and the disposable e2e database.
 * - tests 1–4: the real intro → take → submit → "Xem kết quả" flow;
 * - tests 5–6: a pass attempt and a weak-area attempt seeded through the Admin
 *   CMS (tags are required for Q154) with CSS-scale screenshots for the mockup
 *   comparison. Screenshots/styles are only written when HSK_SHOTS_DIR /
 *   HSK_STYLES_DIR are set (CI leaves them unset).
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SHOTS_DIR = process.env.HSK_SHOTS_DIR;
const STYLES_DIR = process.env.HSK_STYLES_DIR;
const RESULT_TITLE = 'Kết quả bài thi · Hán Lộ';
const ADMIN_EMAIL = 'admin.frontend@example.test';
const ADMIN_PASSWORD = 'FrontendTest-Admin-123';

async function shot(
  page: Page,
  testInfo: TestInfo,
  state: string,
): Promise<void> {
  if (!SHOTS_DIR) return;
  await mkdir(SHOTS_DIR, { recursive: true });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  // CSS scale: the comparison images must use the mockup's CSS pixel scale,
  // independent of the project deviceScaleFactor (mobile-390 runs DPR 3).
  await page.screenshot({
    path: path.join(SHOTS_DIR, `${testInfo.project.name}-${state}.png`),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
}

async function audit(page: Page, state: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .analyze();
  const found = violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'n/a'}): ${violation.nodes
        .map((node) => node.target.join(' '))
        .join(' | ')}`,
  );
  expect.soft(found, `axe ${state}`).toEqual([]);
  expect
    .soft(await page.locator('html').getAttribute('lang'), `lang ${state}`)
    .toBe('vi');
  expect.soft(await page.locator('h1:visible').count(), `h1 ${state}`).toBe(1);
  expect.soft(await page.title(), `title ${state}`).toBe(RESULT_TITLE);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(0);
}

function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/** Visible hero only: the page renders a web hero and a mobile hero. */
function visibleHero(page: Page) {
  return page.locator('.exr-hero:visible');
}

async function startAttempt(
  page: Page,
  baseURL: string | undefined,
  fixtures: ExamTakeFixture,
): Promise<number> {
  await registerReadyLearner(page, baseURL);
  await page.goto(`/learn/exam/${String(fixtures.publishedTestId)}`);
  const hydrated = page.waitForResponse(
    (response) => response.url().includes('/media-grants'),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: 'Bắt đầu thi' }).click();
  await page.waitForURL(/\/learn\/exam\/attempts\/\d+/u);
  await hydrated;
  await page.waitForLoadState('networkidle');
  const match = /\/attempts\/(\d+)/u.exec(page.url());
  if (match === null) throw new Error('attempt id missing from URL');
  return Number(match[1]);
}

async function openSubmitDialog(page: Page): Promise<void> {
  const footer = page
    .getByRole('contentinfo')
    .getByRole('button', { name: 'Nộp bài' });
  const panelList = page.getByRole('complementary', { name: 'Danh sách câu' });
  const panel = panelList.getByRole('button', { name: 'Nộp bài' });
  const nav = page
    .getByRole('navigation', { name: 'Điều hướng câu hỏi' })
    .getByRole('button', { name: 'Nộp bài' });
  if (await footer.isVisible()) {
    await footer.click();
  } else if (await panel.isVisible()) {
    await panel.click();
  } else {
    if (!(await panelList.isVisible())) {
      const opener = page.getByRole('button', {
        name: /Mở danh sách câu hỏi/u,
      });
      if (await opener.isVisible()) await opener.click();
      else await page.getByRole('button', { name: /Mở danh sách/u }).click();
    }
    if (await panel.isVisible()) {
      await panel.click();
    } else {
      await panelList.getByRole('button', { name: /^Câu /u }).last().click();
      await nav.click();
    }
  }
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function submitAttempt(page: Page): Promise<void> {
  await openSubmitDialog(page);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Nộp bài' })
    .click();
  await expect(
    page.getByRole('alert').getByText('Bài đã được nộp.'),
  ).toBeVisible({ timeout: 30_000 });
}

async function answerFirstQuestion(page: Page): Promise<void> {
  await page.getByRole('radio').first().click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Đã lưu' }),
  ).toBeVisible({ timeout: 15_000 });
}

/** Read the learner JWT from the BFF session cookie (value is the token). */
async function learnerToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const cookie = cookies.find((item) => item.name === 'hsk_learner_session');
  if (cookie === undefined) throw new Error('missing learner session cookie');
  return cookie.value;
}

// ---------------------------------------------------------------------------
// FIX B1: pass + weak-area fixtures for the mockup screenshots.
// ---------------------------------------------------------------------------

type ResultFixture = {
  testId: number;
  title: string;
  passScore: number;
};

type PublishQuestionInput = {
  type: 'mcq' | 'fill_blank';
  skill: 'listening' | 'reading' | 'writing';
  content: string;
  answers: unknown;
  correctAnswer: unknown;
  explanation: string;
  audioId?: number;
  tags?: string[];
};

async function seedResultFixture(prefix: string): Promise<ResultFixture> {
  const api = await playwrightRequest.newContext();
  try {
    const admin = await backendLogin(api, ADMIN_EMAIL, ADMIN_PASSWORD);
    const levels = await call<Array<{ id: number; code: string }>>(
      api,
      'GET',
      '/learning/levels',
    );
    const hsk3 = levels.find((level) => level.code === 'HSK3');
    if (hsk3 === undefined) throw new Error('seed has no HSK3 level');

    const { audioId } = await sharedExamMedia(api, admin);

    const publish = async (input: PublishQuestionInput): Promise<number> => {
      const created = await call<{
        question: { id: number };
        revision: { id: number };
      }>(api, 'POST', '/admin/cms/questions', admin, {
        type: input.type,
        skill: input.skill,
        levelId: hsk3.id,
        content: input.content,
        answers: input.answers,
        correctAnswer: input.correctAnswer,
        explanation: input.explanation,
        ...(input.audioId === undefined ? {} : { audioId: input.audioId }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
      });
      const questionId = created.question.id;
      await call(
        api,
        'POST',
        `/admin/cms/questions/${questionId}/revisions/${created.revision.id}/reviews`,
        admin,
        { decision: 'approved' },
      );
      await call(
        api,
        'POST',
        `/admin/cms/questions/${questionId}/revisions/${created.revision.id}/publish`,
        admin,
      );
      return questionId;
    };

    const options = {
      options: [
        { id: 'a', text: 'Đáp án A' },
        { id: 'b', text: 'Đáp án B' },
      ],
    };
    const mcq = async (
      skill: 'listening' | 'reading',
      index: number,
      tags: string[],
      extra: { audioId?: number } = {},
    ): Promise<number> =>
      publish({
        type: 'mcq',
        skill,
        content: `${skill === 'listening' ? 'Nghe' : 'Đọc'} ${prefix} (${String(index)})`,
        answers: options,
        correctAnswer: { optionId: 'a' },
        explanation: 'Đáp án A.',
        tags,
        ...extra,
      });

    const listening: number[] = [];
    for (let index = 1; index <= 3; index += 1) {
      listening.push(await mcq('listening', index, ['Nghe hiểu'], { audioId }));
    }
    const reading = [
      await mcq('reading', 1, ['Ngữ pháp']),
      await mcq('reading', 2, ['Ngữ pháp']),
      await mcq('reading', 3, ['Từ vựng']),
    ];
    const writing: number[] = [];
    const fill = async (index: number, tags: string[]): Promise<number> =>
      publish({
        type: 'fill_blank',
        skill: 'writing',
        content: `Điền ${prefix} (${String(index)}): 我想___东西。`,
        answers: {},
        correctAnswer: { acceptedTexts: ['买'], caseSensitive: false },
        explanation: 'Điền 买.',
        tags,
      });
    writing.push(await fill(1, ['Từ vựng']));
    writing.push(await fill(2, ['Từ vựng']));
    writing.push(await fill(3, ['Ngữ pháp']));

    const title = 'HSK 3 – Đề 04 (Nghe)';
    const draft = await call<{ id: number; updatedAt: string }>(
      api,
      'POST',
      '/admin/cms/tests',
      admin,
      {
        levelId: hsk3.id,
        title,
        instruction: 'Làm hết các phần trong 45 phút.',
        duration: 45,
        passScore: 250,
      },
    );
    const structured = await call<{ id: number; updatedAt: string }>(
      api,
      'PUT',
      `/admin/cms/tests/${draft.id}/structure`,
      admin,
      {
        expectedUpdatedAt: draft.updatedAt,
        sections: [
          {
            skill: 'listening',
            title: 'Nghe hiểu',
            groups: [{ title: 'Phần nghe', questionIds: listening }],
          },
          {
            skill: 'reading',
            title: 'Đọc hiểu',
            groups: [{ title: 'Phần đọc', questionIds: reading }],
          },
          {
            skill: 'writing',
            title: 'Viết câu',
            groups: [{ title: 'Phần viết', questionIds: writing }],
          },
        ],
      },
    );
    await call(api, 'POST', `/admin/cms/tests/${draft.id}/publish`, admin, {
      expectedUpdatedAt: structured.updatedAt,
    });
    return { testId: draft.id, title, passScore: 250 };
  } finally {
    await api.dispose();
  }
}

async function apiContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext();
}

async function apiStart(
  api: APIRequestContext,
  token: string,
  testId: number,
): Promise<number> {
  const started = await call<{ id: number }>(
    api,
    'POST',
    `/exam/tests/${String(testId)}/attempts`,
    token,
    { idempotencyKey: randomUUID() },
  );
  return started.id;
}

async function apiSave(
  api: APIRequestContext,
  token: string,
  attemptId: number,
  questionKey: string,
  answer: unknown,
): Promise<void> {
  await call(
    api,
    'PUT',
    `/exam/attempts/${String(attemptId)}/answers/${questionKey}`,
    token,
    {
      answer,
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: randomUUID(),
    },
  );
}

async function apiSubmit(
  api: APIRequestContext,
  token: string,
  attemptId: number,
): Promise<void> {
  await call(api, 'POST', `/exam/attempts/${String(attemptId)}/submit`, token, {
    idempotencyKey: randomUUID(),
  });
}

const CORRECT_ANSWERS: Array<[string, unknown]> = [
  ['q1', { choice: 'a' }],
  ['q2', { choice: 'a' }],
  ['q3', { choice: 'a' }],
  ['q4', { choice: 'a' }],
  ['q5', { choice: 'a' }],
  ['q6', { choice: 'a' }],
  ['q7', { text: '买' }],
  ['q8', { text: '买' }],
  ['q9', { text: '买' }],
];

const WEAK_ANSWERS: Array<[string, unknown]> = [
  ['q1', { choice: 'a' }],
  ['q2', { choice: 'a' }],
  ['q3', { choice: 'a' }],
  ['q4', { choice: 'b' }],
  ['q5', { choice: 'b' }],
  ['q6', { choice: 'a' }],
  ['q7', { text: '买' }],
  ['q8', { text: '好' }],
  ['q9', { text: '好' }],
];

async function createAttempt(
  api: APIRequestContext,
  token: string,
  fixture: ResultFixture,
  answers: Array<[string, unknown]>,
  duration = '31 minutes 42 seconds',
): Promise<number> {
  const attemptId = await apiStart(api, token, fixture.testId);
  // Fixture time: the mockup shows a real working time (31:42), and the page
  // reads submittedAt − startedAt from the attempt row.
  queryDisposableDb(
    `UPDATE "ExamAttempt" SET "startedAt" = "startedAt" - interval '${duration}' WHERE id = ${String(attemptId)}`,
  );
  for (const [key, answer] of answers) {
    await apiSave(api, token, attemptId, key, answer);
  }
  await apiSubmit(api, token, attemptId);
  return attemptId;
}

/**
 * Dump the computed styles the review compares against the mockup. Values are
 * read from the visible hero/rows, in CSS pixels.
 */
async function captureStyles(
  page: Page,
  testInfo: TestInfo,
  state: string,
): Promise<void> {
  if (STYLES_DIR === undefined) return;
  const styles = await page.evaluate(() => {
    const pick = (selector: string, props: string[]) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const out: Record<string, string | number[]> = {
        rect: [
          Math.round(rect.x * 100) / 100,
          Math.round(rect.y * 100) / 100,
          Math.round(rect.width * 100) / 100,
          Math.round(rect.height * 100) / 100,
        ],
      };
      for (const prop of props) out[prop] = style.getPropertyValue(prop);
      return out;
    };
    const visible = (selector: string) => {
      const elements = [...document.querySelectorAll<HTMLElement>(selector)];
      return elements.find(
        (element) => getComputedStyle(element).display !== 'none',
      );
    };
    const hero = visible('.exr-hero');
    const heroClass = hero?.className ?? '';
    const heroSelector = heroClass.includes('exr-hero--web')
      ? '.exr-hero--web'
      : '.exr-hero--mobile';
    const scoreSelector = `${heroSelector} .exr-score`;
    const rows = [...document.querySelectorAll('.exr-skill')];
    rows.forEach((row, index) => {
      row.setAttribute('data-style-row', String(index));
    });
    const weak = document.querySelector('.exr-card--weak');
    const weakRect = weak?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, dpr: window.devicePixelRatio },
      hero: pick(heroSelector, [
        'padding',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'border-top-left-radius',
        'background-color',
        'border-top-width',
        'row-gap',
        'column-gap',
      ]),
      kicker: pick(`${heroSelector} .exr-kicker`, [
        'font-size',
        'font-weight',
        'line-height',
        'letter-spacing',
        'color',
        'text-transform',
      ]),
      title: pick(`${heroSelector} .exr-title`, [
        'font-size',
        'font-weight',
        'line-height',
        'color',
        'font-family',
      ]),
      scoreBig: pick(`${scoreSelector} b`, [
        'font-size',
        'font-weight',
        'line-height',
        'color',
      ]),
      scoreUnit: pick(`${scoreSelector} span`, [
        'font-size',
        'font-weight',
        'line-height',
        'color',
      ]),
      skillRow: pick('.exr-skill', [
        'height',
        'grid-template-columns',
        'column-gap',
        'font-size',
      ]),
      skillName: pick('.exr-skill__name', [
        'font-size',
        'font-weight',
        'line-height',
        'color',
      ]),
      skillValue: pick('.exr-skill__value', [
        'font-size',
        'font-weight',
        'line-height',
        'color',
      ]),
      skillBar: pick('.exr-progress', ['height', 'background-color']),
      skillFill: pick('.exr-skill', ['--exr-fill']),
      skillsCard: pick('.exr-card--skills', [
        'padding',
        'border-top-left-radius',
        'border-top-width',
        'background-color',
      ]),
      weakCard: {
        rect: weakRect
          ? [
              Math.round(weakRect.x * 100) / 100,
              Math.round(weakRect.y * 100) / 100,
              Math.round(weakRect.width * 100) / 100,
              Math.round(weakRect.height * 100) / 100,
            ]
          : null,
        style: weak
          ? {
              'padding-top':
                getComputedStyle(weak).getPropertyValue('padding-top'),
              'padding-right':
                getComputedStyle(weak).getPropertyValue('padding-right'),
              'padding-bottom':
                getComputedStyle(weak).getPropertyValue('padding-bottom'),
              'padding-left':
                getComputedStyle(weak).getPropertyValue('padding-left'),
              'border-top-left-radius': getComputedStyle(weak).getPropertyValue(
                'border-top-left-radius',
              ),
              'background-color':
                getComputedStyle(weak).getPropertyValue('background-color'),
              'border-top-width':
                getComputedStyle(weak).getPropertyValue('border-top-width'),
            }
          : null,
      },
      weakRow: pick('.exr-weak__row', [
        'height',
        'font-size',
        'line-height',
        'border-top-left-radius',
        'background-color',
      ]),
      weakLevel: pick('.exr-level', [
        'height',
        'font-size',
        'font-weight',
        'line-height',
        'border-top-left-radius',
        'background-color',
        'color',
      ]),
      grid: pick('.exr-grid', ['grid-template-columns', 'column-gap']),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  await mkdir(STYLES_DIR, { recursive: true });
  await writeFile(
    path.join(STYLES_DIR, `${testInfo.project.name}-${state}.json`),
    JSON.stringify(styles, null, 2),
  );
}

test.describe('Learner exam result (M4.3 / TL-172)', () => {
  test.describe.configure({ timeout: 420_000 });
  let fixtures: ExamTakeFixture;
  let resultFixture: ResultFixture;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(360_000);
    const cachePath = process.env.HSK_FIXTURE_CACHE;
    if (cachePath) {
      const cached = await readFile(cachePath, 'utf8').catch(() => null);
      if (cached !== null) {
        fixtures = JSON.parse(cached) as ExamTakeFixture;
      }
    }
    if (fixtures === undefined) {
      fixtures = await seedExamTakeFixtures(
        `result-${testInfo.project.name}-${String(Date.now())}`,
      );
      if (cachePath) await writeFile(cachePath, JSON.stringify(fixtures));
    }
    const resultCache = process.env.HSK_RESULT_FIXTURE_CACHE;
    if (resultCache) {
      const cached = await readFile(resultCache, 'utf8').catch(() => null);
      if (cached !== null) {
        resultFixture = JSON.parse(cached) as ResultFixture;
      }
    }
    if (resultFixture === undefined) {
      resultFixture = await seedResultFixture(
        `${testInfo.project.name}-${String(Date.now())}`,
      );
      if (resultCache) {
        await writeFile(resultCache, JSON.stringify(resultFixture));
      }
    }
  });

  test('1. submit → "Xem kết quả" → stored score, skills and clean page', async ({
    page,
    baseURL,
  }, testInfo) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    const attemptId = await startAttempt(page, baseURL, fixtures);
    await answerFirstQuestion(page);
    await submitAttempt(page);

    const resultLink = page
      .getByRole('alert')
      .getByRole('link', { name: 'Xem kết quả' });
    await expect(resultLink).toBeVisible();
    await resultLink.click();
    await page.waitForURL(
      new RegExp(`/learn/exam/attempts/${String(attemptId)}/result$`, 'u'),
    );
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: 'Kết quả bài thi' }),
    ).toBeVisible();
    const hero = visibleHero(page);
    await expect(hero.locator('.exr-score')).toContainText('/300');
    await expect(
      hero
        .locator('.exr-badge, .exr-hero__badge')
        .filter({ hasText: 'Chưa đạt' }),
    ).toBeVisible();
    await expect(page.getByText('Kết quả theo kỹ năng')).toBeVisible();
    for (const label of ['Nghe', 'Đọc', 'Viết']) {
      await expect(
        page.locator('.exr-skill__name', { hasText: label }),
      ).toBeVisible();
    }
    await expect(page.getByRole('progressbar')).toHaveCount(3);
    await expect(
      page.getByText('Kết quả thi thử không cộng XP hay huy hiệu.'),
    ).toBeVisible();
    await expect(hero.getByText(fixtures.title)).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Làm lại đề này' }),
    ).toHaveAttribute(
      'href',
      `/learn/exam/${String(fixtures.publishedTestId)}`,
    );
    await expectNoHorizontalScroll(page);
    await audit(page, 'result-default');
    await shot(page, testInfo, '1-result');

    const html = await page.content();
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(html).not.toContain(forbidden);
    }
    const api = await page.evaluate(async (id) => {
      const response = await fetch(`/api/learner/exam/attempts/${id}/result`);
      return {
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
        body: await response.text(),
      };
    }, attemptId);
    expect(api.status).toBe(200);
    expect(api.cacheControl).toContain('no-store');
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(api.body).not.toContain(forbidden);
    }

    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('2. an in-progress attempt result URL returns to the taking page', async ({
    page,
    baseURL,
  }) => {
    const attemptId = await startAttempt(page, baseURL, fixtures);
    const api = await page.evaluate(async (id) => {
      const response = await fetch(`/api/learner/exam/attempts/${id}/result`);
      return {
        status: response.status,
        body: (await response.json()) as { error?: { code?: string } },
      };
    }, attemptId);
    expect(api.status).toBe(409);
    expect(api.body).toMatchObject({
      error: { code: 'EXAM_ATTEMPT_NOT_TERMINAL' },
    });

    await page.goto(`/learn/exam/attempts/${String(attemptId)}/result`, {
      waitUntil: 'networkidle',
    });
    await expect(page).toHaveURL(
      new RegExp(`/learn/exam/attempts/${String(attemptId)}$`, 'u'),
    );
    await expect(page.locator('.ext-question')).toBeVisible();
    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('3. a timed-out attempt leads to the result with the auto-submit chip', async ({
    page,
    baseURL,
  }, testInfo) => {
    const attemptId = await startAttempt(page, baseURL, fixtures);
    queryDisposableDb(
      `UPDATE "ExamAttempt" SET "startedAt" = (now() at time zone 'utc' - interval '1 hour'), "expiresAt" = (now() at time zone 'utc' - interval '10 seconds') WHERE id = ${String(attemptId)}`,
    );
    await page.reload();
    await page.waitForSelector('.ext-question');
    const resultLink = page
      .getByRole('alert')
      .getByRole('link', { name: 'Xem kết quả' });
    await expect(resultLink).toBeVisible({ timeout: 20_000 });
    await resultLink.click();
    await page.waitForURL(
      new RegExp(`/learn/exam/attempts/${String(attemptId)}/result$`, 'u'),
    );
    const hero = visibleHero(page);
    await expect(hero.getByText('Hết giờ · tự nộp')).toBeVisible();
    await expect(
      hero
        .locator('.exr-badge, .exr-hero__badge')
        .filter({ hasText: 'Chưa đạt' }),
    ).toBeVisible();
    await shot(page, testInfo, 'c-timed-out');
    await audit(page, 'result-timed-out');
  });

  test('4. @keyboard the result page is fully reachable and focus is visible', async ({
    page,
    baseURL,
  }) => {
    const attemptId = await startAttempt(page, baseURL, fixtures);
    await answerFirstQuestion(page);
    await submitAttempt(page);
    await page
      .getByRole('alert')
      .getByRole('link', { name: 'Xem kết quả' })
      .click();
    await page.waitForURL(
      new RegExp(`/learn/exam/attempts/${String(attemptId)}/result$`, 'u'),
    );
    await page.waitForLoadState('networkidle');

    const focused: string[] = [];
    const focusStyles: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active === null) return null;
        if (!['A', 'BUTTON'].includes(active.tagName)) return null;
        const style = window.getComputedStyle(active);
        return {
          label:
            active.getAttribute('aria-label') ??
            active.textContent?.trim() ??
            active.tagName,
          ring: `${style.outlineStyle} ${style.outlineWidth} ${style.boxShadow}`,
        };
      });
      if (info === null) continue;
      focused.push(info.label);
      focusStyles.push(info.ring);
      if (
        focused.join(' | ').includes('Quay lại giới thiệu đề') &&
        focused.join(' | ').includes('Làm lại đề này')
      ) {
        break;
      }
    }
    expect(focused.join(' | ')).toContain('Quay lại giới thiệu đề');
    expect(focused.join(' | ')).toContain('Làm lại đề này');
    for (const ring of focusStyles) {
      expect(ring).not.toBe('none 0px none');
    }
  });

  test('5. pass attempt: jade score, "Đạt" badge, screenshot (a)', async ({
    page,
    baseURL,
  }, testInfo) => {
    const cspConsole = await watchCsp(page);
    const consoleErrors = captureConsoleErrors(page);
    await registerReadyLearner(page, baseURL);
    const token = await learnerToken(page);
    const api = await apiContext();
    try {
      const attemptId = await createAttempt(
        api,
        token,
        resultFixture,
        CORRECT_ANSWERS,
      );
      await page.goto(`/learn/exam/attempts/${String(attemptId)}/result`, {
        waitUntil: 'networkidle',
      });
      const hero = visibleHero(page);
      await expect(hero.getByText(resultFixture.title)).toBeVisible();
      await expect(hero.locator('.exr-score')).toContainText('300');
      await expect(
        hero.locator('.exr-badge, .exr-hero__badge').filter({ hasText: 'Đạt' }),
      ).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'a-pass');
      await captureStyles(page, testInfo, 'a-pass');
      await audit(page, 'result-pass');
      expect(await readCspViolations(page)).toEqual([]);
      expect(cspConsole).toEqual([]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await api.dispose();
    }
  });

  test('6. weak attempt: weak-area card with "Yếu"/"Trung bình", screenshot (b)', async ({
    page,
    baseURL,
  }, testInfo) => {
    await registerReadyLearner(page, baseURL);
    const token = await learnerToken(page);
    const api = await apiContext();
    try {
      const attemptId = await createAttempt(
        api,
        token,
        resultFixture,
        WEAK_ANSWERS,
        '28 minutes 15 seconds',
      );
      await page.goto(`/learn/exam/attempts/${String(attemptId)}/result`, {
        waitUntil: 'networkidle',
      });
      const hero = visibleHero(page);
      await expect(hero.locator('.exr-score')).toContainText('/300');
      await expect(
        hero
          .locator('.exr-badge, .exr-hero__badge')
          .filter({ hasText: 'Chưa đạt' }),
      ).toBeVisible();
      const weakCard = page.locator('.exr-card--weak');
      await expect(weakCard.getByText('Điểm yếu cần cải thiện')).toBeVisible();
      await expect(weakCard.locator('.exr-weak__row')).toHaveCount(2);
      await expect(weakCard.getByText('Ngữ pháp')).toBeVisible();
      await expect(weakCard.getByText('Từ vựng')).toBeVisible();
      await expect(weakCard.getByText('Yếu', { exact: true })).toBeVisible();
      await expect(
        weakCard.getByText('Trung bình', { exact: true }),
      ).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'b-weak');
      await captureStyles(page, testInfo, 'b-weak');
      await audit(page, 'result-weak');
    } finally {
      await api.dispose();
    }
  });
});
