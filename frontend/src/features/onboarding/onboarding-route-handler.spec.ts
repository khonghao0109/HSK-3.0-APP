import { NextRequest, type NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';
import { getRefreshCookieName } from '@/lib/auth/session-cookie';

import {
  handleOnboardingComplete,
  type OnboardingHandlerDependencies,
} from './onboarding-route-handler';

const appOrigin = 'http://127.0.0.1:3200';
const learnerCookieName = 'hsk_learner_session';

function validBody() {
  return {
    learningPurpose: 'communication',
    targetBand: 3,
    dailyMinutes: 15,
    reminderEnabled: true,
    reminderTime: '19:00',
    startDate: '2026-10-05',
  };
}

function sampleLevelsResponse() {
  return {
    success: true,
    data: [
      {
        id: 1,
        name: 'HSK 1',
        orderIndex: 1,
        code: 'HSK1',
        minBand: 1,
        maxBand: 1,
      },
      {
        id: 2,
        name: 'HSK 2',
        orderIndex: 2,
        code: 'HSK2',
        minBand: 2,
        maxBand: 2,
      },
      {
        id: 3,
        name: 'HSK 3',
        orderIndex: 3,
        code: 'HSK3',
        minBand: 3,
        maxBand: 3,
      },
      {
        id: 7,
        name: 'HSK 7-9',
        orderIndex: 7,
        code: 'HSK7_9',
        minBand: 7,
        maxBand: 9,
      },
    ],
  };
}

function sampleGoalResponse() {
  return {
    success: true,
    data: {
      id: 10,
      targetLevelId: 3,
      targetBand: 3,
      dailyMinutes: 15,
      learningPurpose: 'communication',
      reminderEnabled: true,
      reminderTime: '19:00',
      startDate: '2026-10-05',
      isActive: true,
      createdAt: '2026-10-05T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
      targetLevel: {
        id: 3,
        code: 'HSK3',
        name: 'HSK 3',
        minBand: 3,
        maxBand: 3,
      },
    },
  };
}

function samplePlanResponse() {
  return { success: true, data: { id: 20, status: 'active' } };
}

function backendError(status: number): BackendRequestError {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

function timeoutError(): BackendRequestError {
  return new BackendRequestError({
    status: 503,
    kind: 'timeout',
    message: 'The upstream request timed out.',
    retryable: true,
  });
}

/**
 * Backend mock that answers the happy path, except for the paths in
 * `overrides`, whose handler decides the outcome of that call.
 */
function mockBackend(overrides: Record<string, () => Promise<unknown>> = {}) {
  return vi.fn().mockImplementation((path: string) => {
    const override = overrides[path];
    if (override) return override();
    if (path === '/api/v1/levels')
      return Promise.resolve(sampleLevelsResponse());
    if (path === '/api/v1/onboarding/goals')
      return Promise.resolve(sampleGoalResponse());
    if (path === '/api/v1/learning-plans')
      return Promise.resolve(samplePlanResponse());
    return Promise.reject(new Error(`Unhandled path: ${path}`));
  });
}

async function runWithBackend(
  requestBackend: OnboardingHandlerDependencies['requestBackend'],
): Promise<NextResponse> {
  return handleOnboardingComplete(
    createRequest({
      body: validBody(),
      cookies: { [learnerCookieName]: 'my-token' },
    }),
    createDeps({ requestBackend }),
  );
}

async function expectFailure(
  response: NextResponse,
  status: number,
  kind: string,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.error.kind).toBe(kind);
}

function expectCookiesCleared(response: NextResponse): void {
  expect(response.cookies.get(learnerCookieName)?.maxAge).toBe(0);
  expect(
    response.cookies.get(getRefreshCookieName(learnerCookieName))?.maxAge,
  ).toBe(0);
}

function expectCookiesUntouched(response: NextResponse): void {
  expect(response.cookies.get(learnerCookieName)).toBeUndefined();
  expect(
    response.cookies.get(getRefreshCookieName(learnerCookieName)),
  ).toBeUndefined();
}

function createRequest(options: {
  origin?: string | null;
  cookies?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
}) {
  const headers = new Headers();
  if (options.origin !== null) {
    headers.set('origin', options.origin ?? appOrigin);
  }
  if (options.cookies) {
    const cookieHeader = Object.entries(options.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    headers.set('cookie', cookieHeader);
  }

  const req = new NextRequest(
    new URL('/api/learner/onboarding/complete', appOrigin),
    {
      method: 'POST',
      headers,
      body:
        options.rawBody !== undefined
          ? options.rawBody
          : options.body !== undefined
            ? JSON.stringify(options.body)
            : JSON.stringify(validBody()),
    },
  );

  return req;
}

function createDeps(
  overrides: Partial<OnboardingHandlerDependencies> = {},
): OnboardingHandlerDependencies {
  return {
    appOrigin,
    learnerCookieName,
    production: false,
    requestBackend: vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/levels') {
        return Promise.resolve(sampleLevelsResponse());
      }
      if (path === '/api/v1/onboarding/goals') {
        return Promise.resolve(sampleGoalResponse());
      }
      if (path === '/api/v1/learning-plans') {
        return Promise.resolve(samplePlanResponse());
      }
      if (path === '/api/v1/onboarding/status') {
        return Promise.resolve({
          success: true,
          data: {
            hasActiveGoal: true,
            hasActiveLearningPlan: true,
            hasUsableLearningPlan: true,
            hasCompletedPlacement: false,
            nextStep: 'ready',
          },
        });
      }
      return Promise.reject(new Error(`Unhandled path: ${path}`));
    }),
    ...overrides,
  };
}

