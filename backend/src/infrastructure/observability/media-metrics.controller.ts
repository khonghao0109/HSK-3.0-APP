import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MediaObservabilityService } from './media-observability.service';

@Controller('internal/metrics/media')
export class MediaMetricsController {
  private readonly bearerTokenHashes: Buffer[];

  constructor(
    private readonly metrics: MediaObservabilityService,
    config: ConfigService,
  ) {
    this.bearerTokenHashes = config
      .getOrThrow<string[]>('media.metricsBearerTokens')
      .map(hashToken);
  }

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  scrape(@Headers('authorization') authorization: string | undefined) {
    if (!hasValidBearer(authorization, this.bearerTokenHashes)) {
      throw new ForbiddenException('Metrics access is not allowed.');
    }
    return this.metrics.render();
  }
}

function hasValidBearer(
  authorization: string | undefined,
  trustedHashes: readonly Buffer[],
): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  const received = hashToken(authorization.slice(7));
  return trustedHashes.reduce(
    (matched, trusted) => timingSafeEqual(received, trusted) || matched,
    false,
  );
}

function hashToken(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
