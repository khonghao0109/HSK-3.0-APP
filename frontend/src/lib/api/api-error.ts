export type ApiFailureKind =
  | 'invalid_request'
  | 'session_expired'
  | 'forbidden'
  | 'account_locked'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'unknown';

export type ApiFailure = {
  status: number;
  kind: ApiFailureKind;
  message: string;
  retryable: boolean;
  requestId?: string;
};

const FAILURE_BY_STATUS: Record<
  number,
  Omit<ApiFailure, 'status' | 'requestId'>
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
  return {
    status,
    ...(known ?? {
      kind: 'unknown' as const,
      message: 'Something went wrong. Try again or contact support.',
      retryable: status >= 500,
    }),
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
}

export class BackendRequestError extends Error implements ApiFailure {
  status: number;
  kind: ApiFailureKind;
  retryable: boolean;
  requestId?: string;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'BackendRequestError';
    this.status = failure.status;
    this.kind = failure.kind;
    this.retryable = failure.retryable;
    this.requestId = failure.requestId;
  }
}
