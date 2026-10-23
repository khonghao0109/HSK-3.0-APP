export type ApiFailureKind =
  | 'invalid_request'
  | 'session_expired'
  | 'forbidden'
  | 'account_locked'
  | 'admin_account'
  | 'email_taken'
  | 'weak_password'
  | 'level_unavailable'
  | 'content_unavailable'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'unknown';

/**
 * M5.1b1 (F1/TL-20): chi tiết lỗi 422 mà form cần để hiện đúng ô — chỉ hai
 * khoá này được đi qua BFF, mọi khoá khác của `error.details` bị bỏ.
 */
export type ApiErrorDetailRow = {
  rowNumber: number;
  code: string;
  path: string;
};

export type ApiErrorDetails = {
  /** Vị trí lỗi trong payload (ví dụ `content.options[1].text`). */
  path?: string;
  /** Lỗi theo dòng của import (tối đa 100 dòng). */
  errors?: ApiErrorDetailRow[];
};

export type ApiFailure = {
  status: number;
  kind: ApiFailureKind;
  message: string;
  retryable: boolean;
  requestId?: string;
  /** `error.code` of the backend error envelope, when it is a string. */
  code?: string;
  /** Chi tiết lỗi đã lọc (chỉ `path` và `errors`). */
  details?: ApiErrorDetails;
};

export const API_ERROR_DETAILS_LIMITS = {
  maxPathLength: 200,
  maxErrors: 100,
  maxCodeLength: 64,
} as const;

const FAILURE_BY_STATUS: Record<
  number,
  Omit<ApiFailure, 'status' | 'requestId' | 'code'>
> = {
  400: {
    kind: 'invalid_request',
    message: 'The request is not valid.',
    retryable: false,
  },
  401: {
    kind: 'session_expired',
    message: 'Your session has expired.',
    retryable: false,
  },
  403: {
    kind: 'forbidden',
    message: 'You do not have access to this area.',
    retryable: false,
  },
  404: {
    kind: 'not_found',
    message: 'The requested resource was not found.',
    retryable: false,
  },
  409: {
    kind: 'conflict',
    message: 'The resource changed. Reload and try again.',
    retryable: false,
  },
  422: {
    kind: 'validation',
    message: 'Some request values are invalid.',
    retryable: false,
  },
  429: {
    kind: 'rate_limited',
    message: 'Too many requests. Try again shortly.',
    retryable: true,
  },
  503: {
    kind: 'unavailable',
    message: 'The service is temporarily unavailable.',
    retryable: true,
  },
};

export function normalizeApiFailure(input: {
  status?: number;
  body?: unknown;
  requestId?: string;
}): ApiFailure {
  const status = Number.isInteger(input.status)
    ? (input.status as number)
    : 500;
  const known = FAILURE_BY_STATUS[status];
  const code = envelopeCode(input.body);
  const details = sanitizeErrorDetails(envelopeDetails(input.body));
  return {
    status,
    ...(known ?? {
      kind: 'unknown' as const,
      message: 'Something went wrong. Try again or contact support.',
      retryable: status >= 500,
    }),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(code === undefined ? {} : { code }),
    ...(details === undefined ? {} : { details }),
  };
}

/**
 * F1: giữ đúng `path` (string ≤ 200) và `errors` (≤ 100 × {rowNumber int,
 * code ≤ 64, path ≤ 200}), bỏ mọi khoá khác và mọi phần tử sai shape/quá dài.
 * Không có mục nào hợp lệ → undefined.
 */
export function sanitizeErrorDetails(
  value: unknown,
): ApiErrorDetails | undefined {
  if (!isPlainRecord(value)) return undefined;
  const path = validString(value.path, API_ERROR_DETAILS_LIMITS.maxPathLength);

  let errors: ApiErrorDetailRow[] | undefined;
  if (Array.isArray(value.errors)) {
    const rows: ApiErrorDetailRow[] = [];
    for (const entry of value.errors) {
      if (rows.length >= API_ERROR_DETAILS_LIMITS.maxErrors) break;
      if (!isPlainRecord(entry)) continue;
      if (!Number.isInteger(entry.rowNumber)) continue;
      const code = validString(
        entry.code,
        API_ERROR_DETAILS_LIMITS.maxCodeLength,
      );
      const rowPath = validString(
        entry.path,
        API_ERROR_DETAILS_LIMITS.maxPathLength,
      );
      if (code === undefined || rowPath === undefined) continue;
      rows.push({ rowNumber: entry.rowNumber as number, code, path: rowPath });
    }
    if (rows.length > 0) errors = rows;
  }

  if (path === undefined && errors === undefined) return undefined;
  return {
    ...(path === undefined ? {} : { path }),
    ...(errors === undefined ? {} : { errors }),
  };
}

function validString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength
    ? value
    : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function envelopeDetails(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  return (error as { details?: unknown }).details;
}

function envelopeCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export class BackendRequestError extends Error implements ApiFailure {
  status: number;
  kind: ApiFailureKind;
  retryable: boolean;
  requestId?: string;
  code?: string;
  details?: ApiErrorDetails;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'BackendRequestError';
    this.status = failure.status;
    this.kind = failure.kind;
    this.retryable = failure.retryable;
    this.requestId = failure.requestId;
    this.code = failure.code;
    this.details = failure.details;
  }
}

/** True for a backend 401/403: the session is gone or not allowed. */
export function isAuthFailure(error: unknown): boolean {
  return (
    error instanceof BackendRequestError &&
    (error.status === 401 || error.status === 403)
  );
}
