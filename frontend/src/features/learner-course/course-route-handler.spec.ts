import { NextRequest, type NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';
import { getRefreshCookieName } from '@/lib/auth/session-cookie';

import {
  type CourseHandlerDependencies,
  handleCourseDetail,
  handleCourseEnroll,
  handleCourseLeave,
  handleCourseList,
  handleCurrentCourse,
} from './course-route-handler';

const appOrigin = 'http://127.0.0.1:3200';
const learnerCookieName = 'hsk_learner_session';
const meta = { requestId: 'r', timestamp: 't' };

const summary = {
  code: 'HSK3_TOPIC',
  kind: 'topic',
  curriculumVersion: 'HSK_3_0',
  title: 'Chủ đề HSK 3.0',
  description: null,
  enrolled: true,
  isCurrent: true,
  progress: { completedLessons: 2, totalLessons: 10 },
  orderIndex: 1,
};
const enrollment = {
  courseCode: 'HSK3_TOPIC',
  status: 'active',
  isCurrent: true,
  enrolledAt: '2026-11-24T00:00:00.000Z',
  leftAt: null,
  userId: 5,
};

type Backend = CourseHandlerDependencies['requestBackend'];

function deps(requestBackend: Backend): CourseHandlerDependencies {
  return { appOrigin, learnerCookieName, production: false, requestBackend };
}

function backendError(status: number, code?: string) {
  return new BackendRequestError(
    normalizeApiFailure({
      status,
      body:
        code === undefined
          ? null
          : {
              success: false,
              error: { code, message: 'x', details: { secret: 1 } },
            },
    }),
  );
}

function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    origin?: string | null;
    cookie?: boolean;
  } = {},
) {
  const headers = new Headers();
  if (options.origin !== null)
    headers.set('origin', options.origin ?? appOrigin);
  if (options.cookie !== false)
    headers.set('cookie', `${learnerCookieName}=learner-token`);
  const body =
    options.rawBody ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(new URL(path, appOrigin), {
    method: options.method ?? 'GET',
    headers,
    body,
  });
}

async function expectStatus(response: NextResponse, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return status === 204
    ? null
    : ((await response.json()) as Record<string, unknown>);
}