describe('handleOnboardingComplete', () => {
  it('returns 403 when origin is missing or different, without calling backend', async () => {
    const requestBackend = vi.fn();
    const deps = createDeps({ requestBackend });

    // Missing origin
    const req1 = createRequest({
      origin: null,
      cookies: { [learnerCookieName]: 'token' },
    });
    const res1 = await handleOnboardingComplete(req1, deps);
    expect(res1.status).toBe(403);
    expect(requestBackend).not.toHaveBeenCalled();

    // Different origin
    const req2 = createRequest({
      origin: 'http://malicious.example.test',
      cookies: { [learnerCookieName]: 'token' },
    });
    const res2 = await handleOnboardingComplete(req2, deps);
    expect(res2.status).toBe(403);
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('returns 400 when JSON is malformed, has unknown fields, dailyMinutes is 20, band is 0/10, or reminder rule violated', async () => {
    const requestBackend = vi.fn();
    const deps = createDeps({ requestBackend });
    const defaultCookies = { [learnerCookieName]: 'token' };

    // Malformed JSON
    const resBroken = await handleOnboardingComplete(
      createRequest({ rawBody: '{ broken json ', cookies: defaultCookies }),
      deps,
    );
    expect(resBroken.status).toBe(400);

    // Extra unknown field (strict)
    const resExtra = await handleOnboardingComplete(
      createRequest({
        body: { ...validBody(), unexpectedField: 'bad' },
        cookies: defaultCookies,
      }),
      deps,
    );
    expect(resExtra.status).toBe(400);

    // dailyMinutes = 20
    const resDaily20 = await handleOnboardingComplete(
      createRequest({
        body: { ...validBody(), dailyMinutes: 20 },
        cookies: defaultCookies,
      }),
      deps,
    );
    expect(resDaily20.status).toBe(400);

    // targetBand = 0
    const resBand0 = await handleOnboardingComplete(
      createRequest({
        body: { ...validBody(), targetBand: 0 },
        cookies: defaultCookies,
      }),
      deps,
    );
    expect(resBand0.status).toBe(400);

    // targetBand = 10
    const resBand10 = await handleOnboardingComplete(
      createRequest({
        body: { ...validBody(), targetBand: 10 },
        cookies: defaultCookies,
      }),
      deps,
    );
    expect(resBand10.status).toBe(400);

    // Reminder enabled but reminderTime is null
    const resReminder1 = await handleOnboardingComplete(
      createRequest({
        body: { ...validBody(), reminderEnabled: true, reminderTime: null },
        cookies: defaultCookies,
      }),
      deps,
    );
    expect(resReminder1.status).toBe(400);

    // Reminder disabled but reminderTime is non-null
    const resReminder2 = await handleOnboardingComplete(
      createRequest({
        body: { ...validBody(), reminderEnabled: false, reminderTime: '19:00' },
        cookies: defaultCookies,
      }),
      deps,
    );
    expect(resReminder2.status).toBe(400);

    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('returns 401 when no cookie is present or when only admin cookie is present', async () => {
    const requestBackend = vi.fn();
    const deps = createDeps({ requestBackend });

    // No cookies
    const resNoCookie = await handleOnboardingComplete(
      createRequest({ cookies: {} }),
      deps,
    );
    expect(resNoCookie.status).toBe(401);

    // Only admin cookie
    const resAdminOnly = await handleOnboardingComplete(
      createRequest({ cookies: { hsk_admin_session: 'admin-token' } }),
      deps,
    );
    expect(resAdminOnly.status).toBe(401);

    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('executes the correct happy path sequence and omits reminderTime when reminder is off', async () => {
    const callLog: Array<{ path: string; body?: unknown }> = [];
    const requestBackend = vi
      .fn()
      .mockImplementation((path: string, opts?: { body?: unknown }) => {
        callLog.push({ path, body: opts?.body });
        if (path === '/api/v1/levels')
          return Promise.resolve(sampleLevelsResponse());
        if (path === '/api/v1/onboarding/goals')
          return Promise.resolve(sampleGoalResponse());
        if (path === '/api/v1/learning-plans')
          return Promise.resolve(samplePlanResponse());
        return Promise.resolve({});
      });
    const deps = createDeps({ requestBackend });

    // 1. With reminder enabled
    const resOn = await handleOnboardingComplete(
      createRequest({
        body: validBody(),
        cookies: { [learnerCookieName]: 'my-token' },
      }),
      deps,
    );

    expect(resOn.status).toBe(200);
    expect(await resOn.json()).toEqual({ success: true });
    expect(resOn.headers.get('cache-control')).toBe('no-store');
    expect(callLog).toEqual([
      { path: '/api/v1/levels', body: undefined },
      {
        path: '/api/v1/onboarding/goals',
        body: {
          targetLevelId: 3,
          targetBand: 3,
          dailyMinutes: 15,
          learningPurpose: 'communication',
          reminderEnabled: true,
          reminderTime: '19:00',
          startDate: '2026-10-05',
        },
      },
      { path: '/api/v1/learning-plans', body: undefined },
    ]);
    expect(requestBackend).toHaveBeenCalledTimes(3);
    expect(requestBackend).toHaveBeenNthCalledWith(1, '/api/v1/levels', {
      token: 'my-token',
    });
    expect(requestBackend).toHaveBeenNthCalledWith(
      2,
      '/api/v1/onboarding/goals',
      {
        token: 'my-token',
        method: 'POST',
        body: {
          targetLevelId: 3,
          targetBand: 3,
          dailyMinutes: 15,
          learningPurpose: 'communication',
          reminderEnabled: true,
          reminderTime: '19:00',
          startDate: '2026-10-05',
        },
      },
    );
    expect(requestBackend).toHaveBeenNthCalledWith(
      3,
      '/api/v1/learning-plans',
      { token: 'my-token', method: 'POST' },
    );
    expectCookiesUntouched(resOn);

    // 2. With reminder disabled: reminderTime omitted
    callLog.length = 0;
    const bodyOff = {
      ...validBody(),
      reminderEnabled: false,
      reminderTime: null,
    };
    const resOff = await handleOnboardingComplete(
      createRequest({
        body: bodyOff,
        cookies: { [learnerCookieName]: 'my-token' },
      }),
      deps,
    );

    expect(resOff.status).toBe(200);
    expect(callLog).toEqual([
      { path: '/api/v1/levels', body: undefined },
      {
        path: '/api/v1/onboarding/goals',
        body: {
          targetLevelId: 3,
          targetBand: 3,
          dailyMinutes: 15,
          learningPurpose: 'communication',
          reminderEnabled: false,
          startDate: '2026-10-05',
        },
      },
      { path: '/api/v1/learning-plans', body: undefined },
    ]);
    const secondCall = callLog[1];
    expect(secondCall).toBeDefined();
    expect(
      (secondCall?.body as Record<string, unknown> | undefined)?.reminderTime,
    ).toBeUndefined();
  });

  it('returns 409 level_unavailable without POSTing goals when level cannot be resolved, and when goals POST returns 404', async () => {
    // 1. Band 5 is not in sample levels
    const requestBackend = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/levels')
        return Promise.resolve(sampleLevelsResponse());
      return Promise.resolve({});
    });
    const deps = createDeps({ requestBackend });

    const resMissing = await handleOnboardingComplete(
      createRequest({
        body: { ...validBody(), targetBand: 5 },
        cookies: { [learnerCookieName]: 'my-token' },
      }),
      deps,
    );
    expect(resMissing.status).toBe(409);
    const bodyMissing = await resMissing.json();
    expect(bodyMissing.error.kind).toBe('level_unavailable');
    expect(requestBackend).toHaveBeenCalledTimes(1); // only GET /api/v1/levels, never POST goals!

    // 2. Goal returns 404
    const requestBackend404 = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/levels')
        return Promise.resolve(sampleLevelsResponse());
      if (path === '/api/v1/onboarding/goals') {
        const error = new Error('Not found');
        (error as { status?: number }).status = 404;
        return Promise.reject(error);
      }
      return Promise.resolve({});
    });
    const deps404 = createDeps({ requestBackend: requestBackend404 });

    const res404 = await handleOnboardingComplete(
      createRequest({
        body: validBody(),
        cookies: { [learnerCookieName]: 'my-token' },
      }),
      deps404,
    );
    expect(res404.status).toBe(409);
    const body404 = await res404.json();
    expect(body404.error.kind).toBe('level_unavailable');
  });

  it('returns 409 content_unavailable when plan is 409 and status nextStep is content_unavailable; otherwise returns 409 conflict', async () => {
    // 1. Next step is content_unavailable
    const requestBackendContentUnavail = vi
      .fn()
      .mockImplementation((path: string) => {
        if (path === '/api/v1/levels')
          return Promise.resolve(sampleLevelsResponse());
        if (path === '/api/v1/onboarding/goals')
          return Promise.resolve(sampleGoalResponse());
        if (path === '/api/v1/learning-plans') {
          const error = new Error('Plan Conflict');
          (error as { status?: number }).status = 409;
          return Promise.reject(error);
        }
        if (path === '/api/v1/onboarding/status') {
          return Promise.resolve({
            success: true,
            data: {
              hasActiveGoal: true,
              hasActiveLearningPlan: false,
              hasUsableLearningPlan: false,
              hasCompletedPlacement: false,
              nextStep: 'content_unavailable',
            },
          });
        }
        return Promise.resolve({});
      });

    const resContent = await handleOnboardingComplete(
      createRequest({
        body: validBody(),
        cookies: { [learnerCookieName]: 'my-token' },
      }),
      createDeps({ requestBackend: requestBackendContentUnavail }),
    );
    expect(resContent.status).toBe(409);
    const bodyContent = await resContent.json();
    expect(bodyContent.error.kind).toBe('content_unavailable');

    // 2. Next step is NOT content_unavailable
    const requestBackendConflict = vi
      .fn()
      .mockImplementation((path: string) => {
        if (path === '/api/v1/levels')
          return Promise.resolve(sampleLevelsResponse());
        if (path === '/api/v1/onboarding/goals')
          return Promise.resolve(sampleGoalResponse());
        if (path === '/api/v1/learning-plans') {
          const error = new Error('Plan Conflict');
          (error as { status?: number }).status = 409;
          return Promise.reject(error);
        }
        if (path === '/api/v1/onboarding/status') {
          return Promise.resolve({
            success: true,
            data: {
              hasActiveGoal: true,
              hasActiveLearningPlan: false,
              hasUsableLearningPlan: false,
              hasCompletedPlacement: false,
              nextStep: 'set_goal',
            },
          });
        }
        return Promise.resolve({});
      });

    const resConflict = await handleOnboardingComplete(
      createRequest({
        body: validBody(),
        cookies: { [learnerCookieName]: 'my-token' },
      }),
      createDeps({ requestBackend: requestBackendConflict }),
    );
    expect(resConflict.status).toBe(409);
    const bodyConflict = await resConflict.json();
    expect(bodyConflict.error.kind).toBe('conflict');

    // 3. Goal itself returns 409
    const requestBackendGoalConflict = vi
      .fn()
      .mockImplementation((path: string) => {
        if (path === '/api/v1/levels')
          return Promise.resolve(sampleLevelsResponse());
        if (path === '/api/v1/onboarding/goals') {
          const error = new Error('Goal Conflict');
          (error as { status?: number }).status = 409;
          return Promise.reject(error);
        }
        return Promise.resolve({});
      });

    const resGoalConflict = await handleOnboardingComplete(
      createRequest({
        body: validBody(),
        cookies: { [learnerCookieName]: 'my-token' },
      }),
      createDeps({ requestBackend: requestBackendGoalConflict }),
    );
    expect(resGoalConflict.status).toBe(409);
    const bodyGoalConflict = await resGoalConflict.json();
    expect(bodyGoalConflict.error.kind).toBe('conflict');
  });

  it('handles backend 401 with cleared cookies, handles 429, and handles 500/timeout/envelope errors with 503', async () => {
    // 1. Backend 401 -> clears cookies
    const req401 = createRequest({
      body: validBody(),
      cookies: { [learnerCookieName]: 'my-token' },
    });
    const res401 = await handleOnboardingComplete(
      req401,
      createDeps({
        requestBackend: vi.fn().mockRejectedValue({ status: 401 }),
      }),
    );
    expect(res401.status).toBe(401);
    expectCookiesCleared(res401);

    // 2. Backend 429
    const res429 = await handleOnboardingComplete(
      createRequest({
        body: validBody(),
        cookies: { [learnerCookieName]: 'my-token' },
      }),
      createDeps({
        requestBackend: vi.fn().mockRejectedValue({ status: 429 }),
      }),
    );
    expect(res429.status).toBe(429);
    const body429 = await res429.json();
    expect(body429.error.kind).toBe('rate_limited');

    // 3. Backend 500
    const res500 = await handleOnboardingComplete(
      createRequest({
        body: validBody(),
        cookies: { [learnerCookieName]: 'my-token' },
      }),
      createDeps({
        requestBackend: vi.fn().mockRejectedValue({ status: 500 }),
      }),
    );
    expect(res500.status).toBe(503);
    const body500 = await res500.json();
    expect(body500.error.kind).toBe('unavailable');

    // 4. Envelope error (invalid backend JSON schema)
    const resEnvelope = await handleOnboardingComplete(
      createRequest({
        body: validBody(),
        cookies: { [learnerCookieName]: 'my-token' },
      }),
      createDeps({
        requestBackend: vi.fn().mockResolvedValue({ not_success: false }),
      }),
    );
    expect(resEnvelope.status).toBe(503);
    const bodyEnvelope = await resEnvelope.json();
    expect(bodyEnvelope.error.kind).toBe('unavailable');
  });
  describe('levels step failures', () => {
    it('returns 503 unavailable when GET /levels times out', async () => {
      const requestBackend = mockBackend({
        '/api/v1/levels': () => Promise.reject(timeoutError()),
      });
      const response = await runWithBackend(requestBackend);
      await expectFailure(response, 503, 'unavailable');
      expectCookiesUntouched(response);
      expect(requestBackend).toHaveBeenCalledTimes(1);
    });

    it('returns 503 unavailable when GET /levels fails at the network level', async () => {
      const networkErrors = [
        new Error('fetch failed'),
        new BackendRequestError(normalizeApiFailure({ status: 503 })),
      ];
      for (const networkError of networkErrors) {
        const requestBackend = mockBackend({
          '/api/v1/levels': () => Promise.reject(networkError),
        });
        const response = await runWithBackend(requestBackend);
        await expectFailure(response, 503, 'unavailable');
        expectCookiesUntouched(response);
        expect(requestBackend).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('goal step failures', () => {
    it('returns 400 invalid_request when POST /onboarding/goals answers 400', async () => {
      const requestBackend = mockBackend({
        '/api/v1/onboarding/goals': () => Promise.reject(backendError(400)),
      });
      const response = await runWithBackend(requestBackend);
      await expectFailure(response, 400, 'invalid_request');
      expectCookiesUntouched(response);
      expect(requestBackend).not.toHaveBeenCalledWith(
        '/api/v1/learning-plans',
        expect.anything(),
      );
    });

    it('returns 401 and clears both session cookies when POST /onboarding/goals answers 401', async () => {
      const response = await runWithBackend(
        mockBackend({
          '/api/v1/onboarding/goals': () => Promise.reject(backendError(401)),
        }),
      );
      await expectFailure(response, 401, 'session_expired');
      expectCookiesCleared(response);
    });

    it('returns 403 and clears both session cookies when POST /onboarding/goals answers 403', async () => {
      const response = await runWithBackend(
        mockBackend({
          '/api/v1/onboarding/goals': () => Promise.reject(backendError(403)),
        }),
      );
      await expectFailure(response, 403, 'forbidden');
      expectCookiesCleared(response);
    });

    it('returns 503 unavailable when POST /onboarding/goals answers 500', async () => {
      const requestBackend = mockBackend({
        '/api/v1/onboarding/goals': () => Promise.reject(backendError(500)),
      });
      const response = await runWithBackend(requestBackend);
      await expectFailure(response, 503, 'unavailable');
      expectCookiesUntouched(response);
      expect(requestBackend).not.toHaveBeenCalledWith(
        '/api/v1/learning-plans',
        expect.anything(),
      );
    });

    it('returns 503 unavailable without creating a plan when POST /onboarding/goals returns a wrong envelope', async () => {
      const wrongEnvelopes: unknown[] = [
        { success: true, data: {} },
        { success: false },
        { success: true, data: { ...sampleGoalResponse().data, id: 'x' } },
        'not json',
      ];
      for (const envelope of wrongEnvelopes) {
        const requestBackend = mockBackend({
          '/api/v1/onboarding/goals': () => Promise.resolve(envelope),
        });
        const response = await runWithBackend(requestBackend);
        await expectFailure(response, 503, 'unavailable');
        expectCookiesUntouched(response);
        expect(requestBackend).not.toHaveBeenCalledWith(
          '/api/v1/learning-plans',
          expect.anything(),
        );
      }
    });

    it('returns 503 unavailable when POST /onboarding/goals succeeds with an empty body', async () => {
      const requestBackend = mockBackend({
        '/api/v1/onboarding/goals': () => Promise.resolve(null),
      });
      const response = await runWithBackend(requestBackend);
      await expectFailure(response, 503, 'unavailable');
      expect(requestBackend).not.toHaveBeenCalledWith(
        '/api/v1/learning-plans',
        expect.anything(),
      );
    });
  });

  describe('plan step failures', () => {
    it('returns 401 and clears both session cookies when POST /learning-plans answers 401', async () => {
      const response = await runWithBackend(
        mockBackend({
          '/api/v1/learning-plans': () => Promise.reject(backendError(401)),
        }),
      );
      await expectFailure(response, 401, 'session_expired');
      expectCookiesCleared(response);
    });

    it('returns 503 unavailable when POST /learning-plans answers 500', async () => {
      const response = await runWithBackend(
        mockBackend({
          '/api/v1/learning-plans': () => Promise.reject(backendError(500)),
        }),
      );
      await expectFailure(response, 503, 'unavailable');
      expectCookiesUntouched(response);
    });

    it('returns 503 unavailable when POST /learning-plans returns a wrong envelope', async () => {
      const wrongEnvelopes: unknown[] = [
        { success: true, data: {} },
        { success: false },
        { success: true, data: { id: 'x' } },
        null,
      ];
      for (const envelope of wrongEnvelopes) {
        const response = await runWithBackend(
          mockBackend({
            '/api/v1/learning-plans': () => Promise.resolve(envelope),
          }),
        );
        await expectFailure(response, 503, 'unavailable');
        expectCookiesUntouched(response);
      }
    });

    it('returns 409 conflict when POST /learning-plans answers 409 and the status follow-up throws', async () => {
      const requestBackend = mockBackend({
        '/api/v1/learning-plans': () => Promise.reject(backendError(409)),
        '/api/v1/onboarding/status': () => Promise.reject(timeoutError()),
      });
      const response = await runWithBackend(requestBackend);
      await expectFailure(response, 409, 'conflict');
      expectCookiesUntouched(response);
      expect(requestBackend).toHaveBeenCalledWith('/api/v1/onboarding/status', {
        token: 'my-token',
      });
    });
  });
});
