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

export function getRefreshCookieName(sessionCookieName: string): string {
  return `${sessionCookieName}_refresh`;
}

export function readJwtExpiry(token: string): number | null {
  const segments = token.split('.');
  if (segments.length !== 3 || !segments[1]) return null;
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
      return null;
    }
    return payload.exp;
  } catch {
    return null;
  }
}

function jwtExpiry(token: string): number {
  const exp = readJwtExpiry(token);
  if (exp === null) throw new SessionTokenError();
  return exp;
}

export function createRefreshSessionCookie(
  refreshToken: string,
  expiresAtIsoOrMs: string | number | Date,
  input: { cookieName: string; nowMs: number; production: boolean },
): SessionCookie {
  const expiresAtMs =
    typeof expiresAtIsoOrMs === 'number'
      ? expiresAtIsoOrMs
      : expiresAtIsoOrMs instanceof Date
        ? expiresAtIsoOrMs.getTime()
        : new Date(expiresAtIsoOrMs).getTime();

  if (!Number.isFinite(expiresAtMs)) throw new SessionTokenError();
  const maxAge =
    Math.floor(expiresAtMs / 1000) - Math.floor(input.nowMs / 1000);
  if (maxAge <= 0) throw new SessionTokenError();

  return {
    name: input.cookieName,
    value: refreshToken,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: input.production,
      path: '/',
      maxAge,
    },
  };
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
