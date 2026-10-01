import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import type { RefreshResponse } from './auth-contract';
import {
  sessionRefresh,
  type SessionRefreshDependencies,
} from './session-refresh';

const nowSeconds = 2_000_000_000;

function jwt(exp: number): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'v1' })).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify({ sub: 1, exp })).toString('base64url'),
    'signature',
  ].join('.');
}

function createRequest(cookies: Record<string, string>): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest('http://frontend.example.test/admin/dashboard', {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

function createDependencies(
  overrides: Partial<SessionRefreshDependencies> = {},
): SessionRefreshDependencies {
  return {
    cookieName: 'hsk_admin_session',
    production: true,
    nowMs: () => nowSeconds * 1000,
    refresh: vi.fn().mockResolvedValue({
      user: { id: 1, email: 'admin@example.test', role: 'admin' },
      accessToken: jwt(nowSeconds + 900),
      refreshToken: 'new-refresh-token',
      refreshTokenExpiresAt: new Date(
        (nowSeconds + 86400) * 1000,
      ).toISOString(),
    }),
    ...overrides,
  };
}

describe('sessionRefresh proxy helper', () => {
  // (a) không có refresh -> không gọi backend
  it('(a) does not call backend refresh when refresh cookie is absent', async () => {
    const deps = createDependencies();
    const req = createRequest({ hsk_admin_session: jwt(nowSeconds + 50) });

    const response = await sessionRefresh(req, deps);

    expect(deps.refresh).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  });

  // (b) access còn > 120 s -> không gọi
  it('(b) does not call backend refresh when access token has > 120s remaining', async () => {
    const deps = createDependencies();
    const req = createRequest({
      hsk_admin_session: jwt(nowSeconds + 121),
      hsk_admin_session_refresh: 'sample-refresh',
    });

    const response = await sessionRefresh(req, deps);

    expect(deps.refresh).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  });

  // (c) sắp hết hạn + 200 -> 2 cookie mới với đúng thuộc tính và maxAge; header cookie của request đi tiếp chứa access mới, không còn access cũ
  it('(c) refreshes when access token is expiring soon, sets both cookies with correct maxAge and updates request cookie header', async () => {
    const oldAccessToken = jwt(nowSeconds + 60);
    const newAccessToken = jwt(nowSeconds + 900);
    const deps = createDependencies({
      refresh: vi.fn().mockResolvedValue({
        user: { id: 1, email: 'admin@example.test', role: 'admin' },
        accessToken: newAccessToken,
        refreshToken: 'rotated-refresh-token',
        refreshTokenExpiresAt: new Date(
          (nowSeconds + 86400) * 1000,
        ).toISOString(),
      }),
    });
    const req = createRequest({
      hsk_admin_session: oldAccessToken,
      hsk_admin_session_refresh: 'sample-refresh',
      other_cookie: 'val123',
    });

    const response = await sessionRefresh(req, deps);

    expect(deps.refresh).toHaveBeenCalledWith('sample-refresh');

    const accessCookie = response.cookies.get('hsk_admin_session');
    expect(accessCookie).toBeDefined();
    expect(accessCookie?.value).toBe(newAccessToken);
    expect(accessCookie?.maxAge).toBe(900);
    expect(accessCookie?.httpOnly).toBe(true);
    expect(accessCookie?.secure).toBe(true);
    expect(accessCookie?.sameSite).toBe('lax');

    const refreshCookie = response.cookies.get('hsk_admin_session_refresh');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.value).toBe('rotated-refresh-token');
    expect(refreshCookie?.maxAge).toBe(86400);
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.secure).toBe(true);
    expect(refreshCookie?.sameSite).toBe('lax');

    const forwardCookie = response.headers.get('x-middleware-request-cookie');
    expect(forwardCookie).toContain(`hsk_admin_session=${newAccessToken}`);
    expect(forwardCookie).toContain(
      'hsk_admin_session_refresh=rotated-refresh-token',
    );
    expect(forwardCookie).toContain('other_cookie=val123');
    expect(forwardCookie).not.toContain(oldAccessToken);
  });

  // (d) 401 + access còn hạn -> không set hay xoá cookie
  it('(d) keeps cookies unchanged when refresh returns 401 but current access token is still valid (grace period race)', async () => {
    const validAccessToken = jwt(nowSeconds + 60); // < 120s so refresh attempted, but > 0 so still valid
    const deps = createDependencies({
      refresh: vi.fn().mockRejectedValue({ status: 401 }),
    });
    const req = createRequest({
      hsk_admin_session: validAccessToken,
      hsk_admin_session_refresh: 'sample-refresh',
    });

    const response = await sessionRefresh(req, deps);

    expect(deps.refresh).toHaveBeenCalledWith('sample-refresh');
    expect(response.cookies.getAll()).toEqual([]);
    expect(response.headers.get('x-middleware-request-cookie')).toContain(
      `hsk_admin_session=${validAccessToken}`,
    );
  });

  // (e) 401 + access hết hạn -> không set response cookie, request đi tiếp không còn 2 cookie đó
  it('(e) strips cookies from forwarded request without setting response cookies when refresh returns 401 and current access token is expired', async () => {
    const expiredAccessToken = jwt(nowSeconds - 10);
    const deps = createDependencies({
      refresh: vi.fn().mockRejectedValue({ status: 401 }),
    });
    const req = createRequest({
      hsk_admin_session: expiredAccessToken,
      hsk_admin_session_refresh: 'sample-refresh',
      preserve_this: 'keep_me',
    });

    const response = await sessionRefresh(req, deps);

    expect(deps.refresh).toHaveBeenCalledWith('sample-refresh');
    expect(response.cookies.getAll()).toEqual([]);

    const forwardCookie = response.headers.get('x-middleware-request-cookie');
    expect(forwardCookie).toContain('preserve_this=keep_me');
    expect(forwardCookie).not.toContain('hsk_admin_session=');
    expect(forwardCookie).not.toContain('hsk_admin_session_refresh=');
  });

  // (f) 503 -> không xoá
  it('(f) preserves cookies when refresh fails with 503', async () => {
    const expiredAccessToken = jwt(nowSeconds - 10);
    const deps = createDependencies({
      refresh: vi.fn().mockRejectedValue({ status: 503 }),
    });
    const req = createRequest({
      hsk_admin_session: expiredAccessToken,
      hsk_admin_session_refresh: 'sample-refresh',
    });

    const response = await sessionRefresh(req, deps);

    expect(deps.refresh).toHaveBeenCalledWith('sample-refresh');
    expect(response.cookies.getAll()).toEqual([]);
  });

  // (g) 2 lời gọi đồng thời cùng refresh token -> backend refresh bị gọi ĐÚNG 1 lần, cả hai nhận cùng kết quả
  it('(g) single-flights concurrent requests with the same refresh token, calling backend once', async () => {
    let resolveRefresh!: (val: RefreshResponse) => void;
    const refreshPromise = new Promise<RefreshResponse>((resolve) => {
      resolveRefresh = resolve;
    });

    const refreshFn = vi.fn().mockImplementation(() => refreshPromise);
    const deps = createDependencies({ refresh: refreshFn });

    const req1 = createRequest({
      hsk_admin_session: jwt(nowSeconds + 10),
      hsk_admin_session_refresh: 'concurrent-token',
    });
    const req2 = createRequest({
      hsk_admin_session: jwt(nowSeconds + 10),
      hsk_admin_session_refresh: 'concurrent-token',
    });

    const call1 = sessionRefresh(req1, deps);
    const call2 = sessionRefresh(req2, deps);

    resolveRefresh!({
      user: { id: 1, email: 'admin@example.test', role: 'admin' },
      accessToken: jwt(nowSeconds + 900),
      refreshToken: 'single-flight-rotated-token',
      refreshTokenExpiresAt: new Date(
        (nowSeconds + 86400) * 1000,
      ).toISOString(),
    });

    const [res1, res2] = await Promise.all([call1, call2]);

    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(res1.cookies.get('hsk_admin_session_refresh')?.value).toBe(
      'single-flight-rotated-token',
    );
    expect(res2.cookies.get('hsk_admin_session_refresh')?.value).toBe(
      'single-flight-rotated-token',
    );
  });

  // (h) access có exp không đọc được -> coi là cần refresh
  it('(h) triggers refresh when access token exp is unreadable or malformed', async () => {
    const deps = createDependencies();
    const req = createRequest({
      hsk_admin_session: 'malformed-jwt-token',
      hsk_admin_session_refresh: 'sample-refresh',
    });

    const response = await sessionRefresh(req, deps);

    expect(deps.refresh).toHaveBeenCalledWith('sample-refresh');
    expect(response.cookies.get('hsk_admin_session')?.value).toBeDefined();
  });

  // (i) 429 -> đi tiếp nguyên trạng, KHÔNG xoá cookie
  it('(i) preserves cookies on 429 rate limited response from backend refresh', async () => {
    const expiredAccessToken = jwt(nowSeconds - 10);
    const deps = createDependencies({
      refresh: vi.fn().mockRejectedValue({ status: 429 }),
    });
    const req = createRequest({
      hsk_admin_session: expiredAccessToken,
      hsk_admin_session_refresh: 'sample-refresh',
    });

    const response = await sessionRefresh(req, deps);

    expect(deps.refresh).toHaveBeenCalledWith('sample-refresh');
    expect(response.cookies.getAll()).toEqual([]);
  });

  // (j) chạy tuần tự: lần 1 refresh 200 và đặt cookie mới; lần 2 dùng refresh cookie cũ, không có access, backend trả 401 -> response lần 2 không có Set-Cookie nào
  it('(j) handles sequential calls: first refresh succeeds with 200, second call with stale refresh token gets 401 and sets no cookies', async () => {
    const staleRefreshToken = 'stale-refresh-token';
    const newAccessToken = jwt(nowSeconds + 900);
    const rotatedRefreshToken = 'new-rotated-refresh-token';

    const refreshMock = vi
      .fn()
      .mockResolvedValueOnce({
        accessToken: newAccessToken,
        refreshToken: rotatedRefreshToken,
        refreshTokenExpiresAt: new Date(
          (nowSeconds + 86400) * 1000,
        ).toISOString(),
      })
      .mockRejectedValueOnce({ status: 401 });

    const deps = createDependencies({ refresh: refreshMock });

    // Lần 1: request có access token đã hết hạn và refresh token cũ -> refresh thành công, đặt 2 cookie mới
    const expiredAccessToken = jwt(nowSeconds - 10);
    const req1 = createRequest({
      hsk_admin_session: expiredAccessToken,
      hsk_admin_session_refresh: staleRefreshToken,
    });
    const res1 = await sessionRefresh(req1, deps);
    expect(res1.cookies.get('hsk_admin_session')?.value).toBe(newAccessToken);
    expect(res1.cookies.get('hsk_admin_session_refresh')?.value).toBe(
      rotatedRefreshToken,
    );

    // Lần 2: request dùng refresh cookie cũ, không có access token -> backend trả 401 -> response không có Set-Cookie nào
    const req2 = createRequest({
      hsk_admin_session_refresh: staleRefreshToken,
      other_cookie: 'keep_me',
    });
    const res2 = await sessionRefresh(req2, deps);
    expect(res2.cookies.getAll()).toEqual([]);
    const forwardCookie = res2.headers.get('x-middleware-request-cookie');
    expect(forwardCookie).toContain('other_cookie=keep_me');
    expect(forwardCookie).not.toContain('hsk_admin_session_refresh=');
  });
});
