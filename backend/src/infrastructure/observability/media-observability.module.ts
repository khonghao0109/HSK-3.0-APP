import { Global, Module } from '@nestjs/common';

import { MediaMetricsController } from './media-metrics.controller';
import { MediaObservabilityService } from './media-observability.service';

@Global()
@Module({
  controllers: [MediaMetricsController],
  providers: [MediaObservabilityService],
  exports: [MediaObservabilityService],
})
export class MediaObservabilityModule {}
