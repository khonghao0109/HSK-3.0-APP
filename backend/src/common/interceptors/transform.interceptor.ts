import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';

import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';
import type {
  ApiResponseMeta,
  ApiSuccessEnvelope,
  PaginationMeta,
} from '../interfaces/api-response.interface';
import { resolveRequestId } from '../middleware/request-id.middleware';

/** Wraps every successful JSON response in the `{ success, data, meta }` envelope. */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean | undefined>(
      RAW_RESPONSE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (context.getType() !== 'http' || raw) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        // A handler that wrote the response itself, or returned bytes.
        if (
          response.headersSent ||
          body instanceof StreamableFile ||
          Buffer.isBuffer(body)
        ) {
          return body;
        }
        return toSuccessEnvelope(body, resolveRequestId(request, response));
      }),
    );
  }
}

export function toSuccessEnvelope(
  body: unknown,
  requestId: string,
  now: Date = new Date(),
): ApiSuccessEnvelope {
  const meta: ApiResponseMeta = { requestId, timestamp: now.toISOString() };
  if (!isHandlerEnvelope(body)) {
    return { success: true, data: body ?? null, meta };
  }
  if (body.meta !== undefined) meta.pagination = body.meta;
  return { success: true, data: body.data, meta };
}

const HANDLER_ENVELOPE_KEYS = new Set(['success', 'data', 'meta']);

/**
 * Services that already return `{ success: true, data, meta? }` are unwrapped
 * instead of nested. Such a result may carry nothing else, and its `meta` can
 * only be pagination; anything more is a programming error and fails loudly
 * rather than reaching clients in an undocumented shape.
 */
function isHandlerEnvelope(
  body: unknown,
): body is { success: true; data: unknown; meta?: PaginationMeta } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return false;
  }
  const record = body as Record<string, unknown>;
  if (
    record.success !== true ||
    !Object.prototype.hasOwnProperty.call(record, 'data')
  ) {
    return false;
  }
  if (
    !Object.keys(record).every((key) => HANDLER_ENVELOPE_KEYS.has(key)) ||
    (record.meta !== undefined && !isPaginationMeta(record.meta))
  ) {
    throw new Error('Handler envelope carries unsupported fields.');
  }
  return true;
}

function isPaginationMeta(value: unknown): value is PaginationMeta {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const keys = ['page', 'limit', 'total', 'totalPages'];
  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => Number.isInteger(record[key]))
  );
}
