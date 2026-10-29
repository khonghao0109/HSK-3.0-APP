import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '@/lib/api/api-error';

import {
  handleExamAttemptRead,
  handleExamMediaGrants,
  handleExamSaveAnswer,
  handleExamSaveAnswers,
  rewriteGrantUrl,
} from './exam-attempt-route-handler';
import type { ExamHandlerDependencies } from './exam-route-handler';
import { FORBIDDEN_KEYS } from './exam-forbidden-keys';

const ATTEMPT_ID = '41';
const QUESTION_KEY = 'q12';
const APP_ORIGIN = 'http://127.0.0.1:3200';
const COOKIE = 'hsk_learner_session';
const TOKEN = 'learner-token';

type BackendCall = {
  path: string;
  options?: { token?: string; method?: string; body?: unknown };
};

function deps(
  requestBackend: (
    path: string,
    options?: { token?: string; method?: string; body?: unknown },
  ) => Promise<unknown>,
): ExamHandlerDependencies & { calls: BackendCall[] } {
  const calls: BackendCall[] = [];
  return {
    appOrigin: APP_ORIGIN,
    learnerCookieName: COOKIE,
    production: false,
    calls,
    requestBackend: (path, options) => {
      calls.push({ path, options });
      return requestBackend(path, options);
    },
  };
}

function failure(
  status: number,
  code?: string,
  details?: { field?: string },
): BackendRequestError {
  return new BackendRequestError({
    status,
    kind:
      status === 409
        ? 'conflict'
        : status === 400
          ? 'invalid_request'
          : 'unavailable',
    message: 'failure',
    retryable: false,
    ...(code === undefined ? {} : { code }),
    ...(details === undefined ? {} : { details }),
  });
}

