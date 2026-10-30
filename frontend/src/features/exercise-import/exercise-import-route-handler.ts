import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  exactOrigin,
  failure,
  token,
} from '@/features/content/content-route-handler';
import { IDEMPOTENCY_KEY_PATTERN } from '@/features/learner-lesson/lesson-player-model';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';

import {
  exerciseImportCommitSchema,
  exerciseImportPreviewEnvelopeSchema,
  importRowErrorSchema,
} from './exercise-import-contract';
import {
  EXERCISE_IMPORT_BFF_MAX_BYTES,
  EXERCISE_IMPORT_MAX_DISPLAYED_ERRORS,
} from './exercise-import-values';

/**
 * BFF nhập bài tập (M5.1b2, TL-27/TL-30; Z1/Z12): thứ tự kiểm thật là
 * Origin 403 → cookie 401 → Content-Length/body 413 → JSON 400 →
 * (commit: key 400) → backend. Chỉ `code`/`details` đã lọc của
 * BackendRequestError đi tiếp (TL-31 để client map 422 và giữ details.errors).
 */
const PREVIEW_PATH = '/api/v1/admin/cms/exercise-imports/preview';
const COMMIT_PATH = '/api/v1/admin/cms/exercise-imports';

/** Z10: mã máy của lỗi thiếu/sai Idempotency-Key để client/e2e khẳng định. */
export const INVALID_IDEMPOTENCY_KEY = 'INVALID_IDEMPOTENCY_KEY';

type BodyResult =
  { ok: true; body: unknown } | { ok: false; response: NextResponse };

function tooLarge(): NextResponse {
  return failure(413);
}

async function readBody(request: NextRequest): Promise<BodyResult> {
  // Z12: header Content-Length khai báo quá lớn → 413 trước khi đọc body.
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes > EXERCISE_IMPORT_BFF_MAX_BYTES
    ) {
      return { ok: false, response: tooLarge() };
    }
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: failure(400) };
  }
  // Giữ kiểm sau khi đọc cho request không có Content-Length.
  if (Buffer.byteLength(text, 'utf8') > EXERCISE_IMPORT_BFF_MAX_BYTES) {
    return { ok: false, response: tooLarge() };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: failure(400) };
  }
}

function noStore(payload: unknown): NextResponse {
  const response = NextResponse.json(payload);
  response.headers.set('cache-control', 'no-store');
  return response;
}

function relay(error: unknown): NextResponse {
  if (error instanceof BackendRequestError) {
    return failure(error.status, error.code, error.details);
  }
  return failure(503);
}

async function forwardPreview(
  session: string,
  body: unknown,
): Promise<NextResponse> {
  try {
    const envelope = exerciseImportPreviewEnvelopeSchema.parse(
      await backend.request(PREVIEW_PATH, {
        token: session,
        method: 'POST',
        body,
      }),
    );
    // Z1: validate từng lỗi (shape/length), giữ thứ tự backend, cắt 100 đầu.
    const errors = envelope.data.errors.map((entry) =>
      importRowErrorSchema.parse(entry),
    );
    return noStore({
      success: true,
      data: {
        ...envelope.data,
        errors: errors.slice(0, EXERCISE_IMPORT_MAX_DISPLAYED_ERRORS),
        errorsTotal: errors.length,
      },
    });
  } catch (error) {
    return relay(error);
  }
}

async function forwardCommit(
  session: string,
  body: unknown,
  idempotencyKey: string,
): Promise<NextResponse> {
  try {
    const parsed = exerciseImportCommitSchema.parse(
      await backend.request(COMMIT_PATH, {
        token: session,
        method: 'POST',
        body,
        idempotencyKey,
      }),
    );
    return noStore(parsed);
  } catch (error) {
    return relay(error);
  }
}

export async function handleExerciseImportPreview(
  request: NextRequest,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const session = token(request);
  if (!session) return failure(401);
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  return forwardPreview(session, parsed.body);
}

export async function handleExerciseImportCommit(
  request: NextRequest,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const session = token(request);
  if (!session) return failure(401);
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return failure(400, INVALID_IDEMPOTENCY_KEY);
  }
  return forwardCommit(session, parsed.body, idempotencyKey);
}
