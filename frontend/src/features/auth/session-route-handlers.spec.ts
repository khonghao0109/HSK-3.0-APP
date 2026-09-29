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
      refreshToken: 'sample-refresh-token',
      refreshTokenExpiresAt: new Date(
        (nowSeconds + 86400) * 1000,
      ).toISOString(),
    }),
    loadCurrentUser: vi.fn().mockResolvedValue({
      id: 1,
      email: 'admin@example.test',
      role: 'admin',
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue({
      user: { id: 1, email: 'admin@example.test', role: 'admin', name: 'Lan' },
      accessToken: jwt(),
      refreshToken: 'refreshed-token',
      refreshTokenExpiresAt: new Date(
        (nowSeconds + 86400) * 1000,
      ).toISOString(),
    }),
    ...overrides,
  };
}

function post(
  path: string,
  body?: unknown,
  origin = 'http://frontend.example.test',
  cookies?: Record<string, string>,
) {
  const headers = new Headers({ 'content-type': 'application/json', origin });
  if (cookies) {
    headers.set(
      'cookie',
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    );
  }
  return new NextRequest(`http://frontend.example.test${path}`, {
    method: 'POST',
    headers,
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

    const accessCookie = response.cookies.get('hsk_admin_session');
    expect(accessCookie).toBeDefined();
    expect(accessCookie?.httpOnly).toBe(true);
    expect(accessCookie?.sameSite).toBe('lax');
    expect(accessCookie?.path).toBe('/');
    expect(accessCookie?.maxAge).toBe(600);

    const refreshCookie = response.cookies.get('hsk_admin_session_refresh');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.sameSite).toBe('lax');
    expect(refreshCookie?.path).toBe('/');
    expect(refreshCookie?.maxAge).toBe(86400);

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('signature');
  });

  it('does not expose refreshToken in browser login response and keeps cookie access-token-only', async () => {
    const rawRefreshToken = 'placeholder-refresh-token-43-chars-base64_';
    const accessToken = jwt();
    const deps = dependencies({
      login: vi.fn().mockResolvedValue({
        user: {
          id: 1,
          email: 'admin@example.test',
          role: 'admin',
          name: 'Lan',
        },
        accessToken,
        refreshToken: rawRefreshToken,
        refreshTokenExpiresAt: new Date(
          (nowSeconds + 86400) * 1000,
        ).toISOString(),
      }),
    });

    const response = await handleLogin(
      post('/api/session/login', {
        email: 'admin@example.test',
        password: 'secret1',
      }),
      deps,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      user: unknown;
      refreshToken?: unknown;
    };
    expect(body).toEqual({
      success: true,
      user: { id: 1, email: 'admin@example.test', role: 'admin', name: 'Lan' },
    });
    expect(body.refreshToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(rawRefreshToken);

    expect(response.cookies.get('hsk_admin_session')?.value).toBe(accessToken);
    expect(response.cookies.get('hsk_admin_session_refresh')?.value).toBe(
      rawRefreshToken,
    );
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
    const nonAdminAccessToken = jwt();
    const logoutMock = vi.fn().mockResolvedValue(undefined);
    const response = await handleLogin(
      post('/api/session/login', {
        email: 'user@example.test',
        password: 'secret1',
      }),
      dependencies({
        login: vi.fn().mockResolvedValue({
          user: { id: 2, email: 'user@example.test', role: 'user', name: null },
          accessToken: nonAdminAccessToken,
          refreshToken: 'sample-refresh',
          refreshTokenExpiresAt: new Date(
            (nowSeconds + 86400) * 1000,
          ).toISOString(),
        }),
        logout: logoutMock,
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledWith(nonAdminAccessToken);
    expect(await response.json()).toMatchObject({
      error: { kind: 'forbidden' },
    });
  });

  it('marks a backend 403 on login as a locked account, distinct from forbidden', async () => {
    const response = await handleLogin(
      post('/api/session/login', {
        email: 'admin@example.test',
        password: 'secret1',
      }),
      dependencies({
        login: vi.fn().mockRejectedValue({
          status: 403,
          body: { message: 'Account temporarily locked. secret-detail' },
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).not.toContain('secret-detail');
    expect(JSON.parse(text)).toMatchObject({
      success: false,
      error: { kind: 'account_locked' },
    });
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

  it('clears the session when /auth/me rejects the token as forbidden', async () => {
    const response = await handleSessionMe(
      new NextRequest('http://frontend.example.test/api/session/me', {
        headers: { cookie: `hsk_admin_session=${jwt()}` },
      }),
      dependencies({
        loadCurrentUser: vi.fn().mockRejectedValue({ status: 403 }),
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it.each([
    ['backend 500', { status: 500 }, 500],
    ['backend 502', { status: 502 }, 503],
    ['backend 503', { status: 503 }, 503],
    ['upstream timeout', { status: 503, kind: 'timeout' }, 503],
    ['network failure without status', new TypeError('fetch failed'), 500],
    ['unreadable user body', { id: 'not-a-number' }, 500],
  ])(
    'keeps the session cookie on a transient %s',
    async (_label, failure, expectedStatus) => {
      const loadCurrentUser =
        failure instanceof Error || 'status' in failure
          ? vi.fn().mockRejectedValue(failure)
          : vi.fn().mockResolvedValue(failure);
      const response = await handleSessionMe(
        new NextRequest('http://frontend.example.test/api/session/me', {
          headers: { cookie: `hsk_admin_session=${jwt()}` },
        }),
        dependencies({ loadCurrentUser }),
      );
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ success: false });
    },
  );

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

  it('calls backend logout and clears both cookies on valid access token', async () => {
    const accessToken = jwt(nowSeconds + 600);
    const deps = dependencies();
    const response = await handleLogout(
      post('/api/session/logout', undefined, undefined, {
        hsk_admin_session: accessToken,
        hsk_admin_session_refresh: 'valid-refresh-token',
      }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(deps.logout).toHaveBeenCalledWith(accessToken);
    expect(response.cookies.get('hsk_admin_session')?.maxAge).toBe(0);
    expect(response.cookies.get('hsk_admin_session_refresh')?.maxAge).toBe(0);
  });

  it('clears both cookies and returns 200 when backend logout returns 401', async () => {
    const accessToken = jwt(nowSeconds + 600);
    const deps = dependencies({
      logout: vi.fn().mockRejectedValue({ status: 401 }),
    });
    const response = await handleLogout(
      post('/api/session/logout', undefined, undefined, {
        hsk_admin_session: accessToken,
      }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.cookies.get('hsk_admin_session')?.maxAge).toBe(0);
    expect(response.cookies.get('hsk_admin_session_refresh')?.maxAge).toBe(0);
  });

  it('preserves cookies and returns 503 when backend logout fails with 5xx', async () => {
    const accessToken = jwt(nowSeconds + 600);
    const deps = dependencies({
      logout: vi.fn().mockRejectedValue({ status: 503 }),
    });
    const response = await handleLogout(
      post('/api/session/logout', undefined, undefined, {
        hsk_admin_session: accessToken,
      }),
      deps,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refreshes token then calls logout when access token is expired but refresh token is present', async () => {
    const expiredAccessToken = jwt(nowSeconds - 100);
    const newAccessToken = jwt(nowSeconds + 600);
    const deps = dependencies({
      refresh: vi.fn().mockResolvedValue({
        user: { id: 1, email: 'admin@example.test', role: 'admin' },
        accessToken: newAccessToken,
        refreshToken: 'new-refresh-token',
        refreshTokenExpiresAt: new Date(
          (nowSeconds + 86400) * 1000,
        ).toISOString(),
      }),
    });
    const response = await handleLogout(
      post('/api/session/logout', undefined, undefined, {
        hsk_admin_session: expiredAccessToken,
        hsk_admin_session_refresh: 'valid-refresh-token',
      }),
      deps,
    );
    expect(deps.refresh).toHaveBeenCalledWith('valid-refresh-token');
    expect(deps.logout).toHaveBeenCalledWith(newAccessToken);
    expect(response.status).toBe(200);
    expect(response.cookies.get('hsk_admin_session')?.maxAge).toBe(0);
    expect(response.cookies.get('hsk_admin_session_refresh')?.maxAge).toBe(0);
  });

  it('clears frontend cookies and returns 200 when no cookies are provided (no-op)', async () => {
    const deps = dependencies();
    const response = await handleLogout(post('/api/session/logout'), deps);
    expect(response.status).toBe(200);
    expect(deps.logout).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(response.cookies.get('hsk_admin_session')?.maxAge).toBe(0);
    expect(response.cookies.get('hsk_admin_session_refresh')?.maxAge).toBe(0);
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
