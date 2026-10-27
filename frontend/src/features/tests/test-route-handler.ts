import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  exactOrigin,
  failure,
  token,
} from '@/features/content/content-route-handler';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';

import { testMutationResponseSchema } from './test-contract';

/**
 * BFF trình xây dựng đề thi (M4.1b, TL-105). Thứ tự kiểm mỗi route:
 * Origin 403 → id 400 (dạng `^[1-9]\d{0,9}$`, ≤ 2 147 483 647) → cookie 401 →
 * JSON object 400 (body ≤ 65 536 byte) → dựng lại body chỉ từ khoá hợp lệ →
 * backend → parse `TestDetail`.
 */
const POSITIVE_ID = /^[1-9]\d{0,9}$/u;
const MAX_BODY_BYTES = 65_536;

const TEST_CREATE_KEYS = [
  'levelId',
  'title',
  'instruction',
  'duration',
  'passScore',
] as const;

const TEST_UPDATE_KEYS = [
  'expectedUpdatedAt',
  'levelId',
  'title',
  'instruction',
  'duration',
  'passScore',
] as const;

const TEST_PUBLISH_KEYS = ['expectedUpdatedAt'] as const;

/** TL-96: mỗi section chỉ nhận đúng các khoá dưới đây, `groups` được dựng lại. */
const SECTION_KEYS = ['skill', 'title', 'instruction', 'groups'] as const;
const GROUP_KEYS = [
  'title',
  'instruction',
  'audioId',
  'imageId',
  'questionIds',
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Chỉ các khoá contract nhận được chuyển sang backend, bỏ mọi khoá lạ. */
function pickKeys(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) picked[key] = source[key];
  }
  return picked;
}

/**
 * TL-96: dựng lại cây section/group từ đúng các khoá của contract. Trả `null`
 * khi `sections`, `groups` hoặc một phần tử không phải object để route trả 400
 * thay vì chuyển giá trị tuỳ ý của client sang backend.
 */
function rebuildSections(
  value: unknown,
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  const sections: Array<Record<string, unknown>> = [];
  for (const section of value) {
    if (!isPlainRecord(section)) return null;
    if (!Array.isArray(section.groups)) return null;
    const groups: Array<Record<string, unknown>> = [];
    for (const group of section.groups) {
      if (!isPlainRecord(group)) return null;
      groups.push(pickKeys(group, GROUP_KEYS));
    }
    sections.push({ ...pickKeys(section, SECTION_KEYS), groups });
  }
  return sections;
}

async function forward(
  session: string,
  path: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body?: unknown,
  status = 200,
): Promise<NextResponse> {
  try {
    const parsed = testMutationResponseSchema.parse(
      await backend.request(path, {
        token: session,
        method,
        ...(body === undefined ? {} : { body }),
      }),
    );
    const response = NextResponse.json(parsed, { status });
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof BackendRequestError) {
      return failure(error.status, error.code, error.details);
    }
    return failure(503);
  }
}

/** POST /api/admin/tests — tạo đề nháp chưa có phần. */
export async function handleTestCreate(
  request: NextRequest,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const session = token(request);
  if (!session) return failure(401);
  const body = await readJsonObject(request);
  if (!body) return failure(400);
  return forward(
    session,
    '/api/v1/admin/cms/tests',
    'POST',
    pickKeys(body, TEST_CREATE_KEYS),
    201,
  );
}

/** PATCH /api/admin/tests/:id — sửa meta, chỉ đề `draft`. */
export async function handleTestUpdate(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const testId = parseId(rawId);
  if (!testId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  const body = await readJsonObject(request);
  if (!body) return failure(400);
  const payload = pickKeys(body, TEST_UPDATE_KEYS);
  if (typeof payload.expectedUpdatedAt !== 'string') return failure(400);
  return forward(
    session,
    `/api/v1/admin/cms/tests/${testId}`,
    'PATCH',
    payload,
  );
}

/** PUT /api/admin/tests/:id/structure — thay toàn bộ cây phần/nhóm/câu. */
export async function handleTestStructureReplace(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const testId = parseId(rawId);
  if (!testId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  const body = await readJsonObject(request);
  if (!body) return failure(400);
  const payload = pickKeys(body, ['expectedUpdatedAt', 'sections'] as const);
  if (typeof payload.expectedUpdatedAt !== 'string') return failure(400);
  const sections = rebuildSections(body.sections);
  if (!sections) return failure(400);
  return forward(
    session,
    `/api/v1/admin/cms/tests/${testId}/structure`,
    'PUT',
    { ...payload, sections },
  );
}

/** POST /api/admin/tests/:id/publish — xuất bản đề đã đủ điều kiện. */
export async function handleTestPublish(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const testId = parseId(rawId);
  if (!testId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  const body = await readJsonObject(request);
  if (!body) return failure(400);
  const payload = pickKeys(body, TEST_PUBLISH_KEYS);
  if (typeof payload.expectedUpdatedAt !== 'string') return failure(400);
  return forward(
    session,
    `/api/v1/admin/cms/tests/${testId}/publish`,
    'POST',
    payload,
    201,
  );
}

/** POST /api/admin/tests/:id/archive — lưu trữ đề, không gửi body. */
export async function handleTestArchive(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const testId = parseId(rawId);
  if (!testId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  return forward(
    session,
    `/api/v1/admin/cms/tests/${testId}/archive`,
    'POST',
    undefined,
    201,
  );
}

/** POST /api/admin/tests/:id/duplicate — nhân bản thành đề nháp mới. */
export async function handleTestDuplicate(
  request: NextRequest,
  rawId: string,
): Promise<NextResponse> {
  if (!exactOrigin(request)) return failure(403);
  const testId = parseId(rawId);
  if (!testId) return failure(400);
  const session = token(request);
  if (!session) return failure(401);
  return forward(
    session,
    `/api/v1/admin/cms/tests/${testId}/duplicate`,
    'POST',
    undefined,
    201,
  );
}
