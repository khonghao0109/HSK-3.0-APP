import type { NextFunction, Request, Response } from 'express';
import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';

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

/**
 * `req.ip` becomes the address `TRUST_PROXY_HOPS` entries from the right of
 * X-Forwarded-For. Default 1 matches both deployed paths: nginx -> backend,
 * and nginx -> BFF -> backend where the BFF forwards nginx's chain verbatim.
 * The backend listener must stay private, otherwise clients can forge the
 * header.
 */
export function configureTrustProxy(
  app: Pick<NestExpressApplication, 'set'>,
  config: Pick<ConfigService, 'getOrThrow'>,
): void {
  app.set('trust proxy', config.getOrThrow<number>('app.trustProxyHops'));
}

export function assertProductionSecrets(environment: {
  JWT_SECRETS?: string;
  JWT_ACTIVE_KID?: string;
  AUTH_PASSWORD_PEPPER?: string;
  MEDIA_SIGNING_SECRET?: string;
  MEDIA_METRICS_BEARER_TOKEN?: string;
  MEDIA_METRICS_BEARER_TOKEN_PREVIOUS?: string;
}): void {
  let parsedJwtSecrets: unknown;
  try {
    parsedJwtSecrets = JSON.parse(environment.JWT_SECRETS ?? '');
  } catch {
    failInvalidProductionSecrets();
  }
  if (!isSecretRecord(parsedJwtSecrets)) failInvalidProductionSecrets();

  const active = environment.JWT_ACTIVE_KID;
  if (!active || typeof parsedJwtSecrets[active] !== 'string')
    failInvalidProductionSecrets();

  const values = [
    ...Object.values(parsedJwtSecrets),
    environment.AUTH_PASSWORD_PEPPER,
    environment.MEDIA_SIGNING_SECRET,
    environment.MEDIA_METRICS_BEARER_TOKEN,
    ...(environment.MEDIA_METRICS_BEARER_TOKEN_PREVIOUS
      ? [environment.MEDIA_METRICS_BEARER_TOKEN_PREVIOUS]
      : []),
  ];
  if (!values.every(isString)) failInvalidProductionSecrets();

  const decoded = values.map((value) => decodeSecretMaterial(value));
  if (!decoded.every(isStrongSecret)) failInvalidProductionSecrets();

  const fingerprints = decoded.map((value) =>
    createHash('sha256').update(value).digest('hex'),
  );
  if (new Set(fingerprints).size !== fingerprints.length)
    failInvalidProductionSecrets();
}

function isSecretRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function failInvalidProductionSecrets(): never {
  throw new Error('Production secret configuration is invalid.');
}

function decodeSecretMaterial(value: string): Buffer | undefined {
  if (value.length === 0 || value.length > 4_096) return undefined;
  if (!isPrintableAsciiWithoutWhitespace(value)) return undefined;
  if (containsPlaceholder(Buffer.from(value, 'utf8'))) return undefined;
  if (/^(?:base64|hex):/iu.test(value) || /^0x/iu.test(value)) {
    return undefined;
  }
  if (/^[a-f0-9]+$/iu.test(value) && value.length % 2 === 0) {
    return Buffer.from(value, 'hex');
  }
  if (/^[A-Za-z0-9+/]+=*$/u.test(value)) {
    return decodeCanonicalBase64(value);
  }
  if (/^[A-Za-z0-9_-]+=*$/u.test(value)) {
    return decodeCanonicalBase64Url(value);
  }
  return Buffer.from(value, 'utf8');
}

function isPrintableAsciiWithoutWhitespace(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x21 || codePoint > 0x7e) {
      return false;
    }
  }
  return true;
}

function decodeCanonicalBase64(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return undefined;
  const unpadded = value.replace(/=+$/u, '');
  if (unpadded.length % 4 === 1) return undefined;
  const canonicalPadded = `${unpadded}${'='.repeat(
    (4 - (unpadded.length % 4)) % 4,
  )}`;
  if (value.includes('=') && value !== canonicalPadded) return undefined;
  const decoded = Buffer.from(canonicalPadded, 'base64');
  return decoded.toString('base64') === canonicalPadded ? decoded : undefined;
}

function decodeCanonicalBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    return undefined;
  }
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : undefined;
}

function isStrongSecret(value: Buffer | undefined): value is Buffer {
  if (!value || value.length < 32) return false;
  if (containsPlaceholder(value)) return false;
  if (isRepeatedPattern(value) || hasLongRepeatedByteRun(value)) return false;
  return hasAcceptableByteDistribution(value);
}

function containsPlaceholder(value: Buffer): boolean {
  const bytePreservingText = value.toString('latin1').toLowerCase();
  if (matchesPlaceholder(bytePreservingText)) return true;
  if (!isUtf8(value)) return false;
  const text = value.toString('utf8').normalize('NFKC').toLowerCase();
  return matchesPlaceholder(text);
}

function matchesPlaceholder(value: string): boolean {
  return /change[\s._-]*me|password|example|(?:^|[^a-z0-9])test(?:[\s._-]|$)/u.test(
    value,
  );
}

function isRepeatedPattern(value: Buffer): boolean {
  const prefix = new Uint32Array(value.length);
  for (let index = 1; index < value.length; index += 1) {
    let matched = prefix[index - 1] ?? 0;
    while (matched > 0 && value[index] !== value[matched]) {
      matched = prefix[matched - 1] ?? 0;
    }
    if (value[index] === value[matched]) matched += 1;
    prefix[index] = matched;
  }
  const period = value.length - (prefix[value.length - 1] ?? 0);
  return period < value.length && value.length % period === 0;
}

function hasLongRepeatedByteRun(value: Buffer): boolean {
  let runLength = 1;
  for (let index = 1; index < value.length; index += 1) {
    runLength = value[index] === value[index - 1] ? runLength + 1 : 1;
    if (runLength >= 8) return true;
  }
  return false;
}

function hasAcceptableByteDistribution(value: Buffer): boolean {
  const counts = new Uint32Array(256);
  for (const byte of value) counts[byte] = (counts[byte] ?? 0) + 1;

  let informationBitsPerByte = 0;
  let maximumCount = 0;
  for (const count of counts) {
    if (count === 0) continue;
    maximumCount = Math.max(maximumCount, count);
    const probability = count / value.length;
    informationBitsPerByte -= probability * Math.log2(probability);
  }
  return informationBitsPerByte >= 3.5 && maximumCount / value.length <= 0.25;
}
