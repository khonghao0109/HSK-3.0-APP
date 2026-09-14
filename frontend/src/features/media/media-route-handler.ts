import { NextRequest, NextResponse } from 'next/server';

import { normalizeApiFailure } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import {
  backendMediaDetailSchema,
  backendMediaListSchema,
  backendMediaMutationSchema,
} from './media-contract';
import { parseMediaQuery, serializeMediaQuery } from './media-query';

function status(error: unknown): number {
  return typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
    ? error.status
    : 503;
}

function failure(statusCode: number) {
  const response = NextResponse.json(
    { success: false, error: normalizeApiFailure({ status: statusCode }) },
    { status: statusCode },
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}

function token(request: NextRequest): string | null {
  return request.cookies.get(serverEnv.SESSION_COOKIE_NAME)?.value ?? null;
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

export async function handleMediaList(request: NextRequest) {
  const session = token(request);
  if (!session) return failure(401);
  const query = parseMediaQuery(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  try {
    const response = backendMediaListSchema.parse(
      await backend.request(
        `/api/v1/admin/cms/media?${serializeMediaQuery(query).toString()}`,
        { token: session },
      ),
    );
    const result = NextResponse.json(response);
    result.headers.set('cache-control', 'no-store');
    return result;
  } catch (error) {
    return failure(status(error));
  }
}

export async function handleMediaDetail(request: NextRequest, mediaId: string) {
  if (!/^\d+$/u.test(mediaId)) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  try {
    const response = backendMediaDetailSchema.parse(
      await backend.request(`/api/v1/admin/cms/media/${mediaId}`, {
        token: session,
      }),
    );
    const result = NextResponse.json(response);
    result.headers.set('cache-control', 'no-store');
    return result;
  } catch (error) {
    return failure(status(error));
  }
}

export async function handleMediaMutation(
  request: NextRequest,
  mediaId: string,
  operation: 'archive' | 'quarantine',
) {
  if (!exactOrigin(request)) return failure(403);
  if (!/^\d+$/u.test(mediaId)) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  try {
    const response = backendMediaMutationSchema.parse(
      await backend.request(`/api/v1/admin/cms/media/${mediaId}/${operation}`, {
        token: session,
        method: 'POST',
      }),
    );
    const result = NextResponse.json(response);
    result.headers.set('cache-control', 'no-store');
    return result;
  } catch (error) {
    return failure(status(error));
  }
}
