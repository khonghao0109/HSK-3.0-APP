import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { config, proxy } from './proxy';

describe('CSP nonce proxy and session refresh router', () => {
  it('returns a distinct valid nonce for every request', async () => {
    const first = await proxy(
      new NextRequest('https://frontend.example.test/login'),
    );
    const second = await proxy(
      new NextRequest('https://frontend.example.test/admin/exercises'),
    );
    const firstPolicy = first.headers.get('content-security-policy');
    const secondPolicy = second.headers.get('content-security-policy');
    const firstNonce = firstPolicy?.match(/'nonce-([^']+)'/u)?.[1];
    const secondNonce = secondPolicy?.match(/'nonce-([^']+)'/u)?.[1];

    expect(firstNonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);
    expect(secondNonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);
    expect(firstNonce).not.toBe(secondNonce);
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(firstNonce);
  });

  it('does not set CSP on API requests', async () => {
    const response = await proxy(
      new NextRequest('https://frontend.example.test/api/session/me'),
    );
    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it.each([
    '/api/session/login',
    '/api/session/logout',
    '/api/learner/session/login',
    '/api/learner/session/register',
    '/api/learner/session/logout',
    '/_next/static/x.js',
    '/_next/static/chunks/app.js',
    '/_next/image?url=%2Flogo.png&w=64&q=75',
    '/favicon.ico',
    '/sitemap.xml',
    '/robots.txt',
  ])('does not run for excluded request %s', (url) => {
    expect(doesProxyMatch({ config, nextConfig: {}, url })).toBe(false);
  });

  it.each([
    '/admin/media',
    '/api/admin/media/1/archive',
    '/api/session/me',
    '/api/session/recover',
    '/api/learner/session/me',
  ])('runs for targeted request %s', (url) => {
    expect(doesProxyMatch({ config, nextConfig: {}, url })).toBe(true);
  });

  it.each([{ 'next-router-prefetch': '1' }, { purpose: 'prefetch' }])(
    'does not run for router prefetch headers %o',
    (headers) => {
      expect(
        doesProxyMatch({
          config,
          nextConfig: {},
          url: '/admin',
          headers,
        }),
      ).toBe(false);
    },
  );

  it('still runs for normal document requests', () => {
    expect(doesProxyMatch({ config, nextConfig: {}, url: '/login' })).toBe(
      true,
    );
  });

  describe('proxy path-based session refresh', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function makeJwt(expSecondsFromNow: number): string {
      const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
      return [
        Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'v1' })).toString(
          'base64url',
        ),
        Buffer.from(JSON.stringify({ sub: 1, exp })).toString('base64url'),
        'signature',
      ].join('.');
    }

    it('refreshes learner cookie on learner routes when learner access token is expiring soon', async () => {
      const oldLearnerAccess = makeJwt(60);
      const newLearnerAccess = makeJwt(900);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({
          success: true,
          data: {
            user: { id: 2, email: 'learner@example.test', role: 'user' },
            accessToken: newLearnerAccess,
            refreshToken: 'rotated-learner-refresh',
            refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
          meta: {
            requestId: 'test-request-id',
            timestamp: new Date().toISOString(),
          },
        }),
      );

      const req = new NextRequest('https://frontend.example.test/exercises', {
        headers: {
          cookie: `hsk_learner_session=${oldLearnerAccess}; hsk_learner_session_refresh=current-learner-refresh`,
        },
      });

      const res = await proxy(req);
      expect(fetchSpy).toHaveBeenCalled();
      expect(res.cookies.get('hsk_learner_session')?.value).toBe(newLearnerAccess);
      expect(res.cookies.get('hsk_learner_session_refresh')?.value).toBe('rotated-learner-refresh');
      expect(res.cookies.get('hsk_admin_session')).toBeUndefined();
    });

    it('refreshes admin cookie on admin routes maintaining existing behavior', async () => {
      const oldAdminAccess = makeJwt(60);
      const newAdminAccess = makeJwt(900);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({
          success: true,
          data: {
            user: { id: 1, email: 'admin@example.test', role: 'admin' },
            accessToken: newAdminAccess,
            refreshToken: 'rotated-admin-refresh',
            refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
          meta: {
            requestId: 'test-request-id',
            timestamp: new Date().toISOString(),
          },
        }),
      );

      const req = new NextRequest('https://frontend.example.test/admin/dashboard', {
        headers: {
          cookie: `hsk_admin_session=${oldAdminAccess}; hsk_admin_session_refresh=current-admin-refresh`,
        },
      });

      const res = await proxy(req);
      expect(fetchSpy).toHaveBeenCalled();
      expect(res.cookies.get('hsk_admin_session')?.value).toBe(newAdminAccess);
      expect(res.cookies.get('hsk_admin_session_refresh')?.value).toBe('rotated-admin-refresh');
      expect(res.cookies.get('hsk_learner_session')).toBeUndefined();
    });

    it('refreshes only learner cookie and preserves admin cookie without admin Set-Cookie when both cookies are present on learner routes', async () => {
      const oldLearnerAccess = makeJwt(60);
      const newLearnerAccess = makeJwt(900);
      const adminAccess = makeJwt(60);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({
          success: true,
          data: {
            user: { id: 2, email: 'learner@example.test', role: 'user' },
            accessToken: newLearnerAccess,
            refreshToken: 'rotated-learner-refresh',
            refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
          meta: {
            requestId: 'test-request-id',
            timestamp: new Date().toISOString(),
          },
        }),
      );

      const req = new NextRequest('https://frontend.example.test/learn', {
        headers: {
          cookie: [
            `hsk_learner_session=${oldLearnerAccess}`,
            `hsk_learner_session_refresh=current-learner-refresh`,
            `hsk_admin_session=${adminAccess}`,
            `hsk_admin_session_refresh=current-admin-refresh`,
          ].join('; '),
        },
      });

      const res = await proxy(req);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, fetchOptions] = fetchSpy.mock.calls[0] ?? [];
      expect(String(fetchOptions?.body)).toContain('current-learner-refresh');
      expect(res.cookies.get('hsk_learner_session')?.value).toBe(newLearnerAccess);
      expect(res.cookies.get('hsk_learner_session_refresh')?.value).toBe('rotated-learner-refresh');
      expect(res.cookies.get('hsk_admin_session')).toBeUndefined();
      expect(res.cookies.get('hsk_admin_session_refresh')).toBeUndefined();
    });
  });
});
