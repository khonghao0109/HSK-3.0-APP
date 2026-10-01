export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * What a handler may return for a paginated or legacy-wrapped result.
 * TransformInterceptor unwraps it into ApiSuccessEnvelope, moving `meta` to
 * `meta.pagination`; any other return value becomes `data` as is.
 */
export interface ApiSuccessResponse<T = unknown, TMeta = PaginationMeta> {
  success: true;
  data: T;
  meta?: TMeta;
}

export interface ApiResponseMeta {
  requestId: string;
  timestamp: string;
  pagination?: PaginationMeta;
}

/** Every JSON success body on the wire. */
export interface ApiSuccessEnvelope<T = unknown> {
  success: true;
  data: T;
  meta: ApiResponseMeta;
}

/** Every JSON error body on the wire. */
export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: Omit<ApiResponseMeta, 'pagination'>;
}
