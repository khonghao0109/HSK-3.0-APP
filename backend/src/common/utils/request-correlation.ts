import { randomUUID } from 'node:crypto';

import { isAcceptedRequestId } from '../middleware/request-id.middleware';

/**
 * Audit correlation id for one request. RequestIdMiddleware has already
 * replaced the header with the id echoed in `X-Request-ID`, so audit rows
 * correlate with the response the client saw; an absent or malformed header
 * falls back to a fresh UUID exactly like `cms.controller.ts` does.
 */
export function correlationId(requestId: string | undefined): string {
  return isAcceptedRequestId(requestId) ? requestId : randomUUID();
}
