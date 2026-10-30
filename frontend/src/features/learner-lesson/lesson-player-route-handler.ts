import { NextRequest, NextResponse } from 'next/server';

import {
  isSameOrigin,
  safeResponse,
  setClearedCookies,
  statusFromError,
} from '@/features/auth/session-route-handlers';

import {
  attemptInputSchema,
  backendAttemptSchema,
  backendLessonPlayerActivitySchema,
  backendLessonProgressSchema,
  backendLessonStartSchema,
  topicCompleteInputSchema,
  type LessonPlayerActivity,
} from './lesson-player-contract';
import { IDEMPOTENCY_KEY_PATTERN } from './lesson-player-model';
import { parseLessonId } from './lesson-sections';

export type LessonPlayerHandlerDependencies = {
  appOrigin: string;
  learnerCookieName: string;
  production: boolean;
  requestBackend: <T = unknown>(
    path: string,
    options?: {
      token?: string;
      method?: 'GET' | 'POST';
      body?: unknown;
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
  deps: LessonPlayerHandlerDependencies,
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
  if ([400, 404, 409, 422, 429].includes(status)) return safeResponse(status);
  return safeResponse(503);
}

/**
 * `POST /api/learner/lessons/:id/start`. The Idempotency-Key is derived from
 * the lesson id on the server, so a reload or a second tab replays the same
 * start (201) instead of tripping "already started with a different key".
 */
export async function handleLessonStart(
  request: NextRequest,
  rawId: string,
  deps: LessonPlayerHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const lessonId = parseLessonId(rawId);
  if (lessonId === null) return safeResponse(404);
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);

  try {
    const raw = await deps.requestBackend(
      `/api/v1/learning/lessons/${lessonId}/start`,
      {
        token,
        method: 'POST',
        body: {},
        idempotencyKey: `lesson-start-${lessonId}`,
      },
    );
    if (!backendLessonStartSchema.safeParse(raw).success) {
      return safeResponse(503);
    }
    return json(200, { success: true });
  } catch (error) {
    if (statusFromError(error) !== 409) return backendFailure(error, deps);
  }

  // 409 is `lesson_locked`, "already started with another key", or a
  // rolled-back write conflict; the backend's own state tells them apart.
  try {
    const raw = await deps.requestBackend(
      `/api/v1/learning/lessons/${lessonId}/activity`,
      { token },
    );
    const parsed = backendLessonPlayerActivitySchema.safeParse(raw);
    if (!parsed.success) return safeResponse(503);
    if (parsed.data.data.state === 'locked') {
      return json(409, {
        success: false,
        error: {
          kind: 'lesson_locked',
          message: 'Complete the previous lesson first.',
        },
      });
    }
    // Not started after all (conflict rolled back): let the player retry.
    if (parsed.data.data.progress.status === 'not_started') {
      return safeResponse(503);
    }
    return json(200, { success: true });
  } catch (error) {
    return backendFailure(error, deps);
  }
}

/**
 * `POST /api/learner/exercises/:id/attempts`. The browser makes one
 * Idempotency-Key per answer and sends it again only to retry that same
 * answer, so a double submit or a retry stores one attempt.
 */
export async function handleExerciseAttempt(
  request: NextRequest,
  rawId: string,
  deps: LessonPlayerHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const exerciseId = parseLessonId(rawId);
  if (exerciseId === null) return safeResponse(404);
  const idempotencyKey = request.headers.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) return safeResponse(400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeResponse(400);
  }
  const input = attemptInputSchema.safeParse(body);
  if (!input.success) return safeResponse(400);

  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);

  try {
    const raw = await deps.requestBackend(
      `/api/v1/learning/exercises/${exerciseId}/attempts`,
      { token, method: 'POST', body: input.data, idempotencyKey },
    );
    const parsed = backendAttemptSchema.safeParse(raw);
    if (!parsed.success) return safeResponse(503);
    return json(200, {
      success: true,
      data: {
        isCorrect: parsed.data.data.isCorrect === true,
        explanation: parsed.data.data.explanation,
      },
    });
  } catch (error) {
    return backendFailure(error, deps);
  }
}

type Activity = LessonPlayerActivity;
type Topic = Activity['topics'][number];

/** Activity of the lesson, or null when the envelope is malformed. */
async function readActivity(
  deps: LessonPlayerHandlerDependencies,
  token: string,
  lessonId: number,
): Promise<Activity | null> {
  const raw = await deps.requestBackend(
    `/api/v1/learning/lessons/${lessonId}/activity`,
    { token },
  );
  const parsed = backendLessonPlayerActivitySchema.safeParse(raw);
  return parsed.success ? parsed.data.data : null;
}

