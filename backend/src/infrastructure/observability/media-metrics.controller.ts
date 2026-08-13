import { timingSafeEqual } from 'node:crypto';

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
  private readonly bearerToken: string;

  constructor(
    private readonly metrics: MediaObservabilityService,
    config: ConfigService,
  ) {
    this.bearerToken = config.getOrThrow<string>('media.metricsBearerToken');
  }

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  scrape(@Headers('authorization') authorization: string | undefined) {
    if (!hasValidBearer(authorization, this.bearerToken)) {
      throw new ForbiddenException('Metrics access is not allowed.');
    }
    return this.metrics.render();
  }
}

function hasValidBearer(
  authorization: string | undefined,
  expected: string,
): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  const received = Buffer.from(authorization.slice(7));
  const trusted = Buffer.from(expected);
  return (
    received.length === trusted.length && timingSafeEqual(received, trusted)
  );
}
