import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

const { backendRequest } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));

import {
  handleContentArchive,
  handleContentCreate,
  handleContentRevisionAction,
  handleContentRevisionCreate,
} from './content-route-handler';

function exercisePayload() {
  return {
    type: 'mcq',
    prompt: 'Chọn lời chào đúng',
    content: {
      options: [
        { id: 'opt-1', text: '你好' },
        { id: 'opt-2', text: '再见' },
      ],
    },
    answer: { optionId: 'opt-1' },
    orderIndex: 1,
  };
}

function post(url: string, init?: { origin?: string; body?: unknown }) {
  const headers = new Headers();
  if (init?.origin) headers.set('origin', init.origin);
  headers.set('cookie', 'hsk_admin_session=test-token');
  return new NextRequest(url, {
    method: 'POST',
    headers,
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

describe('Content BFF mutation boundary (M5.1a, F4)', () => {
  it.each([undefined, 'https://attacker.example'])(
    'rejects missing or cross-origin mutation before session/backend access',
    async (origin) => {
      const response = await handleContentArchive(
        post('http://127.0.0.1:3200/api/admin/content/lessons/41/archive', {
          origin,
        }),
        'lessons',
        '41',
      );
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(backendRequest).not.toHaveBeenCalled();
    },
  );

  it('rejects non-numeric ids and unauthenticated calls', async () => {
    const badId = await handleContentRevisionCreate(
      post('http://127.0.0.1:3200/api/admin/content/lessons/abc/revisions', {
        origin: 'http://127.0.0.1:3200',
        body: { title: 'x' },
      }),
      'lessons',
      'abc',
    );
    expect(badId.status).toBe(400);

    const noSession = await handleContentRevisionAction(
      new NextRequest(
        'http://127.0.0.1:3200/api/admin/content/topics/9/revisions/3/publish',
        { method: 'POST', headers: { origin: 'http://127.0.0.1:3200' } },
      ),
      'topics',
      '9',
      '3',
      'publish',
    );
    expect(noSession.status).toBe(401);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects an unparseable JSON body with 400 before calling the backend', async () => {
    const headers = new Headers({
      origin: 'http://127.0.0.1:3200',
      cookie: 'hsk_admin_session=test-token',
      'content-type': 'application/json',
    });
    const request = new NextRequest(
      'http://127.0.0.1:3200/api/admin/content/lessons',
      { method: 'POST', headers, body: '{not json' },
    );
    const response = await handleContentCreate(request, 'lessons');
    expect(response.status).toBe(400);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('proxies create/revision/review/publish/archive to the matching backend path', async () => {
    backendRequest.mockResolvedValue({
      success: true,
      data: { idempotent: false, lesson: { id: 41 } },
    });
    const cases: [() => Promise<Response>, string, unknown][] = [
      [
        () =>
          handleContentCreate(
            post('http://127.0.0.1:3200/api/admin/content/lessons', {
              origin: 'http://127.0.0.1:3200',
              body: { levelId: 1, title: 'Chào hỏi' },
            }),
            'lessons',
          ),
        '/api/v1/admin/cms/lessons',
        { levelId: 1, title: 'Chào hỏi' },
      ],
      [
        () =>
          handleContentRevisionCreate(
            post('http://127.0.0.1:3200/api/admin/content/topics/9/revisions', {
              origin: 'http://127.0.0.1:3200',
              body: { title: 'Từ vựng' },
            }),
            'topics',
            '9',
          ),
        '/api/v1/admin/cms/topics/9/revisions',
        { title: 'Từ vựng' },
      ],
      [
        () =>
          handleContentRevisionAction(
            post(
              'http://127.0.0.1:3200/api/admin/content/lessons/41/revisions/7/reviews',
              {
                origin: 'http://127.0.0.1:3200',
                body: { decision: 'approved' },
              },
            ),
            'lessons',
            '41',
            '7',
            'reviews',
          ),
        '/api/v1/admin/cms/lessons/41/revisions/7/reviews',
        { decision: 'approved' },
      ],
      [
        () =>
          handleContentRevisionAction(
            post(
              'http://127.0.0.1:3200/api/admin/content/lessons/41/revisions/7/publish',
              { origin: 'http://127.0.0.1:3200' },
            ),
            'lessons',
            '41',
            '7',
            'publish',
          ),
        '/api/v1/admin/cms/lessons/41/revisions/7/publish',
        undefined,
      ],
      [
        () =>
          handleContentArchive(
            post('http://127.0.0.1:3200/api/admin/content/topics/9/archive', {
              origin: 'http://127.0.0.1:3200',
            }),
            'topics',
            '9',
          ),
        '/api/v1/admin/cms/topics/9/archive',
        undefined,
      ],
    ];
    for (const [run, path, body] of cases) {
      const response = await run();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const call = backendRequest.mock.calls.at(-1);
      expect(call?.[0]).toBe(path);
      expect(call?.[1]).toMatchObject({ method: 'POST' });
      if (body === undefined) {
        expect(call?.[1]).not.toHaveProperty('body');
      } else {
        expect(call?.[1]).toMatchObject({ body });
      }
    }
  });

  it('proxies exercise mutations to the same backend CMS paths (M5.1b1, F3)', async () => {
    backendRequest.mockClear();
    backendRequest.mockResolvedValue({
      success: true,
      data: { idempotent: false, exercise: { id: 41 } },
    });
    const cases: [() => Promise<Response>, string, unknown][] = [
      [
        () =>
          handleContentCreate(
            post('http://127.0.0.1:3200/api/admin/exercises', {
              origin: 'http://127.0.0.1:3200',
              body: { lessonId: 7, ...exercisePayload() },
            }),
            'exercises',
          ),
        '/api/v1/admin/cms/exercises',
        { lessonId: 7, ...exercisePayload() },
      ],
      [
        () =>
          handleContentRevisionCreate(
            post('http://127.0.0.1:3200/api/admin/exercises/41/revisions', {
              origin: 'http://127.0.0.1:3200',
              body: exercisePayload(),
            }),
            'exercises',
            '41',
          ),
        '/api/v1/admin/cms/exercises/41/revisions',
        exercisePayload(),
      ],
      [
        () =>
          handleContentRevisionAction(
            post(
              'http://127.0.0.1:3200/api/admin/exercises/41/revisions/7/reviews',
              {
                origin: 'http://127.0.0.1:3200',
                body: { decision: 'approved' },
              },
            ),
            'exercises',
            '41',
            '7',
            'reviews',
          ),
        '/api/v1/admin/cms/exercises/41/revisions/7/reviews',
        { decision: 'approved' },
      ],
      [
        () =>
          handleContentRevisionAction(
            post(
              'http://127.0.0.1:3200/api/admin/exercises/41/revisions/7/publish',
              { origin: 'http://127.0.0.1:3200' },
            ),
            'exercises',
            '41',
            '7',
            'publish',
          ),
        '/api/v1/admin/cms/exercises/41/revisions/7/publish',
        undefined,
      ],
      [
        () =>
          handleContentArchive(
            post('http://127.0.0.1:3200/api/admin/exercises/41/archive', {
              origin: 'http://127.0.0.1:3200',
            }),
            'exercises',
            '41',
          ),
        '/api/v1/admin/cms/exercises/41/archive',
        undefined,
      ],
    ];
    for (const [run, path, body] of cases) {
      const response = await run();
      expect(response.status).toBe(200);
      const call = backendRequest.mock.calls.at(-1);
      expect(call?.[0]).toBe(path);
      if (body === undefined) {
        expect(call?.[1]).not.toHaveProperty('body');
      } else {
        expect(call?.[1]).toMatchObject({ body });
      }
    }
    expect(backendRequest).toHaveBeenCalledTimes(cases.length);
  });

  it('forwards only the filtered error details of a backend 422 (M5.1b1, F1/TL-20)', async () => {
    backendRequest.mockRejectedValueOnce(
      new BackendRequestError({
        status: 422,
        kind: 'validation',
        message: 'LessonExercise validation failed at content.options[1].text.',
        retryable: false,
        code: 'non_empty_string_required',
        details: {
          path: 'content.options[1].text',
          errors: [{ rowNumber: 2, code: 'missing_field', path: 'answer' }],
        },
      }),
    );
    const response = await handleContentRevisionCreate(
      post('http://127.0.0.1:3200/api/admin/exercises/41/revisions', {
        origin: 'http://127.0.0.1:3200',
        body: exercisePayload(),
      }),
      'exercises',
      '41',
    );
    expect(response.status).toBe(422);
    expect(JSON.parse(await response.text())).toMatchObject({
      success: false,
      error: {
        code: 'non_empty_string_required',
        details: {
          path: 'content.options[1].text',
          errors: [{ rowNumber: 2, code: 'missing_field', path: 'answer' }],
        },
      },
    });
  });

  it('preserves the backend 409 error.code for the client message map (TL-14)', async () => {
    backendRequest.mockRejectedValueOnce(
      new BackendRequestError({
        status: 409,
        kind: 'conflict',
        message: 'Lesson requires at least one published Topic or Story.',
        retryable: false,
        code: 'LESSON_NO_PUBLISHED_CHILD',
      }),
    );
    const response = await handleContentRevisionAction(
      post(
        'http://127.0.0.1:3200/api/admin/content/lessons/41/revisions/7/publish',
        { origin: 'http://127.0.0.1:3200' },
      ),
      'lessons',
      '41',
      '7',
      'publish',
    );
    expect(response.status).toBe(409);
    expect(JSON.parse(await response.text())).toMatchObject({
      success: false,
      error: { status: 409, code: 'LESSON_NO_PUBLISHED_CHILD' },
    });
  });

  it('maps non-conflict backend failures to their status without a code', async () => {
    backendRequest.mockRejectedValueOnce(
      new BackendRequestError({
        status: 503,
        kind: 'unavailable',
        message: 'The service is temporarily unavailable.',
        retryable: true,
      }),
    );
    const response = await handleContentArchive(
      post('http://127.0.0.1:3200/api/admin/content/lessons/41/archive', {
        origin: 'http://127.0.0.1:3200',
      }),
      'lessons',
      '41',
    );
    expect(response.status).toBe(503);
    expect(JSON.parse(await response.text()).error).not.toHaveProperty('code');
  });

  // R4 (M5.1b1 A'): lesson/topic cũng đi qua đường chuyển tiếp details đã lọc.
  it.each([409, 422])(
    'forwards only the filtered details of a lesson %i error (R4)',
    async (status) => {
      backendRequest.mockClear();
      backendRequest.mockRejectedValueOnce(
        new BackendRequestError(
          normalizeApiFailure({
            status,
            body: {
              success: false,
              error: {
                code:
                  status === 409
                    ? 'CONTENT_ARCHIVED'
                    : 'non_empty_string_required',
                message: 'raw backend message',
                details: {
                  path: 'content.options[1].text',
                  errors: [
                    { rowNumber: 2, code: 'missing_field', path: 'answer' },
                    { rowNumber: '2', code: 'bad_row', path: 'answer' },
                  ],
                  sql: 'SELECT answer FROM LessonExercise',
                  stack: 'secret stack',
                  metadata: { authorId: 7 },
                },
              },
            },
          }),
        ),
      );
      const response = await handleContentRevisionCreate(
        post('http://127.0.0.1:3200/api/admin/content/lessons/41/revisions', {
          origin: 'http://127.0.0.1:3200',
          body: { title: 'x' },
        }),
        'lessons',
        '41',
      );
      expect(response.status).toBe(status);
      const payload = JSON.parse(await response.text()) as {
        error: { details?: unknown };
      };
      expect(payload.error.details).toEqual({
        path: 'content.options[1].text',
        errors: [{ rowNumber: 2, code: 'missing_field', path: 'answer' }],
      });
      expect(JSON.stringify(payload)).not.toContain('SELECT answer');
      expect(JSON.stringify(payload)).not.toContain('secret stack');
    },
  );
});
