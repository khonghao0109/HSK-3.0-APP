import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import {
  handleConsentAccept,
  handleOptionalConsent,
  type ConsentHandlerDependencies,
} from './consent-route-handler';

const appOrigin = 'http://127.0.0.1:3200';
const learnerCookieName = 'hsk_learner_session';
const documents = [
  { type: 'terms', version: '2026-11', sha256: 'a'.repeat(64) },
  { type: 'privacy', version: '2026-11', sha256: 'b'.repeat(64) },
];

function deps(
  requestBackend: ConsentHandlerDependencies['requestBackend'],
): ConsentHandlerDependencies {
  return { appOrigin, learnerCookieName, production: false, requestBackend };
}

function request(
  options: { origin?: string | null; cookie?: boolean; body?: unknown } = {},
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.origin !== null)
    headers.set('origin', options.origin ?? appOrigin);
  if (options.cookie !== false) {
    headers.set('cookie', `${learnerCookieName}=learner-token`);
  }
  return new NextRequest(new URL('/api/learner/consents/accept', appOrigin), {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body ?? { documents }),
  });
}

const failure = (status: number, code?: string) =>
  new BackendRequestError(
    normalizeApiFailure({
      status,
      body: code === undefined ? null : { error: { code } },
    }),
  );

describe('handleConsentAccept (M1.7b2 B2a)', () => {
  it('forwards exactly the accepted documents with the learner token', async () => {
    const requestBackend = vi.fn().mockResolvedValue({
      success: true,
      data: { documents: [], optional: [] },
      meta: { requestId: 'r', timestamp: 't' },
    });
    const response = await handleConsentAccept(request(), deps(requestBackend));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true });
    expect(requestBackend).toHaveBeenCalledWith(
      '/api/v1/users/me/consents/accept',
      { token: 'learner-token', method: 'POST', body: { documents } },
    );
  });

  it.each([
    ['cross-origin', { origin: 'https://evil.example' }, 403],
    ['origin-less', { origin: null }, 403],
    ['signed out', { cookie: false }, 401],
    ['empty list', { body: { documents: [] } }, 400],
    ['extra key', { body: { documents, returnTo: '/x' } }, 400],
    [
      'bad hash',
      { body: { documents: [{ ...documents[0], sha256: 'x' }] } },
      400,
    ],
  ] as const)(
    'rejects a %s request before the backend',
    async (_l, opts, status) => {
      const requestBackend = vi.fn();
      const response = await handleConsentAccept(
        request(opts),
        deps(requestBackend),
      );
      expect(response.status).toBe(status);
      expect(requestBackend).not.toHaveBeenCalled();
    },
  );

  it('answers legal_documents_outdated on a version mismatch', async () => {
    const response = await handleConsentAccept(
      request(),
      deps(vi.fn().mockRejectedValue(failure(400, 'LEGAL_DOCUMENT_MISMATCH'))),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { kind: 'legal_documents_outdated' },
    });
  });

  it('clears the learner cookies on a backend 401', async () => {
    const response = await handleConsentAccept(
      request(),
      deps(vi.fn().mockRejectedValue(failure(401))),
    );
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().join(';')).toContain(
      `${learnerCookieName}=;`,
    );
  });

  it('maps an unexpected backend failure to 503', async () => {
    const response = await handleConsentAccept(
      request(),
      deps(vi.fn().mockRejectedValue(failure(500))),
    );
    expect(response.status).toBe(503);
  });
});

function optionalRequest(
  options: { origin?: string | null; cookie?: boolean; body?: unknown } = {},
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.origin !== null)
    headers.set('origin', options.origin ?? appOrigin);
  if (options.cookie !== false) {
    headers.set('cookie', `${learnerCookieName}=learner-token`);
  }
  return new NextRequest(
    new URL('/api/learner/consents/optional/analytics', appOrigin),
    {
      method: 'PUT',
      headers,
      body: JSON.stringify(options.body ?? { granted: true }),
    },
  );
}

describe('handleOptionalConsent (M1.7b2 B3)', () => {
  it('forwards the choice with the learner token and returns the saved state', async () => {
    const requestBackend = vi.fn().mockResolvedValue({
      success: true,
      data: { type: 'analytics', granted: true },
      meta: { requestId: 'r', timestamp: 't' },
    });
    const response = await handleOptionalConsent(
      optionalRequest(),
      'analytics',
      deps(requestBackend),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: { type: 'analytics', granted: true },
    });
    expect(requestBackend).toHaveBeenCalledWith(
      '/api/v1/users/me/consents/optional/analytics',
      { token: 'learner-token', method: 'PUT', body: { granted: true } },
    );
  });

  it.each([
    ['cross-origin', { origin: 'https://evil.example' }, 403],
    ['origin-less', { origin: null }, 403],
    ['signed out', { cookie: false }, 401],
    ['extra key', { body: { granted: true, type: 'marketing' } }, 400],
    ['non-boolean', { body: { granted: 'true' } }, 400],
    ['missing granted', { body: {} }, 400],
  ])(
    'refuses a %s request without calling the backend',
    async (_name, options, status) => {
      const requestBackend = vi.fn();
      const response = await handleOptionalConsent(
        optionalRequest(options),
        'analytics',
        deps(requestBackend),
      );
      expect(response.status).toBe(status);
      expect(requestBackend).not.toHaveBeenCalled();
    },
  );

  it.each(['terms', 'privacy', 'recording', 'ANALYTICS'])(
    'answers 404 for the non-optional type %s',
    async (type) => {
      const requestBackend = vi.fn();
      const response = await handleOptionalConsent(
        optionalRequest(),
        type,
        deps(requestBackend),
      );
      expect(response.status).toBe(404);
      expect(requestBackend).not.toHaveBeenCalled();
    },
  );

  it('keeps the session on 429 and clears it on 401', async () => {
    const limited = await handleOptionalConsent(
      optionalRequest(),
      'marketing',
      deps(vi.fn().mockRejectedValue(failure(429))),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.getSetCookie()).toEqual([]);
    const signedOut = await handleOptionalConsent(
      optionalRequest(),
      'marketing',
      deps(vi.fn().mockRejectedValue(failure(401))),
    );
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.getSetCookie().join(';')).toContain(
      `${learnerCookieName}=;`,
    );
  });

  it('maps an unexpected backend reply to 503', async () => {
    const response = await handleOptionalConsent(
      optionalRequest(),
      'analytics',
      deps(vi.fn().mockResolvedValue({ success: true, data: { granted: 1 } })),
    );
    expect(response.status).toBe(503);
  });
});
