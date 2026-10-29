import { deflateSync } from 'node:zlib';

import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

import { queryDisposableDb } from './disposable-db';
import { ingestListeningAudio } from './listening-audio';

// Shared by the lesson page (M2.5a), player (M2.5b) and listening (M2.5c)
// specs. Fixtures go through the Admin CMS of the disposable e2e DB and are
// idempotent per DB: each project re-runs beforeAll, and Playwright runs one
// worker.

export const PASSWORD = 'StrongPassword123!';
export const LOCKED_SLUG = 'm25a-e2e-locked';
export const BACKEND =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://127.0.0.1:3100/api/v1';
const ADMIN = {
  email: 'admin.frontend@example.test',
  password: 'FrontendTest-Admin-123',
};

function uniqueEmail(tag: string): string {
  return `learner.lesson.${tag}.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
}

function appOrigin(baseURL: string | undefined): string {
  return new URL(baseURL ?? 'http://127.0.0.1:3200').origin;
}

/**
 * Registers through the BFF and completes onboarding for HSK 1; returns the
 * learner's email (password {@link PASSWORD}).
 */
export async function registerReadyLearner(
  page: Page,
  baseURL: string | undefined,
): Promise<string> {
  const origin = appOrigin(baseURL);
  const email = uniqueEmail('band1');
  const register = await page.request.post('/api/learner/session/register', {
    headers: { origin, 'content-type': 'application/json' },
    data: { email, password: PASSWORD },
  });
  expect(register.status()).toBe(201);

  await page.goto('/sign-in');
  const completeStatus = await page.evaluate(async () => {
    const now = new Date();
    const startDate = [
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const res = await fetch('/api/learner/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        learningPurpose: 'hsk_exam',
        targetBand: 1,
        dailyMinutes: 15,
        reminderEnabled: true,
        reminderTime: '07:00',
        startDate,
      }),
    });
    return res.status;
  });
  expect(completeStatus).toBe(200);
  return email;
}

type Envelope<T> = { data: T };

export async function call<T>(
  api: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT',
  route: string,
  token?: string,
  data?: unknown,
): Promise<T> {
  const response = await api.fetch(`${BACKEND}${route}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    data,
  });
  if (response.status() === 409 && route.startsWith('/admin/cms/')) {
    throw new Error(
      `${method} ${route} → 409: a fixture draft is left from an aborted run; use a new disposable DB.`,
    );
  }
  expect(response.ok(), `${method} ${route} → ${response.status()}`).toBe(true);
  return ((await response.json()) as Envelope<T>).data;
}

/** Backend access token for an email and password (direct, not the BFF). */
export async function backendLogin(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  return (
    await call<{ accessToken: string }>(api, 'POST', '/auth/login', undefined, {
      email,
      password,
    })
  ).accessToken;
}

async function levelId(api: APIRequestContext, code: string): Promise<number> {
  const levels = await call<Array<{ id: number; code: string }>>(
    api,
    'GET',
    '/learning/levels',
  );
  const level = levels.find((item) => item.code === code);
  if (!level) throw new Error(`seed has no published ${code}`);
  return level.id;
}

/** Id of a ready lesson of a level, by slug or else the first one. */
export async function readyLessonId(
  code: string,
  slug?: string,
): Promise<number | null> {
  const api = await playwrightRequest.newContext();
  try {
    const ready = await call<Array<{ id: number; slug: string }>>(
      api,
      'GET',
      `/learning/lessons?levelId=${await levelId(api, code)}`,
    );
    const lesson = slug ? ready.find((item) => item.slug === slug) : ready[0];
    return lesson?.id ?? null;
  } finally {
    await api.dispose();
  }
}

type Draft = {
  lesson?: { id: number };
  topic?: { id: number };
  exercise?: { id: number };
  revision: { id: number };
};

async function approveAndPublish(
  api: APIRequestContext,
  admin: string,
  kind: 'lessons' | 'topics' | 'exercises',
  id: number,
  revision: number,
): Promise<void> {
  await call(
    api,
    'POST',
    `/admin/cms/${kind}/${id}/revisions/${revision}/reviews`,
    admin,
    { decision: 'approved' },
  );
  await call(
    api,
    'POST',
    `/admin/cms/${kind}/${id}/revisions/${revision}/publish`,
    admin,
  );
}

/**
 * Publishes a second ready lesson on HSK 3 through the Admin CMS: for a new
 * learner it sits behind the level's first lesson, so it is locked (Q18).
 * One grammar topic: the Từ vựng row needs words, which the CMS cannot add.
 * HSK 3 keeps its single path grid, so the path specs are unaffected.
 */
