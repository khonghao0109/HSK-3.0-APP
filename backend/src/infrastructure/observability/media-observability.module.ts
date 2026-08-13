import { Global, Module } from '@nestjs/common';

import { MediaMetricsServer } from './media-metrics.server';
import { MediaObservabilityService } from './media-observability.service';

@Global()
@Module({
  providers: [MediaMetricsServer, MediaObservabilityService],
  exports: [MediaMetricsServer, MediaObservabilityService],
})
export class MediaObservabilityModule {}
