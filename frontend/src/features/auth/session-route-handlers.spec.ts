import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import {
  handleLogin,
  handleLogout,
  handleSessionRecovery,
  handleSessionMe,
  type SessionHandlerDependencies,
} from './session-route-handlers';

const nowSeconds = 2_000_000_000;

function jwt(exp = nowSeconds + 600): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 1, exp })).toString('base64url'),
    'signature',
  ].join('.');
}

function dependencies(
  overrides: Partial<SessionHandlerDependencies> = {},
): SessionHandlerDependencies {
  return {
    appOrigin: 'http://frontend.example.test',
    cookieName: 'hsk_admin_session',
    production: false,
    nowMs: () => nowSeconds * 1000,
    login: vi.fn().mockResolvedValue({
      user: { id: 1, email: 'admin@example.test', role: 'admin', name: 'Lan' },
      accessToken: jwt(),
    }),
    loadCurrentUser: vi.fn().mockResolvedValue({
      id: 1,
      email: 'admin@example.test',
      role: 'admin',
    }),
    ...overrides,
  };
}

function post(
  path: string,
  body?: unknown,
  origin = 'http://frontend.example.test',
) {
  return new NextRequest(`http://frontend.example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('session BFF handlers', () => {
  it('sets an HttpOnly admin cookie without returning the token', async () => {
    const response = await handleLogin(
      post('/api/session/login', {
        email: 'admin@example.test',
        password: 'secret1',
      }),
      dependencies(),
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=lax');
    expect(setCookie).toContain('Path=/');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('signature');
  });

  it('rejects cross-origin login before contacting the backend', async () => {
    const deps = dependencies();
    const response = await handleLogin(
      post(
        '/api/session/login',
        { email: 'admin@example.test', password: 'secret1' },
        'https://attacker.example',
      ),
      deps,
    );
    expect(response.status).toBe(403);
    expect(deps.login).not.toHaveBeenCalled();
  });

  it('does not create a session for a non-admin backend identity', async () => {
    const response = await handleLogin(
      post('/api/session/login', {
        email: 'user@example.test',
        password: 'secret1',
      }),
      dependencies({
        login: vi.fn().mockResolvedValue({
          user: { id: 2, email: 'user@example.test', role: 'user', name: null },
          accessToken: jwt(),
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('maps backend rate limiting without reflecting the backend body', async () => {
    const response = await handleLogin(
      post('/api/session/login', {
        email: 'admin@example.test',
        password: 'secret1',
      }),
      dependencies({
        login: vi
          .fn()
          .mockRejectedValue({ status: 429, body: { secret: 'token' } }),
      }),
    );
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain('token');
  });

  it.each([
    [401, 401, 'session_expired'],
    [500, 500, 'unknown'],
  ] as const)(
    'maps backend login HTTP %i to a safe BFF response',
    async (backendStatus, expectedStatus, expectedKind) => {
      const response = await handleLogin(
        post('/api/session/login', {
          email: 'admin@example.test',
          password: 'secret1',
        }),
        dependencies({
          login: vi.fn().mockRejectedValue({ status: backendStatus }),
        }),
      );
      expect(response.status).toBe(expectedStatus);
      expect(await response.json()).toMatchObject({
        error: { kind: expectedKind },
      });
    },
  );

  it('returns forbidden and no identity when /auth/me reports a current non-admin', async () => {
    const request = new NextRequest(
      'http://frontend.example.test/api/session/me',
      {
        headers: { cookie: `hsk_admin_session=${jwt()}` },
      },
    );
    const response = await handleSessionMe(
      request,
      dependencies({
        loadCurrentUser: vi.fn().mockResolvedValue({
          id: 2,
          email: 'user@example.test',
          role: 'user',
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('user@example.test');
  });

  it('revalidates /auth/me and clears an invalid session', async () => {
    const request = new NextRequest(
      'http://frontend.example.test/api/session/me',
      {
        headers: { cookie: `hsk_admin_session=${jwt()}` },
      },
    );
    const response = await handleSessionMe(
      request,
      dependencies({
        loadCurrentUser: vi.fn().mockRejectedValue({ status: 401 }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([401, 403])(
    'classifies backend HTTP %i as an invalid session without mutating the cookie',
    async (backendStatus) => {
      const request = new NextRequest(
        'http://frontend.example.test/api/session/recover',
        {
          method: 'POST',
          headers: {
            cookie: `hsk_admin_session=${jwt()}`,
            origin: 'http://frontend.example.test',
          },
        },
      );
      const response = await handleSessionRecovery(
        request,
        dependencies({
          loadCurrentUser: vi.fn().mockRejectedValue({ status: backendStatus }),
        }),
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('x-session-recovery')).toBe('invalid');
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );

  it('skips the backend when recovery has no cookie', async () => {
    const deps = dependencies();
    const response = await handleSessionRecovery(
      post('/api/session/recover'),
      deps,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('x-session-recovery')).toBe('ready');
    expect(deps.loadCurrentUser).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('does not clear a valid session during recovery', async () => {
    const request = new NextRequest(
      'http://frontend.example.test/api/session/recover',
      {
        method: 'POST',
        headers: {
          cookie: `hsk_admin_session=${jwt()}`,
          origin: 'http://frontend.example.test',
        },
      },
    );
    const response = await handleSessionRecovery(request, dependencies());

    expect(response.status).toBe(204);
    expect(response.headers.get('x-session-recovery')).toBe('ready');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each([500, 503])(
    'fails closed on backend recovery HTTP %i without clearing the cookie',
    async (backendStatus) => {
      const request = new NextRequest(
        'http://frontend.example.test/api/session/recover',
        {
          method: 'POST',
          headers: {
            cookie: `hsk_admin_session=${jwt()}`,
            origin: 'http://frontend.example.test',
          },
        },
      );
      const response = await handleSessionRecovery(
        request,
        dependencies({
          loadCurrentUser: vi.fn().mockRejectedValue({ status: backendStatus }),
        }),
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('x-session-recovery')).toBe('unavailable');
      expect(response.headers.get('set-cookie')).toBeNull();
    },
  );

  it('rejects cross-origin session recovery without clearing the cookie', async () => {
    const response = await handleSessionRecovery(
      post('/api/session/recover', undefined, 'https://attacker.example'),
      dependencies(),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('clears the frontend cookie on same-origin logout', async () => {
    const response = await handleLogout(
      post('/api/session/logout'),
      dependencies(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('rejects cross-origin logout without clearing the cookie', async () => {
    const deps = dependencies();
    const response = await handleLogout(
      post('/api/session/logout', undefined, 'https://attacker.example'),
      deps,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