describe('course BFF route handlers (ADR-009 C3b-UI, A.7c)', () => {
  it('lists courses and drops fields outside the contract', async () => {
    const backend = vi
      .fn<Backend>()
      .mockResolvedValue({ success: true, data: { courses: [summary] }, meta });
    const body = await expectStatus(
      await handleCourseList(request('/api/learner/courses'), deps(backend)),
      200,
    );
    expect(backend).toHaveBeenCalledWith('/api/v1/learning/courses', {
      token: 'learner-token',
    });
    expect(body).toEqual({
      success: true,
      data: {
        courses: [
          {
            code: 'HSK3_TOPIC',
            kind: 'topic',
            curriculumVersion: 'HSK_3_0',
            title: 'Chủ đề HSK 3.0',
            description: null,
            enrolled: true,
            isCurrent: true,
            progress: { completedLessons: 2, totalLessons: 10 },
          },
        ],
      },
    });
  });

  it('reads a course detail with its units and lessons', async () => {
    const unit = {
      orderIndex: 1,
      title: 'Cấp 1',
      gradeNumber: null,
      volume: null,
      levelCode: 'HSK1',
      lessons: [
        {
          id: 9,
          title: 'Chào hỏi',
          slug: 'chao-hoi',
          position: 1,
          state: 'current',
          completionPercent: 40,
          orderIndex: 3,
        },
      ],
    };
    const backend = vi.fn<Backend>().mockResolvedValue({
      success: true,
      data: { ...summary, units: [unit] },
      meta,
    });
    const body = await expectStatus(
      await handleCourseDetail(
        request('/api/learner/courses/HSK3_TOPIC'),
        'HSK3_TOPIC',
        deps(backend),
      ),
      200,
    );
    expect(backend).toHaveBeenCalledWith(
      '/api/v1/learning/courses/HSK3_TOPIC',
      { token: 'learner-token' },
    );
    const data = body?.data as { units: Array<{ lessons: object[] }> };
    expect(data.units[0]?.lessons[0]).not.toHaveProperty('orderIndex');
    expect(data).not.toHaveProperty('orderIndex');
  });

  it('rejects a malformed course code before calling the backend', async () => {
    const backend = vi.fn<Backend>();
    for (const code of ['hsk3_topic', 'AB', 'HSK3/../x', 'A'.repeat(41)]) {
      await expectStatus(
        await handleCourseDetail(
          request('/api/learner/courses/x'),
          code,
          deps(backend),
        ),
        404,
      );
      await expectStatus(
        await handleCourseEnroll(
          request('/api/learner/courses/x/enrollment', { method: 'POST' }),
          code,
          deps(backend),
        ),
        404,
      );
    }
    expect(backend).not.toHaveBeenCalled();
  });

  it('enrolls and leaves with a same-origin write', async () => {
    const backend = vi
      .fn<Backend>()
      .mockResolvedValueOnce({ success: true, data: enrollment, meta })
      .mockResolvedValueOnce(null);
    const enrolled = await expectStatus(
      await handleCourseEnroll(
        request('/api/learner/courses/HSK3_TOPIC/enrollment', {
          method: 'POST',
        }),
        'HSK3_TOPIC',
        deps(backend),
      ),
      200,
    );
    expect(enrolled?.data).not.toHaveProperty('userId');
    await expectStatus(
      await handleCourseLeave(
        request('/api/learner/courses/HSK3_TOPIC/enrollment', {
          method: 'DELETE',
        }),
        'HSK3_TOPIC',
        deps(backend),
      ),
      204,
    );
    expect(backend.mock.calls).toEqual([
      [
        '/api/v1/learning/courses/HSK3_TOPIC/enrollment',
        { token: 'learner-token', method: 'POST' },
      ],
      [
        '/api/v1/learning/courses/HSK3_TOPIC/enrollment',
        { token: 'learner-token', method: 'DELETE' },
      ],
    ]);
  });

  it('sets the current course from a strictly parsed body', async () => {
    const backend = vi
      .fn<Backend>()
      .mockResolvedValue({ success: true, data: enrollment, meta });
    await expectStatus(
      await handleCurrentCourse(
        request('/api/learner/current-course', {
          method: 'PUT',
          body: { courseCode: 'HSK3_TOPIC' },
        }),
        deps(backend),
      ),
      200,
    );
    expect(backend).toHaveBeenCalledWith('/api/v1/learning/current-course', {
      token: 'learner-token',
      method: 'PUT',
      body: { courseCode: 'HSK3_TOPIC' },
    });

    const bad = vi.fn<Backend>();
    for (const input of [
      { rawBody: '{' },
      { body: {} },
      { body: { courseCode: 'hsk' } },
      { body: { courseCode: 'HSK3_TOPIC', extra: 1 } },
    ]) {
      await expectStatus(
        await handleCurrentCourse(
          request('/api/learner/current-course', { method: 'PUT', ...input }),
          deps(bad),
        ),
        400,
      );
    }
    expect(bad).not.toHaveBeenCalled();
  });

  it('refuses cross-origin writes and missing sessions', async () => {
    const backend = vi.fn<Backend>();
    await expectStatus(
      await handleCurrentCourse(
        request('/api/learner/current-course', {
          method: 'PUT',
          body: { courseCode: 'HSK3_TOPIC' },
          origin: 'https://evil.example',
        }),
        deps(backend),
      ),
      403,
    );
    await expectStatus(
      await handleCourseLeave(
        request('/api/learner/courses/HSK3_TOPIC/enrollment', {
          method: 'DELETE',
          origin: null,
        }),
        'HSK3_TOPIC',
        deps(backend),
      ),
      403,
    );
    await expectStatus(
      await handleCourseList(
        request('/api/learner/courses', { cookie: false }),
        deps(backend),
      ),
      401,
    );
    expect(backend).not.toHaveBeenCalled();
  });

  it('maps backend failures without leaking details', async () => {
    const cases: Array<[number, string | undefined, number]> = [
      [404, 'NOT_FOUND', 404],
      [400, 'REQUEST_VALIDATION_FAILED', 400],
      [429, undefined, 429],
      [500, undefined, 503],
      [409, 'CONFLICT', 503],
    ];
    for (const [status, code, expected] of cases) {
      const backend = vi
        .fn<Backend>()
        .mockRejectedValue(backendError(status, code));
      const body = await expectStatus(
        await handleCourseDetail(
          request('/api/learner/courses/HSK3_TOPIC'),
          'HSK3_TOPIC',
          deps(backend),
        ),
        expected,
      );
      expect(JSON.stringify(body)).not.toContain('secret');
    }
  });

  it('clears the session cookies on 401 and on 403', async () => {
    for (const status of [401, 403]) {
      const backend = vi
        .fn<Backend>()
        .mockRejectedValue(backendError(status, 'UNAUTHORIZED'));
      const response = await handleCourseList(
        request('/api/learner/courses'),
        deps(backend),
      );
      await expectStatus(response, status);
      expect(response.cookies.get(learnerCookieName)?.maxAge).toBe(0);
      expect(
        response.cookies.get(getRefreshCookieName(learnerCookieName))?.maxAge,
      ).toBe(0);
    }
  });

  it('answers 503 when the backend shape breaks the contract', async () => {
    const backend = vi.fn<Backend>().mockResolvedValue({
      success: true,
      data: { courses: [{ ...summary, kind: 'other' }] },
      meta,
    });
    await expectStatus(
      await handleCourseList(request('/api/learner/courses'), deps(backend)),
      503,
    );
  });
});
