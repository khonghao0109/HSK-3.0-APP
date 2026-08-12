import {
  mediaLifecycles,
  mediaProcessingStatuses,
  mediaTypes,
} from './media-contract';

export type MediaQuery = {
  page: number;
  limit: number;
  type?: (typeof mediaTypes)[number];
  processingStatus?: (typeof mediaProcessingStatuses)[number];
  lifecycle?: (typeof mediaLifecycles)[number];
  dataSourceId?: number;
};

type SearchInput = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function enumValue<T extends readonly string[]>(
  values: T,
  value: string | undefined,
): T[number] | undefined {
  return values.includes(value as T[number]) ? (value as T[number]) : undefined;
}

export function parseMediaQuery(input: SearchInput): MediaQuery {
  const page = positiveInteger(first(input.page));
  const limit = positiveInteger(first(input.limit));
  const type = enumValue(mediaTypes, first(input.type));
  const processingStatus = enumValue(
    mediaProcessingStatuses,
    first(input.processingStatus),
  );
  const lifecycle = enumValue(mediaLifecycles, first(input.lifecycle));
  const dataSourceId = positiveInteger(first(input.dataSourceId));
  return {
    page: page ?? 1,
    limit: limit && limit <= 100 ? limit : 20,
    ...(type ? { type } : {}),
    ...(processingStatus ? { processingStatus } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(dataSourceId ? { dataSourceId } : {}),
  };
}

export function serializeMediaQuery(query: MediaQuery): URLSearchParams {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
  });
  if (query.type) params.set('type', query.type);
  if (query.processingStatus)
    params.set('processingStatus', query.processingStatus);
  if (query.lifecycle) params.set('lifecycle', query.lifecycle);
  if (query.dataSourceId)
    params.set('dataSourceId', String(query.dataSourceId));
  return params;
}

export function withMediaPage(query: MediaQuery, page: number): string {
  return `?${serializeMediaQuery({ ...query, page: Math.max(1, page) }).toString()}`;
}
