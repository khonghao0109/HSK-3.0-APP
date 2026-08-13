import type { NextFunction, Request, Response } from 'express';
import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

export const DEFAULT_NON_PRODUCTION_ORIGINS =
  'http://localhost:3001,http://127.0.0.1:3001';

export const API_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy':
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; media-src 'self'",
});

type RuntimeEnvironment = 'development' | 'production' | 'test';

export function normalizeAllowedOrigins(
  rawValue: string,
  environment: RuntimeEnvironment,
): string[] {
  const values = rawValue.split(',').map((value) => value.trim());
  if (
    values.length === 0 ||
    values.some((value) => value.length === 0 || value.includes('*'))
  ) {
    throw new Error('ALLOWED_ORIGINS must contain explicit origins.');
  }

  const normalized = values.map((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('ALLOWED_ORIGINS contains an invalid origin.');
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '' && parsed.pathname !== '/')
    ) {
      throw new Error('ALLOWED_ORIGINS must not contain URL components.');
    }
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]';
    if (
      parsed.protocol !== 'https:' &&
      !(environment !== 'production' && parsed.protocol === 'http:' && loopback)
    ) {
      throw new Error('ALLOWED_ORIGINS requires HTTPS origins.');
    }
    return parsed.origin;
  });
  return [...new Set(normalized)];
}

export function buildCorsOriginValidator(
  allowedOrigins: readonly string[],
): (origin: string | undefined) => boolean {
  const allowed = new Set(allowedOrigins);
  return (origin) => origin === undefined || allowed.has(origin);
}

export function applyApiSecurityHeaders(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
  next();
}

export function configureApiEdgeSecurity(
  app: Pick<INestApplication, 'enableCors' | 'use'>,
  config: Pick<ConfigService, 'getOrThrow'>,
): void {
  const isAllowedOrigin = buildCorsOriginValidator(
    config.getOrThrow<string[]>('app.allowedOrigins'),
  );
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => callback(null, isAllowedOrigin(origin)),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  app.use(applyApiSecurityHeaders);
}

export function assertProductionSecrets(environment: {
  JWT_SECRETS?: string;
  JWT_ACTIVE_KID?: string;
  AUTH_PASSWORD_PEPPER?: string;
  MEDIA_SIGNING_SECRET?: string;
  MEDIA_METRICS_BEARER_TOKEN?: string;
  MEDIA_METRICS_BEARER_TOKEN_PREVIOUS?: string;
}): void {
  let jwtSecrets: Record<string, unknown>;
  try {
    jwtSecrets = JSON.parse(environment.JWT_SECRETS ?? '') as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error('Production secret configuration is invalid.');
  }
  const active = environment.JWT_ACTIVE_KID;
  if (!active || typeof jwtSecrets[active] !== 'string') {
    throw new Error('Production secret configuration is invalid.');
  }
  const values = [
    ...Object.values(jwtSecrets),
    environment.AUTH_PASSWORD_PEPPER,
    environment.MEDIA_SIGNING_SECRET,
    environment.MEDIA_METRICS_BEARER_TOKEN,
    ...(environment.MEDIA_METRICS_BEARER_TOKEN_PREVIOUS
      ? [environment.MEDIA_METRICS_BEARER_TOKEN_PREVIOUS]
      : []),
  ];
  if (
    values.some(
      (value) => typeof value !== 'string' || !isStrongEncodedSecret(value),
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new Error('Production secret configuration is invalid.');
  }
}

function isStrongEncodedSecret(value: string): boolean {
  if (/change-me|test-|example|password/iu.test(value)) return false;
  let decoded: Buffer;
  if (/^[a-f0-9]{64,}$/iu.test(value) && value.length % 2 === 0) {
    decoded = Buffer.from(value, 'hex');
  } else {
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) {
      return false;
    }
    decoded = Buffer.from(value, 'base64');
  }
  return decoded.length >= 32 && new Set(decoded).size >= 16;
}
