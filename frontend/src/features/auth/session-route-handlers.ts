import { NextRequest, NextResponse } from 'next/server';

import {
  BackendRequestError,
  normalizeApiFailure,
  type ApiFailureKind,
} from '@/lib/api/api-error';
import {
  createClearedSessionCookie,
  createSessionCookie,
  SessionTokenError,
} from '@/lib/auth/session-cookie';

import {
  authUserSchema,
  loginInputSchema,
  loginResponseSchema,
  type AuthUser,
  type LoginInput,
  type LoginResponse,
} from './auth-contract';

export type SessionHandlerDependencies = {
  appOrigin: string;
  cookieName: string;
  production: boolean;
  nowMs: () => number;
  login: (input: LoginInput) => Promise<LoginResponse>;
  loadCurrentUser: (token: string) => Promise<AuthUser>;
};

function safeResponse(status: number, requestId?: string): NextResponse {
  const failure = normalizeApiFailure({ status, requestId });
  const response = NextResponse.json(
    {
      success: false,
      error: {
        kind: failure.kind,
        message: failure.message,
        ...(failure.requestId ? { requestId: failure.requestId } : {}),
      },
    },
    { status: failure.status },
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}

/**
 * The backend answers login with 403 only for a temporarily locked account;
 * unknown, inactive and wrong-password logins share 401. The console's own
 * 403s (cross-origin, non-admin) keep kind `forbidden`.
 */
function accountLockedResponse(): NextResponse {
  const kind: ApiFailureKind = 'account_locked';
  const response = NextResponse.json(
    {
      success: false,
      error: {
        kind,
        message: 'This account is temporarily locked. Try again later.',
      },
    },
    { status: 403 },
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set('cache-control', 'no-store');
  return response;
}

function noContent(): NextResponse {
  return noStore(new NextResponse(null, { status: 204 }));
}

function recoveryResponse(
  state: 'ready' | 'invalid' | 'unavailable',
): NextResponse {
  const response = noContent();
  response.headers.set('x-session-recovery', state);
  return response;
}

function isSameOrigin(request: NextRequest, appOrigin: string): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

function setClearedCookie(
  response: NextResponse,
  deps: SessionHandlerDependencies,
): void {
  const cookie = createClearedSessionCookie(deps.cookieName, deps.production);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
}

function statusFromError(error: unknown): number {
  if (error instanceof BackendRequestError) return error.status;
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  return 500;
}

export async function handleLogin(
  request: NextRequest,
  deps: SessionHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return safeResponse(400);
  }
  const input = loginInputSchema.safeParse(payload);
  if (!input.success) return safeResponse(422);
  try {
    const result = loginResponseSchema.parse(await deps.login(input.data));
    if (result.user.role !== 'admin') return safeResponse(403);
    const sessionCookie = createSessionCookie(result.accessToken, {
      cookieName: deps.cookieName,
      nowMs: deps.nowMs(),
      production: deps.production,
    });
    const response = NextResponse.json({ success: true, user: result.user });
    response.cookies.set(
      sessionCookie.name,
      sessionCookie.value,
      sessionCookie.options,
    );
    return noStore(response);
  } catch (error) {
    if (error instanceof SessionTokenError) return safeResponse(503);
    const status = statusFromError(error);
    if (status === 403) return accountLockedResponse();
    return safeResponse(
      [400, 401, 403, 422, 429, 503].includes(status) ? status : 500,
    );
  }
}

export async function handleSessionMe(
  request: NextRequest,
  deps: SessionHandlerDependencies,
): Promise<NextResponse> {
  const token = request.cookies.get(deps.cookieName)?.value;
  if (!token) return safeResponse(401);
  try {
    const user = authUserSchema.parse(await deps.loadCurrentUser(token));
    if (user.role !== 'admin') return safeResponse(403);
    return noStore(NextResponse.json({ success: true, user }));
  } catch (error) {
    const response = safeResponse(statusFromError(error) === 403 ? 403 : 401);
    setClearedCookie(response, deps);
    return response;
  }
}

export async function handleSessionRecovery(
  request: NextRequest,
  deps: SessionHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const token = request.cookies.get(deps.cookieName)?.value;
  if (!token) return recoveryResponse('ready');
  try {
    const user = authUserSchema.parse(await deps.loadCurrentUser(token));
    if (user.role !== 'admin') return recoveryResponse('invalid');
    return recoveryResponse('ready');
  } catch (error) {
    const status = statusFromError(error);
    if ([401, 403].includes(status)) return recoveryResponse('invalid');
    return recoveryResponse('unavailable');
  }
}

export async function handleLogout(
  request: NextRequest,
  deps: SessionHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const response = NextResponse.json({ success: true });
  setClearedCookie(response, deps);
  return noStore(response);
}
