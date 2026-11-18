import { NextRequest, NextResponse } from 'next/server';

import {
  isSameOrigin,
  safeResponse,
  setClearedCookies,
  statusFromError,
} from '@/features/auth/session-route-handlers';
import { BackendRequestError } from '@/lib/api/api-error';

import {
  emailVerificationConfirmSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from './recovery-contract';

export type RecoveryHandlerDependencies = {
  appOrigin: string;
  learnerCookieName: string;
  production: boolean;
  requestBackend: (
    path: string,
    options?: { token?: string; method?: 'POST'; body?: unknown },
  ) => Promise<unknown>;
};

export type RecoveryErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_RESET_TOKEN'
  | 'WEAK_PASSWORD'
  | 'INVALID_VERIFICATION_TOKEN';

function noContent(): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set('cache-control', 'no-store');
  return response;
}

function codeResponse(code: RecoveryErrorCode): NextResponse {
  const response = NextResponse.json(
    { success: false, error: { code } },
    { status: 400 },
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}

function clearSession(
  response: NextResponse,
  deps: RecoveryHandlerDependencies,
): NextResponse {
  setClearedCookies(response, {
    cookieName: deps.learnerCookieName,
    production: deps.production,
  });
  return response;
}

/** Only 429 passes through; every other backend failure is a safe 503. */
function rateLimitedOr503(error: unknown): NextResponse {
  return safeResponse(statusFromError(error) === 429 ? 429 : 503);
}

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * `POST /api/learner/password-reset/request`: the answer never depends on
 * whether the email has an account (the backend answers 204 either way).
 */
export async function handlePasswordResetRequest(
  request: NextRequest,
  deps: RecoveryHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const input = passwordResetRequestSchema.safeParse(await readJson(request));
  if (!input.success) return safeResponse(400);
  try {
    await deps.requestBackend('/api/v1/auth/password-reset/request', {
      method: 'POST',
      body: { email: input.data.email },
    });
  } catch (error) {
    return rateLimitedOr503(error);
  }
  return noContent();
}

/** `POST /api/learner/password-reset/confirm`: the backend revokes every session. */
export async function handlePasswordResetConfirm(
  request: NextRequest,
  deps: RecoveryHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const input = passwordResetConfirmSchema.safeParse(await readJson(request));
  if (!input.success) return codeResponse('INVALID_REQUEST');
  try {
    await deps.requestBackend('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: input.data,
    });
  } catch (error) {
    if (statusFromError(error) === 400) {
      const code = error instanceof BackendRequestError ? error.code : null;
      if (code === 'INVALID_RESET_TOKEN') return codeResponse(code);
      // Zod above already checked token and length, so a remaining 400 BAD_REQUEST is only the blacklist (`auth.service.ts` `assertPasswordNotBlacklisted`).
      if (code === 'BAD_REQUEST') return codeResponse('WEAK_PASSWORD');
      return codeResponse('INVALID_REQUEST');
    }
    return rateLimitedOr503(error);
  }
  return clearSession(noContent(), deps);
}

/** `POST /api/learner/email-verification/confirm`: public, no cookie needed. */
export async function handleEmailVerificationConfirm(
  request: NextRequest,
  deps: RecoveryHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const input = emailVerificationConfirmSchema.safeParse(
    await readJson(request),
  );
  if (!input.success) return codeResponse('INVALID_VERIFICATION_TOKEN');
  try {
    await deps.requestBackend('/api/v1/auth/email-verification/confirm', {
      method: 'POST',
      body: input.data,
    });
  } catch (error) {
    if (statusFromError(error) === 400)
      return codeResponse('INVALID_VERIFICATION_TOKEN');
    return rateLimitedOr503(error);
  }
  return noContent();
}

/** `POST /api/learner/email-verification/request`: resend for the signed-in learner. */
export async function handleEmailVerificationRequest(
  request: NextRequest,
  deps: RecoveryHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);
  try {
    await deps.requestBackend('/api/v1/auth/email-verification/request', {
      method: 'POST',
      token,
    });
  } catch (error) {
    const status = statusFromError(error);
    if (status === 401 || status === 403)
      return clearSession(safeResponse(status), deps);
    return rateLimitedOr503(error);
  }
  return noContent();
}
