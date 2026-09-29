import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';

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
});
