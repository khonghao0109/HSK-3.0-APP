import { NextRequest, type NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';
import { getRefreshCookieName } from '@/lib/auth/session-cookie';

import {
  handleReviewComplete,
  handleReviewCreateSession,
  handleReviewCurrent,
  handleReviewGrade,
  handleReviewQueue,
  type ReviewHandlerDependencies,
} from './review-route-handler';

const appOrigin = 'http://127.0.0.1:3200';
const learnerCookieName = 'hsk_learner_session';
const meta = { requestId: 'r', timestamp: 't' };
const KEY = '0b5f7f1e-7c4f-4a2e-9b1d-2f6a3c4d5e6f';

const preview = (dueAt: string) => ({
  state: 'learning',
  dueAt,
  intervalDays: 0,
  extra: 'dropped',
});
const item = {
  cardId: 7,
  state: 'new',
  dueAt: '2026-11-12T08:00:00.000Z',
  userId: 99,
  word: {
    id: 12,
    hanzi: '学习',
    traditional: null,
    pinyin: 'xue2 xi2',
    pinyinTone: 'xuéxí',
    example: null,
    meanings: [
      {
        order: 1,
        en: 'to study',
        vi: 'học tập',
        partOfSpeech: null,
        usage: null,
        note: null,
      },
    ],
    levels: [],
    sources: [],
  },
  preview: {
    again: preview('2026-11-12T08:01:00.000Z'),
    hard: preview('2026-11-12T08:06:00.000Z'),
    good: preview('2026-11-12T08:10:00.000Z'),
    easy: preview('2026-11-16T08:00:00.000Z'),
  },
};
const session = {
  sessionId: 41,
  status: 'in_progress',
  plannedCount: 3,
  reviewedCount: 0,
  startedAt: '2026-11-12T08:00:00.000Z',
  expiresAt: '2026-11-13T08:00:00.000Z',
};

type Backend = ReviewHandlerDependencies['requestBackend'];

function deps(requestBackend: Backend): ReviewHandlerDependencies {
  return { appOrigin, learnerCookieName, production: false, requestBackend };
}

function backendError(status: number, code?: string) {
  return new BackendRequestError(
    normalizeApiFailure({
      status,
      body:
        code === undefined
          ? null
          : {
              success: false,
              error: { code, message: 'x', details: { secret: 1 } },
            },
    }),
  );
}

function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    origin?: string | null;
    cookie?: boolean;
    key?: string | null;
  } = {},
) {
  const headers = new Headers();
  if (options.origin !== null)
    headers.set('origin', options.origin ?? appOrigin);
  if (options.cookie !== false)
    headers.set('cookie', `${learnerCookieName}=learner-token`);
  if (options.key !== null && options.method === 'POST')
    headers.set('idempotency-key', options.key ?? KEY);
  if (options.body !== undefined)
    headers.set('content-type', 'application/json');
  return new NextRequest(new URL(path, appOrigin), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function expectStatus(response: NextResponse, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return (await response.json()) as Record<string, unknown>;
}

describe('review BFF route handlers (M3.3a)', () => {
  it('reads the queue with only a numeric limit and projects the items', async () => {
    const backend = vi.fn<Backend>().mockResolvedValue({
      success: true,
      data: { dueCount: 3, items: [item] },
      meta,
    });
    const response = await handleReviewQueue(
      request('/api/learner/review/queue?limit=5'),
      deps(backend),
    );
    const body = await expectStatus(response, 200);
    expect(backend).toHaveBeenCalledWith('/api/v1/review/queue?limit=5', {
      token: 'learner-token',
    });
    const data = body.data as { items: Array<Record<string, unknown>> };
    expect(data.items[0]).not.toHaveProperty('userId');
    expect(JSON.stringify(body)).not.toContain('dropped');

    const bad = vi.fn<Backend>();
    await expectStatus(
      await handleReviewQueue(
        request('/api/learner/review/queue?limit=abc'),
        deps(bad),
      ),
      400,
    );
    expect(bad).not.toHaveBeenCalled();
  });

  it('creates a session with the browser key, rebuilt body and same origin', async () => {
    const backend = vi.fn<Backend>().mockResolvedValue({
      success: true,
      data: { created: true, session },
      meta,
    });
    const response = await handleReviewCreateSession(
      request('/api/learner/review/sessions', {
        method: 'POST',
        body: { limit: 20 },
      }),
      deps(backend),
    );
    const body = await expectStatus(response, 200);
    expect(body).toEqual({ success: true, data: { created: true, session } });
    expect(backend).toHaveBeenCalledWith('/api/v1/review/sessions', {
      token: 'learner-token',
      method: 'POST',
      body: { limit: 20 },
      idempotencyKey: KEY,
    });
  });

  it('refuses a cross-origin write, a missing/malformed key or an unknown field', async () => {
    const backend = vi.fn<Backend>();
    const path = '/api/learner/review/sessions';
    await expectStatus(
      await handleReviewCreateSession(
        request(path, { method: 'POST', body: {}, origin: 'http://evil.test' }),
        deps(backend),
      ),
      403,
    );
    await expectStatus(
      await handleReviewCreateSession(
        request(path, { method: 'POST', body: {}, key: null }),
        deps(backend),
      ),
      400,
    );
    await expectStatus(
      await handleReviewCreateSession(
        request(path, { method: 'POST', body: {}, key: 'bad key!' }),
        deps(backend),
      ),
      400,
    );
    await expectStatus(
      await handleReviewCreateSession(
        request(path, { method: 'POST', body: { limit: 20, userId: 1 } }),
        deps(backend),
      ),
      400,
    );
    expect(backend).not.toHaveBeenCalled();
  });

  it('keeps the documented 409 code and drops its details', async () => {
    const backend = vi
      .fn<Backend>()
      .mockRejectedValue(backendError(409, 'REVIEW_NOTHING_DUE'));
    const response = await handleReviewCreateSession(
      request('/api/learner/review/sessions', { method: 'POST', body: {} }),
      deps(backend),
    );
    const body = await expectStatus(response, 409);
    expect(body).toMatchObject({ error: { code: 'REVIEW_NOTHING_DUE' } });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('maps an undocumented 409 to 503', async () => {
    const backend = vi
      .fn<Backend>()
      .mockRejectedValue(backendError(409, 'SOMETHING_ELSE'));
    await expectStatus(
      await handleReviewCreateSession(
        request('/api/learner/review/sessions', { method: 'POST', body: {} }),
        deps(backend),
      ),
      503,
    );
  });

  it('reads the current session and passes a 404 through', async () => {
    const backend = vi
      .fn<Backend>()
      .mockResolvedValueOnce({
        success: true,
        data: { session, items: [item] },
        meta,
      })
      .mockRejectedValueOnce(backendError(404, 'REVIEW_SESSION_NOT_FOUND'));
    const ok = await expectStatus(
      await handleReviewCurrent(
        request('/api/learner/review/sessions/current'),
        deps(backend),
      ),
      200,
    );
    expect((ok.data as { items: unknown[] }).items).toHaveLength(1);
    expect(backend).toHaveBeenCalledWith('/api/v1/review/sessions/current', {
      token: 'learner-token',
    });
    await expectStatus(
      await handleReviewCurrent(
        request('/api/learner/review/sessions/current'),
        deps(backend),
      ),
      404,
    );
  });

  it('grades with the browser key and a rebuilt body', async () => {
    const backend = vi.fn<Backend>().mockResolvedValue({
      success: true,
      data: {
        replayed: false,
        cardId: 7,
        grade: 'good',
        next: preview('2026-11-12T08:10:00.000Z'),
        session: { reviewedCount: 1, plannedCount: 3 },
      },
      meta,
    });
    const response = await handleReviewGrade(
      request('/api/learner/review/sessions/41/reviews', {
        method: 'POST',
        body: { cardId: 7, grade: 'good', durationMs: 1200 },
      }),
      '41',
      deps(backend),
    );
    const body = await expectStatus(response, 200);
    expect(body.data).toMatchObject({
      cardId: 7,
      session: { reviewedCount: 1 },
    });
    expect(backend).toHaveBeenCalledWith('/api/v1/review/sessions/41/reviews', {
      token: 'learner-token',
      method: 'POST',
      body: { cardId: 7, grade: 'good', durationMs: 1200 },
      idempotencyKey: KEY,
    });
  });

  it('rejects a bad session id or grade before the backend', async () => {
    const backend = vi.fn<Backend>();
    await expectStatus(
      await handleReviewGrade(
        request('/api/learner/review/sessions/x/reviews', {
          method: 'POST',
          body: { cardId: 7, grade: 'good' },
        }),
        'x',
        deps(backend),
      ),
      404,
    );
    await expectStatus(
      await handleReviewGrade(
        request('/api/learner/review/sessions/41/reviews', {
          method: 'POST',
          body: { cardId: 7, grade: 'perfect' },
        }),
        '41',
        deps(backend),
      ),
      400,
    );
    await expectStatus(
      await handleReviewGrade(
        request('/api/learner/review/sessions/41/reviews', {
          method: 'POST',
          body: { cardId: 7, grade: 'good', durationMs: 600_001 },
        }),
        '41',
        deps(backend),
      ),
      400,
    );
    expect(backend).not.toHaveBeenCalled();
  });

  it.each([
    'REVIEW_CARD_ALREADY_REVIEWED',
    'REVIEW_CARD_UNAVAILABLE',
    'REVIEW_CARD_NOT_IN_SESSION',
    'REVIEW_SESSION_EXPIRED',
    'REVIEW_SESSION_NOT_ACTIVE',
    'CONFLICT',
  ])('forwards the grade conflict %s', async (code) => {
    const backend = vi.fn<Backend>().mockRejectedValue(backendError(409, code));
    const body = await expectStatus(
      await handleReviewGrade(
        request('/api/learner/review/sessions/41/reviews', {
          method: 'POST',
          body: { cardId: 7, grade: 'again' },
        }),
        '41',
        deps(backend),
      ),
      409,
    );
    expect(body).toMatchObject({ error: { code } });
  });

  it('completes without a body and projects the summary', async () => {
    const backend = vi.fn<Backend>().mockResolvedValue({
      success: true,
      data: {
        session: { ...session, status: 'completed', expiresAt: null },
        summary: {
          again: 1,
          hard: 0,
          good: 1,
          easy: 1,
          remembered: 2,
          forgot: 1,
          retentionPercent: 67,
          totalDurationMs: 6000,
          cardIds: [1, 2, 3],
        },
      },
      meta,
    });
    const body = await expectStatus(
      await handleReviewComplete(
        request('/api/learner/review/sessions/41/complete', { method: 'POST' }),
        '41',
        deps(backend),
      ),
      200,
    );
    expect(backend).toHaveBeenCalledWith(
      '/api/v1/review/sessions/41/complete',
      {
        token: 'learner-token',
        method: 'POST',
      },
    );
    expect(JSON.stringify(body)).not.toContain('cardIds');
    expect(body.data).toMatchObject({ summary: { retentionPercent: 67 } });
  });

  it('clears the learner cookies on 401 and needs a cookie at all', async () => {
    const backend = vi.fn<Backend>().mockRejectedValue(backendError(401));
    const response = await handleReviewCurrent(
      request('/api/learner/review/sessions/current'),
      deps(backend),
    );
    await expectStatus(response, 401);
    expect(response.cookies.get(learnerCookieName)?.maxAge).toBe(0);
    expect(
      response.cookies.get(getRefreshCookieName(learnerCookieName))?.maxAge,
    ).toBe(0);

    const none = vi.fn<Backend>();
    await expectStatus(
      await handleReviewCurrent(
        request('/api/learner/review/sessions/current', { cookie: false }),
        deps(none),
      ),
      401,
    );
    expect(none).not.toHaveBeenCalled();
  });

  it('answers 503 when the backend shape is unreadable', async () => {
    const backend = vi
      .fn<Backend>()
      .mockResolvedValue({ success: true, data: { session: 1 }, meta });
    await expectStatus(
      await handleReviewCurrent(
        request('/api/learner/review/sessions/current'),
        deps(backend),
      ),
      503,
    );
  });
});
