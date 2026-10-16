import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import {
  handleMediaAccess,
  handleMediaContent,
  type LearnerMediaHandlerDependencies,
} from './learner-media-route-handler';

const appOrigin = 'http://127.0.0.1:3200';
const learnerCookieName = 'hsk_learner_session';
const meta = { requestId: 'r', timestamp: 't' };
const SIG = 'ab'.repeat(32);
// Header.payload.signature with a numeric exp: the only shape checked.
const TOKEN = `x.${Buffer.from('{"exp":4102444800}').toString('base64url')}.y`;

type Deps = LearnerMediaHandlerDependencies;

function deps(over: Partial<Deps> = {}): Deps {
  return {
    learnerCookieName,
    requestBackend: vi.fn<Deps['requestBackend']>(),
    requestBackendRaw: vi.fn<Deps['requestBackendRaw']>(),
    ...over,
  };
}

function backendError(status: number) {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

function get(
  path: string,
  options: { cookie?: string | null; range?: string } = {},
) {
  const headers = new Headers();
  if (options.cookie !== null) {
    headers.set('cookie', `${learnerCookieName}=${options.cookie ?? TOKEN}`);
  }
  if (options.range !== undefined) headers.set('range', options.range);
  return new NextRequest(new URL(path, appOrigin), { headers });
}

function grant(url: string) {
  return {
    success: true,
    meta,
    data: { expiresAt: '2026-10-12T10:05:00.000Z', url },
  };
}

async function expectFailure(response: Response, status: number) {
  expect(response.status).toBe(status);
  const body: unknown = await response.json();
  expect(body).toMatchObject({ success: false });
  expect(JSON.stringify(body)).not.toContain('backend-secret');
}

describe('GET /api/learner/media/:id/access', () => {
  const good = `/api/v1/media/7/content?expires=1791000000&signature=${SIG}`;

  it('rebuilds a same-origin src from the backend grant', async () => {
    const requestBackend = vi.fn().mockResolvedValue(grant(good));
    const response = await handleMediaAccess(
      get('/api/learner/media/7/access'),
      '7',
      deps({ requestBackend }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: {
        src: `/api/learner/media/7/content?expires=1791000000&signature=${SIG}`,
        expiresAt: '2026-10-12T10:05:00.000Z',
      },
    });
    expect(requestBackend).toHaveBeenCalledWith('/api/v1/media/7/access', {
      token: TOKEN,
    });
  });

  it.each([
    '0',
    '07',
    'abc',
    '1e3',
    '12345678901234567',
    '9999999999999999',
    '-1',
  ])('answers 404 for id %s without calling the backend', async (id) => {
    const requestBackend = vi.fn();
    const response = await handleMediaAccess(
      get(`/api/learner/media/${id}/access`),
      id,
      deps({ requestBackend }),
    );
    await expectFailure(response, 404);
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('answers 401 without a learner session', async () => {
    const requestBackend = vi.fn();
    const response = await handleMediaAccess(
      get('/api/learner/media/7/access', { cookie: null }),
      '7',
      deps({ requestBackend }),
    );
    await expectFailure(response, 401);
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it.each([
    [401, 401],
    [403, 403],
    [404, 404],
    [429, 429],
    [400, 503],
    [500, 503],
    [503, 503],
  ])('maps backend %i to %i', async (backendStatus, status) => {
    const requestBackend = vi
      .fn()
      .mockRejectedValue(backendError(backendStatus));
    await expectFailure(
      await handleMediaAccess(
        get('/api/learner/media/7/access'),
        '7',
        deps({ requestBackend }),
      ),
      status,
    );
  });

  it('maps a timeout to 503', async () => {
    const requestBackend = vi.fn().mockRejectedValue(
      new BackendRequestError({
        status: 503,
        kind: 'timeout',
        message: 'backend-secret',
        retryable: true,
      }),
    );
    await expectFailure(
      await handleMediaAccess(
        get('/api/learner/media/7/access'),
        '7',
        deps({ requestBackend }),
      ),
      503,
    );
  });

  it.each([
    ['another media id', `/api/v1/media/8/content?expires=1&signature=${SIG}`],
    [
      'an absolute url',
      `https://evil.example/api/v1/media/7/content?expires=1&signature=${SIG}`,
    ],
    [
      'a protocol-relative url',
      `//evil.example/api/v1/media/7/content?expires=1&signature=${SIG}`,
    ],
    ['another path', `/api/v1/media/7/access?expires=1&signature=${SIG}`],
    ['an extra parameter', `${good}&x=1`],
    ['a repeated parameter', `${good}&expires=2`],
    ['a missing signature', '/api/v1/media/7/content?expires=1'],
    [
      'an upper-case signature',
      `/api/v1/media/7/content?expires=1&signature=${SIG.toUpperCase()}`,
    ],
    [
      'a long expires',
      `/api/v1/media/7/content?expires=12345678901&signature=${SIG}`,
    ],
    ['a fragment', `${good}#x`],
  ])('answers 502 for %s', async (_name, url) => {
    const requestBackend = vi.fn().mockResolvedValue(grant(url));
    await expectFailure(
      await handleMediaAccess(
        get('/api/learner/media/7/access'),
        '7',
        deps({ requestBackend }),
      ),
      502,
    );
  });

  it('answers 502 for a malformed envelope or expiresAt', async () => {
    for (const body of [
      { success: true, meta, data: { url: good } },
      { success: true, meta, data: { url: good, expiresAt: 'soon' } },
      { secret: 'backend-secret' },
    ]) {
      const requestBackend = vi.fn().mockResolvedValue(body);
      await expectFailure(
        await handleMediaAccess(
          get('/api/learner/media/7/access'),
          '7',
          deps({ requestBackend }),
        ),
        502,
      );
    }
  });
});

describe('GET /api/learner/media/:id/content', () => {
  const path = `/api/learner/media/7/content?expires=1791000000&signature=${SIG}`;

  function upstream(status: number, headers: Record<string, string> = {}) {
    return new Response(status === 204 ? null : 'backend-secret body', {
      status,
      headers,
    });
  }

  it('streams the backend bytes with only the whitelisted headers', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode(`chunk${pulls}`));
        if (pulls === 3) controller.close();
      },
    });
    const requestBackendRaw = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 206,
        headers: {
          'content-type': 'audio/wav',
          'content-length': '2',
          'content-range': 'bytes 0-1/48044',
          'accept-ranges': 'bytes',
          'content-disposition': 'inline',
          'x-content-type-options': 'nosniff',
          'cache-control': 'public, max-age=60',
          'set-cookie': 'backend=1',
          'x-request-id': 'backend-request',
          etag: '"x"',
        },
      }),
    );
    const response = await handleMediaContent(
      get(path, { range: 'bytes=0-1' }),
      '7',
      deps({ requestBackendRaw }),
    );

    // Nothing was drained before the browser reads (at most the stream's
    // own first pull).
    expect(pulls).toBeLessThanOrEqual(1);
    expect(response.status).toBe(206);
    expect(Object.fromEntries(response.headers)).toEqual({
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
      'content-disposition': 'inline',
      'content-length': '2',
      'content-range': 'bytes 0-1/48044',
      'content-type': 'audio/wav',
      'x-content-type-options': 'nosniff',
    });
    expect(await response.text()).toBe('chunk1chunk2chunk3');

    const [backendPath, options] = requestBackendRaw.mock.calls[0] ?? [];
    expect(backendPath).toBe('/api/v1/media/7/content');
    expect(String(options.search)).toBe(`expires=1791000000&signature=${SIG}`);
    expect(options.headers).toEqual({ range: 'bytes=0-1' });
  });

  it('passes 200 through and sends no cookie or token upstream', async () => {
    const requestBackendRaw = vi
      .fn()
      .mockResolvedValue(upstream(200, { 'content-type': 'audio/wav' }));
    const response = await handleMediaContent(
      get(path),
      '7',
      deps({ requestBackendRaw }),
    );
    expect(response.status).toBe(200);
    const [, options] = requestBackendRaw.mock.calls[0] ?? [];
    expect(options.headers).toEqual({});
    expect(JSON.stringify(options)).not.toContain(TOKEN);
  });

  it('keeps 416 and its Content-Range without the backend body', async () => {
    const requestBackendRaw = vi.fn().mockResolvedValue(
      upstream(416, {
        'content-type': 'application/json',
        'content-range': 'bytes */48044',
      }),
    );
    const response = await handleMediaContent(
      get(path, { range: 'bytes=99999999-' }),
      '7',
      deps({ requestBackendRaw }),
    );
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */48044');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('');
  });

  it.each(['bytes=0-1', 'bytes=10-', 'bytes=-500'])(
    'forwards the range %s',
    async (range) => {
      const requestBackendRaw = vi.fn().mockResolvedValue(upstream(206));
      await handleMediaContent(
        get(path, { range }),
        '7',
        deps({ requestBackendRaw }),
      );
      expect(requestBackendRaw.mock.calls[0]?.[1].headers).toEqual({ range });
    },
  );

  it.each([
    'bytes=0-1,4-5',
    'items=0-1',
    'bytes=a-b',
    'bytes=-',
    'bytes = 0-1',
    `bytes=${'1'.repeat(95)}-`,
  ])('drops the range %s', async (range) => {
    const requestBackendRaw = vi.fn().mockResolvedValue(upstream(200));
    await handleMediaContent(
      get(path, { range }),
      '7',
      deps({ requestBackendRaw }),
    );
    expect(requestBackendRaw.mock.calls[0]?.[1].headers).toEqual({});
  });

  it.each([null, 'not-a-jwt'])('answers 401 with cookie %s', async (cookie) => {
    const requestBackendRaw = vi.fn();
    await expectFailure(
      await handleMediaContent(
        get(path, { cookie }),
        '7',
        deps({ requestBackendRaw }),
      ),
      401,
    );
    expect(requestBackendRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['no query', ''],
    ['a missing signature', '?expires=1'],
    ['a repeated expires', `?expires=1&expires=2&signature=${SIG}`],
    ['an extra parameter', `?expires=1&signature=${SIG}&x=1`],
    ['a long expires', `?expires=12345678901&signature=${SIG}`],
    ['a short signature', `?expires=1&signature=${SIG.slice(2)}`],
    ['an upper-case signature', `?expires=1&signature=${SIG.toUpperCase()}`],
  ])('answers 400 for %s', async (_name, query) => {
    const requestBackendRaw = vi.fn();
    await expectFailure(
      await handleMediaContent(
        get(`/api/learner/media/7/content${query}`),
        '7',
        deps({ requestBackendRaw }),
      ),
      400,
    );
    expect(requestBackendRaw).not.toHaveBeenCalled();
  });

  it('answers 404 for a bad id', async () => {
    await expectFailure(await handleMediaContent(get(path), 'x7', deps()), 404);
  });

  it.each([
    [403, 403],
    [404, 404],
    [429, 429],
    [400, 503],
    [401, 503],
    [500, 503],
    [502, 503],
  ])(
    'maps backend %i to %i without its body',
    async (backendStatus, status) => {
      const requestBackendRaw = vi
        .fn()
        .mockResolvedValue(upstream(backendStatus));
      await expectFailure(
        await handleMediaContent(get(path), '7', deps({ requestBackendRaw })),
        status,
      );
    },
  );

  it('maps a timeout or network failure to 503', async () => {
    const requestBackendRaw = vi.fn().mockRejectedValue(backendError(503));
    await expectFailure(
      await handleMediaContent(get(path), '7', deps({ requestBackendRaw })),
      503,
    );
  });
});
