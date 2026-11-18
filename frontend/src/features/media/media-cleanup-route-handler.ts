import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  exactOrigin,
  failure,
  token,
} from '@/features/content/content-route-handler';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';

import { backendMediaCleanupSchema } from './media-contract';

const INGESTION_ID = /^[1-9]\d{0,9}$/u;

/**
 * BFF dọn dẹp lượt tải (M5.2b, TL-50). Thứ tự kiểm: Origin 403 → id 400 →
 * cookie 401 → backend POST không body. Giữ status thành công (201) và mã lỗi
 * backend để client hiện đúng câu; lỗi khác (kể cả phản hồi lệch) → 503.
 */
export async function handleMediaCleanup(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  if (!INGESTION_ID.test(rawId) || Number(rawId) > 2_147_483_647) {
    return failure(400);
  }
  const session = token(request);
  if (!session) return failure(401);
  try {
    const result = backendMediaCleanupSchema.parse(
      await backend.request(
        `/api/v1/admin/cms/media/ingestions/${rawId}/cleanup`,
        { token: session, method: 'POST' },
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
