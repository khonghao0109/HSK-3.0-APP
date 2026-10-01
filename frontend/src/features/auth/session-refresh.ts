import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  createRefreshSessionCookie,
  createSessionCookie,
  getRefreshCookieName,
  readJwtExpiry,
  SessionTokenError,
} from '@/lib/auth/session-cookie';

import type { RefreshResponse } from './auth-contract';

export type SessionRefreshDependencies = {
  cookieName: string;
  production: boolean;
  nowMs: () => number;
  refresh: (refreshToken: string) => Promise<RefreshResponse>;
};

type SingleFlightResult =
  { ok: true; data: RefreshResponse } | { ok: false; error: unknown };

const singleFlightMap = new Map<string, Promise<SingleFlightResult>>();

function statusFromError(error: unknown): number {
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

function updateCookieHeader(
  cookieHeader: string | null,
  updates: Record<string, string | null>,
): string {
  const cookies = new Map<string, string>();
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        cookies.set(
          trimmed.slice(0, eqIdx).trim(),
          trimmed.slice(eqIdx + 1).trim(),
        );
      }
    }
  }
  for (const [name, value] of Object.entries(updates)) {
    if (value === null) {
      cookies.delete(name);
    } else {
      cookies.set(name, value);
    }
  }
  return Array.from(cookies.entries())
    .map(([name, val]) => `${name}=${val}`)
    .join('; ');
}

export async function sessionRefresh(
  request: NextRequest,
  deps: SessionRefreshDependencies,
  requestHeaders = new Headers(request.headers),
): Promise<NextResponse> {
  const refreshCookieName = getRefreshCookieName(deps.cookieName);
  const refreshToken = request.cookies.get(refreshCookieName)?.value;

  // 1. Không có cookie refresh -> đi tiếp, không đổi gì
  if (!refreshToken) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // 2. Có access, exp - now > 120 s -> đi tiếp, không gọi backend
  const accessToken = request.cookies.get(deps.cookieName)?.value;
  const nowSec = Math.floor(deps.nowMs() / 1000);
  const accessExp = accessToken ? readJwtExpiry(accessToken) : null;

  if (accessToken && accessExp !== null && accessExp - nowSec > 120) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // 3. Còn lại (access thiếu, không đọc được exp, hoặc sắp hết hạn) -> gọi /auth/refresh
  const flightKey = createHash('sha256').update(refreshToken).digest('hex');
  let flightPromise = singleFlightMap.get(flightKey);
  if (!flightPromise) {
    flightPromise = deps
      .refresh(refreshToken)
      .then((data) => ({ ok: true as const, data }))
      .catch((error: unknown) => ({ ok: false as const, error }))
      .finally(() => singleFlightMap.delete(flightKey));
    singleFlightMap.set(flightKey, flightPromise);
  }

  const settled = await flightPromise;

  if (settled.ok) {
    try {
      const result = settled.data;
      const sessionCookie = createSessionCookie(result.accessToken, {
        cookieName: deps.cookieName,
        nowMs: deps.nowMs(),
        production: deps.production,
      });
      const refreshCookie = createRefreshSessionCookie(
        result.refreshToken,
        result.refreshTokenExpiresAt,
        {
          cookieName: refreshCookieName,
          nowMs: deps.nowMs(),
          production: deps.production,
        },
      );

      // Ghi đè header cookie của request đi tiếp bằng giá trị mới
      const updatedCookieStr = updateCookieHeader(
        request.headers.get('cookie'),
        {
          [deps.cookieName]: result.accessToken,
          [refreshCookieName]: result.refreshToken,
        },
      );
      if (updatedCookieStr) {
        requestHeaders.set('cookie', updatedCookieStr);
      } else {
        requestHeaders.delete('cookie');
      }

      const response = NextResponse.next({
        request: { headers: requestHeaders },
      });
      response.cookies.set(
        sessionCookie.name,
        sessionCookie.value,
        sessionCookie.options,
      );
      response.cookies.set(
        refreshCookie.name,
        refreshCookie.value,
        refreshCookie.options,
      );
      return response;
    } catch (err) {
      if (err instanceof SessionTokenError) {
        return NextResponse.next({ request: { headers: requestHeaders } });
      }
      throw err;
    }
  }

  const status = statusFromError(settled.error);

  if (status === 401) {
    // Nếu access hiện tại còn hạn (exp > now) thì đi tiếp nguyên trạng (thua race trong khoảng ân hạn)
    if (accessExp !== null && accessExp > nowSec) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    // Nếu không, CHỈ bỏ 2 cookie khỏi header cookie của request đi tiếp, KHÔNG gọi response.cookies.set
    const updatedCookieStr = updateCookieHeader(request.headers.get('cookie'), {
      [deps.cookieName]: null,
      [refreshCookieName]: null,
    });
    if (updatedCookieStr) {
      requestHeaders.set('cookie', updatedCookieStr);
    } else {
      requestHeaders.delete('cookie');
    }

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  // 429, 5xx, lỗi mạng hay timeout -> đi tiếp nguyên trạng, KHÔNG xoá cookie (E-01)
  return NextResponse.next({ request: { headers: requestHeaders } });
}
