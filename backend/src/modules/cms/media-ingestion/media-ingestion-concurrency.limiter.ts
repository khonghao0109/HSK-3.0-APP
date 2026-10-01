import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const MEDIA_INGESTION_DEFAULT_CONCURRENCY = 4;
export const MEDIA_INGESTION_MIN_CONCURRENCY = 1;
export const MEDIA_INGESTION_MAX_CONCURRENCY_LIMIT = 16;

@Injectable()
export class MediaIngestionConcurrencyLimiter {
  private readonly maxConcurrency: number;
  private current = 0;

  constructor(config: ConfigService) {
    const configured = config.get<number>('media.maxConcurrency');
    this.maxConcurrency =
      typeof configured === 'number' &&
      Number.isInteger(configured) &&
      configured >= MEDIA_INGESTION_MIN_CONCURRENCY &&
      configured <= MEDIA_INGESTION_MAX_CONCURRENCY_LIMIT
        ? configured
        : MEDIA_INGESTION_DEFAULT_CONCURRENCY;
  }

  tryAcquire(): boolean {
    if (this.current < this.maxConcurrency) {
      this.current += 1;
      return true;
    }
    return false;
  }

  release(): void {
    if (this.current > 0) {
      this.current -= 1;
    }
  }

  get activeCount(): number {
    return this.current;
  }

  get limit(): number {
    return this.maxConcurrency;
  }
}
