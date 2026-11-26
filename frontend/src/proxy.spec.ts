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
    '/api/learner/onboarding/complete',
    '/api/learner/lessons/12/start',
    '/api/learner/lessons/12/complete',
    '/api/learner/topics/7/complete',
    '/api/learner/exercises/34/attempts',
    '/api/learner/media/7/access',
    '/api/learner/media/7/content',
    '/api/learner/dictionary?q=a',
    '/api/learner/dictionary/words/5/save',
    '/api/learner/email-verification/request',
    '/api/learner/exam/tests/7/attempts',
  ])('runs for targeted request %s', (url) => {
    expect(doesProxyMatch({ config, nextConfig: {}, url })).toBe(true);
  });

  it('keeps every learner BFF route in the matcher (M2.6b, M2.1c)', () => {
    expect(config.matcher).toEqual(
      expect.arrayContaining([
        '/api/admin/:path*',
        '/api/session/me',
        '/api/session/recover',
        '/api/learner/session/me',
        '/api/learner/media/:path*',
        '/api/learner/onboarding/:path*',
        '/api/learner/lessons/:path*',
        '/api/learner/exercises/:path*',
        '/api/learner/topics/:path*',
        '/api/learner/dictionary/:path*',
        '/api/learner/email-verification/:path*',
        '/api/learner/exam/:path*',
        '/api/learner/review/:path*',
        '/api/learner/data-exports/:path*',
        '/api/learner/account-deletion',
      ]),
    );
  });

  it.each([
    '/api/learner/data-exports',
    '/api/learner/data-exports/4/download',
    '/api/learner/account-deletion',
  ])('refreshes the session for the privacy BFF %s (M1.7b2 B2b)', (url) => {
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
            refreshTokenExpiresAt: new Date(
              Date.now() + 86400000,
            ).toISOString(),
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
      expect(res.cookies.get('hsk_learner_session')?.value).toBe(
        newLearnerAccess,
      );
      expect(res.cookies.get('hsk_learner_session_refresh')?.value).toBe(
        'rotated-learner-refresh',
      );
      expect(res.cookies.get('hsk_admin_session')).toBeUndefined();
    });

    it('refreshes an expired learner access cookie on the dictionary BFF route', async () => {
      const expiredAccess = makeJwt(-60);
      const newLearnerAccess = makeJwt(900);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({
          success: true,
          data: {
            user: { id: 2, email: 'learner@example.test', role: 'user' },
            accessToken: newLearnerAccess,
            refreshToken: 'rotated-learner-refresh',
            refreshTokenExpiresAt: new Date(
              Date.now() + 86400000,
            ).toISOString(),
          },
          meta: {
            requestId: 'test-request-id',
            timestamp: new Date().toISOString(),
          },
        }),
      );

      const req = new NextRequest(
        'https://frontend.example.test/api/learner/dictionary?q=a',
        {
          headers: {
            cookie: `hsk_learner_session=${expiredAccess}; hsk_learner_session_refresh=current-learner-refresh`,
          },
        },
      );

      expect(
        doesProxyMatch({ config, nextConfig: {}, url: req.nextUrl.pathname }),
      ).toBe(true);
      const res = await proxy(req);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        '/api/v1/auth/refresh',
      );
      expect(res.cookies.get('hsk_learner_session')?.value).toBe(
        newLearnerAccess,
      );
      expect(res.cookies.get('hsk_learner_session_refresh')?.value).toBe(
        'rotated-learner-refresh',
      );
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
            refreshTokenExpiresAt: new Date(
              Date.now() + 86400000,
            ).toISOString(),
          },
          meta: {
            requestId: 'test-request-id',
            timestamp: new Date().toISOString(),
          },
        }),
      );

      const req = new NextRequest(
        'https://frontend.example.test/admin/dashboard',
        {
          headers: {
            cookie: `hsk_admin_session=${oldAdminAccess}; hsk_admin_session_refresh=current-admin-refresh`,
          },
        },
      );

      const res = await proxy(req);
      expect(fetchSpy).toHaveBeenCalled();
      expect(res.cookies.get('hsk_admin_session')?.value).toBe(newAdminAccess);
      expect(res.cookies.get('hsk_admin_session_refresh')?.value).toBe(
        'rotated-admin-refresh',
      );
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
            refreshTokenExpiresAt: new Date(
              Date.now() + 86400000,
            ).toISOString(),
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
      expect(res.cookies.get('hsk_learner_session')?.value).toBe(
        newLearnerAccess,
      );
      expect(res.cookies.get('hsk_learner_session_refresh')?.value).toBe(
        'rotated-learner-refresh',
      );
      expect(res.cookies.get('hsk_admin_session')).toBeUndefined();
      expect(res.cookies.get('hsk_admin_session_refresh')).toBeUndefined();
    });
  });

  describe('consent pre-check for learner pages (M1.7b2 B2a)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function liveJwt(): string {
      const exp = Math.floor(Date.now() / 1000) + 900;
      return [
        Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
        Buffer.from(JSON.stringify({ sub: 2, exp })).toString('base64url'),
        'signature',
      ].join('.');
    }

    function consents(
      documents: Array<{ status: string; deadline?: string | null }>,
    ) {
      return Response.json({
        success: true,
        data: {
          documents: documents.map((doc, index) => ({
            type: index === 0 ? 'terms' : 'privacy',
            status: doc.status,
            version: '2026-11',
            sha256: 'a'.repeat(64),
            effectiveAt: '2026-11-20T00:00:00.000Z',
            deadline: doc.deadline ?? null,
          })),
          optional: [],
        },
        meta: { requestId: 'r', timestamp: 't' },
      });
    }

    function page(path: string, extra: Record<string, string> = {}) {
      return new NextRequest(`https://frontend.example.test${path}`, {
        headers: { cookie: `hsk_learner_session=${liveJwt()}`, ...extra },
      });
    }

    it('sends a blocked learner to /consent with the page as returnTo, in one backend call', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          consents([{ status: 'blocked' }, { status: 'accepted' }]),
        );
      const res = await proxy(page('/learn/lessons/12?step=2'));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] ?? [];
      expect(String(url)).toContain('/api/v1/users/me/consents');
      expect(new Headers(init?.headers).get('authorization')).toMatch(
        /^Bearer /u,
      );
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe(
        'https://frontend.example.test/consent?returnTo=%2Flearn%2Flessons%2F12%3Fstep%3D2',
      );
    });

    it('passes a pending learner through with the earliest deadline header', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        consents([
          { status: 'pending', deadline: '2026-12-04T00:00:00.000Z' },
          { status: 'pending', deadline: '2026-12-01T00:00:00.000Z' },
        ]),
      );
      const res = await proxy(page('/onboarding/goal'));
      expect(res.headers.get('location')).toBeNull();
      expect(
        res.headers.get('x-middleware-request-x-hsk-consent-deadline'),
      ).toBe('2026-12-01T00:00:00.000Z');
    });

    it('fails open and logs when the consent read fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await proxy(page('/learn'));
      expect(res.headers.get('location')).toBeNull();
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/Bearer|eyJ/u);
    });

    it('drops a client-sent deadline header and adds none when all is accepted', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        consents([{ status: 'accepted' }, { status: 'not_required' }]),
      );
      const res = await proxy(
        page('/learn', { 'x-hsk-consent-deadline': 'forged' }),
      );
      expect(res.headers.get('location')).toBeNull();
      expect(
        res.headers.get('x-middleware-request-x-hsk-consent-deadline'),
      ).toBeNull();
    });

    it.each([
      '/api/learner/data-exports',
      '/api/learner/data-exports/4/download',
      '/api/learner/account-deletion',
    ])(
      'lets a blocked learner reach the privacy BFF %s (M1.7b2 B2b)',
      async (path) => {
        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockResolvedValue(
            consents([{ status: 'blocked' }, { status: 'accepted' }]),
          );
        const res = await proxy(page(path));
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(res.headers.get('location')).toBeNull();
      },
    );

    it.each(['/sign-in', '/consent', '/learnx', '/terms'])(
      'does not call the backend for %s',
      async (path) => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        await proxy(page(path));
        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );

    it('does not call the backend without a learner session cookie', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await proxy(new NextRequest('https://frontend.example.test/learn'));
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
