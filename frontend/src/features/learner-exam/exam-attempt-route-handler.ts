import { NextRequest, NextResponse } from 'next/server';

import {
  isSameOrigin,
  noStore,
  safeResponse,
  setClearedCookies,
  statusFromError,
} from '@/features/auth/session-route-handlers';
import { parseLessonId } from '@/features/learner-lesson/lesson-sections';
import {
  isMediaId,
  readGrant,
} from '@/features/learner-lesson/learner-media-route-handler';
import { normalizeApiFailure } from '@/lib/api/api-error';
import { BackendRequestError } from '@/lib/api/api-error';

import {
  EXAM_QUESTION_KEY_PATTERN,
  examAnswerBatchEnvelopeSchema,
  examAnswerSaveEnvelopeSchema,
  examAttemptEnvelopeSchema,
  examMediaGrantsBackendEnvelopeSchema,
  examSaveAnswerInputSchema,
  examSaveAnswersInputSchema,
} from './exam-contract';
import type { ExamHandlerDependencies } from './exam-route-handler';

/** TL-134.5: 409 codes the answer routes may forward to the browser. */
const ANSWER_CONFLICT_CODES = new Set([
  'EXAM_ANSWER_VERSION_CONFLICT',
  'EXAM_ATTEMPT_EXPIRED',
  'EXAM_ATTEMPT_CLOSED',
  'EXAM_IDEMPOTENCY_KEY_REUSED',
]);

/** TL-134.5: the grants route forwards the two attempt-terminal codes only. */
const GRANT_CONFLICT_CODES = new Set([
  'EXAM_ATTEMPT_EXPIRED',
  'EXAM_ATTEMPT_CLOSED',
]);

const ANSWER_INVALID_CODE = 'EXAM_ANSWER_INVALID';

function json(status: number, body: unknown): NextResponse {
  return noStore(NextResponse.json(body, { status }));
}

/**
 * TL-134.5: a 409 keeps the backend machine code; `details` (the winning row,
 * internal status) stays on the server.
 */
function conflictResponse(code: string): NextResponse {
  const failure = normalizeApiFailure({ status: 409 });
  return json(409, {
    success: false,
    error: { kind: failure.kind, message: failure.message, code },
  });
}

/**
 * TL-134.5: the one 400 that carries data is EXAM_ANSWER_INVALID; the client
 * needs `details.field` to point at the answer input.
 */
function answerInvalidResponse(field: string | null): NextResponse {
  const failure = normalizeApiFailure({ status: 400 });
  return json(400, {
    success: false,
    error: {
      kind: failure.kind,
      message: failure.message,
      code: ANSWER_INVALID_CODE,
      details: { field: field ?? 'answer' },
    },
  });
}

function answerInvalidField(error: unknown): string | null {
  if (!(error instanceof BackendRequestError)) return null;
  if (error.code !== ANSWER_INVALID_CODE) return null;
  const field = error.details?.field;
  return typeof field === 'string' && field.length > 0 ? field : null;
}

function clearSession(
  response: NextResponse,
  deps: ExamHandlerDependencies,
): NextResponse {
  setClearedCookies(response, {
    cookieName: deps.learnerCookieName,
    production: deps.production,
  });
  return response;
}

type ErrorMapOptions = {
  deps: ExamHandlerDependencies;
  conflictCodes: Set<string>;
};

/** Shared error mapping for the four attempt routes (TL-134.5). */
function mapAttemptError(
  error: unknown,
  options: ErrorMapOptions,
): NextResponse {
  const status = statusFromError(error);
  if (status === 409) {
    const code =
      error instanceof BackendRequestError ? (error.code ?? null) : null;
    if (code !== null && options.conflictCodes.has(code)) {
      return conflictResponse(code);
    }
    return safeResponse(503);
  }
  if (status === 400) {
    const field = answerInvalidField(error);
    if (field !== null) return answerInvalidResponse(field);
    return safeResponse(400);
  }
  if (status === 401 || status === 403) {
    return clearSession(safeResponse(status), options.deps);
  }
  if (status === 404 || status === 429) return safeResponse(status);
  return safeResponse(503);
}

function parseAttemptId(rawAttemptId: string): number | null {
  return parseLessonId(rawAttemptId);
}

/** `GET /api/learner/exam/attempts/:attemptId` (TL-134). GET skips Origin. */
export async function handleExamAttemptRead(
  request: NextRequest,
  rawAttemptId: string,
  deps: ExamHandlerDependencies,
): Promise<NextResponse> {
  const attemptId = parseAttemptId(rawAttemptId);
  if (attemptId === null) return safeResponse(404);
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);

  let raw: unknown;
  try {
    raw = await deps.requestBackend(`/api/v1/exam/attempts/${attemptId}`, {
      token,
      method: 'GET',
    });
  } catch (error: unknown) {
    return mapAttemptError(error, {
      deps,
      conflictCodes: ANSWER_CONFLICT_CODES,
    });
  }

  const parsed = examAttemptEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return safeResponse(503);
  // The parsed projection is already the allowlist (group.content dropped).
  return json(200, { success: true, data: parsed.data.data });
}

/**
 * `GET /api/learner/exam/attempts/:attemptId/media-grants` (TL-135). The
 * backend signed URL is rewritten to the same-origin learner media route; a
 * grant that does not match the documented shape moves to `unavailable`.
 */
