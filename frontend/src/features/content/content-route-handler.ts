import { NextRequest, NextResponse } from 'next/server';

import {
  BackendRequestError,
  normalizeApiFailure,
  type ApiErrorDetails,
} from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import { backendContentMutationSchema } from './content-contract';

/**
 * F3 (M5.1b1): entity của BFF content, dùng chung cho lesson/topic (M5.1a) và
 * exercises (M5.1b1). Đường dẫn backend giữ nguyên `/api/v1/admin/cms/<entity>`.
 */
export type ContentEntity = 'lessons' | 'topics' | 'exercises';

function status(error: unknown): number {
  return error instanceof BackendRequestError ? error.status : 503;
}

/**
 * Envelope lỗi BFF → browser (media-route-handler pattern), nhưng GIỮ
 * `error.code` của backend (TL-14) để client map sang câu tiếng Việt.
 */
export function failure(
  statusCode: number,
  code?: string,
  details?: ApiErrorDetails,
) {
  const response = NextResponse.json(
    {
      success: false,
      error: {
        ...normalizeApiFailure({ status: statusCode }),
        ...(code === undefined ? {} : { code }),
        ...(details === undefined ? {} : { details }),
      },
    },
    { status: statusCode },
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}

export function token(request: NextRequest): string | null {
  return request.cookies.get(serverEnv.SESSION_COOKIE_NAME)?.value ?? null;
}

export function exactOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(serverEnv.APP_ORIGIN).origin;
  } catch {
    return false;
  }
}

export function numericId(value: string): boolean {
  return /^\d+$/u.test(value);
}

export async function proxy(
  request: NextRequest,
  path: string,
  withBody: boolean,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const session = token(request);
  if (!session) return failure(401);
  let body: unknown;
  if (withBody) {
    try {
      body = await request.json();
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
    // F1: chỉ `path`/`errors` đã lọc của BackendRequestError đi tiếp ra browser.
    return failure(
      status(error),
      error instanceof BackendRequestError ? error.code : undefined,
      error instanceof BackendRequestError ? error.details : undefined,
    );
  }
}

/** POST /admin/cms/{lessons|topics} — tạo mới (kèm revision 1). */
export async function handleContentCreate(
  request: NextRequest,
  entity: ContentEntity,
): Promise<NextResponse> {
  return proxy(request, `/api/v1/admin/cms/${entity}`, true);
}

/** POST /admin/cms/{entity}/:id/revisions — sửa = tạo bản sửa mới (TL-15). */
export async function handleContentRevisionCreate(
  request: NextRequest,
  entity: ContentEntity,
  entityId: string,
): Promise<NextResponse> {
  if (!numericId(entityId)) return failure(400);
  return proxy(
    request,
    `/api/v1/admin/cms/${entity}/${entityId}/revisions`,
    true,
  );
}

/** POST /admin/cms/{entity}/:id/revisions/:rid/{reviews|publish}. */
export async function handleContentRevisionAction(
  request: NextRequest,
  entity: ContentEntity,
  entityId: string,
  revisionId: string,
  action: 'reviews' | 'publish',
): Promise<NextResponse> {
  if (!numericId(entityId) || !numericId(revisionId)) return failure(400);
  return proxy(
    request,
    `/api/v1/admin/cms/${entity}/${entityId}/revisions/${revisionId}/${action}`,
    action === 'reviews',
  );
}

/** POST /admin/cms/{entity}/:id/archive — thao tác huỷ duy nhất (Q91). */
export async function handleContentArchive(
  request: NextRequest,
  entity: ContentEntity,
  entityId: string,
): Promise<NextResponse> {
  if (!numericId(entityId)) return failure(400);
  return proxy(
    request,
    `/api/v1/admin/cms/${entity}/${entityId}/archive`,
    false,
  );
}
