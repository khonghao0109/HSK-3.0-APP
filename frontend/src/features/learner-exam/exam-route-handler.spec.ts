import { NextRequest, type NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';
import { getRefreshCookieName } from '@/lib/auth/session-cookie';

import {
  handleExamStart,
  type ExamHandlerDependencies,
} from './exam-route-handler';

const appOrigin = 'http://127.0.0.1:3200';
const learnerCookieName = 'hsk_learner_session';
const KEY = '9d1f0b6a-2c6f-4d7f-8d2b-0f3c5a7e9b10';
const meta = { requestId: 'r', timestamp: 't' };
const push = '/api/learner/exam/tests/12/attempts';

function deps(
  requestBackend: ExamHandlerDependencies['requestBackend'],
): ExamHandlerDependencies {
  return { appOrigin, learnerCookieName, production: false, requestBackend };
}

function backendError(status: number, code?: string): BackendRequestError {
  return new BackendRequestError(
    normalizeApiFailure({
      status,
      body: code
        ? { success: false, error: { code, message: 'backend failure' } }
        : undefined,
    }),
  );
}

function request(
  options: {
    path?: string;
    origin?: string | null;
    cookie?: boolean;
    rawBody?: string;
    body?: unknown;
  } = {},
) {
  const headers = new Headers();
  if (options.origin !== null) {
    headers.set('origin', options.origin ?? appOrigin);
  }
  if (options.cookie !== false) {
    headers.set('cookie', `${learnerCookieName}=learner-token`);
  }
  return new NextRequest(new URL(options.path ?? push, appOrigin), {
    method: 'POST',
    headers,
    body:
      options.rawBody ??
      JSON.stringify(options.body ?? { idempotencyKey: KEY }),
  });
}

async function expectFailure(
  response: NextResponse,
  status: number,
  kind: string,
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ success: false, error: { kind } });
  return body;
}

function expectCookiesCleared(response: NextResponse): void {
  expect(response.cookies.get(learnerCookieName)?.maxAge).toBe(0);
  expect(
    response.cookies.get(getRefreshCookieName(learnerCookieName))?.maxAge,
  ).toBe(0);
}

