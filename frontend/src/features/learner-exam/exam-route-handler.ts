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

import { examStartBackendSchema, examStartInputSchema } from './exam-contract';

/** M4.2b Pha B (TL-134) uses the same dependency shape for the attempt routes. */
export type ExamHandlerDependencies = {
  appOrigin: string;
  learnerCookieName: string;
  production: boolean;
  requestBackend: (
    path: string,
    options?: {
      token?: string;
      method?: 'GET' | 'POST' | 'PUT';
      body?: unknown;
    },
  ) => Promise<unknown>;
};

/** 409 belongs to these two documented machine codes only (TL-111). */
const EXAM_CONFLICT_CODES = new Set([
  'EXAM_TEST_UNAVAILABLE',
  'EXAM_IDEMPOTENCY_KEY_REUSED',
]);

function json(status: number, body: unknown): NextResponse {
  return noStore(NextResponse.json(body, { status }));
}

/**
 * A 409 keeps the backend machine code so the island can tell "content
 * unavailable" from "key reused"; `details.reasons` stays on the server
 * because it is internal publish-gate state.
 */
function conflictResponse(code: string): NextResponse {
  const failure = normalizeApiFailure({ status: 409 });
  return json(409, {
    success: false,
    error: { kind: failure.kind, message: failure.message, code },
  });
}

/**
 * `POST /api/learner/exam/tests/:testId/attempts` (TL-118). The browser sends
 * its own `idempotencyKey` in the body; the BFF forwards exactly that body and
 * never attaches an `Idempotency-Key` header, which the exam API ignores.
 */
export async function handleExamStart(
  request: NextRequest,
  rawId: string,
  deps: ExamHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const testId = parseLessonId(rawId);
  if (testId === null) return safeResponse(404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeResponse(400);
  }
  const input = examStartInputSchema.safeParse(body);
  if (!input.success) return safeResponse(400);

  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);

  let raw: unknown;
  try {
    raw = await deps.requestBackend(`/api/v1/exam/tests/${testId}/attempts`, {
      token,
      method: 'POST',
      body: { idempotencyKey: input.data.idempotencyKey },
    });
  } catch (error: unknown) {
    const status = statusFromError(error);
    if (status === 409) {
      const code =
        error instanceof BackendRequestError ? (error.code ?? null) : null;
      if (code !== null && EXAM_CONFLICT_CODES.has(code)) {
        return conflictResponse(code);
      }
      return safeResponse(503);
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

  const parsed = examStartBackendSchema.safeParse(raw);
  if (!parsed.success) return safeResponse(503);
  const { id, status, expiresAt } = parsed.data.data;
  return json(200, { success: true, data: { id, status, expiresAt } });
}
