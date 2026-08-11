import { exerciseStatuses, exerciseTypes } from './exercise-contract';

export type ExerciseQuery = {
  page: number;
  limit: number;
  lessonId?: number;
  topicId?: number;
  type?: (typeof exerciseTypes)[number];
  status?: (typeof exerciseStatuses)[number];
};

type SearchInput = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseExerciseQuery(input: SearchInput): ExerciseQuery {
  const requestedPage = positiveInteger(first(input.page));
  const requestedLimit = positiveInteger(first(input.limit));
  const type = first(input.type);
  const status = first(input.status);
  return {
    page: requestedPage ?? 1,
    limit: requestedLimit && requestedLimit <= 100 ? requestedLimit : 20,
    ...(positiveInteger(first(input.lessonId))
      ? { lessonId: positiveInteger(first(input.lessonId)) }
      : {}),
    ...(positiveInteger(first(input.topicId))
      ? { topicId: positiveInteger(first(input.topicId)) }
      : {}),
    ...(exerciseTypes.includes(type as (typeof exerciseTypes)[number])
      ? { type: type as (typeof exerciseTypes)[number] }
      : {}),
    ...(exerciseStatuses.includes(status as (typeof exerciseStatuses)[number])
      ? { status: status as (typeof exerciseStatuses)[number] }
      : {}),
  };
}

export function serializeExerciseQuery(query: ExerciseQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  if (query.lessonId) params.set('lessonId', String(query.lessonId));
  if (query.topicId) params.set('topicId', String(query.topicId));
  if (query.type) params.set('type', query.type);
  if (query.status) params.set('status', query.status);
  return params;
}

export function withExercisePage(query: ExerciseQuery, page: number): string {
  return `?${serializeExerciseQuery({ ...query, page: Math.max(1, page) }).toString()}`;
}