export async function publishLockedLesson(): Promise<number> {
  const existing = await readyLessonId('HSK3', LOCKED_SLUG);
  if (existing) return existing;
  const api = await playwrightRequest.newContext();
  try {
    const admin = await backendLogin(api, ADMIN.email, ADMIN.password);
    const lesson = await call<Draft>(api, 'POST', '/admin/cms/lessons', admin, {
      levelId: await levelId(api, 'HSK3'),
      title: 'Bài khoá e2e',
      orderIndex: 900,
      slug: LOCKED_SLUG,
    });
    const lessonId = lesson.lesson?.id;
    if (!lessonId) throw new Error('lesson draft has no id');
    const topic = await call<Draft>(api, 'POST', '/admin/cms/topics', admin, {
      lessonId,
      title: 'Ngữ pháp e2e',
      subtitle: 'Fixture e2e',
      type: 'grammar',
      content: [{ type: 'text', value: 'Nội dung fixture.' }],
      orderIndex: 1,
      isPremium: false,
      isLocked: false,
    });
    const topicId = topic.topic?.id;
    if (!topicId) throw new Error('topic draft has no id');
    await approveAndPublish(api, admin, 'topics', topicId, topic.revision.id);
    await approveAndPublish(
      api,
      admin,
      'lessons',
      lessonId,
      lesson.revision.id,
    );
    return lessonId;
  } finally {
    await api.dispose();
  }
}

export const ARRANGE_PROMPT = 'Sắp xếp các từ sau thành câu hoàn chỉnh.';
export const FILL_PROMPT = '我想___东西。';
export const FILL_EXPLANATION = 'Điền 买 (mua): 我想买东西。';

export const LISTENING_PROMPT = 'Nghe và chọn đáp án đúng.';
export const LISTENING_EXPLANATION = 'Đoạn nghe nói 超市.';

/**
 * Adds arrange_sentence, fill_blank and listening_choice exercises (no
 * topic) to the first HSK 3 lesson, which the seed gives no exercises.
 * Returns the lesson id.
 */
export async function publishPracticeExercises(): Promise<number> {
  const lessonId = await readyLessonId('HSK3');
  if (!lessonId) throw new Error('seed has no ready HSK3 lesson');
  const api = await playwrightRequest.newContext();
  try {
    const admin = await backendLogin(api, ADMIN.email, ADMIN.password);
    const existing = await call<Array<{ prompt: string; status: string }>>(
      api,
      'GET',
      `/admin/cms/exercises?lessonId=${lessonId}&limit=100`,
      admin,
    );
    const fixtures = [
      {
        type: 'arrange_sentence',
        prompt: ARRANGE_PROMPT,
        content: {
          tokens: [
            { id: 'wo', text: '我' },
            { id: 'xiang', text: '想' },
            { id: 'mai', text: '买' },
          ],
        },
        answer: { tokenIds: ['wo', 'xiang', 'mai'] },
        explanation: 'Câu đúng: 我想买。',
        orderIndex: 901,
      },
      {
        type: 'fill_blank',
        prompt: FILL_PROMPT,
        content: {},
        answer: { acceptedTexts: ['买'] },
        explanation: FILL_EXPLANATION,
        orderIndex: 902,
      },
      {
        type: 'listening_choice',
        prompt: LISTENING_PROMPT,
        content: {
          options: [
            { id: 'shop', text: '商店' },
            { id: 'market', text: '超市' },
          ],
        },
        answer: { optionId: 'market' },
        explanation: LISTENING_EXPLANATION,
        orderIndex: 903,
      },
    ];
    for (const fixture of fixtures) {
      if (existing.some((item) => item.prompt === fixture.prompt)) continue;
      // A real WAV in the backend's memory storage, so the player can play
      // it; admin-console quarantines the seeded nihao-listening.mp3.
      const mediaId =
        fixture.type === 'listening_choice'
          ? await ingestListeningAudio(api, BACKEND, admin)
          : undefined;
      const draft = await call<Draft>(
        api,
        'POST',
        '/admin/cms/exercises',
        admin,
        { lessonId, ...fixture, ...(mediaId ? { mediaId } : {}) },
      );
      const id = draft.exercise?.id;
      if (!id) throw new Error('exercise draft has no id');
      await approveAndPublish(api, admin, 'exercises', id, draft.revision.id);
    }
    return lessonId;
  } finally {
    await api.dispose();
  }
}

