import { MEDIA_UPLOAD_BFF_TIMEOUT_CODE } from '@/features/media-upload/media-upload-values';

import { BackendRequestError, normalizeApiFailure } from './api-error';

const ALLOWED_PATHS = [
  /^\/api\/v1\/auth\/login$/,
  /^\/api\/v1\/auth\/register$/,
  /^\/api\/v1\/auth\/refresh$/,
  /^\/api\/v1\/auth\/logout$/,
  /^\/api\/v1\/auth\/me$/,
  /^\/api\/v1\/auth\/password-reset\/request$/,
  /^\/api\/v1\/auth\/password-reset\/confirm$/,
  /^\/api\/v1\/auth\/email-verification\/request$/,
  /^\/api\/v1\/auth\/email-verification\/confirm$/,
  /^\/api\/v1\/admin\/cms\/exercises(?:\?.*)?$/,
  /^\/api\/v1\/admin\/cms\/exercises\/\d+$/,
  /^\/api\/v1\/admin\/cms\/exercises\/\d+\/revisions$/,
  /^\/api\/v1\/admin\/cms\/exercises\/\d+\/revisions\/\d+\/(?:reviews|publish)$/,
  /^\/api\/v1\/admin\/cms\/exercises\/\d+\/archive$/,
  // M5.1b2: nguồn dữ liệu (chỉ đọc, có query) + hai bước nhập bài tập.
  /^\/api\/v1\/admin\/cms\/data-sources(?:\?[^#]*)?$/,
  /^\/api\/v1\/admin\/cms\/exercise-imports\/preview$/,
  /^\/api\/v1\/admin\/cms\/exercise-imports$/,
  /^\/api\/v1\/admin\/cms\/lessons(?:\?.*)?$/,
  /^\/api\/v1\/admin\/cms\/lessons\/\d+$/,
  /^\/api\/v1\/admin\/cms\/lessons\/\d+\/revisions$/,
  /^\/api\/v1\/admin\/cms\/lessons\/\d+\/revisions\/\d+\/(?:reviews|publish)$/,
  /^\/api\/v1\/admin\/cms\/lessons\/\d+\/archive$/,
  /^\/api\/v1\/admin\/cms\/topics$/,
  /^\/api\/v1\/admin\/cms\/topics\/\d+$/,
  /^\/api\/v1\/admin\/cms\/topics\/\d+\/revisions$/,
  /^\/api\/v1\/admin\/cms\/topics\/\d+\/revisions\/\d+\/(?:reviews|publish)$/,
  /^\/api\/v1\/admin\/cms\/topics\/\d+\/archive$/,
  /^\/api\/v1\/admin\/cms\/media(?:\?.*)?$/,
  /^\/api\/v1\/admin\/cms\/media\/\d+$/,
  /^\/api\/v1\/admin\/cms\/media\/\d+\/(?:archive|quarantine)$/,
  // M5.2a (TL-40): tải media, chỉ query dataSourceId số.
  /^\/api\/v1\/admin\/cms\/media\/ingestions\?dataSourceId=\d+$/,
  /^\/api\/v1\/admin\/cms\/media\/ingestions\?page=\d+&limit=\d+$/,
  /^\/api\/v1\/admin\/cms\/media\/ingestions\/\d+\/cleanup$/,
  // M4.1a (TL-88): ngân hàng câu hỏi. Chỉ các GET danh sách (questions,
  // counts, tags) nhận query string; route mutation không nhận query.
  /^\/api\/v1\/admin\/cms\/questions(?:\?[^#]*)?$/,
  /^\/api\/v1\/admin\/cms\/questions\/counts(?:\?[^#]*)?$/,
  /^\/api\/v1\/admin\/cms\/tags(?:\?[^#]*)?$/,
  /^\/api\/v1\/admin\/cms\/questions\/\d+$/,
  /^\/api\/v1\/admin\/cms\/questions\/\d+\/revisions$/,
  /^\/api\/v1\/admin\/cms\/questions\/\d+\/revisions\/\d+\/(?:reviews|publish)$/,
  /^\/api\/v1\/admin\/cms\/questions\/\d+\/archive$/,
  // M4.1b (TL-105): trình xây dựng đề. GET danh sách nhận query string;
  // các route mutation/structure không nhận query.
  /^\/api\/v1\/admin\/cms\/tests(?:\?[^#]*)?$/,
  /^\/api\/v1\/admin\/cms\/tests\/\d+$/,
  /^\/api\/v1\/admin\/cms\/tests\/\d+\/structure$/,
  /^\/api\/v1\/admin\/cms\/tests\/\d+\/(?:publish|archive|duplicate)$/,
  // M5.3 (TL-70): quản lý người dùng admin + nhật ký audit.
  /^\/api\/v1\/admin\/users(?:\?[^#]*)?$/,
  /^\/api\/v1\/admin\/users\/\d+\/(?:role|suspend|unsuspend)$/,
  /^\/api\/v1\/admin\/audit-logs(?:\?[^#]*)?$/,
  /^\/api\/v1\/levels$/,
  /^\/api\/v1\/onboarding\/status$/,
  /^\/api\/v1\/onboarding\/goals$/,
  /^\/api\/v1\/onboarding\/goals\/current$/,
  /^\/api\/v1\/learning-plans$/,
  /^\/api\/v1\/learning\/home$/,
  /^\/api\/v1\/learning\/path$/,
  /^\/api\/v1\/learning\/lessons\/\d+\/activity$/,
  /^\/api\/v1\/learning\/lessons\/\d+\/(?:start|complete)$/,
  /^\/api\/v1\/learning\/topics\/\d+\/(?:start|complete)$/,
  /^\/api\/v1\/progress\/lessons\/\d+$/,
  /^\/api\/v1\/learning\/exercises\/\d+\/attempts$/,
  /^\/api\/v1\/media\/\d+\/access$/,
  /^\/api\/v1\/media\/\d+\/content$/,
  /^\/api\/v1\/dictionary\?query=[^&#]+$/,
  /^\/api\/v1\/dictionary\/words\/\d+$/,
  /^\/api\/v1\/dictionary\/words\/\d+\/save$/,
  // M4.2a (TL-118): exam intro + start. The attempt detail route is not part
  // of Pha B, so it stays out of the allowlist on purpose.
  /^\/api\/v1\/exam\/tests\/\d+$/,
  /^\/api\/v1\/exam\/tests\/\d+\/attempts$/,
];

/**
 * TL-40: ≥ trần MEDIA_UPLOAD_TIMEOUT_MS 120 000 của backend (env.validation.ts)
 * để backend tự trả 408 trước khi BFF bỏ cuộc.
 */
export const MEDIA_UPLOAD_BFF_TIMEOUT_MS = 125_000;

/** Raw requests wait at most this long for the response headers. */
const RAW_HEADERS_TIMEOUT_MS = 10_000;

type ClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  requestIdFactory?: () => string;
  /** X-Forwarded-For value of the incoming browser request, if any. */
  forwardedFor?: () => Promise<string | undefined>;
};

type RawRequestOptions = {
  /** Query string, appended to the allowlisted path as given. */
  search?: URLSearchParams;
  headers?: Record<string, string>;
  /** Aborts the upstream request (for example when the browser leaves). */
  signal?: AbortSignal;
};

type UploadOptions = {
  token: string;
  idempotencyKey: string;
  /** Header multipart nguyên văn (có boundary). */
  contentType: string;
  body: ArrayBuffer;
};

type RequestOptions = {
  token?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Sent as `Idempotency-Key` (docs/api/api.md §A.7). */
  idempotencyKey?: string;
};

function isAllowedPath(path: string): boolean {
  return (
    path.startsWith('/') && ALLOWED_PATHS.some((pattern) => pattern.test(path))
  );
}

/**
 * The chain is forwarded verbatim, never reduced to its first entry: the
 * backend trusts one hop and reads the right-most address, which nginx
 * appended. The left part is client-controlled.
 */
export function clientForwardedFor(
  headers: Pick<Headers, 'get'>,
): string | undefined {
  for (const name of ['x-forwarded-for', 'x-real-ip']) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

export function createBackendClient(options: ClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestIdFactory =
    options.requestIdFactory ?? (() => crypto.randomUUID());

  return {
    async request<T = unknown>(
      path: string,
      request: RequestOptions = {},
    ): Promise<T> {
      if (!isAllowedPath(path)) {
        throw new BackendRequestError(
          normalizeApiFailure({ status: 400, requestId: requestIdFactory() }),
        );
      }
      const requestId = requestIdFactory();
      const forwardedFor = await options.forwardedFor?.();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const headers = new Headers({
          accept: 'application/json',
          'x-request-id': requestId,
        });
        if (request.token)
          headers.set('authorization', `Bearer ${request.token}`);
        if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
        if (request.idempotencyKey)
          headers.set('idempotency-key', request.idempotencyKey);
        if (request.body !== undefined)
          headers.set('content-type', 'application/json');
        const response = await fetchImpl(new URL(path, options.baseUrl), {
          method: request.method ?? 'GET',
          headers,
          body:
            request.body === undefined
              ? undefined
              : JSON.stringify(request.body),
          cache: 'no-store',
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new BackendRequestError(
            normalizeApiFailure({
              status: response.status,
              body,
              requestId: response.headers.get('x-request-id') ?? requestId,
            }),
          );
        }
        return body as T;
      } catch (error) {
        if (error instanceof BackendRequestError) throw error;
        if (controller.signal.aborted) {
          throw new BackendRequestError({
            status: 503,
            kind: 'timeout',
            message: 'The upstream request timed out.',
            retryable: true,
            requestId,
          });
        }
        throw new BackendRequestError(
          normalizeApiFailure({ status: 503, requestId }),
        );
      } finally {
        clearTimeout(timer);
      }
    },

    /**
     * POST multipart (request() chỉ gửi JSON). Chỉ chuyển tiếp content-type,
     * idempotency-key và bearer.
     * shortcut: đệm ≤ ~10 MiB mỗi request, chuyển sang stream request.body khi
     * tải đồng thời/giới hạn lớn hơn.
     */
    async upload<T = unknown>(
      path: string,
      request: UploadOptions,
    ): Promise<T> {
      if (!isAllowedPath(path)) {
        throw new BackendRequestError(
          normalizeApiFailure({ status: 400, requestId: requestIdFactory() }),
        );
      }
      const requestId = requestIdFactory();
      const forwardedFor = await options.forwardedFor?.();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        MEDIA_UPLOAD_BFF_TIMEOUT_MS,
      );
      try {
        const headers = new Headers({
          accept: 'application/json',
          'x-request-id': requestId,
          authorization: `Bearer ${request.token}`,
          'content-type': request.contentType,
          'idempotency-key': request.idempotencyKey,
        });
        if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
        const response = await fetchImpl(new URL(path, options.baseUrl), {
          method: 'POST',
          headers,
          body: request.body,
          cache: 'no-store',
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new BackendRequestError(
            normalizeApiFailure({
              status: response.status,
              body,
              requestId: response.headers.get('x-request-id') ?? requestId,
            }),
          );
        }
        return body as T;
      } catch (error) {
        if (error instanceof BackendRequestError) throw error;
        if (controller.signal.aborted) {
          throw new BackendRequestError({
            status: 503,
            kind: 'timeout',
            message: 'The upstream request timed out.',
            retryable: true,
            requestId,
            code: MEDIA_UPLOAD_BFF_TIMEOUT_CODE,
          });
        }
        throw new BackendRequestError(
          normalizeApiFailure({ status: 503, requestId }),
        );
      } finally {
        clearTimeout(timer);
      }
    },

    /**
     * GET without a token whose response (any status) is returned as is, body
     * unread, for streaming. The timeout covers only the wait for headers.
     */
    async raw(
      path: string,
      request: RawRequestOptions = {},
    ): Promise<Response> {
      if (!isAllowedPath(path)) {
        throw new BackendRequestError(
          normalizeApiFailure({ status: 400, requestId: requestIdFactory() }),
        );
      }
      const requestId = requestIdFactory();
      const forwardedFor = await options.forwardedFor?.();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        RAW_HEADERS_TIMEOUT_MS,
      );
      const signal = request.signal
        ? AbortSignal.any([controller.signal, request.signal])
        : controller.signal;
      const url = new URL(path, options.baseUrl);
      if (request.search) url.search = request.search.toString();
      try {
        const headers = new Headers(request.headers);
        headers.set('x-request-id', requestId);
        if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
        return await fetchImpl(url, {
          method: 'GET',
          headers,
          cache: 'no-store',
          signal,
        });
      } catch {
        throw new BackendRequestError(
          controller.signal.aborted
            ? {
                status: 503,
                kind: 'timeout',
                message: 'The upstream request timed out.',
                retryable: true,
                requestId,
              }
            : normalizeApiFailure({ status: 503, requestId }),
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type BackendClient = ReturnType<typeof createBackendClient>;
