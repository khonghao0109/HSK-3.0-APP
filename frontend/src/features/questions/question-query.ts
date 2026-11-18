import {
  QUESTION_SKILL_VALUES,
  QUESTION_STATUS_VALUES,
  QUESTION_TYPE_VALUES,
} from './question-values';

export type QuestionQuery = {
  page: number;
  limit: number;
  levelId?: number;
  skill?: (typeof QUESTION_SKILL_VALUES)[number];
  type?: (typeof QUESTION_TYPE_VALUES)[number];
  difficulty?: number;
  status?: (typeof QUESTION_STATUS_VALUES)[number];
  /** TL-82b: 1–5 slug, kết hợp OR. */
  tag?: string[];
  q?: string;
  /** Câu đang chọn để hiện khối "Lịch sử phiên bản" (TL-90). */
  selected?: number;
};

type SearchInput = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d{0,9}$/u.test(value)) return undefined;
  const parsed = Number(value);
  return parsed <= 2_147_483_647 ? parsed : undefined;
}

function stringList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function parseQuestionQuery(input: SearchInput): QuestionQuery {
  const requestedPage = positiveInteger(first(input.page));
  const requestedLimit = positiveInteger(first(input.limit));
  const skill = first(input.skill);
  const type = first(input.type);
  const status = first(input.status);
  const difficulty = positiveInteger(first(input.difficulty));
  const q = first(input.q)?.trim();
  // TL-82b: `?tag=a&tag=b`; giữ tối đa 5 slug (backend trả 400 nếu nhiều hơn).
  const tags = stringList(input.tag)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= 80)
    .slice(0, 5);
  return {
    page: requestedPage ?? 1,
    limit: requestedLimit && requestedLimit <= 100 ? requestedLimit : 20,
    ...(positiveInteger(first(input.levelId))
      ? { levelId: positiveInteger(first(input.levelId)) }
      : {}),
    ...(QUESTION_SKILL_VALUES.includes(
      skill as (typeof QUESTION_SKILL_VALUES)[number],
    )
      ? { skill: skill as (typeof QUESTION_SKILL_VALUES)[number] }
      : {}),
    ...(QUESTION_TYPE_VALUES.includes(
      type as (typeof QUESTION_TYPE_VALUES)[number],
    )
      ? { type: type as (typeof QUESTION_TYPE_VALUES)[number] }
      : {}),
    ...(difficulty !== undefined && difficulty <= 3 ? { difficulty } : {}),
    ...(QUESTION_STATUS_VALUES.includes(
      status as (typeof QUESTION_STATUS_VALUES)[number],
    )
      ? { status: status as (typeof QUESTION_STATUS_VALUES)[number] }
      : {}),
    ...(tags.length > 0 ? { tag: tags } : {}),
    ...(q && q.length <= 100 ? { q } : {}),
    ...(positiveInteger(first(input.selected))
      ? { selected: positiveInteger(first(input.selected)) }
      : {}),
  };
}

export function serializeQuestionQuery(query: QuestionQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  if (query.levelId) params.set('levelId', String(query.levelId));
  if (query.skill) params.set('skill', query.skill);
  if (query.type) params.set('type', query.type);
  if (query.difficulty) params.set('difficulty', String(query.difficulty));
  if (query.status) params.set('status', query.status);
  for (const tag of query.tag ?? []) params.append('tag', tag);
  if (query.q) params.set('q', query.q);
  if (query.selected) params.set('selected', String(query.selected));
  return params;
}

export function withQuestionPage(query: QuestionQuery, page: number): string {
  return `?${serializeQuestionQuery({ ...query, page: Math.max(1, page) }).toString()}`;
}

/** Link chọn câu: giữ nguyên mọi filter hiện tại trên URL (TL-90). */
export function withQuestionSelected(
  query: QuestionQuery,
  selected: number,
): string {
  return `?${serializeQuestionQuery({ ...query, selected }).toString()}`;
}

