import { ConfigService } from '@nestjs/config';

import { MediaIngestionConcurrencyLimiter } from './media-ingestion-concurrency.limiter';

describe('MediaIngestionConcurrencyLimiter', () => {
  it('defaults to 4 concurrent slots when configuration is missing or invalid', () => {
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;
    const limiter = new MediaIngestionConcurrencyLimiter(config);

    expect(limiter.limit).toBe(4);
    expect(limiter.activeCount).toBe(0);
  });

  it.each([1, 2, 8, 16])(
    'accepts a valid bounded concurrency limit of %i',
    (limit) => {
      const config = {
        get: jest.fn((key: string) =>
          key === 'media.maxConcurrency' ? limit : undefined,
        ),
      } as unknown as ConfigService;
      const limiter = new MediaIngestionConcurrencyLimiter(config);

      expect(limiter.limit).toBe(limit);
    },
  );

  it('falls back to 4 when configured limit is out of 1-16 bounds or non-integer', () => {
    const limiterNegative = new MediaIngestionConcurrencyLimiter({
      get: () => 0,
    } as unknown as ConfigService);
    expect(limiterNegative.limit).toBe(4);

    const limiterOver = new MediaIngestionConcurrencyLimiter({
      get: () => 17,
    } as unknown as ConfigService);
    expect(limiterOver.limit).toBe(4);

    const limiterFloat = new MediaIngestionConcurrencyLimiter({
      get: () => 3.5,
    } as unknown as ConfigService);
    expect(limiterFloat.limit).toBe(4);
  });

  it('acquires up to the concurrency limit and rejects further attempts until released', () => {
    const config = {
      get: jest.fn(() => 2),
    } as unknown as ConfigService;
    const limiter = new MediaIngestionConcurrencyLimiter(config);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.activeCount).toBe(1);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.activeCount).toBe(2);

    // Exceeded limit: must return false and not increment count
    expect(limiter.tryAcquire()).toBe(false);
    expect(limiter.activeCount).toBe(2);

    // Release one slot
    limiter.release();
    expect(limiter.activeCount).toBe(1);

    // Now acquire should succeed
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.activeCount).toBe(2);
    expect(limiter.tryAcquire()).toBe(false);

    // Release all
    limiter.release();
    limiter.release();
    expect(limiter.activeCount).toBe(0);

    // Underflow guard: release on 0 does not go below 0
    limiter.release();
    expect(limiter.activeCount).toBe(0);
  });
});
