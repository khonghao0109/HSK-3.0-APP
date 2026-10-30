import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { backendContentMutationSchema } from '@/features/content/content-contract';
import {
  exactOrigin,
  failure,
  numericId,
  token,
} from '@/features/content/content-route-handler';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';

/**
 * BFF exercise (M5.1b1, TL-18/TL-21): POST-only, giới hạn body 65 536 byte
 * trước khi parse JSON như validator backend (TL-20 `payload_too_large`).
 *
 * Khác `content-route-handler.proxy` ở chỗ đọc text để đo byte: `request.json()`
 * đã parse xong mới biết kích thước. Mọi kiểm tra khác dùng lại helper của
 * content (origin, cookie, numeric id, envelope lỗi).
 */
export const EXERCISE_MAX_BODY_BYTES = 65_536;

async function proxy(
  request: NextRequest,
  path: string,
  withBody: boolean,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const session = token(request);
  if (!session) return failure(401);
  let body: unknown;
  if (withBody) {
    let text: string;
    try {
      text = await request.text();
    } catch {
      return failure(400);
    }
    if (Buffer.byteLength(text, 'utf8') > EXERCISE_MAX_BODY_BYTES) {
      return failure(413);
    }
    try {
      body = JSON.parse(text);
    } catch {
      return failure(400);
    }
  }
  try {
    const response = backendContentMutationSchema.parse(
      await backend.request(path, {
        token: session,
        method: 'POST',
        ...(withBody ? { body } : {}),
      }),
    );
    const result = NextResponse.json(response);
    result.headers.set('cache-control', 'no-store');
    return result;
  } catch (error) {
    // F1: chỉ `code`/`details` đã lọc của BackendRequestError đi tiếp.
    return failure(
      error instanceof BackendRequestError ? error.status : 503,
      error instanceof BackendRequestError ? error.code : undefined,
      error instanceof BackendRequestError ? error.details : undefined,
    );
  }
}

/** POST /admin/cms/exercises — tạo bài tập (kèm bản sửa 1). */
export async function handleExerciseCreate(
  request: NextRequest,
): Promise<NextResponse> {
  return proxy(request, '/api/v1/admin/cms/exercises', true);
}

/** POST /admin/cms/exercises/:id/revisions — sửa = tạo bản sửa mới. */
export async function handleExerciseRevisionCreate(
  request: NextRequest,
  exerciseId: string,
): Promise<NextResponse> {
  if (!numericId(exerciseId)) return failure(400);
  return proxy(
    request,
    `/api/v1/admin/cms/exercises/${exerciseId}/revisions`,
    true,
  );
}

/** POST /admin/cms/exercises/:id/revisions/:rid/{reviews|publish}. */
export async function handleExerciseRevisionAction(
  request: NextRequest,
  exerciseId: string,
  revisionId: string,
  action: 'reviews' | 'publish',
): Promise<NextResponse> {
  if (!numericId(exerciseId) || !numericId(revisionId)) return failure(400);
  return proxy(
    request,
    `/api/v1/admin/cms/exercises/${exerciseId}/revisions/${revisionId}/${action}`,
    action === 'reviews',
  );
}

/** POST /admin/cms/exercises/:id/archive — thao tác huỷ duy nhất (Q91). */
export async function handleExerciseArchive(
  request: NextRequest,
  exerciseId: string,
): Promise<NextResponse> {
  if (!numericId(exerciseId)) return failure(400);
  return proxy(
    request,
    `/api/v1/admin/cms/exercises/${exerciseId}/archive`,
    false,
  );
}
