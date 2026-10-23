import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '@/lib/api/api-error';

const { backendRequest } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));

import {
  EXERCISE_MAX_BODY_BYTES,
  handleExerciseArchive,
  handleExerciseCreate,
  handleExerciseRevisionAction,
  handleExerciseRevisionCreate,
} from './exercise-route-handler';

const ORIGIN = 'http://127.0.0.1:3200';
const CREATE_URL = `${ORIGIN}/api/admin/exercises`;
const REVISION_URL = `${ORIGIN}/api/admin/exercises/9/revisions`;
const REVIEW_URL = `${ORIGIN}/api/admin/exercises/9/revisions/3/reviews`;
const PUBLISH_URL = `${ORIGIN}/api/admin/exercises/9/revisions/3/publish`;
const ARCHIVE_URL = `${ORIGIN}/api/admin/exercises/9/archive`;

function post(
  url: string,
  body: string | null,
  origin = ORIGIN,
  withCookie = true,
): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      origin,
      ...(withCookie ? { cookie: 'hsk_admin_session=test-token' } : {}),
    },
    ...(body === null ? {} : { body }),
  });
}

const PAYLOAD = JSON.stringify({
  lessonId: 1,
  type: 'mcq',
  prompt: 'Chọn đáp án',
  content: { options: [{ id: 'opt-1', text: 'A' }] },
  answer: { optionId: 'opt-1' },
  explanation: null,
  orderIndex: 1,
  mediaId: null,
});

describe('Exercise BFF (M5.1b1, TL-18/TL-20)', () => {
  it('rejects a cross-origin POST with 403 before touching the backend', async () => {
    const response = await handleExerciseCreate(
      post(CREATE_URL, PAYLOAD, 'https://attacker.example'),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects a request without session cookie with 401', async () => {
    const response = await handleExerciseCreate(
      post(CREATE_URL, PAYLOAD, ORIGIN, false),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects a body over 65 536 bytes with 413 before parsing or calling the backend', async () => {
    const oversized = JSON.stringify({
      prompt: 'x'.repeat(EXERCISE_MAX_BODY_BYTES),
    });
    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(
      EXERCISE_MAX_BODY_BYTES,
    );
    const response = await handleExerciseCreate(post(CREATE_URL, oversized));
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects broken JSON with 400', async () => {
    const response = await handleExerciseCreate(post(CREATE_URL, '{ bad'));
    expect(response.status).toBe(400);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric exerciseId or revisionId with 400', async () => {
    const responses = [
      await handleExerciseRevisionCreate(
        post(`${ORIGIN}/api/admin/exercises/abc/revisions`, PAYLOAD),
        'abc',
      ),
      await handleExerciseRevisionAction(
        post(`${ORIGIN}/api/admin/exercises/abc/revisions/3/reviews`, '{}'),
        'abc',
        '3',
        'reviews',
      ),
      await handleExerciseArchive(post(ARCHIVE_URL, null), 'abc'),
    ];
    for (const response of responses) expect(response.status).toBe(400);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('forwards create and revision payloads to the right backend paths', async () => {
    backendRequest.mockResolvedValue({
      success: true,
      data: { idempotent: false, exercise: { id: 9 } },
    });
    const create = await handleExerciseCreate(post(CREATE_URL, PAYLOAD));
    expect(create.status).toBe(200);
    expect(create.headers.get('cache-control')).toBe('no-store');
    expect(backendRequest.mock.calls.at(-1)).toEqual([
      '/api/v1/admin/cms/exercises',
      expect.objectContaining({
        method: 'POST',
        token: 'test-token',
        body: JSON.parse(PAYLOAD),
      }),
    ]);

    const revision = await handleExerciseRevisionCreate(
      post(REVISION_URL, PAYLOAD),
      '9',
    );
    expect(revision.status).toBe(200);
    expect(backendRequest.mock.calls.at(-1)?.[0]).toBe(
      '/api/v1/admin/cms/exercises/9/revisions',
    );
  });

  it('sends a review body but no body for publish and archive', async () => {
    backendRequest.mockResolvedValue({
      success: true,
      data: { idempotent: true },
    });
    await handleExerciseRevisionAction(
      post(REVIEW_URL, JSON.stringify({ decision: 'approved', note: null })),
      '9',
      '3',
      'reviews',
    );
    expect(backendRequest.mock.calls.at(-1)?.[1]).toMatchObject({
      body: { decision: 'approved', note: null },
    });
    await handleExerciseRevisionAction(
      post(PUBLISH_URL, null),
      '9',
      '3',
      'publish',
    );
    expect(backendRequest.mock.calls.at(-1)?.[1]).not.toHaveProperty('body');
    await handleExerciseArchive(post(ARCHIVE_URL, null), '9');
    expect(backendRequest.mock.calls.at(-1)).toEqual([
      '/api/v1/admin/cms/exercises/9/archive',
      expect.objectContaining({ method: 'POST', token: 'test-token' }),
    ]);
    expect(backendRequest.mock.calls.at(-1)?.[1]).not.toHaveProperty('body');
  });

  it('passes a backend error code and filtered details through (TL-20)', async () => {
    backendRequest.mockRejectedValue(
      new BackendRequestError({
        status: 422,
        kind: 'validation',
        message: 'Validation failed.',
        retryable: false,
        code: 'string_required',
        details: { path: 'content.options[1].text' },
      }),
    );
    const response = await handleExerciseCreate(post(CREATE_URL, PAYLOAD));
    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const error = JSON.parse(await response.text()).error;
    expect(error.code).toBe('string_required');
    expect(error.details).toEqual({ path: 'content.options[1].text' });
  });
});
