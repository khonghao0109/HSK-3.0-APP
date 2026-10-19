import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from './api-error';
import { clientForwardedFor, createBackendClient } from './backend-client';

describe('server-only backend client', () => {
  it('attaches bearer authorization and a safe request id only server-side', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        user: { id: 1, email: 'admin@example.test', role: 'admin' },
      }),
    );
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 500,
      fetchImpl,
      requestIdFactory: () => 'request-123',
    });

    await client.request('/api/v1/auth/me', { token: 'server-secret-token' });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer server-secret-token');
    expect(headers.get('x-request-id')).toBe('request-123');
    expect(init?.cache).toBe('no-store');
  });

  it('forwards the incoming X-Forwarded-For chain verbatim', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 500,
      fetchImpl,
      forwardedFor: async () => '203.0.113.9, 198.51.100.2',
    });

    await client.request('/api/v1/auth/login', { method: 'POST', body: {} });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get('x-forwarded-for')).toBe(
      '203.0.113.9, 198.51.100.2',
    );
  });

  it('omits X-Forwarded-For when the incoming request has no client address', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 500,
      fetchImpl,
      forwardedFor: async () => undefined,
    });

    await client.request('/api/v1/auth/me', { token: 'server-secret-token' });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).has('x-forwarded-for')).toBe(false);
  });

  it.each([
    [
      { 'x-forwarded-for': ' 203.0.113.9, 198.51.100.2 ' },
      '203.0.113.9, 198.51.100.2',
    ],
    [
      { 'x-forwarded-for': '198.51.100.2', 'x-real-ip': '198.51.100.7' },
      '198.51.100.2',
    ],
    [{ 'x-real-ip': '198.51.100.7' }, '198.51.100.7'],
    [{ 'x-forwarded-for': '  ' }, undefined],
    [{}, undefined],
  ])('extracts the client address from %j', (incoming, expected) => {
    expect(clientForwardedFor(new Headers(incoming))).toBe(expected);
  });

  it('aborts an upstream request after the configured timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 5,
      fetchImpl,
    });

    await expect(client.request('/api/v1/auth/me')).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
  });

  it('rejects paths outside the explicit backend allowlist', async () => {
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl: vi.fn<typeof fetch>(),
    });
    await expect(
      client.request('https://attacker.example/secrets'),
    ).rejects.toMatchObject({
      kind: 'invalid_request',
    });
  });

  it('allowlists only the explicit media read and lifecycle endpoints', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request('/api/v1/admin/cms/media?page=1&limit=20');
    await client.request('/api/v1/admin/cms/media/41');
    await client.request('/api/v1/admin/cms/media/41/quarantine', {
      method: 'POST',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await expect(
      client.request('/api/v1/admin/cms/media/41/upload', { method: 'POST' }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
  });

  it('allowlists only the explicit lesson/topic CMS endpoints (M5.1a, F1)', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request(
      '/api/v1/admin/cms/lessons?page=1&limit=20&search=chao',
    );
    await client.request('/api/v1/admin/cms/lessons/41');
    await client.request('/api/v1/admin/cms/lessons/41/revisions', {
      method: 'POST',
    });
    await client.request('/api/v1/admin/cms/lessons/41/revisions/7/reviews', {
      method: 'POST',
    });
    await client.request('/api/v1/admin/cms/lessons/41/revisions/7/publish', {
      method: 'POST',
    });
    await client.request('/api/v1/admin/cms/lessons/41/archive', {
      method: 'POST',
    });
    await client.request('/api/v1/admin/cms/topics', { method: 'POST' });
    await client.request('/api/v1/admin/cms/topics/9');
    await client.request('/api/v1/admin/cms/topics/9/revisions', {
      method: 'POST',
    });
    await client.request('/api/v1/admin/cms/topics/9/revisions/3/reviews', {
      method: 'POST',
    });
    await client.request('/api/v1/admin/cms/topics/9/revisions/3/publish', {
      method: 'POST',
    });
    await client.request('/api/v1/admin/cms/topics/9/archive', {
      method: 'POST',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(12);

    for (const path of [
      '/api/v1/admin/cms/lessons/1/../x',
      '/api/v1/admin/cms/lessons/abc',
      '/api/v1/admin/cms/lessons/41/revisions/7/reviews/extra',
      '/api/v1/admin/cms/lessons/41/revisions/abc/publish',
      '/api/v1/admin/cms/topics/9/archive/extra',
      '/api/v1/admin/cms/topics?x=1',
      '/api/v1/admin/cms/lessons/41/archive?x=1',
    ]) {
      await expect(client.request(path)).rejects.toMatchObject({
        kind: 'invalid_request',
      });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(12);
  });

  it('allowlists only the explicit exercise CMS mutation endpoints (M5.1b1, F2)', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request(
      '/api/v1/admin/cms/exercises?lessonId=7&status=draft&page=1&limit=20',
    );
    await client.request('/api/v1/admin/cms/exercises/41');
    await client.request('/api/v1/admin/cms/exercises', { method: 'POST' });
    await client.request('/api/v1/admin/cms/exercises/41/revisions', {
      method: 'POST',
    });
    await client.request('/api/v1/admin/cms/exercises/41/revisions/7/reviews', {
      method: 'POST',
    });
    await client.request('/api/v1/admin/cms/exercises/41/revisions/7/publish', {
      method: 'POST',
    });
    await client.request('/api/v1/admin/cms/exercises/41/archive', {
      method: 'POST',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(7);

    // Chưa mở exercise-imports (M5.1b2) và không cho biến thể đường dẫn.
    for (const path of [
      '/api/v1/admin/cms/exercise-imports',
      '/api/v1/admin/cms/exercise-imports/preview',
      '/api/v1/admin/cms/exercises/41/revisions/7/reviews/extra',
      '/api/v1/admin/cms/exercises/abc/revisions',
      '/api/v1/admin/cms/exercises/41/archive?x=1',
      '/api/v1/admin/cms/exercises/1/../x',
      '/api/v1/admin/cms/exercises/41/revisions/7',
    ]) {
      await expect(client.request(path)).rejects.toMatchObject({
        kind: 'invalid_request',
      });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it('keeps only the filtered error details of a backend 422 envelope (M5.1b1, F1)', async () => {
    const longPath = `content.${'x'.repeat(210)}`;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          success: false,
          error: {
            code: 'invalid_token_set',
            message: 'LessonExercise validation failed at answer.tokenIds.',
            details: {
              path: 'answer.tokenIds',
              errors: [
                { rowNumber: 3, code: 'missing_field', path: 'answer' },
                { rowNumber: '3', code: 'bad_row', path: 'answer' },
                { rowNumber: 4, code: 'x'.repeat(65), path: 'answer' },
                { rowNumber: 5, code: 'ok', path: longPath },
                { rowNumber: 6, code: 'valid', path: 'content.options[0]' },
                '{not object}',
              ],
              sql: 'SELECT answer FROM LessonExercise',
              authorId: 7,
              stack: 'secret stack',
            },
          },
        },
        { status: 422 },
      ),
    );
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    const error = await client
      .request('/api/v1/admin/cms/exercises', { method: 'POST', body: {} })
      .catch((thrown: unknown) => thrown as BackendRequestError);

    expect(error).toMatchObject({
      status: 422,
      kind: 'validation',
      code: 'invalid_token_set',
      details: {
        path: 'answer.tokenIds',
        errors: [
          { rowNumber: 3, code: 'missing_field', path: 'answer' },
          { rowNumber: 6, code: 'valid', path: 'content.options[0]' },
        ],
      },
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain('SELECT answer');
    expect(serialized).not.toContain('secret stack');
    expect(serialized).not.toContain('bad_row');
  });

  it('allowlists auth refresh and logout endpoints, rejecting path variants', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: 'dummy' },
    });
    await client.request('/api/v1/auth/logout', {
      method: 'POST',
      token: 'dummy-token',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await expect(
      client.request('/api/v1/auth/refresh/x', { method: 'POST' }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(
      client.request('/api/v1/auth/logout?x=1', { method: 'POST' }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(
      client.request('/api/v1/auth/refreshx', { method: 'POST' }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
  });

  it('allowlists password reset and email verification, rejecting path variants', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });
    const paths = [
      '/api/v1/auth/password-reset/request',
      '/api/v1/auth/password-reset/confirm',
      '/api/v1/auth/email-verification/request',
      '/api/v1/auth/email-verification/confirm',
    ];

    for (const path of paths) {
      await client.request(path, { method: 'POST', body: {} });
    }
    expect(
      fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toEqual(paths);

    for (const path of paths) {
      for (const variant of [`${path}?x=1`, `${path}/x`]) {
        await expect(
          client.request(variant, { method: 'POST' }),
        ).rejects.toMatchObject({ kind: 'invalid_request' });
      }
    }
    expect(fetchImpl).toHaveBeenCalledTimes(paths.length);
  });

  it('resolves a 204 response without a body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await expect(
      client.request('/api/v1/auth/password-reset/request', {
        method: 'POST',
        body: { email: 'a@b.test' },
      }),
    ).resolves.toBeNull();
  });

  it('allowlists auth register endpoint, rejecting path variants', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request('/api/v1/auth/register', {
      method: 'POST',
      body: { email: 'user@example.test', password: 'password123' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await expect(
      client.request('/api/v1/auth/register/x', { method: 'POST' }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(
      client.request('/api/v1/auth/register?x=1', { method: 'POST' }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
  });

  it('allowlists onboarding and learning endpoints, rejecting path variants', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request('/api/v1/levels');
    await client.request('/api/v1/onboarding/status');
    await client.request('/api/v1/onboarding/goals', {
      method: 'POST',
      body: {},
    });
    await client.request('/api/v1/onboarding/goals/current');
    await client.request('/api/v1/learning-plans', { method: 'POST' });
    await client.request('/api/v1/learning/home');
    await client.request('/api/v1/learning/path');
    await client.request('/api/v1/learning/lessons/12/activity');
    expect(fetchImpl).toHaveBeenCalledTimes(8);

    for (const path of [
      '/api/v1/levels',
      '/api/v1/onboarding/status',
      '/api/v1/onboarding/goals',
      '/api/v1/onboarding/goals/current',
      '/api/v1/learning-plans',
      '/api/v1/learning/home',
      '/api/v1/learning/path',
      '/api/v1/learning/lessons/12/activity',
    ]) {
      await expect(client.request(`${path}/x`)).rejects.toMatchObject({
        kind: 'invalid_request',
      });
      await expect(client.request(`${path}?x=1`)).rejects.toMatchObject({
        kind: 'invalid_request',
      });
    }
    for (const path of [
      '/api/v1/learning/lessons/abc/activity',
      '/api/v1/learning/lessons//activity',
      '/api/v1/learning/lessons/12',
    ]) {
      await expect(client.request(path)).rejects.toMatchObject({
        kind: 'invalid_request',
      });
    }
  });

  it('allowlists lesson start and exercise attempts, rejecting path variants', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request('/api/v1/learning/lessons/12/start', {
      method: 'POST',
      body: {},
    });
    await client.request('/api/v1/learning/exercises/34/attempts', {
      method: 'POST',
      body: { answer: { optionId: 'a' } },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    for (const path of [
      '/api/v1/learning/lessons/-1/start',
      '/api/v1/learning/lessons/12/start?x=1',
      '/api/v1/learning/lessons/12/start/',
      '/api/v1/learning/lessons/../start',
      '/api/v1/learning/lessons/12/../start',
      '/api/v1/learning/lessons/abc/start',
      '/api/v1/learning/exercises/-1/attempts',
      '/api/v1/learning/exercises/34/attempts?x=1',
      '/api/v1/learning/exercises/34/attempts/',
      '/api/v1/learning/exercises/../attempts',
      '/api/v1/learning/exercises/34/../attempts',
      '/api/v1/learning/exercises//attempts',
      '/api/v1/learning/exercises/34',
    ]) {
      await expect(client.request(path)).rejects.toMatchObject({
        kind: 'invalid_request',
      });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('allowlists lesson/topic complete and lesson progress, rejecting path variants', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    for (const path of [
      '/api/v1/learning/lessons/12/complete',
      '/api/v1/learning/topics/7/start',
      '/api/v1/learning/topics/7/complete',
    ]) {
      await client.request(path, { method: 'POST', body: {} });
    }
    await client.request('/api/v1/progress/lessons/12');
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    for (const path of [
      '/api/v1/learning/lessons/12/complete?x=1',
      '/api/v1/learning/lessons/12/complete/',
      '/api/v1/learning/lessons/../complete',
      '/api/v1/learning/topics/-1/complete',
      '/api/v1/learning/topics/7/attempts',
      '/api/v1/learning/topics/7',
      '/api/v1/progress/lessons',
      '/api/v1/progress/lessons/12/x',
      '/api/v1/progress/lessons/abc',
    ]) {
      await expect(client.request(path)).rejects.toMatchObject({
        kind: 'invalid_request',
      });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('sends the idempotency key header only when given', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request('/api/v1/learning/lessons/12/start', {
      method: 'POST',
      body: {},
      idempotencyKey: 'lesson-start-12',
    });
    await client.request('/api/v1/learning/path');

    const [, first] = fetchImpl.mock.calls[0] ?? [];
    const [, second] = fetchImpl.mock.calls[1] ?? [];
    expect(new Headers(first?.headers).get('idempotency-key')).toBe(
      'lesson-start-12',
    );
    expect(new Headers(second?.headers).has('idempotency-key')).toBe(false);
  });
  it('allowlists dictionary search, word and save, rejecting path variants', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request(
      `/api/v1/dictionary?query=${encodeURIComponent('学习')}`,
      { token: 't' },
    );
    await client.request('/api/v1/dictionary/words/12', { token: 't' });
    await client.request('/api/v1/dictionary/words/12/save', { token: 't' });
    for (const path of [
      '/api/v1/dictionary',
      '/api/v1/dictionary?query=a&x=1',
      '/api/v1/dictionary/words/abc',
      '/api/v1/dictionary/words/1/savex',
      '/api/v1/dictionary/words/1/save?x=1',
    ]) {
      await expect(client.request(path, { token: 't' })).rejects.toMatchObject({
        kind: 'invalid_request',
      });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('sends DELETE with the token and no body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request('/api/v1/dictionary/words/12/save', {
      token: 't',
      method: 'DELETE',
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'http://backend.example.test/api/v1/dictionary/words/12/save',
    );
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer t');
    expect(headers.has('content-type')).toBe(false);
    expect(headers.has('idempotency-key')).toBe(false);
  });

  it('allowlists media access and content, rejecting path variants', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true }));
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
    });

    await client.request('/api/v1/media/7/access', { token: 't' });
    await client.raw('/api/v1/media/7/content');
    for (const path of [
      '/api/v1/media/7/access/x',
      '/api/v1/media/abc/content',
      '/api/v1/media/7/content?expires=1',
      '/api/v1/media/7',
    ]) {
      await expect(client.raw(path)).rejects.toMatchObject({
        kind: 'invalid_request',
      });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('raw returns any status unread and sends no token', async () => {
    const upstream = new Response('nope', { status: 403 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream);
    const client = createBackendClient({
      baseUrl: 'http://backend.example.test',
      timeoutMs: 100,
      fetchImpl,
      requestIdFactory: () => 'request-raw',
      forwardedFor: async () => '203.0.113.9',
    });

    const response = await client.raw('/api/v1/media/7/content', {
      search: new URLSearchParams([
        ['expires', '1'],
        ['signature', 'a'.repeat(64)],
      ]),
      headers: { range: 'bytes=0-1' },
    });

    expect(response).toBe(upstream);
    expect(response.bodyUsed).toBe(false);
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(input)).toBe(
      `http://backend.example.test/api/v1/media/7/content?expires=1&signature=${'a'.repeat(64)}`,
    );
    const headers = new Headers(init?.headers);
    expect(headers.get('range')).toBe('bytes=0-1');
    expect(headers.get('x-request-id')).toBe('request-raw');
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
  });

  it('raw times out waiting for headers, not while the body streams', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const hanging = vi.fn<typeof fetch>((_input, init) => {
        signal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      });
      const client = createBackendClient({
        baseUrl: 'http://backend.example.test',
        timeoutMs: 100,
        fetchImpl: hanging,
      });
      const pending = client.raw('/api/v1/media/7/content');
      const assertion = expect(pending).rejects.toMatchObject({
        kind: 'timeout',
        status: 503,
      });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;

      let bodySignal: AbortSignal | undefined;
      const answering = vi.fn<typeof fetch>((_input, init) => {
        bodySignal = init?.signal ?? undefined;
        return Promise.resolve(new Response('bytes'));
      });
      const streaming = createBackendClient({
        baseUrl: 'http://backend.example.test',
        timeoutMs: 100,
        fetchImpl: answering,
      });
      await streaming.raw('/api/v1/media/7/content');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(bodySignal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
