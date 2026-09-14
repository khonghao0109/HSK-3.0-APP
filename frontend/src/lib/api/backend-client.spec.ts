import { describe, expect, it, vi } from 'vitest';

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
});
