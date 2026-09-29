import { describe, expect, it } from 'vitest';

import {
  createClearedSessionCookie,
  createRefreshSessionCookie,
  createSessionCookie,
  getRefreshCookieName,
  readJwtExpiry,
  SessionTokenError,
} from './session-cookie';

function jwt(exp: number): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'v1' })).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify({ sub: 1, exp })).toString('base64url'),
    'signature',
  ].join('.');
}

describe('session cookie', () => {
  const nowSeconds = 2_000_000_000;

  it('creates an HttpOnly cookie whose lifetime cannot exceed JWT expiry', () => {
    const token = jwt(nowSeconds + 900);
    expect(
      createSessionCookie(token, {
        cookieName: 'hsk_admin_session',
        nowMs: nowSeconds * 1000,
        production: false,
      }),
    ).toEqual({
      name: 'hsk_admin_session',
      value: token,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: 900,
      },
    });
  });

  it('sets Secure in production and clears with the same cookie boundary', () => {
    const cookie = createSessionCookie(jwt(nowSeconds + 10), {
      cookieName: 'hsk_admin_session',
      nowMs: nowSeconds * 1000,
      production: true,
    });
    expect(cookie.options.secure).toBe(true);
    expect(createClearedSessionCookie('hsk_admin_session', true)).toMatchObject(
      {
        name: 'hsk_admin_session',
        value: '',
        options: {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 0,
        },
      },
    );
  });

  it.each(['invalid', jwt(nowSeconds), jwt(nowSeconds - 1)])(
    'rejects malformed or expired token %s',
    (token: string) => {
      expect(() =>
        createSessionCookie(token, {
          cookieName: 'hsk_admin_session',
          nowMs: nowSeconds * 1000,
          production: false,
        }),
      ).toThrow(SessionTokenError);
    },
  );

  it('derives refresh cookie name with _refresh suffix', () => {
    expect(getRefreshCookieName('hsk_admin_session')).toBe(
      'hsk_admin_session_refresh',
    );
  });

  it('reads jwt expiry or returns null for malformed tokens', () => {
    expect(readJwtExpiry(jwt(nowSeconds + 500))).toBe(nowSeconds + 500);
    expect(readJwtExpiry('not-a-jwt')).toBeNull();
    expect(readJwtExpiry('a.b')).toBeNull();
    expect(
      readJwtExpiry(
        `a.${Buffer.from(JSON.stringify({ exp: 'not-a-number' })).toString('base64url')}.c`,
      ),
    ).toBeNull();
  });

  it('creates refresh cookie with correct maxAge and attributes', () => {
    const expiresAt = new Date((nowSeconds + 86400) * 1000).toISOString();
    const cookie = createRefreshSessionCookie(
      'sample-refresh-token',
      expiresAt,
      {
        cookieName: 'hsk_admin_session_refresh',
        nowMs: nowSeconds * 1000,
        production: true,
      },
    );
    expect(cookie).toEqual({
      name: 'hsk_admin_session_refresh',
      value: 'sample-refresh-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 86400,
      },
    });
  });

  it.each([
    new Date(nowSeconds * 1000).toISOString(),
    new Date((nowSeconds - 10) * 1000).toISOString(),
    'not-a-date',
  ])(
    'rejects refresh cookie with non-positive maxAge or invalid date: %s',
    (expiresAt: string) => {
      expect(() =>
        createRefreshSessionCookie('sample-refresh-token', expiresAt, {
          cookieName: 'hsk_admin_session_refresh',
          nowMs: nowSeconds * 1000,
          production: false,
        }),
      ).toThrow(SessionTokenError);
    },
  );
});
