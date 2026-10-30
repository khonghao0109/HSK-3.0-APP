import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  safeResponse,
  statusFromError,
} from '@/features/auth/session-route-handlers';
import { backendEnvelope } from '@/lib/api/backend-envelope';
import { readJwtExpiry } from '@/lib/auth/session-cookie';

export type LearnerMediaHandlerDependencies = {
  /** Session cookie carrying the backend bearer (learner or admin). */
  sessionCookieName: string;
  /** Same-origin route the `src` points at; default '/api/learner/media'. */
  contentRoutePrefix?: string;
  requestBackend: (
    path: string,
    options?: { token?: string },
  ) => Promise<unknown>;
  requestBackendRaw: (
    path: string,
    options: {
      search: URLSearchParams;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    },
  ) => Promise<Response>;
};

const MEDIA_ID_PATTERN = /^[1-9]\d{0,15}$/;
const EXPIRES_PATTERN = /^\d{1,10}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
// One `bytes=` range; anything else stays home and the backend sends 200.
const RANGE_PATTERN = /^bytes=(?:\d+-\d*|-\d+)$/;
const COPIED_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'content-disposition',
  'x-content-type-options',
];

const backendAccessSchema = backendEnvelope(
  z.object({ expiresAt: z.string(), url: z.string() }),
);

/** `expires` and `signature`, each exactly once and nothing else, or null. */
export function readGrant(
  params: URLSearchParams,
): { expires: string; signature: string } | null {
  const entries = [...params];
  if (entries.length !== 2) return null;
  const expires = params.getAll('expires');
  const signature = params.getAll('signature');
  if (expires.length !== 1 || signature.length !== 1) return null;
  if (!EXPIRES_PATTERN.test(expires[0] ?? '')) return null;
  if (!SIGNATURE_PATTERN.test(signature[0] ?? '')) return null;
  return { expires: expires[0] ?? '', signature: signature[0] ?? '' };
}

/** Positive safe integer id, as the backend pipe accepts. */
export function isMediaId(rawId: string): boolean {
  return MEDIA_ID_PATTERN.test(rawId) && Number.isSafeInteger(Number(rawId));
}

/** 403/404/429 keep their status; anything else is 503. */
function mediaFailure(status: number): NextResponse {
  return safeResponse([403, 404, 429].includes(status) ? status : 503);
}

/**
 * `GET /api/learner/media/:id/access`: a same-origin `src` for the audio
 * element, rebuilt from the backend grant. Since M4.2b R12 the exam island
 * preloads those same-origin bytes into a Blob and plays it through a `blob:`
 * URL, so the CSP keeps `media-src 'self' blob:` (no storage origin).
 */
export async function handleMediaAccess(
  request: NextRequest,
  rawId: string,
  deps: LearnerMediaHandlerDependencies,
): Promise<NextResponse> {
  if (!isMediaId(rawId)) return safeResponse(404);
  const token = request.cookies.get(deps.sessionCookieName)?.value;
  if (!token) return safeResponse(401);

  let raw: unknown;
  try {
    raw = await deps.requestBackend(`/api/v1/media/${rawId}/access`, {
      token,
    });
  } catch (error) {
    const status = statusFromError(error);
    return status === 401 ? safeResponse(401) : mediaFailure(status);
  }
  const parsed = backendAccessSchema.safeParse(raw);
  if (!parsed.success) return safeResponse(502);
  const { url, expiresAt } = parsed.data.data;
  if (!url.startsWith('/') || url.startsWith('//')) return safeResponse(502);
  let backendUrl: URL;
  try {
    backendUrl = new URL(url, 'http://backend.invalid');
  } catch {
    return safeResponse(502);
  }
  const grant = readGrant(backendUrl.searchParams);
  if (
    backendUrl.origin !== 'http://backend.invalid' ||
    backendUrl.pathname !== `/api/v1/media/${rawId}/content` ||
    backendUrl.hash ||
    !grant ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    return safeResponse(502);
  }
  const search = new URLSearchParams([
    ['expires', grant.expires],
    ['signature', grant.signature],
  ]);
  const response = NextResponse.json({
    success: true,
    data: {
      src: `${deps.contentRoutePrefix ?? '/api/learner/media'}/${rawId}/content?${search}`,
      expiresAt,
    },
  });
  response.headers.set('cache-control', 'no-store');
  return response;
}

/**
 * `GET /api/learner/media/:id/content`: streams the backend bytes. The URL is
 * a capability (expiring signature), so a well-formed session cookie is
 * enough; there is no `/auth/me` round trip for every Range request.
 */
export async function handleMediaContent(
  request: NextRequest,
  rawId: string,
  deps: LearnerMediaHandlerDependencies,
): Promise<Response> {
  if (!isMediaId(rawId)) return safeResponse(404);
  const token = request.cookies.get(deps.sessionCookieName)?.value;
  if (!token || readJwtExpiry(token) === null) return safeResponse(401);
  const grant = readGrant(request.nextUrl.searchParams);
  if (!grant) return safeResponse(400);

  const headers: Record<string, string> = {};
  const range = request.headers.get('range');
  if (range && range.length <= 100 && RANGE_PATTERN.test(range)) {
    headers.range = range;
  }

  // This route does not pass nginx's limit_req of the content location; the
  // backend still limits per grant and per IP (from X-Forwarded-For).
  let upstream: Response;
  try {
    upstream = await deps.requestBackendRaw(`/api/v1/media/${rawId}/content`, {
      search: new URLSearchParams([
        ['expires', grant.expires],
        ['signature', grant.signature],
      ]),
      headers,
      signal: request.signal,
    });
  } catch (error) {
    return mediaFailure(statusFromError(error));
  }

  if (![200, 206, 416].includes(upstream.status)) {
    await upstream.body?.cancel().catch(() => undefined);
    return mediaFailure(upstream.status);
  }
  const out = new Headers({ 'cache-control': 'private, no-store' });
  for (const name of COPIED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  if (upstream.status === 416) {
    // Keep the status and Content-Range, not the backend's error body.
    await upstream.body?.cancel().catch(() => undefined);
    out.delete('content-type');
    out.delete('content-length');
    return new Response(null, { status: 416, headers: out });
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
