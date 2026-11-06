import { NextRequest, type NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';
import { getRefreshCookieName } from '@/lib/auth/session-cookie';

import {
  handleEmailVerificationConfirm,
  handleEmailVerificationRequest,
  handlePasswordResetConfirm,
  handlePasswordResetRequest,
  type RecoveryHandlerDependencies,
} from './recovery-route-handler';

const appOrigin = 'http://127.0.0.1:3200';
const learnerCookieName = 'hsk_learner_session';
const TOKEN = 'A'.repeat(40) + '_-9';
const PASSWORD = 'new-secret-123';

type Backend = RecoveryHandlerDependencies['requestBackend'];

function deps(requestBackend: Backend): RecoveryHandlerDependencies {
  return { appOrigin, learnerCookieName, production: false, requestBackend };
}

function ok(): Backend {
  return vi.fn<Backend>(async () => null);
}

function failing(status: number, code?: string): Backend {
  const body = code ? { success: false, error: { code, message: 'x' } } : null;
  return vi.fn<Backend>(async () => {
    throw new BackendRequestError(normalizeApiFailure({ status, body }));
  });
}

function post(
  path: string,
  body: unknown,
  options: { origin?: string | null; cookie?: boolean; raw?: string } = {},
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.origin !== null)
    headers.set('origin', options.origin ?? appOrigin);
  if (options.cookie)
    headers.set('cookie', `${learnerCookieName}=learner-token`);
  return new NextRequest(new URL(path, appOrigin), {
    method: 'POST',
    headers,
    body: options.raw ?? JSON.stringify(body),
  });
}

async function text(response: NextResponse) {
  return response.text();
}

function expectNoStore(response: NextResponse) {
  expect(response.headers.get('cache-control')).toBe('no-store');
}

function expectCleared(response: NextResponse) {
  expect(response.cookies.get(learnerCookieName)?.value).toBe('');
  expect(
    response.cookies.get(getRefreshCookieName(learnerCookieName))?.value,
  ).toBe('');
}

function expectNotCleared(response: NextResponse) {
  expect(response.cookies.get(learnerCookieName)).toBeUndefined();
}

describe('POST /api/learner/password-reset/request', () => {
  const path = '/api/learner/password-reset/request';

  it('sends the canonical email and answers 204 with no body', async () => {
    const backend = ok();
    const response = await handlePasswordResetRequest(
      post(path, { email: '  Learner@Example.TEST ' }),
      deps(backend),
    );
    expect(response.status).toBe(204);
    expect(await text(response)).toBe('');
    expectNoStore(response);
    expect(backend).toHaveBeenCalledWith(
      '/api/v1/auth/password-reset/request',
      { method: 'POST', body: { email: 'learner@example.test' } },
    );
  });

  it('answers identically for an email with and without an account', async () => {
    // The backend answers 204 for both; nothing about the email leaks back.
    const known = await handlePasswordResetRequest(
      post(path, { email: 'known@example.test' }),
      deps(ok()),
    );
    const unknown = await handlePasswordResetRequest(
      post(path, { email: 'nobody@example.test' }),
      deps(ok()),
    );
    expect([known.status, await text(known)]).toEqual([
      unknown.status,
      await text(unknown),
    ]);
    expect([...known.headers.entries()]).toEqual([
      ...unknown.headers.entries(),
    ]);
  });

  it.each([
    ['another origin', { origin: 'https://evil.example' }, 403],
    ['no origin', { origin: null }, 403],
  ] as const)('rejects %s with 403', async (_label, options, status) => {
    const backend = ok();
    const response = await handlePasswordResetRequest(
      post(path, { email: 'a@example.test' }, options),
      deps(backend),
    );
    expect(response.status).toBe(status);
    expectNoStore(response);
    expect(backend).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid email', { email: 'not-an-email' }],
    ['a too long email', { email: `${'a'.repeat(250)}@b.co` }],
    ['no email', {}],
    ['a non-string email', { email: 5 }],
  ])('rejects %s with 400 without calling the backend', async (_l, body) => {
    const backend = ok();
    const response = await handlePasswordResetRequest(
      post(path, body),
      deps(backend),
    );
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(backend).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON with 400', async () => {
    const response = await handlePasswordResetRequest(
      post(path, null, { raw: '{' }),
      deps(ok()),
    );
    expect(response.status).toBe(400);
  });

  it.each([
    [429, 429],
    [400, 503],
    [500, 503],
    [503, 503],
  ])('maps backend %i to %i', async (backendStatus, status) => {
    const response = await handlePasswordResetRequest(
      post(path, { email: 'a@example.test' }),
      deps(failing(backendStatus)),
    );
    expect(response.status).toBe(status);
    expectNoStore(response);
    expect(await text(response)).not.toContain('a@example.test');
  });
});

