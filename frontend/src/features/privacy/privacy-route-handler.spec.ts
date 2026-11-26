import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import {
  handleAccountDeletion,
  handleCreateDataExport,
  handleDataExportDownload,
  handleListDataExports,
  type PrivacyHandlerDependencies,
} from './privacy-route-handler';

const appOrigin = 'http://127.0.0.1:3200';
const learnerCookieName = 'hsk_learner_session';
const meta = { requestId: 'r', timestamp: 't' };

function deps(
  overrides: Partial<PrivacyHandlerDependencies> = {},
): PrivacyHandlerDependencies {
  return {
    appOrigin,
    learnerCookieName,
    production: false,
    requestBackend: vi.fn(),
    rawBackend: vi.fn(),
    ...overrides,
  };
}

function request(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    origin?: string | null;
    cookie?: boolean;
    body?: unknown;
  } = {},
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.origin !== null)
    headers.set('origin', options.origin ?? appOrigin);
  if (options.cookie !== false) {
    headers.set('cookie', `${learnerCookieName}=learner-token`);
  }
  return new NextRequest(new URL(path, appOrigin), {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

const failure = (status: number, code?: string) =>
  new BackendRequestError(
    normalizeApiFailure({
      status,
      body: code === undefined ? null : { error: { code } },
    }),
  );

const cleared = (response: Response) =>
  response.headers.getSetCookie().join(';').includes(`${learnerCookieName}=;`);

const EXPORT = {
  id: 4,
  status: 'completed',
  createdAt: '2026-11-26T01:00:00.000Z',
  completedAt: '2026-11-26T01:05:00.000Z',
  outputExpiresAt: '2026-11-27T01:05:00.000Z',
  downloadable: true,
};

describe('handleListDataExports (M1.7b2 B2b)', () => {
  it('returns the learner exports read with the cookie token', async () => {
    const requestBackend = vi
      .fn()
      .mockResolvedValue({ success: true, data: [EXPORT], meta });
    const response = await handleListDataExports(
      request('/api/learner/data-exports'),
      deps({ requestBackend }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, data: [EXPORT] });
    expect(requestBackend).toHaveBeenCalledWith(
      '/api/v1/users/me/data-exports',
      { token: 'learner-token' },
    );
  });

  it('answers 401 without calling the backend when there is no cookie', async () => {
    const requestBackend = vi.fn();
    const response = await handleListDataExports(
      request('/api/learner/data-exports', { cookie: false }),
      deps({ requestBackend }),
    );
    expect(response.status).toBe(401);
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('maps a malformed backend body to 503', async () => {
    const response = await handleListDataExports(
      request('/api/learner/data-exports'),
      deps({
        requestBackend: vi
          .fn()
          .mockResolvedValue({ success: true, data: [{ id: 'x' }], meta }),
      }),
    );
    expect(response.status).toBe(503);
  });
});

describe('handleCreateDataExport (M1.7b2 B2b)', () => {
  it('refuses a cross-origin request before reading the cookie', async () => {
    const requestBackend = vi.fn();
    const response = await handleCreateDataExport(
      request('/api/learner/data-exports', {
        method: 'POST',
        origin: 'https://evil.example',
      }),
      deps({ requestBackend }),
    );
    expect(response.status).toBe(403);
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('starts an export and answers 202 with its id and status', async () => {
    const requestBackend = vi.fn().mockResolvedValue({
      success: true,
      data: { exportId: 9, status: 'requested' },
      meta,
    });
    const response = await handleCreateDataExport(
      request('/api/learner/data-exports', { method: 'POST' }),
      deps({ requestBackend }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: true,
      data: { exportId: 9, status: 'requested' },
    });
    expect(requestBackend).toHaveBeenCalledWith(
      '/api/v1/users/me/data-exports',
      { token: 'learner-token', method: 'POST' },
    );
  });

  it('keeps the 24-hour limit code so the page can say why', async () => {
    const response = await handleCreateDataExport(
      request('/api/learner/data-exports', { method: 'POST' }),
      deps({
        requestBackend: vi
          .fn()
          .mockRejectedValue(failure(429, 'EXPORT_RATE_LIMITED')),
      }),
    );
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe('EXPORT_RATE_LIMITED');
  });

  it('clears the learner cookies on a backend 401', async () => {
    const response = await handleCreateDataExport(
      request('/api/learner/data-exports', { method: 'POST' }),
      deps({ requestBackend: vi.fn().mockRejectedValue(failure(401)) }),
    );
    expect(response.status).toBe(401);
    expect(cleared(response)).toBe(true);
  });
});

describe('handleDataExportDownload (M1.7b2 B2b)', () => {
  it.each(['0', '-1', 'abc', '1.5', '2147483648', '01'])(
    'answers 404 for the id %s without calling the backend',
    async (id) => {
      const rawBackend = vi.fn();
      const response = await handleDataExportDownload(
        request(`/api/learner/data-exports/${id}/download`),
        id,
        deps({ rawBackend }),
      );
      expect(response.status).toBe(404);
      expect(rawBackend).not.toHaveBeenCalled();
    },
  );

  it('passes the file through as an attachment that is never cached or sniffed', async () => {
    const file = '{"profile":{"email":"a@b.c"}}';
    const rawBackend = vi.fn().mockResolvedValue(
      new Response(file, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    );
    const response = await handleDataExportDownload(
      request('/api/learner/data-exports/4/download'),
      '4',
      deps({ rawBackend }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(file);
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="hsk-data-export-4.json"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(rawBackend).toHaveBeenCalledWith(
      '/api/v1/users/me/data-exports/4/download',
      { headers: { authorization: 'Bearer learner-token' } },
    );
  });

  it('answers 404 for an expired or foreign export', async () => {
    const response = await handleDataExportDownload(
      request('/api/learner/data-exports/4/download'),
      '4',
      deps({
        rawBackend: vi
          .fn()
          .mockResolvedValue(new Response('{}', { status: 404 })),
      }),
    );
    expect(response.status).toBe(404);
  });

  it('clears the learner cookies when the backend answers 401', async () => {
    const response = await handleDataExportDownload(
      request('/api/learner/data-exports/4/download'),
      '4',
      deps({
        rawBackend: vi
          .fn()
          .mockResolvedValue(new Response('{}', { status: 401 })),
      }),
    );
    expect(response.status).toBe(401);
    expect(cleared(response)).toBe(true);
  });

  it('keeps the session on a 403 CONSENT_REQUIRED (only the shared rule clears it)', async () => {
    const response = await handleDataExportDownload(
      request('/api/learner/data-exports/4/download'),
      '4',
      deps({
        rawBackend: vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { success: false, error: { code: 'CONSENT_REQUIRED' } },
              { status: 403 },
            ),
          ),
      }),
    );
    expect(response.status).toBe(403);
    expect(cleared(response)).toBe(false);
  });
});

describe('backend codes are passed only with their own status (M1.7b2 B2b)', () => {
  it('drops EXPORT_RATE_LIMITED on anything but 429', async () => {
    const response = await handleCreateDataExport(
      request('/api/learner/data-exports', { method: 'POST' }),
      deps({
        requestBackend: vi
          .fn()
          .mockRejectedValue(failure(400, 'EXPORT_RATE_LIMITED')),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBeUndefined();
  });
});

describe('handleAccountDeletion (M1.7b2 B2b)', () => {
  const body = { password: 'StrongPassword123!' };

  it('refuses a cross-origin request', async () => {
    const requestBackend = vi.fn();
    const response = await handleAccountDeletion(
      request('/api/learner/account-deletion', {
        method: 'POST',
        origin: 'https://evil.example',
        body,
      }),
      deps({ requestBackend }),
    );
    expect(response.status).toBe(403);
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it.each([{}, { password: '' }, { password: 'x', extra: 1 }])(
    'answers 400 to the body %j',
    async (bad) => {
      const requestBackend = vi.fn();
      const response = await handleAccountDeletion(
        request('/api/learner/account-deletion', { method: 'POST', body: bad }),
        deps({ requestBackend }),
      );
      expect(response.status).toBe(400);
      expect(requestBackend).not.toHaveBeenCalled();
    },
  );

  it('schedules the deletion, then clears the learner cookies', async () => {
    const requestBackend = vi.fn().mockResolvedValue({
      success: true,
      data: { requestId: 3, scheduledAt: '2026-12-03T01:00:00.000Z' },
      meta,
    });
    const response = await handleAccountDeletion(
      request('/api/learner/account-deletion', { method: 'POST', body }),
      deps({ requestBackend }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: true,
      data: { scheduledAt: '2026-12-03T01:00:00.000Z' },
    });
    expect(cleared(response)).toBe(true);
    expect(requestBackend).toHaveBeenCalledWith(
      '/api/v1/users/me/deletion-request',
      { token: 'learner-token', method: 'POST', body },
    );
  });

  it('keeps INVALID_PASSWORD and the session on a wrong password', async () => {
    const response = await handleAccountDeletion(
      request('/api/learner/account-deletion', { method: 'POST', body }),
      deps({
        requestBackend: vi
          .fn()
          .mockRejectedValue(failure(400, 'INVALID_PASSWORD')),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_PASSWORD');
    expect(cleared(response)).toBe(false);
  });
});
