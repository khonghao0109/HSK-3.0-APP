import { CanActivate, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  assertMediaIngestionEnabled,
  MediaObservabilityService,
} from '../../../infrastructure/observability/media-observability.service';

@Injectable()
export class MediaIngestionEnabledGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MediaObservabilityService,
  ) {}

  canActivate(): boolean {
    const enabled = this.config.get<boolean>('media.ingestionEnabled') ?? false;
    if (!enabled) {
      const observation = this.metrics?.beginIngestionRequest();
      observation?.complete('disabled');
    }
    assertMediaIngestionEnabled(enabled);
    return true;
  }
}
