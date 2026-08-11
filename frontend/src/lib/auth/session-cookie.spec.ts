import { describe, expect, it } from 'vitest';

import {
  createClearedSessionCookie,
  createSessionCookie,
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
    (token) => {
      expect(() =>
        createSessionCookie(token, {
          cookieName: 'hsk_admin_session',
          nowMs: nowSeconds * 1000,
          production: false,
        }),
      ).toThrow(SessionTokenError);
    },
  );
});
