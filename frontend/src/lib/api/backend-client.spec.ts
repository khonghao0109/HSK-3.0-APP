import { describe, expect, it, vi } from 'vitest';

import { createBackendClient } from './backend-client';

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
});
