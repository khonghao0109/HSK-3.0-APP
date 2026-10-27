import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

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

/** Creates, approves and publishes one question through the Admin CMS. */
async function publishExamQuestion(
  api: APIRequestContext,
  admin: string,
  levelIdValue: number,
  input: {
    type: 'mcq' | 'true_false';
    skill: 'reading' | 'writing';
    content: string;
    answers: unknown;
    correctAnswer: unknown;
    explanation: string;
  },
): Promise<number> {
  const created = await call<ExamQuestionDraft>(
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
    },
  );
  const questionId = created.question?.id;
  if (!questionId) throw new Error('question draft has no id');
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
