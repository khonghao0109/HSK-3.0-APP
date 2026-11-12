import { NextRequest, NextResponse } from 'next/server';

import {
  isSameOrigin,
  noStore,
  safeResponse,
  setClearedCookies,
  statusFromError,
} from '@/features/auth/session-route-handlers';
import { parseLessonId } from '@/features/learner-lesson/lesson-sections';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import {
  REVIEW_IDEMPOTENCY_KEY_PATTERN,
  REVIEW_QUEUE_LIMIT_PATTERN,
  reviewCompleteEnvelopeSchema,
  reviewCreateEnvelopeSchema,
  reviewCreateInputSchema,
  reviewCurrentEnvelopeSchema,
  reviewGradeEnvelopeSchema,
  reviewGradeInputSchema,
  reviewOverviewEnvelopeSchema,
  reviewQueueEnvelopeSchema,
} from './review-contract';

export type ReviewHandlerDependencies = {
  appOrigin: string;
  learnerCookieName: string;
  production: boolean;
  requestBackend: (
    path: string,
    options: {
      token: string;
      method?: 'POST';
      body?: unknown;
      idempotencyKey?: string;
    },
  ) => Promise<unknown>;
};

/** A.7b: the 409 codes the island acts on; any other 409 becomes 503. */
const REVIEW_CONFLICT_CODES = new Set([
  'CONFLICT',
  'REVIEW_NOTHING_DUE',
  'REVIEW_SESSION_NOT_ACTIVE',
  'REVIEW_SESSION_EXPIRED',
  'REVIEW_CARD_NOT_IN_SESSION',
  'REVIEW_CARD_ALREADY_REVIEWED',
  'REVIEW_CARD_UNAVAILABLE',
]);

type Schema = {
  safeParse: (
    raw: unknown,
  ) => { success: true; data: { data: unknown } } | { success: false };
};

function json(status: number, body: unknown): NextResponse {
  return noStore(NextResponse.json(body, { status }));
}

/** The backend machine code survives; `details` stays on the server. */
function failure(
  error: unknown,
  deps: ReviewHandlerDependencies,
): NextResponse {
  const status = statusFromError(error);
  if (status === 409) {
    const code =
      error instanceof BackendRequestError ? (error.code ?? null) : null;
    if (code === null || !REVIEW_CONFLICT_CODES.has(code)) {
      return safeResponse(503);
    }
    const normalized = normalizeApiFailure({ status: 409 });
    return json(409, {
      success: false,
      error: { kind: normalized.kind, message: normalized.message, code },
    });
  }
  if (status === 401 || status === 403) {
    const response = safeResponse(status);
    setClearedCookies(response, {
      cookieName: deps.learnerCookieName,
      production: deps.production,
    });
    return response;
  }
  if (status === 400 || status === 404 || status === 429) {
    return safeResponse(status);
  }
  return safeResponse(503);
}

async function forward(
  deps: ReviewHandlerDependencies,
  path: string,
  options: Parameters<ReviewHandlerDependencies['requestBackend']>[1],
  schema: Schema,
): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await deps.requestBackend(path, options);
  } catch (error: unknown) {
    return failure(error, deps);
  }
  // The parsed projection is the allowlist: unknown keys are dropped.
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return safeResponse(503);
  return json(200, { success: true, data: parsed.data.data });
}

async function readBody(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function tokenOf(
  request: NextRequest,
  deps: ReviewHandlerDependencies,
): string | null {
  return request.cookies.get(deps.learnerCookieName)?.value || null;
}

/** `GET /api/learner/review/queue?limit=`. GET skips the Origin check. */
export async function handleReviewQueue(
  request: NextRequest,
  deps: ReviewHandlerDependencies,
): Promise<NextResponse> {
  const limit = request.nextUrl.searchParams.get('limit');
  if (limit !== null && !REVIEW_QUEUE_LIMIT_PATTERN.test(limit)) {
    return safeResponse(400);
  }
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  const path =
    limit === null
      ? '/api/v1/review/queue'
      : `/api/v1/review/queue?limit=${limit}`;
  return forward(deps, path, { token }, reviewQueueEnvelopeSchema);
}

/** `GET /api/learner/review/overview` (M3.3b, Q268). */
export async function handleReviewOverview(
  request: NextRequest,
  deps: ReviewHandlerDependencies,
): Promise<NextResponse> {
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  return forward(
    deps,
    '/api/v1/review/overview',
    { token },
    reviewOverviewEnvelopeSchema,
  );
}

/** `GET /api/learner/review/sessions/current`. */
export async function handleReviewCurrent(
  request: NextRequest,
  deps: ReviewHandlerDependencies,
): Promise<NextResponse> {
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  return forward(
    deps,
    '/api/v1/review/sessions/current',
    { token },
    reviewCurrentEnvelopeSchema,
  );
}

/**
 * `POST /api/learner/review/sessions`. The browser owns the
 * `Idempotency-Key` (Q259); the body is rebuilt from the strict parse.
 */
export async function handleReviewCreateSession(
  request: NextRequest,
  deps: ReviewHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const key = request.headers.get('idempotency-key');
  if (key === null || !REVIEW_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return safeResponse(400);
  }
  const input = reviewCreateInputSchema.safeParse(await readBody(request));
  if (!input.success) return safeResponse(400);
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  return forward(
    deps,
    '/api/v1/review/sessions',
    {
      token,
      method: 'POST',
      body: input.data.limit === undefined ? {} : { limit: input.data.limit },
      idempotencyKey: key,
    },
    reviewCreateEnvelopeSchema,
  );
}

/** `POST /api/learner/review/sessions/:sessionId/reviews` (Q262). */
export async function handleReviewGrade(
  request: NextRequest,
  rawSessionId: string,
  deps: ReviewHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const sessionId = parseLessonId(rawSessionId);
  if (sessionId === null) return safeResponse(404);
  const key = request.headers.get('idempotency-key');
  if (key === null || !REVIEW_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return safeResponse(400);
  }
  const input = reviewGradeInputSchema.safeParse(await readBody(request));
  if (!input.success) return safeResponse(400);
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  const { cardId, grade, durationMs } = input.data;
  return forward(
    deps,
    `/api/v1/review/sessions/${String(sessionId)}/reviews`,
    {
      token,
      method: 'POST',
      body:
        durationMs === undefined
          ? { cardId, grade }
          : { cardId, grade, durationMs },
      idempotencyKey: key,
    },
    reviewGradeEnvelopeSchema,
  );
}

/** `POST /api/learner/review/sessions/:sessionId/complete` (Q263). */
export async function handleReviewComplete(
  request: NextRequest,
  rawSessionId: string,
  deps: ReviewHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const sessionId = parseLessonId(rawSessionId);
  if (sessionId === null) return safeResponse(404);
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  return forward(
    deps,
    `/api/v1/review/sessions/${String(sessionId)}/complete`,
    { token, method: 'POST' },
    reviewCompleteEnvelopeSchema,
  );
}