describe('POST /api/learner/password-reset/confirm', () => {
  const path = '/api/learner/password-reset/confirm';

  it('answers 204 with no body and clears the learner cookies', async () => {
    const backend = ok();
    const response = await handlePasswordResetConfirm(
      post(path, { token: TOKEN, newPassword: PASSWORD }, { cookie: true }),
      deps(backend),
    );
    expect(response.status).toBe(204);
    expect(await text(response)).toBe('');
    expectNoStore(response);
    expectCleared(response);
    expect(backend).toHaveBeenCalledWith(
      '/api/v1/auth/password-reset/confirm',
      { method: 'POST', body: { token: TOKEN, newPassword: PASSWORD } },
    );
  });

  it('rejects another origin with 403', async () => {
    const backend = ok();
    const response = await handlePasswordResetConfirm(
      post(
        path,
        { token: TOKEN, newPassword: PASSWORD },
        { origin: 'https://evil.example' },
      ),
      deps(backend),
    );
    expect(response.status).toBe(403);
    expect(backend).not.toHaveBeenCalled();
  });

  it.each([
    ['a short token', { token: 'abc', newPassword: PASSWORD }],
    [
      'a token with bad characters',
      { token: `${'A'.repeat(42)}=`, newPassword: PASSWORD },
    ],
    ['a short password', { token: TOKEN, newPassword: '12345' }],
    ['no password', { token: TOKEN }],
  ])('rejects %s with 400 INVALID_REQUEST', async (_l, body) => {
    const backend = ok();
    const response = await handlePasswordResetConfirm(
      post(path, body),
      deps(backend),
    );
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(backend).not.toHaveBeenCalled();
  });

  it.each([
    ['INVALID_RESET_TOKEN', 'INVALID_RESET_TOKEN'],
    ['BAD_REQUEST', 'WEAK_PASSWORD'],
    ['REQUEST_VALIDATION_FAILED', 'INVALID_REQUEST'],
    [undefined, 'INVALID_REQUEST'],
  ])('maps backend 400 %s to %s', async (backendCode, code) => {
    const response = await handlePasswordResetConfirm(
      post(path, { token: TOKEN, newPassword: PASSWORD }, { cookie: true }),
      deps(failing(400, backendCode)),
    );
    expect(response.status).toBe(400);
    expectNoStore(response);
    expectNotCleared(response);
    const raw = await text(response);
    expect(JSON.parse(raw)).toEqual({ success: false, error: { code } });
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(PASSWORD);
  });

  it.each([
    [429, 429],
    [401, 503],
    [500, 503],
  ])('maps backend %i to %i', async (backendStatus, status) => {
    const response = await handlePasswordResetConfirm(
      post(path, { token: TOKEN, newPassword: PASSWORD }),
      deps(failing(backendStatus)),
    );
    expect(response.status).toBe(status);
    expectNoStore(response);
    const raw = await text(response);
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(PASSWORD);
  });
});

