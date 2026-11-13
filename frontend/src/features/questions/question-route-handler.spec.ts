import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '@/lib/api/api-error';

const { backendRequest } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));

import {
  handleQuestionArchive,
  handleQuestionCreate,
  handleQuestionRevisionAction,
  handleQuestionRevisionCreate,
} from './question-route-handler';

const ORIGIN = 'http://127.0.0.1:3200';
const CREATE_URL = `${ORIGIN}/api/admin/questions`;
const REVIEW_URL = `${ORIGIN}/api/admin/questions/9/revisions/3/reviews`;
const PUBLISH_URL = `${ORIGIN}/api/admin/questions/9/revisions/3/publish`;
const ARCHIVE_URL = `${ORIGIN}/api/admin/questions/9/archive`;

function post(
  url: string,
  body: string | null,
  options: { origin?: string; cookie?: boolean } = {},
): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      origin: options.origin ?? ORIGIN,
      ...(options.cookie === false
        ? {}
        : { cookie: 'hsk_admin_session=test-token' }),
    },
    ...(body === null ? {} : { body }),
  });
}

const PAYLOAD = JSON.stringify({
  type: 'mcq',
  skill: 'reading',
  levelId: 1,
  content: 'Chọn đáp án',
  answers: { options: [{ id: 'opt-1', text: 'A' }] },
  correctAnswer: { optionId: 'opt-1' },
  explanation: null,
  objective: null,
  difficulty: 2,
  audioId: null,
  imageId: null,
  tags: ['Gia đình'],
});

describe('Question BFF (M4.1a, TL-88)', () => {
  beforeEach(() => {
    backendRequest.mockReset();
  });

  it('rejects cross-origin and missing-session requests before the backend', async () => {
    expect(
      (
        await handleQuestionCreate(
          post(CREATE_URL, PAYLOAD, { origin: 'https://attacker.example' }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handleQuestionCreate(post(CREATE_URL, PAYLOAD, { cookie: false })))
        .status,
    ).toBe(401);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects non-positive, too-large and non-numeric ids with 400', async () => {
    for (const id of ['0', '-1', 'abc', '2147483648', '1.5']) {
      expect(
        (
          await handleQuestionRevisionCreate(
            post(`${ORIGIN}/api/admin/questions/${id}/revisions`, PAYLOAD),
            id,
          )
        ).status,
      ).toBe(400);
    }
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('forwards only allowlisted body keys and rejects non-object bodies', async () => {
    backendRequest.mockResolvedValueOnce({
      success: true,
      data: {
        idempotent: false,
        question: { id: 9, status: 'draft', version: 1 },
      },
    });
    const response = await handleQuestionCreate(
      post(
        CREATE_URL,
        JSON.stringify({
          ...JSON.parse(PAYLOAD),
          secret: 'AUTHORITATIVEANSWERSECRET',
          lessonId: 1,
        }),
      ),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backendRequest).toHaveBeenCalledTimes(1);
    const [path, options] = backendRequest.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(path).toBe('/api/v1/admin/cms/questions');
    expect(options.body).not.toHaveProperty('secret');
    expect(options.body).not.toHaveProperty('lessonId');
    expect(options.body).toMatchObject({
      type: 'mcq',
      skill: 'reading',
      levelId: 1,
    });

    for (const body of ['[]', 'null', 'not-json']) {
      expect((await handleQuestionCreate(post(CREATE_URL, body))).status).toBe(
        400,
      );
    }
  });

  it('rebuilds the review body from decision and note only', async () => {
    backendRequest.mockResolvedValueOnce({
      success: true,
      data: { idempotent: false, revision: { id: 3, revision: 1 } },
    });
    const response = await handleQuestionRevisionAction(
      post(
        REVIEW_URL,
        JSON.stringify({ decision: 'approved', note: 'Ổn', secret: true }),
      ),
      '9',
      '3',
      'reviews',
    );
    expect(response.status).toBe(201);
    const [, options] = backendRequest.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(options.body).toEqual({ decision: 'approved', note: 'Ổn' });

    expect(
      (
        await handleQuestionRevisionAction(
          post(REVIEW_URL, JSON.stringify({ note: 'thiếu decision' })),
          '9',
          '3',
          'reviews',
        )
      ).status,
    ).toBe(400);
  });

  it('sends no body for publish/archive and forwards 409 reasons to the browser', async () => {
    backendRequest.mockResolvedValueOnce({
      success: true,
      data: {
        idempotent: true,
        question: { id: 9, status: 'published', version: 1 },
      },
    });
    await handleQuestionRevisionAction(
      post(PUBLISH_URL, null),
      '9',
      '3',
      'publish',
    );
    expect(
      (backendRequest.mock.calls[0] as [string, { body?: unknown }])[1].body,
    ).toBeUndefined();

    backendRequest.mockResolvedValueOnce({
      success: true,
      data: {
        idempotent: true,
        question: { id: 9, status: 'archived', version: 1 },
      },
    });
    await handleQuestionArchive(post(ARCHIVE_URL, null), '9');
    expect(
      (backendRequest.mock.calls[1] as [string, { body?: unknown }])[1].body,
    ).toBeUndefined();

    backendRequest.mockRejectedValueOnce(
      new BackendRequestError({
        status: 409,
        kind: 'conflict',
        message: 'conflict',
        retryable: false,
        code: 'QUESTION_NOT_PUBLISHABLE',
        details: {
          reasons: [{ code: 'explanation_required', field: 'explanation' }],
        },
      }),
    );
    const blocked = await handleQuestionRevisionAction(
      post(PUBLISH_URL, null),
      '9',
      '3',
      'publish',
    );
    expect(blocked.status).toBe(409);
    expect(blocked.headers.get('cache-control')).toBe('no-store');
    const body = (await blocked.json()) as {
      error: { code: string; details: { reasons: unknown } };
    };
    expect(body.error.code).toBe('QUESTION_NOT_PUBLISHABLE');
    expect(body.error.details.reasons).toEqual([
      { code: 'explanation_required', field: 'explanation' },
    ]);
  });
});