function request(
  path: string,
  init: { method?: string; origin?: string | null; body?: unknown } = {},
): NextRequest {
  const headers = new Headers();
  headers.set('cookie', `${COOKIE}=${TOKEN}`);
  if (init.origin !== null && init.origin !== undefined) {
    headers.set('origin', init.origin);
  }
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(`http://127.0.0.1:3200${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function envelope(data: unknown): unknown {
  return {
    success: true,
    data,
    meta: { requestId: 'req-1', timestamp: '2026-10-27T09:00:00.000Z' },
  };
}

function media(kind: 'audio' | 'image', mediaId: number) {
  return {
    mediaId,
    kind,
    mimeType: kind === 'audio' ? 'audio/mpeg' : 'image/png',
    durationMs: null,
  };
}

function answerView(questionKey: string, answer: unknown) {
  return {
    questionKey,
    answer,
    isFlagged: false,
    version: 1,
    answeredAt: '2026-10-27T09:00:00.000Z',
    lastSavedAt: '2026-10-27T09:00:00.000Z',
  };
}

function attemptView(extra: Record<string, unknown> = {}): unknown {
  return envelope({
    id: 41,
    testId: 7,
    status: 'in_progress',
    startedAt: '2026-10-27T09:00:00.000Z',
    expiresAt: '2026-10-27T10:30:00.000Z',
    serverNow: '2026-10-27T09:05:00.000Z',
    remainingSeconds: 5_100,
    maxScore: 200,
    questionCount: 2,
    test: {
      title: 'Đề thi thử',
      instruction: null,
      levelCode: 'HSK4',
      durationMinutes: 90,
      passScore: 120,
    },
    sections: [
      {
        key: 's1',
        orderIndex: 1,
        title: 'Đọc hiểu',
        instruction: null,
        skill: 'reading',
        groups: [
          {
            key: 's1-g1',
            orderIndex: 1,
            title: 'Nhóm 1',
            instruction: 'Chọn đáp án đúng.',
            // R11: group.content must never be forwarded, whatever it holds.
            content: {
              correctAnswer: { optionId: 'a' },
              explanation: 'leak',
              nested: { isCorrect: true },
            },
            audio: null,
            image: media('image', 31),
            questions: [
              {
                key: 'q1',
                orderIndex: 1,
                type: 'mcq',
                skill: 'reading',
                content: 'Câu hỏi 1',
                answers: {
                  options: [
                    { id: 'a', text: 'A', isCorrect: true },
                    { id: 'b', text: 'B', optionId: 'b' },
                  ],
                },
                audio: null,
                image: null,
              },
              {
                key: 'q2',
                orderIndex: 2,
                type: 'arrange_sentence',
                skill: 'reading',
                content: 'Sắp xếp',
                answers: {
                  tokens: [
                    { id: 't1', text: '一', tokenIds: ['leak'] },
                    { id: 't2', text: '二' },
                  ],
                },
                audio: null,
                image: null,
                questionId: 99,
                questionVersion: 2,
              },
            ],
          },
        ],
      },
    ],
    answers: [
      {
        ...answerView('q1', { choice: 'a' }),
        questionId: 99,
        questionVersion: 2,
      },
    ],
    ...extra,
  });
}

describe('exam attempt BFF handlers (M4.2b, TL-134)', () => {
  it('reads the attempt without an Origin header and forwards only the allowlist', async () => {
    const requestBackend = vi.fn().mockResolvedValue(attemptView());
    const handlerDeps = deps(requestBackend);
    const response = await handleExamAttemptRead(
      request(`/api/learner/exam/attempts/${ATTEMPT_ID}`),
      ATTEMPT_ID,
      handlerDeps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: 41,
      status: 'in_progress',
      serverNow: '2026-10-27T09:05:00.000Z',
      remainingSeconds: 5_100,
    });
    // group.content is not part of the projection.
    expect(body.data.sections[0].groups[0]).not.toHaveProperty('content');
    expect(body.data.answers[0]).not.toHaveProperty('questionId');
    expect(body.data.sections[0].groups[0].questions[1].answers.tokens).toEqual(
      [
        { id: 't1', text: '一' },
        { id: 't2', text: '二' },
      ],
    );
    const serialized = JSON.stringify(body);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(requestBackend).toHaveBeenCalledWith(
      `/api/v1/exam/attempts/${ATTEMPT_ID}`,
      { token: TOKEN, method: 'GET' },
    );
  });

  it('rejects an invalid attempt id with 404 and a missing cookie with 401', async () => {
    const handlerDeps = deps(vi.fn());
    expect(
      (
        await handleExamAttemptRead(
          request('/api/learner/exam/attempts/abc'),
          'abc',
          handlerDeps,
        )
      ).status,
    ).toBe(404);

    const noCookie = new NextRequest(
      `http://127.0.0.1:3200/api/learner/exam/attempts/${ATTEMPT_ID}`,
    );
    expect(
      (await handleExamAttemptRead(noCookie, ATTEMPT_ID, handlerDeps)).status,
    ).toBe(401);
    expect(handlerDeps.calls).toHaveLength(0);
  });

  it('maps backend errors: 401 clears cookies, 404/429 keep status, unknown 503', async () => {
    for (const [status, expected] of [
      [401, 401],
      [403, 403],
      [404, 404],
      [429, 429],
      [500, 503],
    ] as const) {
      const handlerDeps = deps(vi.fn().mockRejectedValue(failure(status)));
      const response = await handleExamAttemptRead(
        request(`/api/learner/exam/attempts/${ATTEMPT_ID}`),
        ATTEMPT_ID,
        handlerDeps,
      );
      expect(response.status).toBe(expected);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('rewrites media grants to the learner content route and drops bad URLs', async () => {
    const requestBackend = vi.fn().mockResolvedValue(
      envelope({
        grants: [
          {
            mediaId: 31,
            kind: 'image',
            url: `/api/v1/media/31/content?expires=1800000000&signature=${'a'.repeat(64)}`,
            expiresAt: '2027-01-15T08:00:00.000Z',
          },
          {
            mediaId: 32,
            kind: 'audio',
            url: `/api/v1/media/32/content?expires=1800000000&signature=${'b'.repeat(64)}&x=1`,
            expiresAt: '2027-01-15T08:00:00.000Z',
          },
        ],
        unavailable: [33],
      }),
    );
    const handlerDeps = deps(requestBackend);
    const response = await handleExamMediaGrants(
      request(`/api/learner/exam/attempts/${ATTEMPT_ID}/media-grants`),
      ATTEMPT_ID,
      handlerDeps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.data.grants).toEqual([
      {
        mediaId: 31,
        kind: 'image',
        src: `/api/learner/media/31/content?expires=1800000000&signature=${'a'.repeat(64)}`,
        expiresAt: '2027-01-15T08:00:00.000Z',
      },
    ]);
    expect(body.data.unavailable).toEqual([33, 32]);
    expect(JSON.stringify(body)).not.toContain('/api/v1/');
  });

  it('maps only the documented 409 codes on the grants route', async () => {
    for (const [code, expected] of [
      ['EXAM_ATTEMPT_EXPIRED', 409],
      ['EXAM_ATTEMPT_CLOSED', 409],
      ['EXAM_ANSWER_VERSION_CONFLICT', 503],
    ] as const) {
      const handlerDeps = deps(vi.fn().mockRejectedValue(failure(409, code)));
      const response = await handleExamMediaGrants(
        request(`/api/learner/exam/attempts/${ATTEMPT_ID}/media-grants`),
        ATTEMPT_ID,
        handlerDeps,
      );
      expect(response.status).toBe(expected);
    }
  });

  it('saves one answer: requires Origin, validates input and rebuilds the body', async () => {
    const requestBackend = vi.fn().mockResolvedValue(
      envelope({
        ...answerView(QUESTION_KEY, { choice: 'a' }),
        serverNow: '2026-10-27T09:00:00.000Z',
        remainingSeconds: 5_100,
      }),
    );
    const handlerDeps = deps(requestBackend);
    const body = {
      answer: { choice: 'a' },
      isFlagged: true,
      expectedVersion: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      clientElapsedMs: 1234,
    };

    const missingOrigin = await handleExamSaveAnswer(
      request(
        `/api/learner/exam/attempts/${ATTEMPT_ID}/answers/${QUESTION_KEY}`,
        {
          method: 'PUT',
          origin: null,
          body,
        },
      ),
      ATTEMPT_ID,
      QUESTION_KEY,
      handlerDeps,
    );
    expect(missingOrigin.status).toBe(403);

    // clientElapsedMs is not part of the schema: the body is rejected.
    const extraField = await handleExamSaveAnswer(
      request(
        `/api/learner/exam/attempts/${ATTEMPT_ID}/answers/${QUESTION_KEY}`,
        {
          method: 'PUT',
          origin: APP_ORIGIN,
          body,
        },
      ),
      ATTEMPT_ID,
      QUESTION_KEY,
      handlerDeps,
    );
    expect(extraField.status).toBe(400);

    const accepted = await handleExamSaveAnswer(
      request(
        `/api/learner/exam/attempts/${ATTEMPT_ID}/answers/${QUESTION_KEY}`,
        {
          method: 'PUT',
          origin: APP_ORIGIN,
          body: { ...body, clientElapsedMs: undefined },
        },
      ),
      ATTEMPT_ID,
      QUESTION_KEY,
      handlerDeps,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('cache-control')).toBe('no-store');
    expect(requestBackend).toHaveBeenCalledTimes(1);
    expect(requestBackend.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      token: TOKEN,
      body: {
        answer: { choice: 'a' },
        isFlagged: true,
        expectedVersion: null,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      },
    });
    const serialized = JSON.stringify(await accepted.json());
    expect(serialized).not.toContain('clientElapsedMs');
  });

  it('rejects a bad question key or attempt id with 404 and a bad body with 400', async () => {
    const handlerDeps = deps(vi.fn());
    expect(
      (
        await handleExamSaveAnswer(
          request(`/api/learner/exam/attempts/${ATTEMPT_ID}/answers/x1`, {
            method: 'PUT',
            origin: APP_ORIGIN,
            body: {},
          }),
          ATTEMPT_ID,
          'x1',
          handlerDeps,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleExamSaveAnswer(
          request(`/api/learner/exam/attempts/abc/answers/${QUESTION_KEY}`, {
            method: 'PUT',
            origin: APP_ORIGIN,
            body: {},
          }),
          'abc',
          QUESTION_KEY,
          handlerDeps,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleExamSaveAnswer(
          request(
            `/api/learner/exam/attempts/${ATTEMPT_ID}/answers/${QUESTION_KEY}`,
            {
              method: 'PUT',
              origin: APP_ORIGIN,
              body: { answer: { choice: 'a' } },
            },
          ),
          ATTEMPT_ID,
          QUESTION_KEY,
          handlerDeps,
        )
      ).status,
    ).toBe(400);
    expect(handlerDeps.calls).toHaveLength(0);
  });

  it('keeps the EXAM_ANSWER_INVALID code and field on 400', async () => {
    const handlerDeps = deps(
      vi
        .fn()
        .mockRejectedValue(
          failure(400, 'EXAM_ANSWER_INVALID', { field: 'answer.order' }),
        ),
    );
    const response = await handleExamSaveAnswer(
      request(
        `/api/learner/exam/attempts/${ATTEMPT_ID}/answers/${QUESTION_KEY}`,
        {
          method: 'PUT',
          origin: APP_ORIGIN,
          body: {
            answer: { order: ['t1'] },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: '11111111-1111-4111-8111-111111111111',
          },
        },
      ),
      ATTEMPT_ID,
      QUESTION_KEY,
      handlerDeps,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'EXAM_ANSWER_INVALID',
          details: { field: 'answer.order' },
        }),
      }),
    );
  });

  it('maps 409 on answers: allowed code keeps the code, others are 503', async () => {
    for (const [code, expected] of [
      ['EXAM_ANSWER_VERSION_CONFLICT', 409],
      ['EXAM_IDEMPOTENCY_KEY_REUSED', 409],
      ['EXAM_TEST_UNAVAILABLE', 503],
    ] as const) {
      const handlerDeps = deps(vi.fn().mockRejectedValue(failure(409, code)));
      const response = await handleExamSaveAnswer(
        request(
          `/api/learner/exam/attempts/${ATTEMPT_ID}/answers/${QUESTION_KEY}`,
          {
            method: 'PUT',
            origin: APP_ORIGIN,
            body: {
              answer: null,
              isFlagged: true,
              expectedVersion: 3,
              idempotencyKey: '11111111-1111-4111-8111-111111111111',
            },
          },
        ),
        ATTEMPT_ID,
        QUESTION_KEY,
        handlerDeps,
      );
      expect(response.status).toBe(expected);
      if (expected === 409) {
        expect((await response.json()).error.code).toBe(code);
      }
    }
  });

  it('saves a batch: duplicate keys fail before the backend, success strips internals', async () => {
    const result = {
      questionKey: 'q1',
      status: 'saved',
      answer: answerView('q1', { value: true }),
    };
    const requestBackend = vi.fn().mockResolvedValue(
      envelope({
        results: [
          result,
          {
            questionKey: 'q2',
            status: 'conflict',
            current: answerView('q2', null),
            code: 'leak',
          },
          { questionKey: 'q3', status: 'not_found' },
        ],
        serverNow: '2026-10-27T09:00:00.000Z',
        remainingSeconds: 5_100,
      }),
    );
    const handlerDeps = deps(requestBackend);
    const item = {
      questionKey: 'q1',
      answer: { value: true },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    };

    const duplicate = await handleExamSaveAnswers(
      request(`/api/learner/exam/attempts/${ATTEMPT_ID}/answers`, {
        method: 'PUT',
        origin: APP_ORIGIN,
        body: { items: [item, item] },
      }),
      ATTEMPT_ID,
      handlerDeps,
    );
    expect(duplicate.status).toBe(400);
    expect(requestBackend).not.toHaveBeenCalled();

    const accepted = await handleExamSaveAnswers(
      request(`/api/learner/exam/attempts/${ATTEMPT_ID}/answers`, {
        method: 'PUT',
        origin: APP_ORIGIN,
        body: {
          items: [
            item,
            { ...item, questionKey: 'q2', answer: null },
            { ...item, questionKey: 'q3', answer: { text: '你好' } },
          ],
        },
      }),
      ATTEMPT_ID,
      handlerDeps,
    );
    expect(accepted.status).toBe(200);
    const body = await accepted.json();
    expect(
      body.data.results.map((entry: { status: string }) => entry.status),
    ).toEqual(['saved', 'conflict', 'not_found']);
    expect(body.data.remainingSeconds).toBe(5_100);
    expect(JSON.stringify(body)).not.toContain('/api/v1/');
  });

  it('returns 503 when the backend envelope is not the documented shape', async () => {
    const handlerDeps = deps(
      vi.fn().mockResolvedValue({ success: true, data: { nope: true } }),
    );
    const response = await handleExamAttemptRead(
      request(`/api/learner/exam/attempts/${ATTEMPT_ID}`),
      ATTEMPT_ID,
      handlerDeps,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rewriteGrantUrl accepts only the canonical content path', () => {
    expect(
      rewriteGrantUrl(
        7,
        `/api/v1/media/7/content?expires=1800000000&signature=${'a'.repeat(64)}`,
      ),
    ).toBe(
      `/api/learner/media/7/content?expires=1800000000&signature=${'a'.repeat(64)}`,
    );
    for (const url of [
      'https://evil.example/api/v1/media/7/content?expires=1&signature=' +
        'a'.repeat(64),
      '//evil.example/api/v1/media/7/content?expires=1&signature=' +
        'a'.repeat(64),
      `/api/v1/media/8/content?expires=1&signature=${'a'.repeat(64)}`,
      `/api/v1/media/7/access?expires=1&signature=${'a'.repeat(64)}`,
      `/api/v1/media/7/content?expires=1`,
      `/api/v1/media/7/content?expires=1&signature=${'a'.repeat(64)}&x=1`,
    ]) {
      expect(rewriteGrantUrl(7, url)).toBeNull();
    }
  });
});
