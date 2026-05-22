export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccessResponse<T = unknown, TMeta = unknown> {
  success: true;
  data: T;
  message?: string;
  meta?: TMeta;
}

export interface ApiErrorResponse {
  success: false;
  message: string | string[];
  error?: string;
  statusCode?: number;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
