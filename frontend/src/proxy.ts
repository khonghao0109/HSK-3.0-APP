import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { backendRefreshSchema } from '@/features/auth/auth-contract';
import { sessionRefresh } from '@/features/auth/session-refresh';
import {
  clientForwardedFor,
  createBackendClient,
} from '@/lib/api/backend-client';
import { parseServerEnv } from '@/lib/config/env-schema';
import {
  buildContentSecurityPolicy,
  generateCspNonce,
} from '@/lib/security/content-security-policy';

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const isApiRequest = request.nextUrl.pathname.startsWith('/api/');
  const serverEnv = parseServerEnv();

  const isAdminRoute =
    request.nextUrl.pathname.startsWith('/admin') ||
    request.nextUrl.pathname.startsWith('/api/admin') ||
    request.nextUrl.pathname.startsWith('/api/session') ||
    request.nextUrl.pathname.startsWith('/login');

  const cookieName = isAdminRoute
    ? serverEnv.SESSION_COOKIE_NAME
    : serverEnv.LEARNER_SESSION_COOKIE_NAME;

  const deps = {
    cookieName,
    production: serverEnv.NODE_ENV === 'production',
    nowMs: () => Date.now(),
    refresh: async (token: string) => {
      const client = createBackendClient({
        baseUrl: serverEnv.BACKEND_API_URL,
        timeoutMs: serverEnv.BFF_REQUEST_TIMEOUT_MS,
        forwardedFor: async () => clientForwardedFor(request.headers),
      });
      const response = await client.request('/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: token },
      });
      return backendRefreshSchema.parse(response).data;
    },
  };

  if (!isApiRequest) {
    const nonce = generateCspNonce();
    const contentSecurityPolicy = buildContentSecurityPolicy(
      nonce,
      serverEnv.NODE_ENV === 'development',
    );
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

    const response = await sessionRefresh(request, deps, requestHeaders);
    response.headers.set('Content-Security-Policy', contentSecurityPolicy);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  return sessionRefresh(request, deps, requestHeaders);
}

export const config = {
  matcher: [
    {
      source:
        '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
    '/api/admin/:path*',
    '/api/session/me',
    '/api/session/recover',
    '/api/learner/session/me',
    '/api/learner/onboarding/:path*',
  ],
};
