import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '@/lib/api/api-error';

const { backendRequest } = vi.hoisted(() => ({ backendRequest: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));

import { handleMediaCleanup } from './media-cleanup-route-handler';

const ORIGIN = 'http://127.0.0.1:3200';
const meta = { requestId: 'req-1', timestamp: '2026-10-21T00:00:00.000Z' };

function cleanup(options: { origin?: string | null; cookie?: boolean } = {}) {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set('origin', origin);
  if (options.cookie !== false)
    headers.set('cookie', 'hsk_admin_session=token-1');
  return new NextRequest(`${ORIGIN}/api/admin/media/ingestions/41/cleanup`, {
    method: 'POST',
    headers,
  });
}

async function codeOf(response: Response) {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

function backendError(status: number, code?: string) {
  return new BackendRequestError({
    status,
    kind: 'unknown',
    message: 'x',
    retryable: false,
    code,
  });
}

describe('handleMediaCleanup (TL-50)', () => {
  beforeEach(() => {
    backendRequest.mockReset();
  });

  it('checks in order Origin → id → cookie before calling the backend', async () => {
    expect(
      (
        await handleMediaCleanup(
          cleanup({ origin: 'http://evil.example', cookie: false }),
          'abc',
        )
      ).status,
    ).toBe(403);
    expect(
      (await handleMediaCleanup(cleanup({ cookie: false }), 'abc')).status,
    ).toBe(400);
    expect(
      (await handleMediaCleanup(cleanup({ cookie: false }), '41')).status,
    ).toBe(401);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it.each(['0', '07', '-1', '1e3', '2147483648', '12345678901'])(
    'rejects id %s with 400',
    async (id) => {
      expect((await handleMediaCleanup(cleanup(), id)).status).toBe(400);
      expect(backendRequest).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ ingestionId: 41, cleanupCompleted: true }],
    [{ ingestionId: 41, cleanupCompleted: false, settling: true }],
  ])('returns 201 no-store with the backend result %o', async (data) => {
    backendRequest.mockResolvedValue({ success: true, data, meta });
    const response = await handleMediaCleanup(cleanup(), '2147483647');
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, data });
    expect(backendRequest).toHaveBeenCalledWith(
      '/api/v1/admin/cms/media/ingestions/2147483647/cleanup',
      { token: 'token-1', method: 'POST' },
    );
  });

  it.each([
    [503, 'MEDIA_CLEANUP_REQUIRED'],
    [503, 'MEDIA_CLEANUP_OUTCOME_UNKNOWN'],
    [409, 'CONFLICT'],
  ])('keeps backend %i %s', async (status, code) => {
    backendRequest.mockRejectedValue(backendError(status, code));
    const response = await handleMediaCleanup(cleanup(), '41');
    expect(response.status).toBe(status);
    expect(await codeOf(response)).toBe(code);
  });

  it('answers 503 for a backend shape it does not recognize', async () => {
    backendRequest.mockResolvedValue({ success: true, data: { ok: 1 }, meta });
    const response = await handleMediaCleanup(cleanup(), '41');
    expect(response.status).toBe(503);
  });
});
