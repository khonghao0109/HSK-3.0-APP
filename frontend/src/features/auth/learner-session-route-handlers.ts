import { NextRequest, NextResponse } from 'next/server';

import type { ApiFailureKind } from '@/lib/api/api-error';
import {
  createRefreshSessionCookie,
  createSessionCookie,
  getRefreshCookieName,
  readJwtExpiry,
  SessionTokenError,
} from '@/lib/auth/session-cookie';

import {
  authUserSchema,
  loginInputSchema,
  loginResponseSchema,
  registerInputSchema,
  type AuthUser,
  type LoginInput,
  type LoginResponse,
  type RefreshResponse,
  type RegisterInput,
  type RegisterResponse,
} from './auth-contract';
import {
  accountLockedResponse,
  isSameOrigin,
  noStore,
  safeResponse,
  setClearedCookies,
  statusFromError,
} from './session-route-handlers';

export type LearnerSessionHandlerDependencies = {
  appOrigin: string;
  cookieName: string;
  production: boolean;
  nowMs: () => number;
  login: (input: LoginInput) => Promise<LoginResponse>;
  register: (input: RegisterInput) => Promise<RegisterResponse>;
  loadCurrentUser: (token: string) => Promise<AuthUser>;
  logout: (accessToken: string) => Promise<void>;
  refresh?: (refreshToken: string) => Promise<RefreshResponse>;
};

function adminAccountForbiddenResponse(): NextResponse {
  const kind: ApiFailureKind = 'admin_account';
  const response = NextResponse.json(
    {
      success: false,
      error: {
        kind,
        message: 'Admin accounts cannot log in through the learner portal.',
      },
    },
    { status: 403 },
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}

function emailTakenResponse(): NextResponse {
  const kind: ApiFailureKind = 'email_taken';
  const response = NextResponse.json(
    {
      success: false,
      error: {
        kind,
        message: 'This email is already in use.',
      },
    },
    { status: 409 },
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}

function weakPasswordResponse(): NextResponse {
  const kind: ApiFailureKind = 'weak_password';
  const response = NextResponse.json(
    {
      success: false,
      error: {
        kind,
        message: 'Password is too weak.',
      },
    },
    { status: 400 },
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}

function setLearnerSessionCookies(
  response: NextResponse,
  result: LoginResponse,
  deps: Pick<
    LearnerSessionHandlerDependencies,
    'cookieName' | 'nowMs' | 'production'
  >,
): void {
  const sessionCookie = createSessionCookie(result.accessToken, {
    cookieName: deps.cookieName,
    nowMs: deps.nowMs(),
    production: deps.production,
  });
  response.cookies.set(
    sessionCookie.name,
    sessionCookie.value,
    sessionCookie.options,
  );
  if (result.refreshToken && result.refreshTokenExpiresAt) {
    const refreshCookie = createRefreshSessionCookie(
      result.refreshToken,
      result.refreshTokenExpiresAt,
      {
        cookieName: getRefreshCookieName(deps.cookieName),
        nowMs: deps.nowMs(),
        production: deps.production,
      },
    );
    response.cookies.set(
      refreshCookie.name,
      refreshCookie.value,
      refreshCookie.options,
    );
  }
}

export async function handleLearnerLogin(
  request: NextRequest,
  deps: LearnerSessionHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return safeResponse(400);
  }
  const input = loginInputSchema.safeParse(payload);
  if (!input.success) return safeResponse(400);

  try {
    const result = loginResponseSchema.parse(await deps.login(input.data));
    if (result.user.role !== 'user') {
      try {
        await deps.logout(result.accessToken);
      } catch {
        // best effort, lỗi thì bỏ qua, không log token
      }
      return adminAccountForbiddenResponse();
    }

    const response = NextResponse.json({ success: true, user: result.user });
    setLearnerSessionCookies(response, result, deps);
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

export async function handleLearnerRegister(
  request: NextRequest,
  deps: LearnerSessionHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return safeResponse(400);
  }
  const input = registerInputSchema.safeParse(payload);
  if (!input.success) return safeResponse(400);

  try {
    const result = loginResponseSchema.parse(await deps.register(input.data));
    if (result.user.role !== 'user') {
      try {
        await deps.logout(result.accessToken);
      } catch {
        // best effort, lỗi thì bỏ qua, không log token
      }
      return adminAccountForbiddenResponse();
    }

    const response = NextResponse.json(
      { success: true, user: result.user },
      { status: 201 },
    );
    setLearnerSessionCookies(response, result, deps);
    return noStore(response);
  } catch (error) {
    if (error instanceof SessionTokenError) return safeResponse(503);
    const status = statusFromError(error);
    if (status === 400) return weakPasswordResponse();
    if (status === 409) return emailTakenResponse();
    return safeResponse(
      [400, 401, 403, 409, 422, 429, 503].includes(status) ? status : 500,
    );
  }
}

export async function handleLearnerLogout(
  request: NextRequest,
  deps: LearnerSessionHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);

  const accessToken = request.cookies.get(deps.cookieName)?.value;
  const refreshCookieName = getRefreshCookieName(deps.cookieName);
  const refreshToken = request.cookies.get(refreshCookieName)?.value;

  if (accessToken || refreshToken) {
    const nowSec = Math.floor(deps.nowMs() / 1000);
    const accessExp = accessToken ? readJwtExpiry(accessToken) : null;
    const isAccessValid =
      accessToken && accessExp !== null && accessExp > nowSec;

    let tokenToRevoke: string | null = null;
    if (isAccessValid) {
      tokenToRevoke = accessToken;
    } else if (refreshToken && deps.refresh) {
      try {
        const refreshed = await deps.refresh(refreshToken);
        tokenToRevoke = refreshed.accessToken;
      } catch {
        // best effort, lỗi thì bỏ qua
      }
    }

    if (tokenToRevoke) {
      try {
        await deps.logout(tokenToRevoke);
      } catch {
        // best effort, lỗi thì bỏ qua
      }
    }
  }

  const response = new NextResponse(null, { status: 204 });
  response.headers.set('cache-control', 'no-store');
  setClearedCookies(response, deps);
  return response;
}

export async function handleLearnerSessionMe(
  request: NextRequest,
  deps: LearnerSessionHandlerDependencies,
): Promise<NextResponse> {
  const token = request.cookies.get(deps.cookieName)?.value;
  if (!token) return safeResponse(401);
  try {
    const user = authUserSchema.parse(await deps.loadCurrentUser(token));
    if (user.role !== 'user') return safeResponse(403);
    return noStore(NextResponse.json({ user }));
  } catch (error) {
    const status = statusFromError(error);
    if (status === 401 || status === 403) {
      const response = safeResponse(status);
      setClearedCookies(response, deps);
      return response;
    }
    return safeResponse([502, 503, 504].includes(status) ? 503 : 500);
  }
}
