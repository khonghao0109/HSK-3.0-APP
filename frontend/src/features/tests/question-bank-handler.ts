import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { failure, token } from '@/features/content/content-route-handler';
import { QUESTION_TYPE_VALUES } from '@/features/questions/question-values';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';

import { testQuestionBankResponseSchema } from './test-contract';
import { TEST_SKILL_VALUES, TEST_STATUS_VALUES } from './test-values';

/**
 * GET BFF cho bảng ngân hàng câu hỏi của trình xây dựng đề (M4.1b, TL-105).
 * Chỉ đọc nên không kiểm Origin, nhưng vẫn bắt buộc cookie phiên. Query chỉ
 * nhận đúng các khoá dưới đây; khoá lạ hoặc giá trị sai → 400 để backend không
 * bao giờ thấy tham số ngoài contract.
 */
const QUESTIONS_PATH = '/api/v1/admin/cms/questions';
const POSITIVE_INT = /^[1-9]\d{0,9}$/u;
const MAX_INT4 = 2_147_483_647;
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 80;
const MAX_Q_LENGTH = 100;
const MAX_LIMIT = 100;

/** Query đã kiểm, giữ nguyên thứ tự tag lặp `?tag=a&tag=b`. */
type QuestionBankQuery = {
  levelId?: string;
  skill?: string;
  type?: string;
  tag: string[];
  q?: string;
  page?: string;
  limit?: string;
  status?: string;
};

function positiveId(value: string): string | null {
  if (!POSITIVE_INT.test(value)) return null;
  return Number(value) <= MAX_INT4 ? value : null;
}

function isSkill(value: string): boolean {
  return TEST_SKILL_VALUES.some((skill) => skill === value);
}

function isType(value: string): boolean {
  return QUESTION_TYPE_VALUES.some((type) => type === value);
}

function isStatus(value: string): boolean {
  return TEST_STATUS_VALUES.some((status) => status === value);
}

/**
 * Kiểm toàn bộ `searchParams` (kể cả khoá lặp) rồi dựng lại query chỉ từ các
 * khoá hợp lệ theo thứ tự cố định. Trả `null` nếu có khoá lạ hoặc giá trị sai.
 */
function parseQuestionBankQuery(
  searchParams: URLSearchParams,
): URLSearchParams | null {
  const parsed: QuestionBankQuery = { tag: [] };
  for (const [key, raw] of searchParams) {
    switch (key) {
      case 'levelId': {
        const levelId = positiveId(raw);
        if (levelId === null) return null;
        parsed.levelId = levelId;
        break;
      }
      case 'page': {
        const page = positiveId(raw);
        if (page === null) return null;
        parsed.page = page;
        break;
      }
      case 'limit': {
        const limit = positiveId(raw);
        if (limit === null || Number(limit) > MAX_LIMIT) return null;
        parsed.limit = limit;
        break;
      }
      case 'skill': {
        if (!isSkill(raw)) return null;
        parsed.skill = raw;
        break;
      }
      case 'type': {
        if (!isType(raw)) return null;
        parsed.type = raw;
        break;
      }
      case 'status': {
        if (!isStatus(raw)) return null;
        parsed.status = raw;
        break;
      }
      case 'tag': {
        const tag = raw.trim();
        if (tag.length < 1 || tag.length > MAX_TAG_LENGTH) return null;
        parsed.tag.push(tag);
        if (parsed.tag.length > MAX_TAGS) return null;
        break;
      }
      case 'q': {
        const q = raw.trim();
        if (q.length < 1 || q.length > MAX_Q_LENGTH) return null;
        parsed.q = q;
        break;
      }
      default:
        return null;
    }
  }

  const params = new URLSearchParams();
  if (parsed.levelId !== undefined) params.set('levelId', parsed.levelId);
  if (parsed.skill !== undefined) params.set('skill', parsed.skill);
  if (parsed.type !== undefined) params.set('type', parsed.type);
  for (const tag of parsed.tag) params.append('tag', tag);
  if (parsed.q !== undefined) params.set('q', parsed.q);
  if (parsed.page !== undefined) params.set('page', parsed.page);
  if (parsed.limit !== undefined) params.set('limit', parsed.limit);
  if (parsed.status !== undefined) params.set('status', parsed.status);
  return params;
}

/** GET /api/admin/questions — hàng câu hỏi cho bảng chọn câu của builder. */
export async function handleQuestionBankList(
  request: NextRequest,
): Promise<NextResponse> {
  const session = token(request);
  if (!session) return failure(401);
  const params = parseQuestionBankQuery(request.nextUrl.searchParams);
  if (!params) return failure(400);
  const query = params.toString();
  try {
    const parsed = testQuestionBankResponseSchema.parse(
      await backend.request(
        query ? `${QUESTIONS_PATH}?${query}` : QUESTIONS_PATH,
        { token: session },
      ),
    );
    const response = NextResponse.json(parsed);
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof BackendRequestError) {
      return failure(error.status, error.code, error.details);
    }
    return failure(503);
  }
}
