import { describe, expect, it, vi } from 'vitest';

// `createBackendClient` binds `fetch` when `server-backend` is imported.
const { fetchMock } = vi.hoisted(() => {
  const fetchMock = vi.fn<typeof fetch>();
  globalThis.fetch = fetchMock;
  return { fetchMock };
});

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }),
}));
vi.mock('@/lib/config/server-env', () => ({
  serverEnv: {
    APP_ORIGIN: 'http://127.0.0.1:3200',
    LEARNER_SESSION_COOKIE_NAME: 'hsk_learner_session',
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://backend.example.test',
    BFF_REQUEST_TIMEOUT_MS: 1000,
  },
}));

import { recoveryDependencies } from './recovery-service';

describe('recovery backend dependencies', () => {
  it('forwards the browser X-Forwarded-For so per-IP limits count the learner', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await recoveryDependencies().requestBackend(
      '/api/v1/auth/password-reset/request',
      { method: 'POST', body: { email: 'a@b.test' } },
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'http://backend.example.test/api/v1/auth/password-reset/request',
    );
    expect(new Headers(init?.headers).get('x-forwarded-for')).toBe(
      '203.0.113.7, 10.0.0.2',
    );
  });
});
