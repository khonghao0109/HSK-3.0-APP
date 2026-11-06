/**
 * Query string của trang danh sách đề thi thử (M4.5 B1, Q209–Q214).
 *
 * File thuần, KHÔNG import `zod`/`server-only`: filter, sort và pagination đều
 * là `<Link>` do server component render nên chỉ cần module này. Hình dạng
 * query khớp DTO backend `ListExamTestsQueryDto` (`levelCode`, `skill`, `sort`,
 * `page`, `limit`). Giá trị lạ bị bỏ; backend vẫn là nơi trả `400` cuối cùng.
 */

export const EXAM_LIST_SKILL_VALUES = [
  'listening',
  'reading',
  'writing',
  'speaking',
] as const;
export type ExamListSkill = (typeof EXAM_LIST_SKILL_VALUES)[number];

export const EXAM_LIST_SORT_VALUES = ['newest', 'oldest', 'score'] as const;
export type ExamListSort = (typeof EXAM_LIST_SORT_VALUES)[number];

export const DEFAULT_EXAM_LIST_SORT: ExamListSort = 'newest';

/** Rows per page of the list itself (backend limit ceiling is 100). */
export const EXAM_LIST_PAGE_LIMIT = 20;

/**
 * Q210 shortcut: the skill chips are derived from the first 100 visible tests
 * of the selected level (the backend limit cap). Upgrade to a facet endpoint
 * when a level can publish more than 100 visible tests.
 */
export const EXAM_LIST_FACET_LIMIT = 100;

export type ExamListQueryState = {
  /** `null` means "no filter in the URL": the page picks the learner level. */
  levelCode: string | null;
  skill: ExamListSkill | null;
  sort: ExamListSort;
  page: number;
};

type SearchInput = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d{0,4}$/u.test(value)) return undefined;
  return Number(value);
}

/** `HSK1`…`HSK6`, `HSK7_9` (the Level codes of the HSK 3.0 curriculum). */
export function decodeExamLevelCode(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^HSK\d+(_\d+)?$/u.test(trimmed) ? trimmed : undefined;
}

export function decodeExamListSkill(
  value: string | undefined,
): ExamListSkill | undefined {
  return EXAM_LIST_SKILL_VALUES.find((skill) => skill === value);
}

export function decodeExamListSort(
  value: string | undefined,
): ExamListSort | undefined {
  return EXAM_LIST_SORT_VALUES.find((sort) => sort === value);
}

/**
 * Đọc `searchParams` (đã await) thành state của trang. `levelCode` chỉ được
 * coi là hợp lệ về hình dạng ở đây; trang kiểm tiếp với danh sách Level đã
 * xuất bản rồi mới quyết định chip mặc định (Q209).
 */
export function parseExamListQuery(input: SearchInput): ExamListQueryState {
  return {
    levelCode: decodeExamLevelCode(first(input.levelCode)) ?? null,
    skill: decodeExamListSkill(first(input.skill)) ?? null,
    sort: decodeExamListSort(first(input.sort)) ?? DEFAULT_EXAM_LIST_SORT,
    page: positiveInteger(first(input.page)) ?? 1,
  };
}

/**
 * Query string dùng cho mọi link của trang (chip cấp, chip kỹ năng, sort,
 * phân trang). Đổi bộ lọc/sort thì quay về trang 1; truyền `page` trong
 * `overrides` để nhảy trang. Luôn giữ `levelCode` để link chia sẻ được.
 */
export function serializeExamListQuery(
  state: ExamListQueryState,
  overrides: Partial<ExamListQueryState> = {},
): URLSearchParams {
  const hasOverrides = Object.keys(overrides).length > 0;
  const merged: ExamListQueryState = { ...state, ...overrides };
  const params = new URLSearchParams();
  if (merged.levelCode) params.set('levelCode', merged.levelCode);
  if (merged.skill) params.set('skill', merged.skill);
  if (merged.sort !== DEFAULT_EXAM_LIST_SORT) params.set('sort', merged.sort);
  const page = hasOverrides ? Math.max(1, overrides.page ?? 1) : merged.page;
  if (page > 1) params.set('page', String(page));
  return params;
}

/** Link tuyệt đối trong app, ví dụ `/learn/exam?levelCode=HSK3&skill=reading`. */
export function examListHref(
  state: ExamListQueryState,
  overrides: Partial<ExamListQueryState> = {},
): string {
  const search = serializeExamListQuery(state, overrides).toString();
  return search ? `/learn/exam?${search}` : '/learn/exam';
}
