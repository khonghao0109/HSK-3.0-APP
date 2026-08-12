import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Response } from 'express';

const SAFE_BAD_REQUEST_MESSAGES = new Set([
  'Idempotency-Key is invalid.',
  'Upload filename is not allowed.',
]);

@Catch(HttpException)
export class SafeMediaUploadExceptionFilter implements ExceptionFilter<HttpException> {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof PayloadTooLargeException) {
      response.status(413).json({
        statusCode: 413,
        code: 'UPLOAD_TOO_LARGE',
        message: 'Media upload exceeds the allowed size.',
      });
      return;
    }
    if (exception instanceof BadRequestException) {
      const body = exception.getResponse();
      if (isSafeValidationBody(body) || hasSafeMessage(body)) {
        response.status(400).json(body);
        return;
      }
      response.status(400).json({
        statusCode: 400,
        code: 'MULTIPART_INVALID',
        message: 'Media upload request is malformed.',
      });
      return;
    }
    response.status(exception.getStatus()).json(exception.getResponse());
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