export async function watchCsp(page: Page): Promise<string[]> {
  const cspConsole: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes('Content Security Policy')) cspConsole.push(text);
  });
  page.on('pageerror', (error) =>
    cspConsole.push(`pageerror ${error.message}`),
  );
  await page.addInitScript(() => {
    const store: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: store });
    document.addEventListener('securitypolicyviolation', (event) => {
      store.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return cspConsole;
}

export async function readCspViolations(page: Page): Promise<string[] | null> {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(window, '__cspViolations');
    return Array.isArray(value) ? value.map(String) : null;
  });
}

type ExamQuestionDraft = Draft & { question?: { id: number } };

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * A real 320x180 8-bit RGB PNG (soft jade gradient), generated with node:zlib
 * only: big enough to render as a proper image block, no external tooling and
 * nothing copied from docs/ui_reference.
 */
function questionPng(width = 320, height = 180): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const rowBytes = width * 3 + 1;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const offset = y * rowBytes + 1 + x * 3;
      raw[offset] = 226 - Math.floor((y / height) * 46);
      raw[offset + 1] = 240 - Math.floor((x / width) * 30);
      raw[offset + 2] = 232 - Math.floor((y / height) * 26);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRY_ATTEMPTS = 3;
/** Cửa sổ media guard: 5 upload/60 s, server không gửi Retry-After. */
const RETRY_WINDOW_MS = 61_000;

function retryDelayMs(response?: APIResponse): number {
  const header = response?.headers()['retry-after'];
  const seconds = Number(header ?? '');
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 61) * 1000;
}

/**
 * F1 (2c): một đường retry 429 duy nhất cho cả ba chỗ trước đây
 * (postWithRetry / callWithRetry / withAudioRetry). `classify` trả response
 * 429 (fetch) hoặc null; lỗi ném ra có message chứa "429" cũng được thử lại.
 * Hành vi giữ nguyên: tối đa RETRY_ATTEMPTS lần, chờ Retry-After hoặc một
 * cửa sổ media guard.
 */
async function retryOn429<T>(
  run: () => Promise<T>,
  classify: (value: T) => APIResponse | null,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const value = await run();
      const limited = classify(value);
      if (limited === null || attempt >= RETRY_ATTEMPTS) return value;
      await sleep(retryDelayMs(limited));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= RETRY_ATTEMPTS || !message.includes('429')) throw error;
      await sleep(Math.max(retryDelayMs(), attempt * RETRY_WINDOW_MS));
    }
  }
}

/** POST with up to 3 attempts on 429, honouring Retry-After. */
async function postWithRetry(
  api: APIRequestContext,
  url: string,
  init: Parameters<APIRequestContext['fetch']>[1],
): Promise<APIResponse> {
  return retryOn429(
    () => api.fetch(url, init),
    (response) => (response.status() === 429 ? response : null),
  );
}

