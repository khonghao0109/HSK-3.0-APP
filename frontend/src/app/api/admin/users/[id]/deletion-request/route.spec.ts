import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '@/lib/api/api-error';

const { backendRequest } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));

import { POST as deletionRequest } from './route';

const ORIGIN = 'http://127.0.0.1:3200';
const URL = `${ORIGIN}/api/admin/users/21/deletion-request`;
const SESSION_COOKIE = 'hsk_admin_session=test-token';

function post(
  url: string,
  body: unknown,
  options: { origin?: string | null; cookie?: string | null } = {},
) {
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const cookie = options.cookie === undefined ? SESSION_COOKIE : options.cookie;
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  if (cookie !== null) headers.set('cookie', cookie);
  return new NextRequest(url, {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function rawPost(url: string, rawBody: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie: SESSION_COOKIE },
    body: rawBody,
  });
}

const okEnvelope = {
  success: true,
  data: {
    requestId: 77,
    scheduledAt: '2026-11-09T10:00:00.000Z',
    initiatedBy: 'admin',
  },
  meta: { requestId: 'req-1', timestamp: '2026-11-02T10:00:00.000Z' },
};

describe('POST /api/admin/users/:id/deletion-request (M1.7d)', () => {
  beforeEach(() => {
    backendRequest.mockReset();
    backendRequest.mockResolvedValue(okEnvelope);
  });

  it('rejects a cross-origin request with 403 and no backend call', async () => {
    const response = await deletionRequest(
      post(
        URL,
        { reason: 'under_age' },
        { origin: 'https://attacker.example' },
      ),
      { params: Promise.resolve({ id: '21' }) },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it.each(['0', '00', '-1', '1.5', 'abc', '2147483648', '9999999999'])(
    'rejects invalid id %s with 400 and no backend call',
    async (id) => {
      const response = await deletionRequest(
        post(URL, { reason: 'under_age' }),
        { params: Promise.resolve({ id }) },
      );
      expect(response.status).toBe(400);
      expect(backendRequest).not.toHaveBeenCalled();
    },
  );

  it('rejects a request without the admin session cookie with 401', async () => {
    const response = await deletionRequest(
      post(URL, { reason: 'under_age' }, { cookie: null }),
      { params: Promise.resolve({ id: '21' }) },
    );
    expect(response.status).toBe(401);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['missing the reason field', {}],
    ['reason outside the enum', { reason: 'spam' }],
    ['reason of the wrong type', { reason: 7 }],
    ['an extra field', { reason: 'under_age', note: 'PO approved' }],
    ['an array body', [{ reason: 'under_age' }]],
    ['a null body', null],
  ])('rejects a body %s with 400 and no backend call', async (_label, body) => {
    const response = await deletionRequest(post(URL, body), {
      params: Promise.resolve({ id: '21' }),
    });
    expect(response.status).toBe(400);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON body with 400 and no backend call', async () => {
    const response = await deletionRequest(rawPost(URL, 'reason=under_age'), {
      params: Promise.resolve({ id: '21' }),
    });
    expect(response.status).toBe(400);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('forwards only { reason: "under_age" } and returns 201 with no-store', async () => {
    const response = await deletionRequest(post(URL, { reason: 'under_age' }), {
      params: Promise.resolve({ id: '21' }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backendRequest).toHaveBeenCalledTimes(1);
    expect(backendRequest).toHaveBeenCalledWith(
      '/api/v1/admin/users/21/deletion-request',
      { token: 'test-token', method: 'POST', body: { reason: 'under_age' } },
    );
    expect(await response.json()).toEqual({
      success: true,
      data: {
        requestId: 77,
        scheduledAt: '2026-11-09T10:00:00.000Z',
        initiatedBy: 'admin',
      },
    });
  });

  it('keeps the backend status and error code', async () => {
    backendRequest.mockRejectedValue(
      new BackendRequestError({
        status: 409,
        kind: 'conflict',
        code: 'USER_DELETION_ALREADY_DUE',
        message: 'The deletion request is already due.',
        retryable: false,
      }),
    );

    const response = await deletionRequest(post(URL, { reason: 'under_age' }), {
      params: Promise.resolve({ id: '21' }),
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('USER_DELETION_ALREADY_DUE');
  });

  it('fails closed with 503 when the backend response shape is unexpected', async () => {
    backendRequest.mockResolvedValue({
      success: true,
      data: { requestId: 77 },
      meta: { requestId: 'req-1', timestamp: '2026-11-02T10:00:00.000Z' },
    });

    const response = await deletionRequest(post(URL, { reason: 'under_age' }), {
      params: Promise.resolve({ id: '21' }),
    });
    expect(response.status).toBe(503);
  });
});
