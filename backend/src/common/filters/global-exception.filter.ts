import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';

import type { ApiErrorEnvelope } from '../interfaces/api-response.interface';
import { resolveRequestId } from '../middleware/request-id.middleware';

// Fields Nest adds to every HttpException body; the envelope replaces them.
const FRAMEWORK_FIELDS = new Set(['statusCode', 'error', 'code', 'message']);

/**
 * Turns every exception into the `{ success: false, error, meta }` envelope.
 * HttpException bodies are authored by this codebase and keep their `code`,
 * `message` and extra fields (as `details`). Anything else (Prisma, driver,
 * programming errors) becomes a generic 500 whose message and log line never
 * include the original error text, which can carry SQL or row values.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (exception instanceof HttpException) {
      writeErrorEnvelope(
        request,
        response,
        exception.getStatus(),
        withoutReflectedInput(exception),
      );
      return;
    }

    const clientStatus = clientErrorStatus(exception);
    if (clientStatus !== undefined) {
      // Express body parser errors (malformed JSON, oversized body). Their
      // messages can quote the request body, so only the status is kept.
      writeErrorEnvelope(request, response, clientStatus, {});
      return;
    }

    this.logger.error(
      `Unhandled ${errorName(exception)} (requestId=${resolveRequestId(request)})`,
    );
    writeErrorEnvelope(request, response, HttpStatus.INTERNAL_SERVER_ERROR, {
      message: 'Internal server error.',
    });
  }
}

/**
 * Writes the error envelope for `status`. `payload` is an HttpException body:
 * a message string, or an object whose `code` and `message` are used and whose
 * remaining non-framework fields become `details`.
 */
export function writeErrorEnvelope(
  request: Request,
  response: Response,
  status: number,
  payload: string | object,
): void {
  const requestId = resolveRequestId(request, response);
  if (response.headersSent) {
    // A streamed body already started; the connection is all that is left.
    response.end();
    return;
  }
  const body: ApiErrorEnvelope = {
    success: false,
    error: errorBody(status, payload),
    meta: { requestId, timestamp: new Date().toISOString() },
  };
  response.status(status).json(body);
}

function errorBody(
  status: number,
  payload: string | object,
): ApiErrorEnvelope['error'] {
  const record: Record<string, unknown> =
    typeof payload === 'string' ? { message: payload } : { ...payload };
  const code =
    typeof record.code === 'string' && record.code.length > 0
      ? record.code
      : statusCode(status);
  const message =
    typeof record.message === 'string' && record.message.length > 0
      ? record.message
      : (STATUS_CODES[status] ?? 'Error');

  const details = Object.fromEntries(
    Object.entries(record).filter(([key]) => !FRAMEWORK_FIELDS.has(key)),
  );
  if (Array.isArray(record.message)) details.messages = record.message;

  return Object.keys(details).length > 0
    ? { code, message, details }
    : { code, message };
}

// Nest rethrows Express body-parser SyntaxError and router URIError as
// `new BadRequestException(err.message)`, and answers unknown routes with
// `Cannot <METHOD> <originalUrl>`. Those messages quote the request: a JSON
// fragment of the body (passwords included) or the raw path and query string.
const PARSER_MESSAGE = /\bJSON\b|^Failed to decode param |^URI malformed$/u;
const ROUTE_NOT_FOUND_MESSAGE = /^(Cannot [A-Z]+ )([^?#]*)/u;

function withoutReflectedInput(exception: HttpException): string | object {
  const payload = exception.getResponse();
  if (typeof payload !== 'object' || 'code' in payload) return payload;
  const message = (payload as { message?: unknown }).message;
  if (typeof message !== 'string') return payload;

  const status = exception.getStatus();
  if (status === 400 && PARSER_MESSAGE.test(message)) {
    return {
      code: 'MALFORMED_REQUEST',
      message: 'Request body or path could not be parsed.',
    };
  }
  const notFound =
    status === 404 ? ROUTE_NOT_FOUND_MESSAGE.exec(message) : null;
  if (notFound) return { message: `${notFound[1]}${notFound[2]}` };
  return payload;
}

function statusCode(status: number): string {
  const name = (HttpStatus as Record<number, string | undefined>)[status];
  return name ?? `HTTP_${status}`;
}

function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, statusCode: code } = exception as Record<string, unknown>;
  const candidate = typeof status === 'number' ? status : code;
  return typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 400 &&
    candidate < 500
    ? candidate
    : undefined;
}

function errorName(exception: unknown): string {
  return exception instanceof Error ? exception.constructor.name : 'value';
}