/** Admin CMS call with up to 3 attempts on 429, honouring Retry-After. */
async function callWithRetry<T>(
  api: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT',
  route: string,
  token: string,
  data?: unknown,
): Promise<T> {
  const response = await retryOn429(
    () =>
      api.fetch(`${BACKEND}${route}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
        data,
      }),
    (result) => (result.status() === 429 ? result : null),
  );
  expect(response.ok(), `${method} ${route} → ${response.status()}`).toBe(true);
  return ((await response.json()) as Envelope<T>).data;
}

/**
 * Uploads the generated 320x180 PNG through the ingestion API (retrying 429
 * with Retry-After) and waits until the media is ready.
 */
async function ingestQuestionImage(
  api: APIRequestContext,
  backend: string,
  adminToken: string,
  idempotencyKey: string,
): Promise<number> {
  const source = queryDisposableDb(
    'SELECT id FROM "DataSource" ORDER BY id LIMIT 1',
  );
  if (!/^\d+$/u.test(source)) throw new Error('seed has no DataSource');
  const response = await postWithRetry(
    api,
    `${backend}/admin/cms/media/ingestions?dataSourceId=${source}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'idempotency-key': idempotencyKey,
      },
      multipart: {
        file: {
          name: 'e2e-question-image.png',
          mimeType: 'image/png',
          buffer: questionPng(),
        },
      },
    },
  );
  if (response.status() !== 201) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`image ingestion → ${response.status()}: ${body}`);
  }
  const id = ((await response.json()) as { data: { media: { id: number } } })
    .data.media.id;
  for (let i = 0; i < 30; i += 1) {
    const detail = await api.get(`${backend}/admin/cms/media/${id}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const media = (
      (await detail.json()) as { data: { processingStatus: string } }
    ).data;
    if (media.processingStatus === 'ready') return id;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`image media ${id} is not ready after 30 seconds`);
}

export type ExamQuestionInput = {
  type: 'mcq' | 'true_false' | 'fill_blank' | 'arrange_sentence';
  skill: 'listening' | 'reading' | 'writing';
  content: string;
  answers: unknown;
  correctAnswer: unknown;
  explanation: string;
  audioId?: number;
  imageId?: number;
};

/** Creates, approves and publishes one question through the Admin CMS. */
async function publishExamQuestion(
  api: APIRequestContext,
  admin: string,
  levelIdValue: number,
  input: ExamQuestionInput,
): Promise<number> {
  const created = await callWithRetry<ExamQuestionDraft>(
    api,
    'POST',
    '/admin/cms/questions',
    admin,
    {
      type: input.type,
      skill: input.skill,
      levelId: levelIdValue,
      content: input.content,
      answers: input.answers,
      correctAnswer: input.correctAnswer,
      explanation: input.explanation,
      ...(input.audioId === undefined ? {} : { audioId: input.audioId }),
      ...(input.imageId === undefined ? {} : { imageId: input.imageId }),
    },
  );
  const questionId = created.question?.id;
  if (!questionId) throw new Error('question draft has no id');
  await callWithRetry(
    api,
    'POST',
    `/admin/cms/questions/${questionId}/revisions/${created.revision.id}/reviews`,
    admin,
    { decision: 'approved' },
  );
  await callWithRetry(
    api,
    'POST',
    `/admin/cms/questions/${questionId}/revisions/${created.revision.id}/publish`,
    admin,
  );
  return questionId;
}

export type ExamIntroFixture = {
  title: string;
  publishedTestId: number;
  draftTestId: number;
  questionCount: number;
  sectionCount: number;
  passScore: number;
  maxScore: number;
  durationMinutes: number;
};

/**
 * M4.2a (TL-120): one publishable exam test (2 sections, 3 questions) and one
 * draft, seeded through the Admin CMS of the disposable DB. `prefix` keeps the
 * four Playwright projects apart.
 */
export async function seedExamIntroFixtures(
  prefix: string,
): Promise<ExamIntroFixture> {
  const api = await playwrightRequest.newContext();
  try {
    const admin = await backendLogin(api, ADMIN.email, ADMIN.password);
    const hsk3 = await levelId(api, 'HSK3');
    const readingChoice = await publishExamQuestion(api, admin, hsk3, {
      type: 'mcq',
      skill: 'reading',
      content: `Đề giới thiệu ${prefix}: chọn đáp án theo đoạn văn.`,
      answers: {
        options: [
          { id: 'a', text: 'Đáp án đúng' },
          { id: 'b', text: 'Đáp án sai' },
        ],
      },
      correctAnswer: { optionId: 'b' },
      explanation: 'Đoạn văn nói về mùa đông.',
    });
    const writingChoice = await publishExamQuestion(api, admin, hsk3, {
      type: 'mcq',
      skill: 'writing',
      content: `Đề giới thiệu ${prefix}: chọn câu viết đúng.`,
      answers: {
        options: [
          { id: 'a', text: 'Đáp án đúng' },
          { id: 'b', text: 'Đáp án sai' },
        ],
      },
      correctAnswer: { optionId: 'a' },
      explanation: 'Câu viết đúng ngữ pháp.',
    });
    const readingTrueFalse = await publishExamQuestion(api, admin, hsk3, {
      type: 'true_false',
      skill: 'reading',
      content: `Đề giới thiệu ${prefix}: câu này đúng hay sai?`,
      answers: {},
      // M4.1a DTO: a JSON object; the true_false flag lives in `value`.
      correctAnswer: { value: true },
      explanation: 'Đoạn văn khẳng định điều này.',
    });

    const title = `Đề thi thử ${prefix}`;
    const publishedDraft = await call<{ id: number; updatedAt: string }>(
      api,
      'POST',
      '/admin/cms/tests',
      admin,
      {
        levelId: hsk3,
        title,
        instruction: 'Làm hết các phần trong 80 phút.',
        duration: 80,
        passScore: 120,
      },
    );
    const structured = await call<{ id: number; updatedAt: string }>(
      api,
      'PUT',
      `/admin/cms/tests/${publishedDraft.id}/structure`,
      admin,
      {
        expectedUpdatedAt: publishedDraft.updatedAt,
        sections: [
          {
            skill: 'reading',
            title: 'Đọc hiểu',
            groups: [
              {
                title: 'Phần đọc',
                questionIds: [readingChoice, readingTrueFalse],
              },
            ],
          },
          {
            skill: 'writing',
            title: 'Viết câu',
            groups: [{ title: 'Phần viết', questionIds: [writingChoice] }],
          },
        ],
      },
    );
    await call(
      api,
      'POST',
      `/admin/cms/tests/${publishedDraft.id}/publish`,
      admin,
      {
        expectedUpdatedAt: structured.updatedAt,
      },
    );
    const draftOnly = await call<{ id: number }>(
      api,
      'POST',
      '/admin/cms/tests',
      admin,
      {
        levelId: hsk3,
        title: `Đề nháp ${prefix}`,
        duration: 30,
      },
    );

    return {
      title,
      publishedTestId: publishedDraft.id,
      draftTestId: draftOnly.id,
      questionCount: 3,
      sectionCount: 2,
      passScore: 120,
      maxScore: 200,
      durationMinutes: 80,
    };
  } finally {
    await api.dispose();
  }
}

export type ExamTakeFixture = {
  title: string;
  publishedTestId: number;
  questionCount: number;
  durationMinutes: number;
  /** 1-based positions of the format-specific questions, for navigation. */
  listeningCount: number;
  firstFillNumber: number;
  firstArrangeNumber: number;
  imageQuestionNumber: number;
  listeningPrompt: string;
  fillPrompt: string;
  arrangePrompt: string;
  mcqOptionA: string;
};

const LISTENING_OPTIONS: ReadonlyArray<
  ReadonlyArray<{ id: string; text: string }>
> = [
  [
    { id: 'a', text: '他在图书馆。' },
    { id: 'b', text: '他去图书馆了。' },
  ],
  [
    { id: 'a', text: '商店' },
    { id: 'b', text: '超市' },
  ],
  [
    { id: 'a', text: '是' },
    { id: 'b', text: '不是' },
  ],
  [
    { id: 'a', text: '书' },
    { id: 'b', text: '笔' },
  ],
  [
    { id: 'a', text: '今天很冷。' },
    { id: 'b', text: '今天很热。' },
  ],
  [
    { id: 'a', text: '我买水果。' },
    { id: 'b', text: '我买东西。' },
  ],
];

const LISTENING_COUNT = 6;
const READING_COUNT = 20;
const WRITING_COUNT = 14;

/**
 * M4.2b 2b-3: one HSK3 exam test with 40 questions — Nghe (6 mcq with real
 * audio, Q1 first and Q2 carrying a real 320x180 image), Doc (20: 12 mcq +
 * 8 true_false), Viet (14: 7 fill_blank + 7 arrange_sentence) — so the panel
 * grid matches the 40-cell mockup. Listening is section 1, so the attempt
 * opens on a listening mcq. Every ingest/publish retries 429 with Retry-After.
 */
export async function seedExamTakeFixtures(
  prefix: string,
): Promise<ExamTakeFixture> {
  const api = await playwrightRequest.newContext();
  try {
    const admin = await backendLogin(api, ADMIN.email, ADMIN.password);
    const hsk3 = await levelId(api, 'HSK3');
    const idempotency = (kind: string) =>
      `e2e-exam-take-${kind}-${prefix}`.slice(0, 64).padEnd(64, '0');
    const audioId = await withAudioRetry(() =>
      ingestListeningAudio(api, BACKEND, admin, idempotency('audio')),
    );
    const imageId = await ingestQuestionImage(
      api,
      BACKEND,
      admin,
      idempotency('image'),
    );

    const listeningPrompt = `Nghe ${prefix} và chọn đáp án đúng.`;
    const fillPrompt = `Câu điền ${prefix}: 我想___东西。`;
    const arrangePrompt = `Sắp xếp ${prefix}: 我 / 想 / 买`;
    const mcqOptionA = `Đáp án đúng ${prefix}`;

    const questionIds: number[] = [];
    // Nghe: 6 mcq, real audio; question 2 carries the image.
    for (let i = 0; i < LISTENING_COUNT; i += 1) {
      questionIds.push(
        await publishExamQuestion(api, admin, hsk3, {
          type: 'mcq',
          skill: 'listening',
          content: `${listeningPrompt} (${String(i + 1)})`,
          answers: { options: LISTENING_OPTIONS[i % LISTENING_OPTIONS.length] },
          correctAnswer: { optionId: 'a' },
          explanation: 'Đáp án A theo đoạn nghe.',
          audioId,
          ...(i === 1 ? { imageId } : {}),
        }),
      );
    }
    // Doc: 12 mcq + 8 true_false.
    for (let i = 0; i < READING_COUNT; i += 1) {
      const isTrueFalse = i >= 12;
      questionIds.push(
        await publishExamQuestion(api, admin, hsk3, {
          type: isTrueFalse ? 'true_false' : 'mcq',
          skill: 'reading',
          content: isTrueFalse
            ? `Đúng hay sai ${prefix} (${String(i + 1)})?`
            : `Đọc ${prefix} (${String(i + 1)}): chọn đáp án đúng.`,
          answers: isTrueFalse
            ? {}
            : {
                options: [
                  {
                    id: 'a',
                    text: i === 0 ? mcqOptionA : `Lựa chọn A ${String(i + 1)}`,
                  },
                  { id: 'b', text: `Lựa chọn B ${String(i + 1)}` },
                ],
              },
          correctAnswer: isTrueFalse
            ? { value: i % 2 === 0 }
            : { optionId: 'a' },
          explanation: 'Giải thích ngắn cho fixture e2e.',
        }),
      );
    }
    // Viet: 7 fill_blank + 7 arrange_sentence.
    for (let i = 0; i < WRITING_COUNT; i += 1) {
      const isArrange = i >= 7;
      questionIds.push(
        await publishExamQuestion(api, admin, hsk3, {
          type: isArrange ? 'arrange_sentence' : 'fill_blank',
          skill: 'writing',
          content: isArrange
            ? `${arrangePrompt} (${String(i + 1)})`
            : i === 0
              ? fillPrompt
              : `Câu điền ${prefix} (${String(i + 1)}): 你___吗？`,
          answers: isArrange
            ? {
                tokens: [
                  { id: 'wo', text: '我' },
                  { id: 'xiang', text: '想' },
                  { id: 'mai', text: '买' },
                ],
              }
            : {},
          correctAnswer: isArrange
            ? { tokenIds: ['wo', 'xiang', 'mai'] }
            : { acceptedTexts: ['买', '好'], caseSensitive: false },
          explanation: isArrange ? 'Câu đúng: 我想买。' : 'Điền 买/好.',
        }),
      );
    }

    const title = `Đề làm bài ${prefix}`;
    const draft = await callWithRetry<{ id: number; updatedAt: string }>(
      api,
      'POST',
      '/admin/cms/tests',
      admin,
      {
        levelId: hsk3,
        title,
        instruction: 'Làm hết các phần trong 45 phút.',
        duration: 45,
        passScore: 60,
      },
    );
    const structured = await callWithRetry<{ id: number; updatedAt: string }>(
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
            groups: [
              {
                title: 'Phần nghe',
                questionIds: questionIds.slice(0, LISTENING_COUNT),
              },
            ],
          },
          {
            skill: 'reading',
            title: 'Đọc hiểu',
            groups: [
              {
                title: 'Phần đọc',
                questionIds: questionIds.slice(
                  LISTENING_COUNT,
                  LISTENING_COUNT + READING_COUNT,
                ),
              },
            ],
          },
          {
            skill: 'writing',
            title: 'Viết câu',
            groups: [
              {
                title: 'Phần viết',
                questionIds: questionIds.slice(LISTENING_COUNT + READING_COUNT),
              },
            ],
          },
        ],
      },
    );
    await callWithRetry(
      api,
      'POST',
      `/admin/cms/tests/${draft.id}/publish`,
      admin,
      {
        expectedUpdatedAt: structured.updatedAt,
      },
    );
    return {
      title,
      publishedTestId: draft.id,
      questionCount: questionIds.length,
      durationMinutes: 45,
      listeningCount: LISTENING_COUNT,
      firstFillNumber: LISTENING_COUNT + READING_COUNT + 1,
      firstArrangeNumber: LISTENING_COUNT + READING_COUNT + 8,
      imageQuestionNumber: 2,
      listeningPrompt,
      fillPrompt,
      arrangePrompt,
      mcqOptionA,
    };
  } finally {
    await api.dispose();
  }
}

/**
 * ingestListeningAudio lives in a shared helper outside this round's allowed
 * files, so its 429 is retried here with a fixed backoff (it replays through
 * the fixed Idempotency-Key).
 */
async function withAudioRetry<T>(fn: () => Promise<T>): Promise<T> {
  return retryOn429(fn, () => null);
}
