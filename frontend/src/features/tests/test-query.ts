/**
 * Query string của trang danh sách đề thi (M4.1b, TL-107).
 *
 * File thuần, KHÔNG import `zod`/`server-only`: filter là form GET do server
 * component render, pagination là `<Link>` nên cả hai chỉ cần module này.
 * Hình dạng query khớp DTO backend `AdminTestsQueryDto`
 * (`levelId`, `status`, `q`, `page`, `limit`).
 */
import {
  TEST_STATUS_VALUES,
  type TestListQuery,
  type TestStatus,
} from './test-values';

type SearchInput = Record<string, string | string[] | undefined>;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 100;
const POSTGRESQL_INT4_MAX = 2_147_483_647;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d{0,9}$/u.test(value)) return undefined;
  const parsed = Number(value);
  return parsed <= POSTGRESQL_INT4_MAX ? parsed : undefined;
}

function statusValue(value: string | undefined): TestStatus | undefined {
  return TEST_STATUS_VALUES.find((status) => status === value);
}

/**
 * Đọc `searchParams` (đã await) thành `TestListQuery`.
 * Mặc định: `page=1`, `limit=20`, không `status` → backend ẩn đề lưu trữ.
 * Giá trị sai/ngoài biên bị bỏ (giống `parseQuestionQuery` M4.1a).
 */
export function parseTestQuery(input: SearchInput): TestListQuery {
  const levelId = positiveInteger(first(input.levelId));
  const status = statusValue(first(input.status));
  const q = first(input.q)?.trim();
  const requestedLimit = positiveInteger(first(input.limit));
  return {
    page: positiveInteger(first(input.page)) ?? 1,
    limit:
      requestedLimit !== undefined && requestedLimit <= MAX_LIMIT
        ? requestedLimit
        : DEFAULT_LIMIT,
    ...(levelId !== undefined ? { levelId } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(q !== undefined && q.length >= 1 && q.length <= MAX_QUERY_LENGTH
      ? { q }
      : {}),
  };
}

/**
 * Query string dùng cho link phân trang và link giữ filter: luôn có `page` +
 * `limit`, bỏ `levelId`/`status`/`q` rỗng.
 *
 * `overrides` đổi một phần query và **reset trang về 1** (đổi bộ lọc thì quay
 * về trang đầu); truyền `page` trong `overrides` để nhảy trang cụ thể.
 * Không truyền `overrides` thì giữ nguyên trang hiện tại.
 */
export function serializeTestListQuery(
  query: TestListQuery,
  overrides: Partial<TestListQuery> = {},
): URLSearchParams {
  const hasOverrides = Object.keys(overrides).length > 0;
  const merged: TestListQuery = { ...query, ...overrides };
  const page = hasOverrides
    ? Math.max(1, overrides.page ?? 1)
    : Math.max(1, query.page);
  const params = new URLSearchParams();
  if (merged.levelId !== undefined) {
    params.set('levelId', String(merged.levelId));
  }
  if (merged.status !== undefined) params.set('status', merged.status);
  const q = merged.q?.trim();
  if (q) params.set('q', q);
  params.set('page', String(page));
  params.set('limit', String(merged.limit));
  return params;
}

/** Link tuyệt đối trong app, ví dụ `/admin/tests?page=2&limit=20`. */
export function testListHref(
  query: TestListQuery,
  overrides: Partial<TestListQuery> = {},
): string {
  return `/admin/tests?${serializeTestListQuery(query, overrides).toString()}`;
}
