import { NextRequest, NextResponse } from 'next/server';

import { backendContentMutationSchema } from '@/features/content/content-contract';
import { parseTopicJson } from '@/features/content/topic-json';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/content/topics — tạo chủ đề (Q90). Client gửi `contentText`
 * (chuỗi JSON thô từ textarea, không parse ở browser); route này kiểm kích
 * thước/cú pháp trước khi forward `content` đã parse cho backend. Giống
 * handleContentCreate nhưng có bước parse; handler chung không export các
 * helper nên route tự proxy (lặp tối thiểu có chủ đích — KHÔNG sửa file của
 * Pha A).
 */

function failure(
  statusCode: number,
  extras?: { code?: string; message?: string; line?: number; column?: number },
) {
  const response = NextResponse.json(
    {
      success: false,
      error: {
        ...normalizeApiFailure({ status: statusCode }),
        ...(extras?.message === undefined ? {} : { message: extras.message }),
        ...(extras?.code === undefined ? {} : { code: extras.code }),
        ...(extras?.line === undefined ? {} : { line: extras.line }),
        ...(extras?.column === undefined ? {} : { column: extras.column }),
      },
    },
    { status: statusCode },
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}

function exactOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(serverEnv.APP_ORIGIN).origin;
  } catch {
    return false;
  }
}

/** Thay `contentText` bằng `content` đã parse; lỗi Q90 trả 400 ngay. */
function withParsedContent(
  body: unknown,
): Record<string, unknown> | NextResponse {
  if (typeof body !== 'object' || body === null) return failure(400);
  const { contentText, ...rest } = body as Record<string, unknown>;
  if (typeof contentText !== 'string') return failure(400);
  const parsed = parseTopicJson(contentText);
  if (!parsed.ok) {
    if (parsed.oversize) {
      return failure(400, {
        code: 'JSON_TOO_LARGE',
        message: 'The JSON content exceeds the size limit.',
      });
    }
    return failure(400, {
      code: 'INVALID_JSON',
      message: 'Invalid JSON.',
      ...(parsed.line === undefined ? {} : { line: parsed.line }),
      ...(parsed.column === undefined ? {} : { column: parsed.column }),
    });
  }
  return { ...rest, content: parsed.value };
}

export async function POST(request: NextRequest) {
  if (!exactOrigin(request)) return failure(403);
  const session = request.cookies.get(serverEnv.SESSION_COOKIE_NAME)?.value;
  if (!session) return failure(401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(400);
  }
  const prepared = withParsedContent(body);
  if (prepared instanceof NextResponse) return prepared;
  try {
    const response = backendContentMutationSchema.parse(
      await backend.request('/api/v1/admin/cms/topics', {
        token: session,
        method: 'POST',
        body: prepared,
      }),
    );
    const result = NextResponse.json(response);
    result.headers.set('cache-control', 'no-store');
    return result;
  } catch (error) {
    return failure(
      error instanceof BackendRequestError ? error.status : 503,
      error instanceof BackendRequestError && error.code !== undefined
        ? { code: error.code }
        : undefined,
    );
  }
}
