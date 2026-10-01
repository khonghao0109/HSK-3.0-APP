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
export const MEDIA_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const MEDIA_BUSY_DRAIN_MAX_BYTES = MEDIA_UPLOAD_MAX_BYTES + 1024 * 1024; // 1 MiB overhead for multipart padding and headers

type IngestionTerminalOutcome =
  | 'success'
  | 'rejected'
  | 'failed'
  | 'cleanup_required'
  | 'disabled';

const observationKey = Symbol('media-ingestion-request-observation');

type BoundaryRequest = Request & {
  [observationKey]?: MediaRequestObservation<IngestionTerminalOutcome>;
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
      const busyException = new ServiceUnavailableException({
        code: 'MEDIA_INGESTION_BUSY',
        message: 'Media ingestion service is busy. Please try again later.',
      });

      response.setHeader('Retry-After', '1');

      const clHeader = request.headers['content-length'];
      const cl = clHeader ? parseInt(clHeader, 10) : NaN;
      const transferEncoding = request.headers['transfer-encoding'];
      const isChunked =
        typeof transferEncoding === 'string' &&
        transferEncoding.includes('chunked');

      const hasBody = isChunked || (!isNaN(cl) && cl > 0);
      const observation = this.metrics?.beginIngestionRequest();

      if (!hasBody) {
        // No body to drain — return 503 immediately without destroying the socket.
        observation?.complete('failed');
        return throwError(() => busyException);
      }

      if (!isNaN(cl) && cl > MEDIA_BUSY_DRAIN_MAX_BYTES) {
        // Content-Length exceeds drain limit — fail fast, close after response.
        closeAfterResponse(request, response);
        observation?.complete('failed');
        return throwError(() => busyException);
      }

      const timeoutMs = boundedUploadTimeout(
        this.config.get<number>('media.uploadTimeoutMs'),
      );

      return drainBusyRequest(
        request,
        response,
        timeoutMs,
        observation,
        busyException,
      );
    }

    let slotReleased = false;
    const releaseSlot = () => {
      if (!slotReleased) {
        slotReleased = true;
        this.limiter.release();
      }
    };

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

function uploadDeadline(
  request: BoundaryRequest,
  response: Response,
  timeoutMs: number,
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
      subscriber.error(
        new BadRequestException({
          code: 'MEDIA_UPLOAD_ABORTED',
          message: 'Media upload request was interrupted.',
        }),
      );
    };
    const timer = setTimeout(() => {
      if (uploadEnded) return;
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

function drainBusyRequest(
  request: BoundaryRequest,
  response: Response,
  timeoutMs: number,
  observation: MediaRequestObservation<IngestionTerminalOutcome> | undefined,
  busyException: ServiceUnavailableException,
): Observable<never> {
  return new Observable<never>((subscriber) => {
    let totalReceived = 0;
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      closeAfterResponse(request, response);
      subscriber.error(busyException);
    }, timeoutMs);
    timer.unref?.();

    const onData = (chunk: Buffer) => {
      totalReceived += chunk.length;
      if (totalReceived > MEDIA_BUSY_DRAIN_MAX_BYTES && !finished) {
        finished = true;
        cleanup();
        closeAfterResponse(request, response);
        subscriber.error(busyException);
      }
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      closeAfterResponse(request, response);
      subscriber.error(busyException);
    };

    const onAborted = () => {
      if (finished) return;
      finished = true;
      cleanup();
      // Client socket is already gone; error instead of complete to avoid
      // EmptyError from lastValueFrom in the Nest interceptor chain.
      subscriber.error(
        new BadRequestException({
          code: 'MEDIA_UPLOAD_ABORTED',
          message: 'Media upload request was interrupted.',
        }),
      );
    };

    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('aborted', onAborted);
      request.off('close', onAborted);
    };

    if (request.readableEnded) {
      onEnd();
    } else {
      request.on('data', onData);
      request.on('end', onEnd);
      request.on('aborted', onAborted);
      request.on('close', onAborted);
      request.resume();
    }

    return () => {
      if (!finished) {
        finished = true;
        cleanup();
      }
      observation?.complete('failed');
    };
  });
}