describe('handleExamStart', () => {
  it('starts the attempt and returns only id, status and expiresAt', async () => {
    const requestBackend = vi.fn().mockResolvedValue({
      success: true,
      meta,
      data: {
        id: 77,
        testId: 12,
        status: 'in_progress',
        startedAt: '2026-10-27T02:00:00.000Z',
        expiresAt: '2026-10-27T03:20:00.000Z',
        serverNow: '2026-10-27T02:00:00.000Z',
        remainingSeconds: 4800,
        maxScore: 200,
        questionCount: 3,
        test: { title: 'Đề thử' },
        sections: [{ key: 's1', groups: [] }],
        answers: [],
      },
    });
    const response = await handleExamStart(
      request(),
      '12',
      deps(requestBackend),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      success: true,
      data: {
        id: 77,
        status: 'in_progress',
        expiresAt: '2026-10-27T03:20:00.000Z',
      },
    });
    // The question tree never reaches the browser.
    expect(JSON.stringify(body)).not.toContain('sections');
    expect(JSON.stringify(body)).not.toContain('testId');

    expect(requestBackend).toHaveBeenCalledTimes(1);
    expect(requestBackend).toHaveBeenCalledWith(
      '/api/v1/exam/tests/12/attempts',
      {
        token: 'learner-token',
        method: 'POST',
        body: { idempotencyKey: KEY },
      },
    );
    // The exam backend ignores the header, so the BFF must not attach it.
    const options = requestBackend.mock.calls[0]?.[1] as
      Record<string, unknown> | undefined;
    expect(options).not.toHaveProperty('idempotencyKey');
  });

  it('rejects a cross-origin or origin-less request before the backend', async () => {
    const requestBackend = vi.fn();
    for (const origin of ['http://evil.example', null]) {
      const response = await handleExamStart(
        request({ origin }),
        '12',
        deps(requestBackend),
      );
      await expectFailure(response, 403, 'forbidden');
    }
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['not a number', 'abc'],
    ['fractional', '1.5'],
    ['int4 overflow', '2147483648'],
  ])('rejects a %s test id with 404', async (_label, rawId) => {
    const requestBackend = vi.fn();
    const response = await handleExamStart(
      request(),
      rawId,
      deps(requestBackend),
    );
    await expectFailure(response, 404, 'not_found');
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', { rawBody: 'not-json' }],
    ['an empty body', { body: {} }],
    ['a non-UUID key', { body: { idempotencyKey: 'not-a-uuid' } }],
    ['an extra field', { body: { idempotencyKey: KEY, testId: 12 } }],
    ['a non-string key', { body: { idempotencyKey: 12 } }],
  ])('rejects %s with 400', async (_label, body) => {
    const requestBackend = vi.fn();
    const response = await handleExamStart(
      request(body),
      '12',
      deps(requestBackend),
    );
    await expectFailure(response, 400, 'invalid_request');
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('requires the learner cookie', async () => {
    const requestBackend = vi.fn();
    const response = await handleExamStart(
      request({ cookie: false }),
      '12',
      deps(requestBackend),
    );
    await expectFailure(response, 401, 'session_expired');
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('clears both learner cookies when the backend session is gone', async () => {
    for (const status of [401, 403]) {
      const response = await handleExamStart(
        request(),
        '12',
        deps(vi.fn().mockRejectedValue(backendError(status))),
      );
      await expectFailure(
        response,
        status,
        status === 401 ? 'session_expired' : 'forbidden',
      );
      expectCookiesCleared(response);
    }
  });

  it.each([404, 429])(
    'maps a backend %s to a safe response',
    async (status) => {
      const response = await handleExamStart(
        request(),
        '12',
        deps(vi.fn().mockRejectedValue(backendError(status))),
      );
      await expectFailure(
        response,
        status,
        status === 404 ? 'not_found' : 'rate_limited',
      );
    },
  );

  it.each([
    ['EXAM_TEST_UNAVAILABLE', 'conflict'],
    ['EXAM_IDEMPOTENCY_KEY_REUSED', 'conflict'],
  ])('keeps the machine code %s on a 409', async (code) => {
    const response = await handleExamStart(
      request(),
      '12',
      deps(vi.fn().mockRejectedValue(backendError(409, code))),
    );
    const body = await expectFailure(response, 409, 'conflict');
    expect(body.error).toMatchObject({ code });
    // `details.reasons` is an internal publish-gate path and must not travel.
    expect(JSON.stringify(body)).not.toContain('reasons');
  });

  it('turns an unknown 409 code into 503 instead of leaking it', async () => {
    const response = await handleExamStart(
      request(),
      '12',
      deps(vi.fn().mockRejectedValue(backendError(409, 'SOMETHING_ELSE'))),
    );
    await expectFailure(response, 503, 'unavailable');
  });

  it.each([
    ['a server error', 500, 'unavailable'],
    ['a conflict without code', 409, 'unavailable'],
  ])('maps %s to 503', async (_label, status) => {
    const response = await handleExamStart(
      request(),
      '12',
      deps(vi.fn().mockRejectedValue(backendError(status))),
    );
    await expectFailure(response, 503, 'unavailable');
  });

  it('returns 503 when the backend envelope does not match', async () => {
    for (const data of [
      { id: 77 },
      { id: '77', status: 'in_progress', expiresAt: 'x' },
      { id: 77, status: 'in_progress' },
    ]) {
      const response = await handleExamStart(
        request(),
        '12',
        deps(vi.fn().mockResolvedValue({ success: true, meta, data })),
      );
      await expectFailure(response, 503, 'unavailable');
    }
  });

  it('always answers no-store', async () => {
    const responses = [
      await handleExamStart(request({ origin: null }), '12', deps(vi.fn())),
      await handleExamStart(request(), 'abc', deps(vi.fn())),
      await handleExamStart(request({ cookie: false }), '12', deps(vi.fn())),
      await handleExamStart(
        request(),
        '12',
        deps(vi.fn().mockRejectedValue(backendError(500))),
      ),
    ];
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});
