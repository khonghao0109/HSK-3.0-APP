import { contentStatuses } from './content-contract';

/**
 * Hợp đồng query của trang danh sách Nội dung `/admin/content` (M5.1a, TL-11).
 * URL là nguồn đúng duy nhất: query hỏng (page=abc, limit=9999, status lạ,
 * search quá dài) về mặc định thay vì 500. Tên tham số khớp
 * `AdminLessonsQueryDto` của backend (page, limit, levelId, status, search).
 *
 * Module này kéo content-contract (Zod) qua `contentStatuses` nên chỉ dùng
 * trong server graph (page, server component); client không import.
 */
export type ContentQuery = {
  page: number;
  limit: number;
  levelId?: number;
  status?: (typeof contentStatuses)[number];
  search?: string;
};

type SearchInput = Record<string, string | string[] | undefined>;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
/** Khớp `@Max(100)` của `PaginationQueryDto` (backend). */
const MAX_LIMIT = 100;
/** Khớp `@Length(1, 200)` của `AdminLessonsQueryDto.search` và TL-11. */
const MAX_SEARCH_LENGTH = 200;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseContentQuery(input: SearchInput): ContentQuery {
  const requestedPage = positiveInteger(first(input.page));
  const requestedLimit = positiveInteger(first(input.limit));
  const levelId = positiveInteger(first(input.levelId));
  const status = first(input.status);
  const search = first(input.search)?.trim();
  return {
    page: requestedPage ?? DEFAULT_PAGE,
    limit:
      requestedLimit && requestedLimit <= MAX_LIMIT
        ? requestedLimit
        : DEFAULT_LIMIT,
    ...(levelId ? { levelId } : {}),
    ...(contentStatuses.includes(status as (typeof contentStatuses)[number])
      ? { status: status as (typeof contentStatuses)[number] }
      : {}),
    ...(search ? { search: search.slice(0, MAX_SEARCH_LENGTH) } : {}),
  };
}

export function serializeContentQuery(query: ContentQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  if (query.levelId) params.set('levelId', String(query.levelId));
  if (query.status) params.set('status', query.status);
  if (query.search) params.set('search', query.search);
  return params;
}

export function withContentPage(query: ContentQuery, page: number): string {
  return `?${serializeContentQuery({ ...query, page: Math.max(1, page) }).toString()}`;
}
