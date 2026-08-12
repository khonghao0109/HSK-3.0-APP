import { BackendRequestError, normalizeApiFailure } from './api-error';

const ALLOWED_PATHS = [
  /^\/api\/v1\/auth\/login$/,
  /^\/api\/v1\/auth\/me$/,
  /^\/api\/v1\/admin\/cms\/exercises(?:\?.*)?$/,
  /^\/api\/v1\/admin\/cms\/exercises\/\d+$/,
  /^\/api\/v1\/admin\/cms\/media(?:\?.*)?$/,
  /^\/api\/v1\/admin\/cms\/media\/\d+$/,
  /^\/api\/v1\/admin\/cms\/media\/\d+\/(?:archive|quarantine)$/,
];

type ClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  requestIdFactory?: () => string;
};

type RequestOptions = {
  token?: string;
  method?: 'GET' | 'POST';
  body?: unknown;
};

function isAllowedPath(path: string): boolean {
  return (
    path.startsWith('/') && ALLOWED_PATHS.some((pattern) => pattern.test(path))
  );
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const headers = new Headers({
          accept: 'application/json',
          'x-request-id': requestId,
        });
        if (request.token)
          headers.set('authorization', `Bearer ${request.token}`);
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
  };
}

export type BackendClient = ReturnType<typeof createBackendClient>;
