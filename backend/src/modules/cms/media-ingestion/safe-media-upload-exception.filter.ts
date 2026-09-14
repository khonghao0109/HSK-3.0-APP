import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { writeErrorEnvelope } from '../../../common/filters/global-exception.filter';

const SAFE_BAD_REQUEST_MESSAGES = new Set([
  'Idempotency-Key is invalid.',
  'Upload filename is not allowed.',
]);

/**
 * Multer and multipart parsing errors can quote filenames or field values, so
 * only known-safe 400 bodies pass through. The output uses the global error
 * envelope; exceptions other than HttpException reach GlobalExceptionFilter.
 */
@Catch(HttpException)
export class SafeMediaUploadExceptionFilter implements ExceptionFilter<HttpException> {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    if (exception instanceof PayloadTooLargeException) {
      writeErrorEnvelope(request, response, 413, {
        code: 'UPLOAD_TOO_LARGE',
        message: 'Media upload exceeds the allowed size.',
      });
      return;
    }
    if (exception instanceof BadRequestException) {
      const body = exception.getResponse();
      writeErrorEnvelope(
        request,
        response,
        400,
        isSafeValidationBody(body) || hasSafeMessage(body)
          ? body
          : {
              code: 'MULTIPART_INVALID',
              message: 'Media upload request is malformed.',
            },
      );
      return;
    }
    writeErrorEnvelope(
      request,
      response,
      exception.getStatus(),
      exception.getResponse(),
    );
  }
}

function hasSafeMessage(value: string | object): boolean {
  if (typeof value === 'string') return SAFE_BAD_REQUEST_MESSAGES.has(value);
  return (
    value !== null &&
    'message' in value &&
    typeof value.message === 'string' &&
    SAFE_BAD_REQUEST_MESSAGES.has(value.message)
  );
}

function isSafeValidationBody(value: string | object): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    value.code === 'REQUEST_VALIDATION_FAILED'
  );
}
