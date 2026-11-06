import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  exactOrigin,
  failure,
  token,
} from '@/features/content/content-route-handler';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';

import { backendQuestionMutationSchema } from './question-contract';

/**
 * BFF ngân hàng câu hỏi (M4.1a, TL-88). Thứ tự kiểm mỗi route:
 * Origin 403 → id 400 (dạng `^[1-9]\d{0,9}$`, ≤ 2 147 483 647) → cookie 401 →
 * JSON object 400 (body ≤ 65 536 byte) → dựng lại body chỉ từ khoá hợp lệ →
 * backend → parse envelope.
 */
const POSITIVE_ID = /^[1-9]\d{0,9}$/u;
const MAX_BODY_BYTES = 65_536;

const QUESTION_REVISION_KEYS = [
  'type',
  'skill',
  'levelId',
  'content',
  'answers',
  'correctAnswer',
  'explanation',
  'objective',
  'difficulty',
  'audioId',
  'imageId',
  'tags',
] as const;

function parseId(rawId: string): string | null {
  return POSITIVE_ID.test(rawId) && Number(rawId) <= 2_147_483_647
    ? rawId
    : null;
}

async function readJsonObject(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  return body as Record<string, unknown>;
}

/** Chỉ các khoá contract nhận được chuyển sang backend. */
function pickRevisionBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of QUESTION_REVISION_KEYS) {
    if (key in body) picked[key] = body[key];
  }
  return picked;
}

async function forward(
  session: string,
  path: string,
  body?: unknown,
): Promise<NextResponse> {
  try {
    const parsed = backendQuestionMutationSchema.parse(
      await backend.request(path, {
        token: session,
        method: 'POST',
        ...(body === undefined ? {} : { body }),
      }),
    );
    const response = NextResponse.json(parsed, { status: 201 });
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof BackendRequestError) {
      return failure(error.status, error.code, error.details);
    }
    return failure(503);
  }
}

/** POST /api/admin/questions — tạo câu hỏi + bản sửa 1. */
export async function handleQuestionCreate(
  request: NextRequest,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const session = token(request);
  if (!session) return failure(401);
  const body = await readJsonObject(request);
  if (!body) return failure(400);
  return forward(
    session,
    '/api/v1/admin/cms/questions',
    pickRevisionBody(body),
  );
}

/** POST /api/admin/questions/:id/revisions — sửa = tạo bản sửa mới. */
export async function handleQuestionRevisionCreate(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const questionId = parseId(rawId);
  if (!questionId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  const body = await readJsonObject(request);
  if (!body) return failure(400);
  return forward(
    session,
    `/api/v1/admin/cms/questions/${questionId}/revisions`,
    pickRevisionBody(body),
  );
}

/** POST /api/admin/questions/:id/revisions/:rid/{reviews|publish}. */
export async function handleQuestionRevisionAction(
  request: NextRequest,
  rawId: string,
  rawRevisionId: string,
  action: 'reviews' | 'publish',
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const questionId = parseId(rawId);
  const revisionId = parseId(rawRevisionId);
  if (!questionId || !revisionId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  if (action === 'publish') {
    return forward(
      session,
      `/api/v1/admin/cms/questions/${questionId}/revisions/${revisionId}/publish`,
    );
  }
  const body = await readJsonObject(request);
  if (!body) return failure(400);
  const decision = body.decision;
  const note = body.note;
  if (typeof decision !== 'string') return failure(400);
  if (note !== undefined && typeof note !== 'string') return failure(400);
  return forward(
    session,
    `/api/v1/admin/cms/questions/${questionId}/revisions/${revisionId}/reviews`,
    note === undefined ? { decision } : { decision, note },
  );
}

/** POST /api/admin/questions/:id/archive. */
export async function handleQuestionArchive(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const questionId = parseId(rawId);
  if (!questionId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  return forward(session, `/api/v1/admin/cms/questions/${questionId}/archive`);
}
