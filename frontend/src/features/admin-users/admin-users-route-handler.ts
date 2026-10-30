import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  exactOrigin,
  failure,
  token,
} from '@/features/content/content-route-handler';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';

import { backendAdminUserMutationSchema } from './admin-users-contract';

const USER_ID = /^[1-9]\d{0,9}$/u;

function parseUserId(rawId: string): string | null {
  return USER_ID.test(rawId) && Number(rawId) <= 2_147_483_647 ? rawId : null;
}

/**
 * TL-70: thứ tự kiểm trong mỗi route là Origin 403 → id 400 → cookie 401 →
 * JSON body 400 → backend. Body được dựng lại từ đúng khoá contract nhận, không
 * chuyển nguyên object của browser sang backend.
 */
async function readJsonObject(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

async function forward(
  session: string,
  path: string,
  request: { method: 'PATCH' | 'POST'; body?: unknown },
  successStatus: number,
): Promise<NextResponse> {
  try {
    const parsed = backendAdminUserMutationSchema.parse(
      await backend.request(path, {
        token: session,
        method: request.method,
        ...(request.body === undefined ? {} : { body: request.body }),
      }),
    );
    const response = NextResponse.json(parsed, { status: successStatus });
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof BackendRequestError) {
      return failure(error.status, error.code);
    }
    return failure(503);
  }
}

/** PATCH /api/admin/users/:id/role — body `{ role: 'user' | 'admin' }`. */
export async function handleAdminUserRole(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const userId = parseUserId(rawId);
  if (!userId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  const body = await readJsonObject(request);
  if (!body) return failure(400);
  const role = body.role;
  if (role !== 'user' && role !== 'admin') return failure(400);
  return forward(
    session,
    `/api/v1/admin/users/${userId}/role`,
    { method: 'PATCH', body: { role } },
    200,
  );
}

/** POST /api/admin/users/:id/suspend — body `{ reason }` (backend trims). */
export async function handleAdminUserSuspend(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const userId = parseUserId(rawId);
  if (!userId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  const body = await readJsonObject(request);
  if (!body) return failure(400);
  const reason = body.reason;
  if (typeof reason !== 'string') return failure(400);
  return forward(
    session,
    `/api/v1/admin/users/${userId}/suspend`,
    { method: 'POST', body: { reason } },
    201,
  );
}

/** POST /api/admin/users/:id/unsuspend — không body (TL-64). */
export async function handleAdminUserUnsuspend(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const userId = parseUserId(rawId);
  if (!userId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  return forward(
    session,
    `/api/v1/admin/users/${userId}/unsuspend`,
    { method: 'POST' },
    201,
  );
}
