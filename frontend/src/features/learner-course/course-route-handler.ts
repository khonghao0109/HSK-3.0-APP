import { NextRequest, NextResponse } from 'next/server';

import {
  isSameOrigin,
  noStore,
  safeResponse,
  setClearedCookies,
  statusFromError,
} from '@/features/auth/session-route-handlers';

import {
  courseDetailEnvelopeSchema,
  courseEnrollmentEnvelopeSchema,
  courseListEnvelopeSchema,
  currentCourseInputSchema,
} from './course-contract';
import { COURSE_CODE_PATTERN } from './course-model';

export type CourseHandlerDependencies = {
  appOrigin: string;
  learnerCookieName: string;
  production: boolean;
  requestBackend: (
    path: string,
    options: {
      token: string;
      method?: 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
    },
  ) => Promise<unknown>;
};

type Schema = {
  safeParse: (
    raw: unknown,
  ) => { success: true; data: { data: unknown } } | { success: false };
};

/** The backend message and `details` stay on the server. */
function failure(
  error: unknown,
  deps: CourseHandlerDependencies,
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
  if (status === 400 || status === 404 || status === 429) {
    return safeResponse(status);
  }
  return safeResponse(503);
}

async function forward(
  deps: CourseHandlerDependencies,
  path: string,
  options: Parameters<CourseHandlerDependencies['requestBackend']>[1],
  schema: Schema | null,
): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await deps.requestBackend(path, options);
  } catch (error: unknown) {
    return failure(error, deps);
  }
  if (schema === null) return noStore(new NextResponse(null, { status: 204 }));
  // The parsed projection is the allowlist: unknown keys are dropped.
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return safeResponse(503);
  return noStore(
    NextResponse.json(
      { success: true, data: parsed.data.data },
      { status: 200 },
    ),
  );
}

function tokenOf(
  request: NextRequest,
  deps: CourseHandlerDependencies,
): string | null {
  return request.cookies.get(deps.learnerCookieName)?.value || null;
}

const enrollmentPath = (code: string) =>
  `/api/v1/learning/courses/${code}/enrollment`;

/** `GET /api/learner/courses`. GET skips the Origin check. */
export async function handleCourseList(
  request: NextRequest,
  deps: CourseHandlerDependencies,
): Promise<NextResponse> {
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  return forward(
    deps,
    '/api/v1/learning/courses',
    { token },
    courseListEnvelopeSchema,
  );
}

/** `GET /api/learner/courses/:code`. */
export async function handleCourseDetail(
  request: NextRequest,
  code: string,
  deps: CourseHandlerDependencies,
): Promise<NextResponse> {
  if (!COURSE_CODE_PATTERN.test(code)) return safeResponse(404);
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  return forward(
    deps,
    `/api/v1/learning/courses/${code}`,
    { token },
    courseDetailEnvelopeSchema,
  );
}

/** `POST /api/learner/courses/:code/enrollment` (idempotent). */
export async function handleCourseEnroll(
  request: NextRequest,
  code: string,
  deps: CourseHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  if (!COURSE_CODE_PATTERN.test(code)) return safeResponse(404);
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  return forward(
    deps,
    enrollmentPath(code),
    { token, method: 'POST' },
    courseEnrollmentEnvelopeSchema,
  );
}

/** `DELETE /api/learner/courses/:code/enrollment` → `204`. */
export async function handleCourseLeave(
  request: NextRequest,
  code: string,
  deps: CourseHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  if (!COURSE_CODE_PATTERN.test(code)) return safeResponse(404);
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  return forward(deps, enrollmentPath(code), { token, method: 'DELETE' }, null);
}

async function readBody(request: NextRequest): Promise<unknown> {
  try {
    return JSON.parse(await request.text()) as unknown;
  } catch {
    return undefined;
  }
}

/** `PUT /api/learner/current-course`; the body is rebuilt from the strict parse. */
export async function handleCurrentCourse(
  request: NextRequest,
  deps: CourseHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const input = currentCourseInputSchema.safeParse(await readBody(request));
  if (!input.success) return safeResponse(400);
  const token = tokenOf(request, deps);
  if (!token) return safeResponse(401);
  return forward(
    deps,
    '/api/v1/learning/current-course',
    { token, method: 'PUT', body: { courseCode: input.data.courseCode } },
    courseEnrollmentEnvelopeSchema,
  );
}
