export class SessionTokenError extends Error {
  constructor() {
    super('The session token is invalid or expired.');
    this.name = 'SessionTokenError';
  }
}

export type SessionCookie = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: '/';
    maxAge: number;
  };
};

function jwtExpiry(token: string): number {
  const segments = token.split('.');
  if (segments.length !== 3 || !segments[1]) throw new SessionTokenError();
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segments[1], 'base64url').toString('utf8'),
    );
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('exp' in payload) ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp)
    ) {
      throw new SessionTokenError();
    }
    return payload.exp;
  } catch (error) {
    if (error instanceof SessionTokenError) throw error;
    throw new SessionTokenError();
  }
}

export function createSessionCookie(
  token: string,
  input: { cookieName: string; nowMs: number; production: boolean },
): SessionCookie {
  const maxAge = jwtExpiry(token) - Math.floor(input.nowMs / 1000);
  if (maxAge <= 0) throw new SessionTokenError();
  return {
    name: input.cookieName,
    value: token,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: input.production,
      path: '/',
      maxAge,
    },
  };
}

export function createClearedSessionCookie(
  cookieName: string,
  production: boolean,
): SessionCookie {
  return {
    name: cookieName,
    value: '',
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: production,
      path: '/',
      maxAge: 0,
    },
  };
}
