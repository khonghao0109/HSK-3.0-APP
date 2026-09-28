import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  Optional,
  PayloadTooLargeException,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  catchError,
  finalize,
  NEVER,
  Observable,
  race,
  tap,
  throwError,
} from 'rxjs';

import {
  MediaObservabilityService,
  MediaRequestObservation,
} from '../../../infrastructure/observability/media-observability.service';
import { MediaIngestionConcurrencyLimiter } from './media-ingestion-concurrency.limiter';

export const MEDIA_UPLOAD_TIMEOUT_MS = 30_000;

type IngestionTerminalOutcome =
  | 'success'
  | 'rejected'
  | 'failed'
  | 'cleanup_required'
  | 'disabled';

const observationKey = Symbol('media-ingestion-request-observation');
const abortSignalKey = Symbol('media-ingestion-abort-signal');

type BoundaryRequest = Request & {
  [observationKey]?: MediaRequestObservation<IngestionTerminalOutcome>;
  [abortSignalKey]?: AbortSignal;
};

@Injectable()
export class MediaIngestionBoundaryInterceptor implements NestInterceptor {
  constructor(
    private readonly config: ConfigService,
    private readonly limiter: MediaIngestionConcurrencyLimiter,
    @Optional() private readonly metrics?: MediaObservabilityService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<BoundaryRequest>();
    const response = http.getResponse<Response>();

    if (!this.limiter.tryAcquire()) {
      response.setHeader('Retry-After', '1');
      closeAfterResponse(request, response);
      const busyException = new ServiceUnavailableException({
        code: 'MEDIA_INGESTION_BUSY',
        message: 'Media ingestion service is busy. Please try again later.',
      });
      const observation = this.metrics?.beginIngestionRequest();
      observation?.complete('failed');
      return throwError(() => busyException);
    }

    let slotReleased = false;
    const releaseSlot = () => {
      if (!slotReleased) {
        slotReleased = true;
        this.limiter.release();
      }
    };

    const abortController = new AbortController();
    request[abortSignalKey] = abortController.signal;

    const onResponseClose = () => {
      if (!response.writableEnded) {
        abortController.abort(new Error('MEDIA_UPLOAD_ABORTED'));
      }
    };
    response.once('close', onResponseClose);

    const onRequestClose = () => {
      if (!request.complete) {
        abortController.abort(new Error('MEDIA_UPLOAD_ABORTED'));
      }
    };
    request.once('close', onRequestClose);

    const observation = this.metrics?.beginIngestionRequest();
    let completed = false;
    const complete = (
      outcome: IngestionTerminalOutcome,
      milliseconds?: number,
    ) => {
      if (completed) return;
      completed = true;
      if (milliseconds === undefined) observation?.complete(outcome);
      else observation?.complete(outcome, milliseconds);
    };
    if (observation) request[observationKey] = { complete };

    const deadline = uploadDeadline(
      request,
      response,
      boundedUploadTimeout(this.config.get<number>('media.uploadTimeoutMs')),
      abortController,
    );
    return race(deadline, next.handle()).pipe(
      tap(() => complete('success')),
      catchError((error: unknown) => {
        complete(ingestionBoundaryOutcome(error));
        return throwError(() => error);
      }),
      // Covers a client disconnect or an interceptor that completes without a
      // controller value.
      finalize(() => {
        response.off('close', onResponseClose);
        request.off('close', onRequestClose);
        if (!response.writableEnded && !abortController.signal.aborted) {
          abortController.abort(new Error('MEDIA_UPLOAD_ABORTED'));
        }
        releaseSlot();
        complete('failed');
      }),
    );
  }
}

export function getMediaIngestionObservation(
  request: Request,
): MediaRequestObservation<IngestionTerminalOutcome> | undefined {
  return (request as BoundaryRequest)[observationKey];
}

export function getMediaIngestionAbortSignal(
  request: Request,
): AbortSignal | undefined {
  return (request as BoundaryRequest)[abortSignalKey];
}

function uploadDeadline(
  request: BoundaryRequest,
  response: Response,
  timeoutMs: number,
  abortController: AbortController,
): Observable<never> {
  if (request.complete || request.readableEnded) return NEVER;

  return new Observable<never>((subscriber) => {
    let uploadEnded = false;
    const clear = () => {
      uploadEnded = true;
      clearTimeout(timer);
    };
    const abort = () => {
      clearTimeout(timer);
      abortController.abort(new Error('MEDIA_UPLOAD_ABORTED'));
      subscriber.error(
        new BadRequestException({
          code: 'MEDIA_UPLOAD_ABORTED',
          message: 'Media upload request was interrupted.',
        }),
      );
    };
    const timer = setTimeout(() => {
      if (uploadEnded) return;
      abortController.abort(new Error('MEDIA_UPLOAD_TIMEOUT'));
      closeAfterResponse(request, response);
      subscriber.error(
        new RequestTimeoutException({
          code: 'MEDIA_UPLOAD_TIMEOUT',
          message: 'Media upload did not complete within the allowed time.',
        }),
      );
    }, timeoutMs);
    timer.unref?.();
    request.once('end', clear);
    request.once('aborted', abort);

    return () => {
      clearTimeout(timer);
      request.off('end', clear);
      request.off('aborted', abort);
    };
  });
}

function closeAfterResponse(request: BoundaryRequest, response: Response) {
  response.shouldKeepAlive = false;
  response.setHeader('Connection', 'close');
  request.unpipe();
  request.resume();
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    response.off('finish', destroy);
    response.off('close', destroy);
    if (!request.destroyed) request.destroy();
  };
  response.once('finish', destroy);
  response.once('close', destroy);
}

function ingestionBoundaryOutcome(error: unknown): IngestionTerminalOutcome {
  if (
    error instanceof PayloadTooLargeException ||
    error instanceof BadRequestException
  ) {
    return 'rejected';
  }
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (
      response &&
      typeof response === 'object' &&
      'code' in response &&
      (response.code === 'MEDIA_CLEANUP_REQUIRED' ||
        response.code === 'MEDIA_CLEANUP_OUTCOME_UNKNOWN')
    ) {
      return 'cleanup_required';
    }
  }
  return 'failed';
}

function boundedUploadTimeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value ?? MEDIA_UPLOAD_TIMEOUT_MS, 120_000)
    : MEDIA_UPLOAD_TIMEOUT_MS;
}
