/// <reference types="jest" />

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/** `meta` of the global response envelope; ids and times vary per request. */
export function envelopeMeta(pagination?: Pagination) {
  return {
    requestId: expect.any(String) as unknown,
    timestamp: expect.any(String) as unknown,
    ...(pagination === undefined ? {} : { pagination }),
  };
}

/** A complete error body, for exact `toEqual` assertions. */
export function apiError(error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}) {
  return { success: false, error, meta: envelopeMeta() };
}
