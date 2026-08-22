import { EventEmitter } from 'node:events';

import {
  CallHandler,
  ExecutionContext,
  PayloadTooLargeException,
} from '@nestjs/common';
import { firstValueFrom, NEVER, of, Subject, throwError } from 'rxjs';

import {
  getMediaIngestionObservation,
  MediaIngestionBoundaryInterceptor,
} from './media-ingestion-boundary.interceptor';

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
});

function createFixture(uploadTimeoutMs = 30_000) {
  const request = Object.assign(new EventEmitter(), {
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
  const interceptor = new MediaIngestionBoundaryInterceptor(
    config as never,
    metrics as never,
  );
  return {
    complete,
    config,
    context,
    interceptor,
    metrics,
    observation,
    request,
    response,
  };
}