/**
 * A write whose 409 the caller resolves from state; any other failure
 * propagates. Each write gets a fresh key: a retry of the whole close is a
 * new request, and the state read decides what still has to happen.
 */
async function writeTolerating409(
  deps: LessonPlayerHandlerDependencies,
  token: string,
  path: string,
): Promise<'ok' | 'conflict'> {
  try {
    await deps.requestBackend(path, {
      token,
      method: 'POST',
      body: {},
      idempotencyKey: crypto.randomUUID(),
    });
    return 'ok';
  } catch (error) {
    if (statusFromError(error) === 409) return 'conflict';
    throw error;
  }
}

/** Starts the topic when it is not started yet, then completes it (Q58). */
async function closeTopic(
  deps: LessonPlayerHandlerDependencies,
  token: string,
  topic: Topic,
): Promise<'ok' | 'conflict'> {
  if (topic.progress.status === 'not_started') {
    // 409 here: another tab started it; completing still applies.
    await writeTolerating409(
      deps,
      token,
      `/api/v1/learning/topics/${topic.id}/start`,
    );
  }
  return writeTolerating409(
    deps,
    token,
    `/api/v1/learning/topics/${topic.id}/complete`,
  );
}

/**
 * `POST /api/learner/topics/:id/complete` with `{ lessonId }`: closes a topic
 * once the learner has answered its exercises (Q58). The lesson's activity
 * gives the topic's state, so a learning topic is not started again and a
 * 409 counts as success only when the topic really is done.
 */
export async function handleTopicComplete(
  request: NextRequest,
  rawId: string,
  deps: LessonPlayerHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const topicId = parseLessonId(rawId);
  if (topicId === null) return safeResponse(404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeResponse(400);
  }
  const input = topicCompleteInputSchema.safeParse(body);
  if (!input.success) return safeResponse(400);

  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);
  const { lessonId } = input.data;
  const done = () => json(200, { success: true, data: { topicId } });

  try {
    const activity = await readActivity(deps, token, lessonId);
    if (!activity) return safeResponse(503);
    const topic = activity.topics.find((item) => item.id === topicId);
    if (!topic) return safeResponse(404);
    if (topic.progress.status === 'done') return done();
    if ((await closeTopic(deps, token, topic)) === 'ok') return done();

    const after = await readActivity(deps, token, lessonId);
    if (!after) return safeResponse(503);
    const status = after.topics.find((item) => item.id === topicId)?.progress
      .status;
    return status === 'done' ? done() : safeResponse(409);
  } catch (error) {
    return backendFailure(error, deps);
  }
}

/**
 * `POST /api/learner/lessons/:id/complete` (Q58): closes every topic whose
 * exercises all have an attempt, then completes the lesson. A 409 from the
 * backend is success only when the lesson's progress is already done.
 */
export async function handleLessonComplete(
  request: NextRequest,
  rawId: string,
  deps: LessonPlayerHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const lessonId = parseLessonId(rawId);
  if (lessonId === null) return safeResponse(404);
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);
  const done = () => json(200, { success: true, data: { lessonId } });

  try {
    const activity = await readActivity(deps, token, lessonId);
    if (!activity) return safeResponse(503);
    for (const topic of activity.topics) {
      if (topic.progress.status === 'done') continue;
      if (topic.exercises.some((exercise) => exercise.latestAttempt === null)) {
        continue;
      }
      // A 409 is left to the lesson complete below, which then fails.
      await closeTopic(deps, token, topic);
    }
    const result = await writeTolerating409(
      deps,
      token,
      `/api/v1/learning/lessons/${lessonId}/complete`,
    );
    if (result === 'ok') return done();
  } catch (error) {
    return backendFailure(error, deps);
  }

  try {
    const raw = await deps.requestBackend(
      `/api/v1/progress/lessons/${lessonId}`,
      { token },
    );
    const parsed = backendLessonProgressSchema.safeParse(raw);
    if (!parsed.success) return safeResponse(503);
    return parsed.data.data.status === 'done' ? done() : safeResponse(409);
  } catch (error) {
    // No progress row: the lesson was never started, so it is not done.
    if (statusFromError(error) === 404) return safeResponse(409);
    return backendFailure(error, deps);
  }
}
