import { EventEmitter } from 'node:events';

import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, NEVER, of, Subject, throwError } from 'rxjs';

import {
  getMediaIngestionObservation,
  MediaIngestionBoundaryInterceptor,
} from './media-ingestion-boundary.interceptor';
import { MediaIngestionConcurrencyLimiter } from './media-ingestion-concurrency.limiter';

describe('MediaIngestionBoundaryInterceptor', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts one request observation before multipart processing and exposes it to the service', async () => {
    const fixture = createFixture();
    const next: CallHandler = {
      handle: jest.fn(() => {
        expect(fixture.metrics.beginIngestionRequest).toHaveBeenCalledTimes(1);
        getMediaIngestionObservation(fixture.request as never)?.complete(
          'success',
          17,
        );
        return of({ success: true });
      }),
    };

    await expect(
      firstValueFrom(fixture.interceptor.intercept(fixture.context, next)),
    ).resolves.toEqual({ success: true });
    expect(fixture.complete).toHaveBeenCalledTimes(1);
    expect(fixture.complete).toHaveBeenCalledWith('success', 17);
  });

  it('maps a multipart rejection to one rejected terminal outcome', async () => {
    const fixture = createFixture();
    const error = new PayloadTooLargeException();

    await expect(
      firstValueFrom(
        fixture.interceptor.intercept(fixture.context, {
          handle: () => throwError(() => error),
        }),
      ),
    ).rejects.toBe(error);
    expect(fixture.complete).toHaveBeenCalledTimes(1);
    expect(fixture.complete).toHaveBeenCalledWith('rejected');
  });

  it('terminates a stalled multipart upload at one absolute deadline', async () => {
    jest.useFakeTimers();
    const fixture = createFixture(25);

    const result = firstValueFrom(
      fixture.interceptor.intercept(fixture.context, { handle: () => NEVER }),
    );
    const rejection = expect(result).rejects.toMatchObject({
      response: {
        code: 'MEDIA_UPLOAD_TIMEOUT',
        message: 'Media upload did not complete within the allowed time.',
      },
      status: 408,
    });
    await jest.advanceTimersByTimeAsync(24);
    expect(fixture.complete).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    await rejection;
    expect(fixture.complete).toHaveBeenCalledTimes(1);
    expect(fixture.complete).toHaveBeenCalledWith('failed');
    expect(fixture.request.unpipe).toHaveBeenCalledTimes(1);
    expect(fixture.request.resume).toHaveBeenCalledTimes(1);
    expect(fixture.response.setHeader).toHaveBeenCalledWith(
      'Connection',
      'close',
    );
    expect(fixture.request.destroy).not.toHaveBeenCalled();
    fixture.response.emit('finish');
    expect(fixture.request.destroy).toHaveBeenCalledTimes(1);
    expect(fixture.response.listenerCount('finish')).toBe(0);
    expect(fixture.response.listenerCount('close')).toBe(0);
  });

  it('clears the upload deadline at request end while retaining request accounting through the handler', async () => {
    jest.useFakeTimers();
    const fixture = createFixture(25);
    const handler = new Subject<{ success: true }>();
    const result = firstValueFrom(
      fixture.interceptor.intercept(fixture.context, {
        handle: () => handler,
      }),
    );

    fixture.request.emit('end');
    await jest.advanceTimersByTimeAsync(100);
    expect(fixture.complete).not.toHaveBeenCalled();
    expect(fixture.request.unpipe).not.toHaveBeenCalled();

    handler.next({ success: true });
    handler.complete();
    await expect(result).resolves.toEqual({ success: true });
    expect(fixture.complete).toHaveBeenCalledTimes(1);
    expect(fixture.complete).toHaveBeenCalledWith('success');
  });

  it('settles an interrupted client upload once and clears request listeners', async () => {
    jest.useFakeTimers();
    const fixture = createFixture();
    const result = firstValueFrom(
      fixture.interceptor.intercept(fixture.context, { handle: () => NEVER }),
    );
    const rejection = expect(result).rejects.toMatchObject({
      response: {
        code: 'MEDIA_UPLOAD_ABORTED',
        message: 'Media upload request was interrupted.',
      },
    });

    fixture.request.emit('aborted');
    await rejection;

    expect(fixture.complete).toHaveBeenCalledTimes(1);
    expect(fixture.complete).toHaveBeenCalledWith('rejected');
    expect(fixture.request.listenerCount('end')).toBe(0);
    expect(fixture.request.listenerCount('aborted')).toBe(0);
  });

  describe('when busy (concurrency limit reached)', () => {
    it('1) drains body to end then returns 503 MEDIA_INGESTION_BUSY with headers, without destroying request', async () => {
      // Create a real ConfigService mock that returns 1
      const configServiceMock = new ConfigService({
        media: { maxConcurrency: 1 },
      });
      const realLimiter = new MediaIngestionConcurrencyLimiter(
        configServiceMock,
      );

      // Acquire the only slot to make it busy
      realLimiter.tryAcquire();

      const fixture = createFixture(30_000, realLimiter);
      const next: CallHandler = { handle: jest.fn() };

      const result = firstValueFrom(
        fixture.interceptor.intercept(fixture.context, next),
      );

      // 7) activeCount không tăng
      expect(realLimiter.activeCount).toBe(1);

      const rejection = expect(result).rejects.toMatchObject({
        status: 503,
        response: { code: 'MEDIA_INGESTION_BUSY' },
      });

      fixture.request.emit('data', Buffer.alloc(1024));
      fixture.request.emit('end');

      await rejection;

      expect(fixture.response.setHeader).toHaveBeenCalledWith(
        'Retry-After',
        '1',
      );
      expect(fixture.response.setHeader).toHaveBeenCalledWith(
        'Connection',
        'close',
      );
      expect(fixture.request.destroy).not.toHaveBeenCalled();
      // 8) observation complete 1 lần
      expect(fixture.complete).toHaveBeenCalledWith('failed');
      expect(fixture.complete).toHaveBeenCalledTimes(1);
    });

    it('2) does not destroy request prematurely if content-length > max bytes, only after finish', async () => {
      const fixture = createFixture();
      fixture.limiter.tryAcquire.mockReturnValue(false);
      fixture.request.headers = { 'content-length': '9999999999' };

      const result = firstValueFrom(
        fixture.interceptor.intercept(fixture.context, { handle: jest.fn() }),
      );

      const rejection = expect(result).rejects.toMatchObject({ status: 503 });

      expect(fixture.request.destroy).not.toHaveBeenCalled();
      expect(fixture.complete).toHaveBeenCalledWith('failed');

      await rejection;
      fixture.response.emit('finish');
      expect(fixture.request.destroy).toHaveBeenCalledTimes(1);
    });

    it('3) returns 503 without destroying if request has no body', async () => {
      const fixture = createFixture();
      fixture.limiter.tryAcquire.mockReturnValue(false);
      fixture.request.headers = {}; // no body indicator

      const result = firstValueFrom(
        fixture.interceptor.intercept(fixture.context, { handle: jest.fn() }),
      );

      await expect(result).rejects.toMatchObject({ status: 503 });
      expect(fixture.request.destroy).not.toHaveBeenCalled();
      expect(fixture.complete).toHaveBeenCalledWith('failed');
    });

    it('4) destroys request if drained bytes exceed max limit', async () => {
      const fixture = createFixture();
      fixture.limiter.tryAcquire.mockReturnValue(false);

      const result = firstValueFrom(
        fixture.interceptor.intercept(fixture.context, { handle: jest.fn() }),
      );

      const rejection = expect(result).rejects.toMatchObject({ status: 503 });

      fixture.request.emit('data', Buffer.alloc(11 * 1024 * 1024 + 1));

      await rejection;
      expect(fixture.request.destroy).not.toHaveBeenCalled();
      fixture.response.emit('finish');
      expect(fixture.request.destroy).toHaveBeenCalledTimes(1);
      expect(fixture.complete).toHaveBeenCalledWith('failed');
    });

    it('5) errors with 503 if deadline is reached during drain', async () => {
      jest.useFakeTimers();
      const fixture = createFixture(30_000);
      fixture.limiter.tryAcquire.mockReturnValue(false);

      const result = firstValueFrom(
        fixture.interceptor.intercept(fixture.context, { handle: jest.fn() }),
      );

      const rejection = expect(result).rejects.toMatchObject({ status: 503 });

      await jest.advanceTimersByTimeAsync(30_000);

      await rejection;
      expect(fixture.complete).toHaveBeenCalledWith('failed');
    });

    it('6) errors with MEDIA_UPLOAD_ABORTED and clears listeners if client aborted during drain', async () => {
      jest.useFakeTimers();
      const fixture = createFixture();
      fixture.limiter.tryAcquire.mockReturnValue(false);

      const result = firstValueFrom(
        fixture.interceptor.intercept(fixture.context, { handle: jest.fn() }),
      );

      const rejection = expect(result).rejects.toMatchObject({
        response: {
          code: 'MEDIA_UPLOAD_ABORTED',
          message: 'Media upload request was interrupted.',
        },
      });

      fixture.request.emit('aborted');

      await rejection;
      expect(fixture.complete).toHaveBeenCalledWith('failed');
      expect(fixture.complete).toHaveBeenCalledTimes(1);
      expect(fixture.request.listenerCount('data')).toBe(0);
      expect(fixture.request.listenerCount('end')).toBe(0);
      expect(fixture.request.listenerCount('aborted')).toBe(0);
      expect(fixture.request.listenerCount('close')).toBe(0);
    });

    it('7) does not acquire an additional slot while draining a busy request', async () => {
      const realLimiter = new MediaIngestionConcurrencyLimiter(
        new ConfigService({ media: { maxConcurrency: 1 } }),
      );
      // Occupy the only slot externally
      realLimiter.tryAcquire();
      expect(realLimiter.activeCount).toBe(1);

      const fixture = createFixture(30_000, realLimiter);

      const result = firstValueFrom(
        fixture.interceptor.intercept(fixture.context, { handle: jest.fn() }),
      );

      // While draining, activeCount must stay at 1 (the pre-held slot)
      expect(realLimiter.activeCount).toBe(1);

      fixture.request.emit('data', Buffer.alloc(512));
      expect(realLimiter.activeCount).toBe(1);

      fixture.request.emit('end');
      await expect(result).rejects.toMatchObject({ status: 503 });

      // After drain completes, the externally held slot is still 1
      expect(realLimiter.activeCount).toBe(1);
    });

    it('8) calls observation complete with failed exactly once for every busy branch', async () => {
      // Branch: no body
      const noBody = createFixture();
      noBody.limiter.tryAcquire.mockReturnValue(false);
      noBody.request.headers = {};
      await expect(
        firstValueFrom(
          noBody.interceptor.intercept(noBody.context, { handle: jest.fn() }),
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect(noBody.complete).toHaveBeenCalledTimes(1);
      expect(noBody.complete).toHaveBeenCalledWith('failed');

      // Branch: content-length > limit
      const bigCl = createFixture();
      bigCl.limiter.tryAcquire.mockReturnValue(false);
      bigCl.request.headers = { 'content-length': '9999999999' };
      await expect(
        firstValueFrom(
          bigCl.interceptor.intercept(bigCl.context, { handle: jest.fn() }),
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect(bigCl.complete).toHaveBeenCalledTimes(1);
      expect(bigCl.complete).toHaveBeenCalledWith('failed');

      // Branch: drain to end — pre-attach rejection handler to prevent
      // unhandled-rejection warning from the synchronous emit below.
      const drainEnd = createFixture(60_000);
      drainEnd.limiter.tryAcquire.mockReturnValue(false);
      const drainEndResult = firstValueFrom(
        drainEnd.interceptor.intercept(drainEnd.context, {
          handle: jest.fn(),
        }),
      );
      drainEndResult.catch(() => {});
      drainEnd.request.emit('data', Buffer.alloc(64));
      drainEnd.request.emit('end');
      await expect(drainEndResult).rejects.toMatchObject({ status: 503 });
      expect(drainEnd.complete).toHaveBeenCalledTimes(1);
      expect(drainEnd.complete).toHaveBeenCalledWith('failed');

      // Branch: exceeded drain byte limit
      const overBytes = createFixture(60_000);
      overBytes.limiter.tryAcquire.mockReturnValue(false);
      const overBytesResult = firstValueFrom(
        overBytes.interceptor.intercept(overBytes.context, {
          handle: jest.fn(),
        }),
      );
      overBytesResult.catch(() => {});
      overBytes.request.emit('data', Buffer.alloc(11 * 1024 * 1024 + 1));
      await expect(overBytesResult).rejects.toMatchObject({ status: 503 });
      expect(overBytes.complete).toHaveBeenCalledTimes(1);
      expect(overBytes.complete).toHaveBeenCalledWith('failed');

      // Branch: deadline exceeded — requires fake timers
      jest.useFakeTimers();
      const deadline = createFixture(50);
      deadline.limiter.tryAcquire.mockReturnValue(false);
      const deadlineResult = firstValueFrom(
        deadline.interceptor.intercept(deadline.context, {
          handle: jest.fn(),
        }),
      );
      deadlineResult.catch(() => {});
      await jest.advanceTimersByTimeAsync(50);
      await expect(deadlineResult).rejects.toMatchObject({ status: 503 });
      expect(deadline.complete).toHaveBeenCalledTimes(1);
      expect(deadline.complete).toHaveBeenCalledWith('failed');
      jest.useRealTimers();

      // Branch: client abort
      const abort = createFixture();
      abort.limiter.tryAcquire.mockReturnValue(false);
      const abortResult = firstValueFrom(
        abort.interceptor.intercept(abort.context, { handle: jest.fn() }),
      );
      abortResult.catch(() => {});
      abort.request.emit('aborted');
      await expect(abortResult).rejects.toMatchObject({
        response: { code: 'MEDIA_UPLOAD_ABORTED' },
      });
      expect(abort.complete).toHaveBeenCalledTimes(1);
      expect(abort.complete).toHaveBeenCalledWith('failed');
    });

    it('9) client abort during drain errors with BadRequestException MEDIA_UPLOAD_ABORTED, not empty complete', async () => {
      const fixture = createFixture();
      fixture.limiter.tryAcquire.mockReturnValue(false);

      const result = firstValueFrom(
        fixture.interceptor.intercept(fixture.context, { handle: jest.fn() }),
      );

      fixture.request.emit('data', Buffer.alloc(256));
      fixture.request.emit('aborted');

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toMatchObject({
        response: {
          code: 'MEDIA_UPLOAD_ABORTED',
          message: 'Media upload request was interrupted.',
        },
      });
      expect(fixture.complete).toHaveBeenCalledTimes(1);
      expect(fixture.complete).toHaveBeenCalledWith('failed');
    });
  });

  it('releases acquired slot exactly once on success', async () => {
    const fixture = createFixture();
    const next: CallHandler = { handle: () => of({ ok: true }) };

    await firstValueFrom(fixture.interceptor.intercept(fixture.context, next));
    expect(fixture.limiter.tryAcquire).toHaveBeenCalledTimes(1);
    expect(fixture.limiter.release).toHaveBeenCalledTimes(1);
  });

  it('releases acquired slot exactly once on error', async () => {
    const fixture = createFixture();
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    await expect(
      firstValueFrom(fixture.interceptor.intercept(fixture.context, next)),
    ).rejects.toThrow('boom');
    expect(fixture.limiter.tryAcquire).toHaveBeenCalledTimes(1);
    expect(fixture.limiter.release).toHaveBeenCalledTimes(1);
  });

  it('releases acquired slot exactly once on upload timeout', async () => {
    jest.useFakeTimers();
    const fixture = createFixture(25);
    const result = firstValueFrom(
      fixture.interceptor.intercept(fixture.context, { handle: () => NEVER }),
    );
    const rejection = expect(result).rejects.toMatchObject({ status: 408 });
    await jest.advanceTimersByTimeAsync(25);
    await rejection;
    expect(fixture.limiter.release).toHaveBeenCalledTimes(1);
  });

  it('releases acquired slot exactly once on client abort', async () => {
    const fixture = createFixture();
    const result = firstValueFrom(
      fixture.interceptor.intercept(fixture.context, { handle: () => NEVER }),
    );
    const rejection = expect(result).rejects.toMatchObject({
      response: { code: 'MEDIA_UPLOAD_ABORTED' },
    });
    fixture.request.emit('aborted');
    await rejection;
    expect(fixture.limiter.release).toHaveBeenCalledTimes(1);
  });

  it('retains acquired slot when request ends and response closes while handler is pending, releasing when handler settles', () => {
    const realLimiter = new MediaIngestionConcurrencyLimiter(
      new ConfigService({ media: { maxConcurrency: 1 } }),
    );
    const fixture = createFixture(30_000, realLimiter);
    const handler$ = new Subject<{ ok: boolean }>();

    expect(realLimiter.activeCount).toBe(0);
    const result$ = fixture.interceptor.intercept(fixture.context, {
      handle: () => handler$,
    });
    const sub = result$.subscribe({ next: () => {}, error: () => {} });

    expect(realLimiter.activeCount).toBe(1);

    // Client finishes uploading body
    fixture.request.emit('end');
    expect(realLimiter.activeCount).toBe(1);

    // Client closes connection before response finishes (res close)
    fixture.response.emit('close');
    expect(realLimiter.activeCount).toBe(1);

    // Handler settles
    handler$.next({ ok: true });
    handler$.complete();

    expect(realLimiter.activeCount).toBe(0);
    sub.unsubscribe();
  });
});

type MockLimiter = {
  tryAcquire: jest.Mock<boolean, []>;
  release: jest.Mock<void, []>;
};

function createFixture(
  uploadTimeoutMs = 30_000,
  limiterOverride?: MediaIngestionConcurrencyLimiter,
) {
  const headers: Record<string, string> = { 'transfer-encoding': 'chunked' };
  const request = Object.assign(new EventEmitter(), {
    headers,
    complete: false,
    destroyed: false,
    readableEnded: false,
    destroy: jest.fn(function destroy(this: { destroyed: boolean }) {
      this.destroyed = true;
    }),
    resume: jest.fn(),
    unpipe: jest.fn(),
  });
  const response = Object.assign(new EventEmitter(), {
    setHeader: jest.fn(),
    shouldKeepAlive: true,
    writableEnded: false,
  });
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  const complete = jest.fn();
  const observation = { complete };
  const metrics = {
    beginIngestionRequest: jest.fn(() => observation),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'media.uploadTimeoutMs' ? uploadTimeoutMs : undefined,
    ),
  };
  const defaultLimiter: MockLimiter = {
    tryAcquire: jest.fn(() => true),
    release: jest.fn(),
  };
  const limiter = limiterOverride ?? defaultLimiter;
  const interceptor = new MediaIngestionBoundaryInterceptor(
    config as never,
    limiter as never,
    metrics as never,
  );
  return {
    complete,
    config,
    context,
    interceptor,
    limiter: defaultLimiter,
    metrics,
    observation,
    request,
    response,
  };
}