describe('POST /api/learner/email-verification/confirm', () => {
  const path = '/api/learner/email-verification/confirm';

  it('answers 204 with no body, without needing a cookie', async () => {
    const backend = ok();
    const response = await handleEmailVerificationConfirm(
      post(path, { token: TOKEN }),
      deps(backend),
    );
    expect(response.status).toBe(204);
    expect(await text(response)).toBe('');
    expectNoStore(response);
    expect(backend).toHaveBeenCalledWith(
      '/api/v1/auth/email-verification/confirm',
      { method: 'POST', body: { token: TOKEN } },
    );
  });

  it('rejects another origin with 403', async () => {
    const backend = ok();
    const response = await handleEmailVerificationConfirm(
      post(path, { token: TOKEN }, { origin: 'https://evil.example' }),
      deps(backend),
    );
    expect(response.status).toBe(403);
    expect(backend).not.toHaveBeenCalled();
  });

  it.each([
    ['a short token', { token: 'abc' }],
    ['a 44-character token', { token: `${TOKEN}A` }],
    ['no token', {}],
  ])(
    'rejects %s as INVALID_VERIFICATION_TOKEN without calling the backend',
    async (_l, body) => {
      const backend = ok();
      const response = await handleEmailVerificationConfirm(
        post(path, body),
        deps(backend),
      );
      expect(response.status).toBe(400);
      expectNoStore(response);
      expect(await response.json()).toEqual({
        success: false,
        error: { code: 'INVALID_VERIFICATION_TOKEN' },
      });
      expect(backend).not.toHaveBeenCalled();
    },
  );

  it.each([
    [400, 400],
    [429, 429],
    [500, 503],
    [503, 503],
  ])('maps backend %i to %i', async (backendStatus, status) => {
    const response = await handleEmailVerificationConfirm(
      post(path, { token: TOKEN }),
      deps(failing(backendStatus, 'INVALID_VERIFICATION_TOKEN')),
    );
    expect(response.status).toBe(status);
    expectNoStore(response);
    const raw = await text(response);
    expect(raw).not.toContain(TOKEN);
    if (status === 400)
      expect(JSON.parse(raw)).toEqual({
        success: false,
        error: { code: 'INVALID_VERIFICATION_TOKEN' },
      });
  });
});

describe('POST /api/learner/email-verification/request', () => {
  const path = '/api/learner/email-verification/request';

  it('sends the learner token and answers 204 with no body', async () => {
    const backend = ok();
    const response = await handleEmailVerificationRequest(
      post(path, undefined, { cookie: true, raw: '' }),
      deps(backend),
    );
    expect(response.status).toBe(204);
    expect(await text(response)).toBe('');
    expectNoStore(response);
    expect(backend).toHaveBeenCalledWith(
      '/api/v1/auth/email-verification/request',
      { method: 'POST', token: 'learner-token' },
    );
  });

  it('rejects another origin with 403', async () => {
    const backend = ok();
    const response = await handleEmailVerificationRequest(
      post(path, undefined, {
        cookie: true,
        raw: '',
        origin: 'https://evil.example',
      }),
      deps(backend),
    );
    expect(response.status).toBe(403);
    expect(backend).not.toHaveBeenCalled();
  });

  it('answers 401 without a cookie', async () => {
    const backend = ok();
    const response = await handleEmailVerificationRequest(
      post(path, undefined, { raw: '' }),
      deps(backend),
    );
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(backend).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'keeps backend %i and clears the learner cookies',
    async (status) => {
      const response = await handleEmailVerificationRequest(
        post(path, undefined, { cookie: true, raw: '' }),
        deps(failing(status)),
      );
      expect(response.status).toBe(status);
      expectNoStore(response);
      expectCleared(response);
    },
  );

  it.each([
    [429, 429],
    [400, 503],
    [500, 503],
  ])('maps backend %i to %i', async (backendStatus, status) => {
    const response = await handleEmailVerificationRequest(
      post(path, undefined, { cookie: true, raw: '' }),
      deps(failing(backendStatus)),
    );
    expect(response.status).toBe(status);
    expectNoStore(response);
    expectNotCleared(response);
  });
});
