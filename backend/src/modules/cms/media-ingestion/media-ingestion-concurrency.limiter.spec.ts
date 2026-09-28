import { ConfigService } from '@nestjs/config';

import { MediaIngestionConcurrencyLimiter } from './media-ingestion-concurrency.limiter';

describe('MediaIngestionConcurrencyLimiter', () => {
  it('defaults to 4 concurrent slots when configuration is missing or invalid', () => {
    const config = new ConfigService({});
    const limiter = new MediaIngestionConcurrencyLimiter(config);

    expect(limiter.limit).toBe(4);
    expect(limiter.activeCount).toBe(0);
  });

  it.each([1, 2, 8, 16])(
    'accepts a valid bounded concurrency limit of %i',
    (limit) => {
      const config = new ConfigService({
        media: { maxConcurrency: limit },
      });
      const limiter = new MediaIngestionConcurrencyLimiter(config);

      expect(limiter.limit).toBe(limit);
    },
  );

  it('falls back to 4 when configured limit is out of 1-16 bounds or non-integer', () => {
    const limiterNegative = new MediaIngestionConcurrencyLimiter(
      new ConfigService({ media: { maxConcurrency: 0 } }),
    );
    expect(limiterNegative.limit).toBe(4);

    const limiterOver = new MediaIngestionConcurrencyLimiter(
      new ConfigService({ media: { maxConcurrency: 17 } }),
    );
    expect(limiterOver.limit).toBe(4);

    const limiterFloat = new MediaIngestionConcurrencyLimiter(
      new ConfigService({ media: { maxConcurrency: 3.5 } }),
    );
    expect(limiterFloat.limit).toBe(4);
  });

  it('acquires up to the concurrency limit and rejects further attempts until released', () => {
    const config = new ConfigService({
      media: { maxConcurrency: 2 },
    });
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
