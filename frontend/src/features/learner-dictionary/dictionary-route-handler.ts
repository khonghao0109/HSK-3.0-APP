import { NextRequest, NextResponse } from 'next/server';

import {
  isSameOrigin,
  safeResponse,
  setClearedCookies,
  statusFromError,
} from '@/features/auth/session-route-handlers';
import { parseLessonId } from '@/features/learner-lesson/lesson-sections';

import {
  backendDictionarySavedSchema,
  backendDictionarySearchSchema,
} from './dictionary-contract';
import { normalizeSearchQuery } from './dictionary-display';

export type DictionaryHandlerDependencies = {
  appOrigin: string;
  learnerCookieName: string;
  production: boolean;
  requestBackend: <T = unknown>(
    path: string,
    options?: {
      token?: string;
      method?: 'GET' | 'POST' | 'DELETE';
      idempotencyKey?: string;
    },
  ) => Promise<T>;
};

function json(status: number, body: unknown): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('cache-control', 'no-store');
  return response;
}

/** Backend failure → safe BFF status; 401/403 also clear the learner cookies. */
function backendFailure(
  error: unknown,
  deps: DictionaryHandlerDependencies,
): NextResponse {
  const status = statusFromError(error);
  if (status === 401 || status === 403) {
    const response = safeResponse(status);
    setClearedCookies(response, {
      cookieName: deps.learnerCookieName,
      production: deps.production,
    });
    return response;
  }
  if ([400, 404, 429].includes(status)) return safeResponse(status);
  return safeResponse(503);
}

/** `GET /api/learner/dictionary?q=`: search as the learner types (M2.6b). */
export async function handleDictionarySearch(
  request: NextRequest,
  deps: DictionaryHandlerDependencies,
): Promise<NextResponse> {
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);
  const q = normalizeSearchQuery(request.nextUrl.searchParams.get('q'));
  if (q === null) return safeResponse(400);

  let raw: unknown;
  try {
    raw = await deps.requestBackend(
      `/api/v1/dictionary?query=${encodeURIComponent(q)}`,
      { token },
    );
  } catch (error) {
    return backendFailure(error, deps);
  }
  const parsed = backendDictionarySearchSchema.safeParse(raw);
  if (!parsed.success) return safeResponse(502);
  return json(200, { success: true, data: parsed.data.data });
}

/**
 * `POST` (save) and `DELETE` (unsave) `/api/learner/dictionary/words/:id/save`.
 * Each save gets a fresh server-side Idempotency-Key: the backend save is
 * already idempotent per (user, word), the key only satisfies its contract.
 */
export async function handleDictionarySave(
  request: NextRequest,
  rawId: string,
  method: 'POST' | 'DELETE',
  deps: DictionaryHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const wordId = parseLessonId(rawId);
  if (wordId === null) return safeResponse(404);
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);

  let raw: unknown;
  try {
    raw = await deps.requestBackend(
      `/api/v1/dictionary/words/${wordId}/save`,
      method === 'POST'
        ? { token, method, idempotencyKey: crypto.randomUUID() }
        : { token, method },
    );
  } catch (error) {
    return backendFailure(error, deps);
  }
  const parsed = backendDictionarySavedSchema.safeParse(raw);
  if (!parsed.success) return safeResponse(502);
  return json(200, { success: true, data: { saved: parsed.data.data.saved } });
}
