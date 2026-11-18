import { NextRequest, type NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';
import { getRefreshCookieName } from '@/lib/auth/session-cookie';

import {
  handleExerciseAttempt,
  handleLessonComplete,
  handleLessonStart,
  handleTopicComplete,
  type LessonPlayerHandlerDependencies,
} from './lesson-player-route-handler';

const appOrigin = 'http://127.0.0.1:3200';
const learnerCookieName = 'hsk_learner_session';
const KEY = 'attempt-3b0b6a2e-6f1d-4d5c-9a51-0c2f6d4f7a10';
const meta = { requestId: 'r', timestamp: 't' };

function deps(
  requestBackend: LessonPlayerHandlerDependencies['requestBackend'],
): LessonPlayerHandlerDependencies {
  return { appOrigin, learnerCookieName, production: false, requestBackend };
}

function backendError(status: number) {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

function request(
  path: string,
  options: {
    origin?: string | null;
    cookie?: boolean;
    key?: string | null;
    body?: unknown;
    rawBody?: string;
  } = {},
) {
  const headers = new Headers();
  if (options.origin !== null)
    headers.set('origin', options.origin ?? appOrigin);
  if (options.cookie !== false) {
    headers.set('cookie', `${learnerCookieName}=learner-token`);
  }
  if (options.key !== null) headers.set('idempotency-key', options.key ?? KEY);
  return new NextRequest(new URL(path, appOrigin), {
    method: 'POST',
    headers,
    body:
      options.rawBody ??
      JSON.stringify(options.body ?? { answer: { optionId: 'hello' } }),
  });
}

async function expectFailure(
  response: NextResponse,
  status: number,
  kind: string,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body).toMatchObject({ success: false, error: { kind } });
}

function expectCookiesCleared(response: NextResponse): void {
  expect(response.cookies.get(learnerCookieName)?.maxAge).toBe(0);
  expect(
    response.cookies.get(getRefreshCookieName(learnerCookieName))?.maxAge,
  ).toBe(0);
}

const startPath = '/api/learner/lessons/12/start';
const attemptPath = '/api/learner/exercises/34/attempts';

function activity(state: string, status = 'learning') {
  return {
    success: true,
    meta,
    data: {
      lesson: { id: 12, title: 'Bài' },
      state,
      progress: { status },
      topics: [],
      standaloneExercises: [],
    },
  };
}

describe('handleLessonStart', () => {
  it('starts the lesson with a key derived from its id', async () => {
    const requestBackend = vi.fn().mockResolvedValue({
      success: true,
      meta,
      data: { lessonId: 12, status: 'learning' },
    });
    const response = await handleLessonStart(
      request(startPath),
      '12',
      deps(requestBackend),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true });
    expect(requestBackend).toHaveBeenCalledTimes(1);
    expect(requestBackend).toHaveBeenCalledWith(
      '/api/v1/learning/lessons/12/start',
      {
        token: 'learner-token',
        method: 'POST',
        body: {},
        idempotencyKey: 'lesson-start-12',
      },
    );
  });

  it('rejects a cross-origin or origin-less request before the backend', async () => {
    const requestBackend = vi.fn();
    for (const origin of ['http://evil.example', null]) {
      await expectFailure(
        await handleLessonStart(
          request(startPath, { origin }),
          '12',
          deps(requestBackend),
        ),
        403,
        'forbidden',
      );
    }
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-1', '01', '2147483648'])(
    'answers 404 for lesson id %s without calling the backend',
    async (id) => {
      const requestBackend = vi.fn();
      await expectFailure(
        await handleLessonStart(request(startPath), id, deps(requestBackend)),
        404,
        'not_found',
      );
      expect(requestBackend).not.toHaveBeenCalled();
    },
  );

  it('answers 401 without a learner cookie', async () => {
    const requestBackend = vi.fn();
    await expectFailure(
      await handleLessonStart(
        request(startPath, { cookie: false }),
        '12',
        deps(requestBackend),
      ),
      401,
      'session_expired',
    );
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('turns a 409 on a locked lesson into lesson_locked', async () => {
    const requestBackend = vi
      .fn()
      .mockRejectedValueOnce(backendError(409))
      .mockResolvedValueOnce(activity('locked', 'not_started'));
    await expectFailure(
      await handleLessonStart(request(startPath), '12', deps(requestBackend)),
      409,
      'lesson_locked',
    );
    expect(requestBackend).toHaveBeenLastCalledWith(
      '/api/v1/learning/lessons/12/activity',
      { token: 'learner-token' },
    );
  });

  it('answers 503 when a 409 left an open lesson not started', async () => {
    const requestBackend = vi
      .fn()
      .mockRejectedValueOnce(backendError(409))
      .mockResolvedValueOnce(activity('current', 'not_started'));
    await expectFailure(
      await handleLessonStart(request(startPath), '12', deps(requestBackend)),
      503,
      'unavailable',
    );
  });

  it('treats a 409 on an open, started lesson as already started', async () => {
    const requestBackend = vi
      .fn()
      .mockRejectedValueOnce(backendError(409))
      .mockResolvedValueOnce(activity('current'));
    const response = await handleLessonStart(
      request(startPath),
      '12',
      deps(requestBackend),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it.each([401, 403])(
    'clears the learner cookies on a backend %i',
    async (status) => {
      const requestBackend = vi.fn().mockRejectedValue(backendError(status));
      const response = await handleLessonStart(
        request(startPath),
        '12',
        deps(requestBackend),
      );
      expect(response.status).toBe(status);
      expectCookiesCleared(response);
    },
  );

  it.each([
    [404, 404, 'not_found'],
    [500, 503, 'unavailable'],
    [503, 503, 'unavailable'],
  ])('maps a backend %i to %i', async (upstream, status, kind) => {
    const requestBackend = vi.fn().mockRejectedValue(backendError(upstream));
    await expectFailure(
      await handleLessonStart(request(startPath), '12', deps(requestBackend)),
      status,
      kind,
    );
  });

  it('answers 503 for a malformed success envelope', async () => {
    const requestBackend = vi.fn().mockResolvedValue({ success: true });
    await expectFailure(
      await handleLessonStart(request(startPath), '12', deps(requestBackend)),
      503,
      'unavailable',
    );
  });
});

describe('handleExerciseAttempt', () => {
  function attemptResponse(
    isCorrect: boolean | null,
    explanation: string | null,
  ) {
    return {
      success: true,
      meta,
      data: {
        attemptId: 7,
        exerciseId: 34,
        attemptNumber: 1,
        isCorrect,
        score: isCorrect ? 100 : 0,
        durationSeconds: 3,
        exerciseVersion: 1,
        feedbackVersion: 'lesson-activity-v1',
        explanation,
        media: null,
        submittedAt: '2026-10-11T00:00:00.000Z',
      },
    };
  }

  it('forwards the answer and key, returning only isCorrect and explanation', async () => {
    const requestBackend = vi
      .fn()
      .mockResolvedValue(attemptResponse(false, 'Giải thích.'));
    const response = await handleExerciseAttempt(
      request(attemptPath, {
        body: { answer: { optionId: 'hello' }, durationSeconds: 4 },
      }),
      '34',
      deps(requestBackend),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: { isCorrect: false, explanation: 'Giải thích.' },
    });
    expect(requestBackend).toHaveBeenCalledWith(
      '/api/v1/learning/exercises/34/attempts',
      {
        token: 'learner-token',
        method: 'POST',
        body: { answer: { optionId: 'hello' }, durationSeconds: 4 },
        idempotencyKey: KEY,
      },
    );
  });

  it('trims fill_blank text before forwarding', async () => {
    const requestBackend = vi
      .fn()
      .mockResolvedValue(attemptResponse(true, null));
    await handleExerciseAttempt(
      request(attemptPath, { body: { answer: { text: '  好  ' } } }),
      '34',
      deps(requestBackend),
    );
    expect(requestBackend.mock.calls[0]?.[1]?.body).toEqual({
      answer: { text: '好' },
    });
  });

  it('reads a null isCorrect as not correct', async () => {
    const requestBackend = vi
      .fn()
      .mockResolvedValue(attemptResponse(null, null));
    const response = await handleExerciseAttempt(
      request(attemptPath),
      '34',
      deps(requestBackend),
    );
    expect(await response.json()).toEqual({
      success: true,
      data: { isCorrect: false, explanation: null },
    });
  });

  it('rejects a cross-origin request before reading the body', async () => {
    const requestBackend = vi.fn();
    await expectFailure(
      await handleExerciseAttempt(
        request(attemptPath, { origin: 'http://evil.example' }),
        '34',
        deps(requestBackend),
      ),
      403,
      'forbidden',
    );
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it.each([
    null,
    '',
    'short',
    'has space key 123',
    '-starts-with-dash',
    'x'.repeat(129),
  ])('answers 400 for Idempotency-Key %j', async (key) => {
    const requestBackend = vi.fn();
    await expectFailure(
      await handleExerciseAttempt(
        request(attemptPath, { key }),
        '34',
        deps(requestBackend),
      ),
      400,
      'invalid_request',
    );
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', undefined, '{'],
    ['no answer', {}, undefined],
    ['an extra field', { answer: { optionId: 'a' }, userId: 1 }, undefined],
    [
      'an extra answer key',
      { answer: { optionId: 'a', text: 'b' } },
      undefined,
    ],
    ['an empty text', { answer: { text: '   ' } }, undefined],
    ['a text over 4096', { answer: { text: 'a'.repeat(4097) } }, undefined],
    ['no token ids', { answer: { tokenIds: [] } }, undefined],
    ['a bad option id', { answer: { optionId: 'a b' } }, undefined],
    [
      'a negative duration',
      { answer: { optionId: 'a' }, durationSeconds: -1 },
      undefined,
    ],
    [
      'a duration over a day',
      { answer: { optionId: 'a' }, durationSeconds: 86_401 },
      undefined,
    ],
  ])('answers 400 for %s', async (_label, body, rawBody) => {
    const requestBackend = vi.fn();
    await expectFailure(
      await handleExerciseAttempt(
        request(attemptPath, { body, rawBody }),
        '34',
        deps(requestBackend),
      ),
      400,
      'invalid_request',
    );
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('accepts a 4096-character text', async () => {
    const requestBackend = vi
      .fn()
      .mockResolvedValue(attemptResponse(false, null));
    const response = await handleExerciseAttempt(
      request(attemptPath, { body: { answer: { text: 'a'.repeat(4096) } } }),
      '34',
      deps(requestBackend),
    );
    expect(response.status).toBe(200);
  });

  it.each(['abc', '0', '-1'])('answers 404 for exercise id %s', async (id) => {
    const requestBackend = vi.fn();
    await expectFailure(
      await handleExerciseAttempt(
        request(attemptPath),
        id,
        deps(requestBackend),
      ),
      404,
      'not_found',
    );
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('answers 401 without a learner cookie', async () => {
    const requestBackend = vi.fn();
    await expectFailure(
      await handleExerciseAttempt(
        request(attemptPath, { cookie: false }),
        '34',
        deps(requestBackend),
      ),
      401,
      'session_expired',
    );
  });

  it.each([
    [400, 400, 'invalid_request'],
    [404, 404, 'not_found'],
    [409, 409, 'conflict'],
    [422, 422, 'validation'],
    [429, 429, 'rate_limited'],
    [500, 503, 'unavailable'],
    [503, 503, 'unavailable'],
  ])('maps a backend %i to %i', async (upstream, status, kind) => {
    const requestBackend = vi.fn().mockRejectedValue(backendError(upstream));
    await expectFailure(
      await handleExerciseAttempt(
        request(attemptPath),
        '34',
        deps(requestBackend),
      ),
      status,
      kind,
    );
  });

  it('clears the learner cookies on a backend 401', async () => {
    const requestBackend = vi.fn().mockRejectedValue(backendError(401));
    const response = await handleExerciseAttempt(
      request(attemptPath),
      '34',
      deps(requestBackend),
    );
    expect(response.status).toBe(401);
    expectCookiesCleared(response);
  });

  it('answers 503 for a malformed success envelope', async () => {
    const requestBackend = vi
      .fn()
      .mockResolvedValue({ success: true, meta, data: { isCorrect: 'yes' } });
    await expectFailure(
      await handleExerciseAttempt(
        request(attemptPath),
        '34',
        deps(requestBackend),
      ),
      503,
      'unavailable',
    );
  });
});

type TopicStatus = 'not_started' | 'learning' | 'done';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function completeActivity(
  topics: Array<{ id: number; status: TopicStatus; attempts: boolean[] }>,
  status = 'learning',
) {
  return {
    success: true,
    meta,
    data: {
      lesson: { id: 12, title: 'Bài' },
      state: 'current',
      progress: { status },
      topics: topics.map((topic, index) => ({
        id: topic.id,
        orderIndex: index + 1,
        progress: { status: topic.status },
        exercises: topic.attempts.map((attempted, exercise) => ({
          id: topic.id * 10 + exercise,
          type: 'mcq',
          prompt: 'p',
          content: {},
          orderIndex: exercise + 1,
          latestAttempt: attempted ? { attemptId: 1 } : null,
        })),
      })),
      standaloneExercises: [],
    },
  };
}

type Call = Parameters<LessonPlayerHandlerDependencies['requestBackend']>;

/** Backend fake: reads answer from `reads`, writes answer `writes[path]`. */
function fakeBackend(
  reads: Record<string, unknown[]>,
  writes: Record<string, number> = {},
) {
  const calls: Call[] = [];
  const respond = (...call: Call): unknown => {
    calls.push(call);
    const [path, options] = call;
    if (options?.method === 'POST') {
      const status = writes[path] ?? 201;
      if (status !== 201) throw backendError(status);
      return { success: true, meta, data: {} };
    }
    const queue = reads[path];
    const next = queue && queue.length > 1 ? queue.shift() : queue?.[0];
    if (next === undefined) throw backendError(404);
    if (typeof next === 'number') throw backendError(next);
    return next;
  };
  const requestBackend = vi
    .fn()
    .mockImplementation(async (...call: Call) => respond(...call));
  const posts = () =>
    calls
      .filter(([, options]) => options?.method === 'POST')
      .map(([path]) => path);
  return { requestBackend, calls, posts };
}

const activityPath = '/api/v1/learning/lessons/12/activity';
const topicPath = '/api/learner/topics/3/complete';

function topicRequest(options: { cookie?: boolean; body?: unknown } = {}) {
  return request(topicPath, {
    key: null,
    cookie: options.cookie,
    body: options.body ?? { lessonId: 12 },
  });
}

describe('handleTopicComplete (Q58)', () => {
  it('starts a not-started topic, then completes it, each with a fresh UUID key', async () => {
    const backend = fakeBackend({
      [activityPath]: [
        completeActivity([{ id: 3, status: 'not_started', attempts: [true] }]),
      ],
    });
    const response = await handleTopicComplete(
      topicRequest(),
      '3',
      deps(backend.requestBackend),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: { topicId: 3 },
    });
    expect(backend.posts()).toEqual([
      '/api/v1/learning/topics/3/start',
      '/api/v1/learning/topics/3/complete',
    ]);
    const keys = backend.calls
      .filter(([, options]) => options?.method === 'POST')
      .map(([, options]) => options?.idempotencyKey);
    expect(keys.every((key) => UUID.test(key ?? ''))).toBe(true);
    expect(new Set(keys).size).toBe(2);
    expect(backend.calls[0]).toEqual([
      activityPath,
      { token: 'learner-token' },
    ]);
  });

  it('does not start a topic that is already learning', async () => {
    const backend = fakeBackend({
      [activityPath]: [
        completeActivity([{ id: 3, status: 'learning', attempts: [true] }]),
      ],
    });
    const response = await handleTopicComplete(
      topicRequest(),
      '3',
      deps(backend.requestBackend),
    );
    expect(response.status).toBe(200);
    expect(backend.posts()).toEqual(['/api/v1/learning/topics/3/complete']);
  });

  it('answers success without a write when the topic is already done', async () => {
    const backend = fakeBackend({
      [activityPath]: [
        completeActivity([{ id: 3, status: 'done', attempts: [true] }]),
      ],
    });
    const response = await handleTopicComplete(
      topicRequest(),
      '3',
      deps(backend.requestBackend),
    );
    expect(response.status).toBe(200);
    expect(backend.posts()).toEqual([]);
  });

  it('treats a 409 on complete as success once the topic reads done', async () => {
    const backend = fakeBackend(
      {
        [activityPath]: [
          completeActivity([{ id: 3, status: 'learning', attempts: [true] }]),
          completeActivity([{ id: 3, status: 'done', attempts: [true] }]),
        ],
      },
      { '/api/v1/learning/topics/3/complete': 409 },
    );
    const response = await handleTopicComplete(
      topicRequest(),
      '3',
      deps(backend.requestBackend),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { topicId: 3 },
    });
  });

  it('answers 409 when a 409 leaves the topic not done', async () => {
    const backend = fakeBackend(
      {
        [activityPath]: [
          completeActivity([{ id: 3, status: 'learning', attempts: [false] }]),
        ],
      },
      { '/api/v1/learning/topics/3/complete': 409 },
    );
    await expectFailure(
      await handleTopicComplete(
        topicRequest(),
        '3',
        deps(backend.requestBackend),
      ),
      409,
      'conflict',
    );
  });

  it('answers 401 without a learner cookie, before the backend', async () => {
    const requestBackend = vi.fn();
    await expectFailure(
      await handleTopicComplete(
        topicRequest({ cookie: false }),
        '3',
        deps(requestBackend),
      ),
      401,
      'session_expired',
    );
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('clears the learner cookies on a backend 401', async () => {
    const backend = fakeBackend({ [activityPath]: [401] });
    const response = await handleTopicComplete(
      topicRequest(),
      '3',
      deps(backend.requestBackend),
    );
    await expectFailure(response, 401, 'session_expired');
    expectCookiesCleared(response);
  });

  it.each(['abc', '0', '-1', '2147483648', '01'])(
    'answers 404 for topic id %j before the backend',
    async (id) => {
      const requestBackend = vi.fn();
      await expectFailure(
        await handleTopicComplete(topicRequest(), id, deps(requestBackend)),
        404,
        'not_found',
      );
      expect(requestBackend).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { lessonId: 0 }, { lessonId: '12' }, { lessonId: 12, x: 1 }])(
    'answers 400 for body %j',
    async (body) => {
      const requestBackend = vi.fn();
      await expectFailure(
        await handleTopicComplete(
          topicRequest({ body }),
          '3',
          deps(requestBackend),
        ),
        400,
        'invalid_request',
      );
      expect(requestBackend).not.toHaveBeenCalled();
    },
  );

  it('answers 404 for a topic outside the lesson', async () => {
    const backend = fakeBackend({
      [activityPath]: [
        completeActivity([{ id: 4, status: 'learning', attempts: [true] }]),
      ],
    });
    await expectFailure(
      await handleTopicComplete(
        topicRequest(),
        '3',
        deps(backend.requestBackend),
      ),
      404,
      'not_found',
    );
    expect(backend.posts()).toEqual([]);
  });

  it('rejects a cross-origin request before the backend', async () => {
    const requestBackend = vi.fn();
    const forged = request(topicPath, {
      origin: 'http://evil.example',
      key: null,
      body: { lessonId: 12 },
    });
    await expectFailure(
      await handleTopicComplete(forged, '3', deps(requestBackend)),
      403,
      'forbidden',
    );
    expect(requestBackend).not.toHaveBeenCalled();
  });
});

const lessonCompletePath = '/api/learner/lessons/12/complete';
const progressPath = '/api/v1/progress/lessons/12';

function progress(status: string) {
  return { success: true, meta, data: { lessonId: 12, status, score: 100 } };
}

describe('handleLessonComplete (Q58)', () => {
  it('closes only topics whose exercises all have an attempt, then completes the lesson', async () => {
    const backend = fakeBackend({
      [activityPath]: [
        completeActivity([
          { id: 1, status: 'done', attempts: [true] },
          { id: 2, status: 'not_started', attempts: [true, true] },
          { id: 3, status: 'learning', attempts: [true] },
          { id: 4, status: 'learning', attempts: [true, false] },
          { id: 5, status: 'not_started', attempts: [] },
        ]),
      ],
    });
    const response = await handleLessonComplete(
      request(lessonCompletePath, { key: null }),
      '12',
      deps(backend.requestBackend),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: { lessonId: 12 },
    });
    expect(backend.posts()).toEqual([
      '/api/v1/learning/topics/2/start',
      '/api/v1/learning/topics/2/complete',
      '/api/v1/learning/topics/3/complete',
      '/api/v1/learning/topics/5/start',
      '/api/v1/learning/topics/5/complete',
      '/api/v1/learning/lessons/12/complete',
    ]);
    const keys = backend.calls
      .filter(([, options]) => options?.method === 'POST')
      .map(([, options]) => options?.idempotencyKey ?? '');
    expect(keys.every((key) => UUID.test(key))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('answers success when the lesson complete 409s and progress is done', async () => {
    const backend = fakeBackend(
      {
        [activityPath]: [
          completeActivity(
            [{ id: 1, status: 'done', attempts: [true] }],
            'done',
          ),
        ],
        [progressPath]: [progress('done')],
      },
      { '/api/v1/learning/lessons/12/complete': 409 },
    );
    const response = await handleLessonComplete(
      request(lessonCompletePath, { key: null }),
      '12',
      deps(backend.requestBackend),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { lessonId: 12 },
    });
    expect(backend.calls.at(-1)).toEqual([
      progressPath,
      { token: 'learner-token' },
    ]);
  });

  it.each([
    ['learning', progress('learning')],
    ['missing', 404],
  ])(
    'answers 409 when the lesson complete 409s and progress is %s',
    async (_label, read) => {
      const backend = fakeBackend(
        {
          [activityPath]: [
            completeActivity([
              { id: 1, status: 'learning', attempts: [false] },
            ]),
          ],
          [progressPath]: [read],
        },
        { '/api/v1/learning/lessons/12/complete': 409 },
      );
      await expectFailure(
        await handleLessonComplete(
          request(lessonCompletePath, { key: null }),
          '12',
          deps(backend.requestBackend),
        ),
        409,
        'conflict',
      );
      expect(backend.posts()).toEqual(['/api/v1/learning/lessons/12/complete']);
    },
  );

  it('answers 401 without a learner cookie, before the backend', async () => {
    const requestBackend = vi.fn();
    await expectFailure(
      await handleLessonComplete(
        request(lessonCompletePath, { key: null, cookie: false }),
        '12',
        deps(requestBackend),
      ),
      401,
      'session_expired',
    );
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('clears the learner cookies on a backend 401', async () => {
    const backend = fakeBackend({ [activityPath]: [401] });
    const response = await handleLessonComplete(
      request(lessonCompletePath, { key: null }),
      '12',
      deps(backend.requestBackend),
    );
    await expectFailure(response, 401, 'session_expired');
    expectCookiesCleared(response);
  });

  it.each(['abc', '0', '2147483648'])(
    'answers 404 for lesson id %j before the backend',
    async (id) => {
      const requestBackend = vi.fn();
      await expectFailure(
        await handleLessonComplete(
          request(lessonCompletePath, { key: null }),
          id,
          deps(requestBackend),
        ),
        404,
        'not_found',
      );
      expect(requestBackend).not.toHaveBeenCalled();
    },
  );

  it('answers 503 when a topic write fails with 503', async () => {
    const backend = fakeBackend(
      {
        [activityPath]: [
          completeActivity([{ id: 1, status: 'learning', attempts: [true] }]),
        ],
      },
      { '/api/v1/learning/topics/1/complete': 503 },
    );
    await expectFailure(
      await handleLessonComplete(
        request(lessonCompletePath, { key: null }),
        '12',
        deps(backend.requestBackend),
      ),
      503,
      'unavailable',
    );
    expect(backend.posts()).toEqual(['/api/v1/learning/topics/1/complete']);
  });
});
