import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { backendRefreshSchema } from '@/features/auth/auth-contract';
import { sessionRefresh } from '@/features/auth/session-refresh';
import { userConsentsResponseSchema } from '@/features/legal/consent-route-handler';
import {
  clientForwardedFor,
  createBackendClient,
} from '@/lib/api/backend-client';
import {
  CONSENT_DEADLINE_HEADER,
  consentHref,
} from '@/lib/api/learner-session-failure';
import { readJwtExpiry } from '@/lib/auth/session-cookie';
import { parseServerEnv } from '@/lib/config/env-schema';
import {
  buildContentSecurityPolicy,
  generateCspNonce,
} from '@/lib/security/content-security-policy';

/** Learner pages gated on consent (M1.7b2 B2a); BFF routes are not. */
const CONSENT_GATED_PAGE = /^\/(?:learn|onboarding)(?:\/|$)/u;

type ConsentClient = ReturnType<typeof createBackendClient>;

/**
 * One `GET /users/me/consents` per learner page navigation with a live access
 * token: `blocked` → /consent; `pending` → deadline header. A failed read
 * never blocks the learner (fail open) and is logged without the token.
 */
async function consentGate(
  request: NextRequest,
  requestHeaders: Headers,
  learnerCookieName: string,
  client: ConsentClient,
): Promise<NextResponse | null> {
  const { pathname, search } = request.nextUrl;
  if (!CONSENT_GATED_PAGE.test(pathname)) return null;
  const token = request.cookies.get(learnerCookieName)?.value;
  const exp = token ? readJwtExpiry(token) : null;
  // Skip tokens sessionRefresh is about to replace (<= 120 s left, see
  // session-refresh.ts): the next navigation is gated with the new token.
  if (!token || exp === null || exp - Math.floor(Date.now() / 1000) <= 120) {
    return null;
  }
  try {
    const consents = userConsentsResponseSchema.parse(
      await client.request('/api/v1/users/me/consents', { token }),
    ).data.documents;
    if (consents.some((doc) => doc.status === 'blocked')) {
      return NextResponse.redirect(
        new URL(consentHref(`${pathname}${search}`), request.url),
      );
    }
    const deadline = consents
      .flatMap((doc) =>
        doc.status === 'pending' && doc.deadline ? [doc.deadline] : [],
      )
      .sort()[0];
    if (deadline) requestHeaders.set(CONSENT_DEADLINE_HEADER, deadline);
  } catch (error: unknown) {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? (error as { status?: unknown }).status
        : undefined;
    console.error('[consent-check] read failed; learner let through', {
      path: pathname,
      status: typeof status === 'number' ? status : 'network',
    });
  }
  return null;
}

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

  const backendClient = createBackendClient({
    baseUrl: serverEnv.BACKEND_API_URL,
    timeoutMs: serverEnv.BFF_REQUEST_TIMEOUT_MS,
    forwardedFor: async () => clientForwardedFor(request.headers),
  });
  const deps = {
    cookieName,
    production: serverEnv.NODE_ENV === 'production',
    nowMs: () => Date.now(),
    refresh: async (token: string) => {
      const response = await backendClient.request('/api/v1/auth/refresh', {
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
    requestHeaders.delete(CONSENT_DEADLINE_HEADER);

    const gate = isAdminRoute
      ? null
      : await consentGate(request, requestHeaders, cookieName, backendClient);
    if (gate) return gate;

    const response = await sessionRefresh(request, deps, requestHeaders);
    response.headers.set('Content-Security-Policy', contentSecurityPolicy);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(CONSENT_DEADLINE_HEADER);
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
    '/api/learner/media/:path*',
    '/api/learner/onboarding/:path*',
    '/api/learner/lessons/:path*',
    '/api/learner/exercises/:path*',
    '/api/learner/topics/:path*',
    '/api/learner/dictionary/:path*',
    '/api/learner/email-verification/:path*',
    '/api/learner/exam/:path*',
    '/api/learner/review/:path*',
    '/api/learner/consents/:path*',
    '/api/learner/data-exports/:path*',
    '/api/learner/account-deletion',
  ],
};