export async function handleExamMediaGrants(
  request: NextRequest,
  rawAttemptId: string,
  deps: ExamHandlerDependencies,
): Promise<NextResponse> {
  const attemptId = parseAttemptId(rawAttemptId);
  if (attemptId === null) return safeResponse(404);
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);

  let raw: unknown;
  try {
    raw = await deps.requestBackend(
      `/api/v1/exam/attempts/${attemptId}/media-grants`,
      { token, method: 'GET' },
    );
  } catch (error: unknown) {
    return mapAttemptError(error, {
      deps,
      conflictCodes: GRANT_CONFLICT_CODES,
    });
  }

  const parsed = examMediaGrantsBackendEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return safeResponse(503);

  const unavailable = [...parsed.data.data.unavailable];
  const grants: Array<{
    mediaId: number;
    kind: string;
    src: string;
    expiresAt: string;
  }> = [];
  for (const grant of parsed.data.data.grants) {
    const src = rewriteGrantUrl(grant.mediaId, grant.url);
    if (src === null || !Number.isFinite(Date.parse(grant.expiresAt))) {
      unavailable.push(grant.mediaId);
      continue;
    }
    grants.push({
      mediaId: grant.mediaId,
      kind: grant.kind,
      src,
      expiresAt: grant.expiresAt,
    });
  }
  return json(200, {
    success: true,
    data: { grants, unavailable },
  });
}

/**
 * TL-135: only the learner media content route with exactly `expires` +
 * `signature` is accepted; the browser never sees `/api/v1/...`.
 */
export function rewriteGrantUrl(
  mediaId: number,
  rawUrl: string,
): string | null {
  if (!rawUrl.startsWith('/') || rawUrl.startsWith('//')) return null;
  let url: URL;
  try {
    url = new URL(rawUrl, 'http://backend.invalid');
  } catch {
    return null;
  }
  if (
    url.origin !== 'http://backend.invalid' ||
    url.pathname !== `/api/v1/media/${mediaId}/content` ||
    url.hash
  ) {
    return null;
  }
  const grant = readGrant(url.searchParams);
  if (grant === null || !isMediaId(String(mediaId))) return null;
  const search = new URLSearchParams([
    ['expires', grant.expires],
    ['signature', grant.signature],
  ]);
  return `/api/learner/media/${mediaId}/content?${search.toString()}`;
}

/** `PUT /api/learner/exam/attempts/:attemptId/answers/:questionKey`. */
export async function handleExamSaveAnswer(
  request: NextRequest,
  rawAttemptId: string,
  rawQuestionKey: string,
  deps: ExamHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const attemptId = parseAttemptId(rawAttemptId);
  if (attemptId === null) return safeResponse(404);
  if (!EXAM_QUESTION_KEY_PATTERN.test(rawQuestionKey)) {
    return safeResponse(404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeResponse(400);
  }
  const input = examSaveAnswerInputSchema.safeParse(body);
  if (!input.success) return safeResponse(400);

  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);

  let raw: unknown;
  try {
    raw = await deps.requestBackend(
      `/api/v1/exam/attempts/${attemptId}/answers/${rawQuestionKey}`,
      {
        token,
        method: 'PUT',
        // Rebuilt from parsed data: the raw body never reaches the backend.
        body: {
          answer: input.data.answer,
          isFlagged: input.data.isFlagged,
          expectedVersion: input.data.expectedVersion,
          idempotencyKey: input.data.idempotencyKey,
        },
      },
    );
  } catch (error: unknown) {
    return mapAttemptError(error, {
      deps,
      conflictCodes: ANSWER_CONFLICT_CODES,
    });
  }

  const parsed = examAnswerSaveEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return safeResponse(503);
  const {
    questionKey,
    answer,
    isFlagged,
    version,
    answeredAt,
    lastSavedAt,
    serverNow,
    remainingSeconds,
  } = parsed.data.data;
  return json(200, {
    success: true,
    data: {
      questionKey,
      answer,
      isFlagged,
      version,
      answeredAt,
      lastSavedAt,
      serverNow,
      remainingSeconds,
    },
  });
}

/** `PUT /api/learner/exam/attempts/:attemptId/answers` (batch, TL-134). */
export async function handleExamSaveAnswers(
  request: NextRequest,
  rawAttemptId: string,
  deps: ExamHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const attemptId = parseAttemptId(rawAttemptId);
  if (attemptId === null) return safeResponse(404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeResponse(400);
  }
  const input = examSaveAnswersInputSchema.safeParse(body);
  if (!input.success) return safeResponse(400);
  const keys = new Set<string>();
  for (const item of input.data.items) {
    if (keys.has(item.questionKey)) return safeResponse(400);
    keys.add(item.questionKey);
  }

  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);

  let raw: unknown;
  try {
    raw = await deps.requestBackend(
      `/api/v1/exam/attempts/${attemptId}/answers`,
      {
        token,
        method: 'PUT',
        body: {
          items: input.data.items.map((item) => ({
            questionKey: item.questionKey,
            answer: item.answer,
            isFlagged: item.isFlagged,
            expectedVersion: item.expectedVersion,
            idempotencyKey: item.idempotencyKey,
          })),
        },
      },
    );
  } catch (error: unknown) {
    return mapAttemptError(error, {
      deps,
      conflictCodes: ANSWER_CONFLICT_CODES,
    });
  }

  const parsed = examAnswerBatchEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return safeResponse(503);
  const { results, serverNow, remainingSeconds } = parsed.data.data;
  return json(200, {
    success: true,
    data: {
      results: results.map((result) => ({
        questionKey: result.questionKey,
        status: result.status,
        ...(result.answer === undefined ? {} : { answer: result.answer }),
        ...(result.code === undefined ? {} : { code: result.code }),
        ...(result.current === undefined ? {} : { current: result.current }),
      })),
      serverNow,
      remainingSeconds,
    },
  });
}
