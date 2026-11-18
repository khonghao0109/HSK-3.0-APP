import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  exactOrigin,
  failure,
  token,
} from '@/features/content/content-route-handler';
import { INVALID_IDEMPOTENCY_KEY } from '@/features/exercise-import/exercise-import-route-handler';
import {
  MEDIA_IDEMPOTENCY_KEY_PATTERN,
  MEDIA_UPLOAD_BFF_MAX_BYTES,
} from '@/features/media-upload/media-upload-values';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';

import { backendMediaIngestionSchema } from './media-contract';

const MULTIPART = /^multipart\/form-data;.*\bboundary=[^\s;]+/iu;
const POSITIVE_INT = /^[1-9]\d{0,9}$/u;

/**
 * BFF tải media (M5.2a, TL-40). Thứ tự kiểm: Origin 403 → cookie 401 →
 * content-type 415 → Content-Length 411/413 (trước khi đọc) → key 400 →
 * dataSourceId 400 → đọc body, kiểm lại 413 và độ dài khớp Content-Length
 * (400 UPLOAD_BODY_INCOMPLETE) → backend. Chỉ chuyển tiếp
 * content-type, idempotency-key và bearer.
 */
export async function handleMediaUpload(
  request: NextRequest,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const session = token(request);
  if (!session) return failure(401);
  const contentType = request.headers.get('content-type') ?? '';
  if (!MULTIPART.test(contentType)) return failure(415, 'MULTIPART_INVALID');
  const declared = request.headers.get('content-length');
  if (declared === null || !/^\d+$/u.test(declared)) return failure(411);
  if (Number(declared) > MEDIA_UPLOAD_BFF_MAX_BYTES) {
    return failure(413, 'UPLOAD_TOO_LARGE');
  }
  const idempotencyKey = request.headers.get('idempotency-key') ?? '';
  if (!MEDIA_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return failure(400, INVALID_IDEMPOTENCY_KEY);
  }
  const dataSourceId = request.nextUrl.searchParams.get('dataSourceId') ?? '';
  if (
    !POSITIVE_INT.test(dataSourceId) ||
    Number(dataSourceId) > 2_147_483_647 ||
    request.nextUrl.searchParams.size !== 1
  ) {
    return failure(400);
  }
  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return failure(400, 'MULTIPART_INVALID');
  }
  if (body.byteLength > MEDIA_UPLOAD_BFF_MAX_BYTES) {
    return failure(413, 'UPLOAD_TOO_LARGE');
  }
  // V1: body bị cắt (proxy, kết nối) thì backend sẽ nhận multipart hỏng.
  if (body.byteLength !== Number(declared)) {
    return failure(400, 'UPLOAD_BODY_INCOMPLETE');
  }
  try {
    const result = backendMediaIngestionSchema.parse(
      await backend.upload(
        `/api/v1/admin/cms/media/ingestions?dataSourceId=${dataSourceId}`,
        { token: session, idempotencyKey, contentType, body },
      ),
    );
    const response = NextResponse.json(result, { status: 201 });
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof BackendRequestError) {
      return failure(error.status, error.code);
    }
    return failure(503);
  }
}
