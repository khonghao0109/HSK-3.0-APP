import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const { backendRequest } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));

import { handleMediaMutation } from '@/features/media/media-route-handler';
import {
  handleLearnerLogin,
  handleLearnerLogout,
  handleLearnerRegister,
  handleLearnerSessionMe,
  type LearnerSessionHandlerDependencies,
} from './learner-session-route-handlers';

const nowSeconds = 2_000_000_000;

function jwt(role: 'admin' | 'user' = 'user', exp = nowSeconds + 600): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 1, role, exp })).toString('base64url'),
    'signature',
  ].join('.');
}

function dependencies(
  overrides: Partial<LearnerSessionHandlerDependencies> = {},
): LearnerSessionHandlerDependencies {
  return {
    appOrigin: 'http://frontend.example.test',
    cookieName: 'hsk_learner_session',
    production: false,
    nowMs: () => nowSeconds * 1000,
    login: vi.fn().mockResolvedValue({
      user: {
        id: 2,
        email: 'learner@example.test',
        role: 'user',
        name: 'Learner',
      },
      accessToken: jwt('user'),
      refreshToken: 'sample-refresh-token',
      refreshTokenExpiresAt: new Date(
        (nowSeconds + 86400) * 1000,
      ).toISOString(),
    }),
    register: vi.fn().mockResolvedValue({
      user: { id: 3, email: 'new@example.test', role: 'user', name: 'Newbie' },
      accessToken: jwt('user'),
      refreshToken: 'register-refresh-token',
      refreshTokenExpiresAt: new Date(
        (nowSeconds + 86400) * 1000,
      ).toISOString(),
    }),
    loadCurrentUser: vi.fn().mockResolvedValue({
      id: 2,
      email: 'learner@example.test',
      role: 'user',
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue({
      user: {
        id: 2,
        email: 'learner@example.test',
        role: 'user',
        name: 'Learner',
      },
      accessToken: jwt('user'),
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

function get(path: string, cookies?: Record<string, string>) {
  const headers = new Headers();
  if (cookies) {
    headers.set(
      'cookie',
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    );
  }
  return new NextRequest(`http://frontend.example.test${path}`, {
    method: 'GET',
    headers,
  });
}

describe('learner session BFF handlers', () => {
  describe('login', () => {
    it('logs in user role returning 200 and setting 2 learner cookies with correct attributes', async () => {
      const deps = dependencies();
      const response = await handleLearnerLogin(
        post('/api/learner/session/login', {
          email: 'learner@example.test',
          password: 'secretPassword123',
        }),
        deps,
      );

      expect(response.status).toBe(200);

      const accessCookie = response.cookies.get('hsk_learner_session');
      expect(accessCookie).toBeDefined();
      expect(accessCookie?.httpOnly).toBe(true);
      expect(accessCookie?.sameSite).toBe('lax');
      expect(accessCookie?.path).toBe('/');
      expect(accessCookie?.secure).toBe(false);
      expect(accessCookie?.maxAge).toBe(600);

      const refreshCookie = response.cookies.get('hsk_learner_session_refresh');
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie?.httpOnly).toBe(true);
      expect(refreshCookie?.sameSite).toBe('lax');
      expect(refreshCookie?.path).toBe('/');
      expect(refreshCookie?.secure).toBe(false);
      expect(refreshCookie?.maxAge).toBe(86400);

      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = (await response.json()) as {
        success: boolean;
        user: { role: string };
      };
      expect(body.success).toBe(true);
      expect(body.user.role).toBe('user');
    });

    it('rejects admin login with 403 admin_account, sets 0 cookies, and revokes backend session', async () => {
      const logoutMock = vi.fn().mockResolvedValue(undefined);
      const adminToken = jwt('admin');
      const deps = dependencies({
        login: vi.fn().mockResolvedValue({
          user: {
            id: 1,
            email: 'admin@example.test',
            role: 'admin',
            name: 'Admin',
          },
          accessToken: adminToken,
          refreshToken: 'admin-refresh',
          refreshTokenExpiresAt: new Date(
            (nowSeconds + 86400) * 1000,
          ).toISOString(),
        }),
        logout: logoutMock,
      });

      const response = await handleLearnerLogin(
        post('/api/learner/session/login', {
          email: 'admin@example.test',
          password: 'secretPassword123',
        }),
        deps,
      );

      expect(response.status).toBe(403);
      expect(response.cookies.getAll()).toEqual([]);
      expect(logoutMock).toHaveBeenCalledWith(adminToken);

      const body = (await response.json()) as {
        success: boolean;
        error: { kind: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.kind).toBe('admin_account');
    });

    it('returns 401 without cookies on wrong password', async () => {
      const deps = dependencies({
        login: vi.fn().mockRejectedValue({ status: 401 }),
      });

      const response = await handleLearnerLogin(
        post('/api/learner/session/login', {
          email: 'learner@example.test',
          password: 'wrongPassword',
        }),
        deps,
      );

      expect(response.status).toBe(401);
      expect(response.cookies.getAll()).toEqual([]);
    });

    it('returns 403 account_locked without cookies when backend reports account locked', async () => {
      const deps = dependencies({
        login: vi.fn().mockRejectedValue({ status: 403 }),
      });

      const response = await handleLearnerLogin(
        post('/api/learner/session/login', {
          email: 'learner@example.test',
          password: 'wrongPassword',
        }),
        deps,
      );

      expect(response.status).toBe(403);
      expect(response.cookies.getAll()).toEqual([]);
      const body = (await response.json()) as {
        success: boolean;
        error: { kind: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.kind).toBe('account_locked');
    });

    it('rejects cross-origin login with 403 without calling backend', async () => {
      const loginMock = vi.fn();
      const deps = dependencies({ login: loginMock });

      const response = await handleLearnerLogin(
        post(
          '/api/learner/session/login',
          { email: 'learner@example.test', password: 'secretPassword123' },
          'http://attacker.example.test',
        ),
        deps,
      );

      expect(response.status).toBe(403);
      expect(loginMock).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('registers user returning 201 and setting learner cookies', async () => {
      const deps = dependencies();
      const response = await handleLearnerRegister(
        post('/api/learner/session/register', {
          email: 'new@example.test',
          password: 'secretPassword123',
          name: 'Newbie',
        }),
        deps,
      );

      expect(response.status).toBe(201);
      expect(response.cookies.get('hsk_learner_session')).toBeDefined();
      expect(response.cookies.get('hsk_learner_session_refresh')).toBeDefined();

      const body = (await response.json()) as {
        success: boolean;
        user: { email: string };
      };
      expect(body.success).toBe(true);
      expect(body.user.email).toBe('new@example.test');
    });

    it('returns 409 email_taken when email is already registered', async () => {
      const deps = dependencies({
        register: vi.fn().mockRejectedValue({ status: 409 }),
      });

      const response = await handleLearnerRegister(
        post('/api/learner/session/register', {
          email: 'existing@example.test',
          password: 'secretPassword123',
        }),
        deps,
      );

      expect(response.status).toBe(409);
      expect(response.cookies.getAll()).toEqual([]);

      const body = (await response.json()) as {
        success: boolean;
        error: { kind: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.kind).toBe('email_taken');
    });

    it('returns 400 weak_password when backend rejects password as too weak', async () => {
      const deps = dependencies({
        register: vi.fn().mockRejectedValue({ status: 400 }),
      });

      const response = await handleLearnerRegister(
        post('/api/learner/session/register', {
          email: 'valid@example.test',
          password: 'password123',
        }),
        deps,
      );

      expect(response.status).toBe(400);
      expect(response.cookies.getAll()).toEqual([]);

      const body = (await response.json()) as {
        success: boolean;
        error: { kind: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.kind).toBe('weak_password');
    });

    it('returns 400 without calling backend on invalid registration body', async () => {
      const registerMock = vi.fn();
      const deps = dependencies({ register: registerMock });

      const response = await handleLearnerRegister(
        post('/api/learner/session/register', {
          email: 'not-an-email',
          password: '123',
        }),
        deps,
      );

      expect(response.status).toBe(400);
      expect(registerMock).not.toHaveBeenCalled();
    });

    it('rejects cross-origin register with 403 without calling backend', async () => {
      const registerMock = vi.fn();
      const deps = dependencies({ register: registerMock });

      const response = await handleLearnerRegister(
        post(
          '/api/learner/session/register',
          { email: 'new@example.test', password: 'secretPassword123' },
          'http://attacker.example.test',
        ),
        deps,
      );

      expect(response.status).toBe(403);
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('clears both learner cookies without touching admin cookie', async () => {
      const logoutMock = vi.fn().mockResolvedValue(undefined);
      const deps = dependencies({ logout: logoutMock });

      const learnerToken = jwt('user');
      const response = await handleLearnerLogout(
        post('/api/learner/session/logout', undefined, undefined, {
          hsk_learner_session: learnerToken,
          hsk_learner_session_refresh: 'sample-refresh',
          hsk_admin_session: 'admin-cookie-value',
        }),
        deps,
      );

      expect(response.status).toBe(204);
      expect(logoutMock).toHaveBeenCalledWith(learnerToken);

      const learnerCookie = response.cookies.get('hsk_learner_session');
      expect(learnerCookie?.maxAge).toBe(0);
      const learnerRefreshCookie = response.cookies.get(
        'hsk_learner_session_refresh',
      );
      expect(learnerRefreshCookie?.maxAge).toBe(0);

      // Admin cookie is untouched
      expect(response.cookies.get('hsk_admin_session')).toBeUndefined();
    });

    it('always returns 204 even when backend logout fails', async () => {
      const deps = dependencies({
        logout: vi.fn().mockRejectedValue(new Error('backend network error')),
      });

      const response = await handleLearnerLogout(
        post('/api/learner/session/logout', undefined, undefined, {
          hsk_learner_session: jwt('user'),
        }),
        deps,
      );

      expect(response.status).toBe(204);
      expect(response.cookies.get('hsk_learner_session')?.maxAge).toBe(0);
    });

    it('rejects cross-origin logout with 403 without calling backend', async () => {
      const logoutMock = vi.fn();
      const deps = dependencies({ logout: logoutMock });

      const response = await handleLearnerLogout(
        post(
          '/api/learner/session/logout',
          undefined,
          'http://attacker.example.test',
          { hsk_learner_session: jwt('user') },
        ),
        deps,
      );

      expect(response.status).toBe(403);
      expect(logoutMock).not.toHaveBeenCalled();
    });
  });

  describe('me', () => {
    it('returns 401 when no session cookie is provided', async () => {
      const deps = dependencies();
      const response = await handleLearnerSessionMe(
        get('/api/learner/session/me'),
        deps,
      );

      expect(response.status).toBe(401);
    });

    it('returns 403 when user role is admin', async () => {
      const deps = dependencies({
        loadCurrentUser: vi.fn().mockResolvedValue({
          id: 1,
          email: 'admin@example.test',
          role: 'admin',
        }),
      });

      const response = await handleLearnerSessionMe(
        get('/api/learner/session/me', { hsk_learner_session: jwt('admin') }),
        deps,
      );

      expect(response.status).toBe(403);
    });

    it('returns user profile when session is valid and role is user', async () => {
      const deps = dependencies();
      const response = await handleLearnerSessionMe(
        get('/api/learner/session/me', { hsk_learner_session: jwt('user') }),
        deps,
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        user: { role: string; email: string };
      };
      expect(body.user.role).toBe('user');
      expect(body.user.email).toBe('learner@example.test');
    });
  });

  describe('admin isolation (trap 4)', () => {
    it('rejects admin mutation when only learner session cookie is provided without calling backend admin', async () => {
      backendRequest.mockReset();
      const response = await handleMediaMutation(
        post(
          '/api/admin/media/42/archive',
          undefined,
          'http://127.0.0.1:3200',
          { hsk_learner_session: jwt('user') },
        ),
        '42',
        'archive',
      );

      expect(response.status).toBe(401);
      expect(backendRequest).not.toHaveBeenCalled();
    });
  });
});
