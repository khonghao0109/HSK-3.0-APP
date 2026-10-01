import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

// A UUID (BFF, clients) or nginx's 32-hex `$request_id`. Anything else is
// replaced, so callers cannot put arbitrary text into headers, logs or audit.
const ACCEPTED_REQUEST_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/iu;

type RequestWithId = Request & { requestId?: string };

export function isAcceptedRequestId(value: unknown): value is string {
  return typeof value === 'string' && ACCEPTED_REQUEST_ID.test(value);
}

/**
 * Returns the id of this request, assigning it on first use: the incoming
 * `x-request-id` when acceptable, otherwise a new UUIDv4. The id replaces the
 * request header, so handlers that read the header (CMS audit correlation)
 * record the same value the client receives in `X-Request-ID`.
 */
export function resolveRequestId(
  request: Request,
  response?: Response,
): string {
  const carrier = request as RequestWithId;
  if (carrier.requestId === undefined) {
    const incoming = request.headers[REQUEST_ID_HEADER];
    carrier.requestId = isAcceptedRequestId(incoming) ? incoming : randomUUID();
    request.headers[REQUEST_ID_HEADER] = carrier.requestId;
  }
  if (response && !response.headersSent) {
    response.setHeader('X-Request-ID', carrier.requestId);
  }
  return carrier.requestId;
}

/** Runs before guards, so throttling and auth failures carry the id too. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    resolveRequestId(request, response);
    next();
  }
}