/** Cột "Ngân hàng" bên trái (TL-89, Q113). */
export type QuestionBankItem = {
  key:
    | 'all'
    | 'listening'
    | 'reading'
    | 'vocabularyGrammar'
    | 'writing'
    | 'speaking';
  label: string;
  href: string;
  count: number;
  active: boolean;
};

export const VOCABULARY_GRAMMAR_TAGS = ['tu-vung', 'ngu-phap'] as const;

/**
 * Q113 + TL-89 + TL-82b: "Từ vựng & Ngữ pháp" lọc đồng thời `tu-vung` và
 * `ngu-phap` bằng query lặp `?tag=tu-vung&tag=ngu-phap` (OR), nên số đếm
 * `vocabularyGrammar` bằng đúng meta.total của bảng.
 */
export function questionBankItems(
  counts: {
    total: number;
    bySkill: {
      listening: number;
      reading: number;
      writing: number;
      speaking: number;
    };
    vocabularyGrammar: number;
  },
  query: QuestionQuery,
): QuestionBankItem[] {
  const base = (params: URLSearchParams) => {
    const ordered = new URLSearchParams();
    ordered.set('page', '1');
    ordered.set('limit', String(query.limit));
    // `append` (không `set`) để giữ query lặp `?tag=a&tag=b` (TL-82b).
    for (const [key, value] of params) ordered.append(key, value);
    return `?${ordered.toString()}`;
  };
  const skillHref = (skill: QuestionQuery['skill']) => {
    const params = new URLSearchParams();
    if (query.levelId) params.set('levelId', String(query.levelId));
    if (query.type) params.set('type', query.type);
    if (query.difficulty) params.set('difficulty', String(query.difficulty));
    if (query.status) params.set('status', String(query.status));
    if (query.q) params.set('q', query.q);
    if (skill) params.set('skill', skill);
    return base(params);
  };
  const tagHref = () => {
    const params = new URLSearchParams();
    if (query.levelId) params.set('levelId', String(query.levelId));
    if (query.type) params.set('type', query.type);
    if (query.difficulty) params.set('difficulty', String(query.difficulty));
    if (query.status) params.set('status', String(query.status));
    if (query.q) params.set('q', query.q);
    for (const tag of VOCABULARY_GRAMMAR_TAGS) params.append('tag', tag);
    return base(params);
  };
  const activeTags = new Set(query.tag ?? []);
  const vocabularyGrammarActive = VOCABULARY_GRAMMAR_TAGS.every((tag) =>
    activeTags.has(tag),
  );
  const allParams = new URLSearchParams();
  if (query.levelId) allParams.set('levelId', String(query.levelId));
  if (query.type) allParams.set('type', query.type);
  if (query.difficulty) allParams.set('difficulty', String(query.difficulty));
  if (query.status) allParams.set('status', String(query.status));
  if (query.q) allParams.set('q', query.q);
  return [
    {
      key: 'all',
      label: 'Tất cả câu hỏi',
      href: `/admin/questions${base(allParams)}`,
      count: counts.total,
      active: query.skill === undefined && query.tag === undefined,
    },
    {
      key: 'listening',
      label: 'Nghe hiểu',
      href: `/admin/questions${skillHref('listening')}`,
      count: counts.bySkill.listening,
      active: query.skill === 'listening',
    },
    {
      key: 'reading',
      label: 'Đọc hiểu',
      href: `/admin/questions${skillHref('reading')}`,
      count: counts.bySkill.reading,
      active: query.skill === 'reading',
    },
    {
      key: 'vocabularyGrammar',
      label: 'Từ vựng & Ngữ pháp',
      href: `/admin/questions${tagHref()}`,
      count: counts.vocabularyGrammar,
      active: vocabularyGrammarActive,
    },
    {
      key: 'writing',
      label: 'Viết',
      href: `/admin/questions${skillHref('writing')}`,
      count: counts.bySkill.writing,
      active: query.skill === 'writing',
    },
    {
      key: 'speaking',
      label: 'Nói',
      href: `/admin/questions${skillHref('speaking')}`,
      count: counts.bySkill.speaking,
      active: query.skill === 'speaking',
    },
  ];
}
