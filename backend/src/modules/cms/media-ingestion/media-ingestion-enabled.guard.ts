import { CanActivate, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { assertMediaIngestionEnabled } from '../../../infrastructure/observability/media-observability.service';

@Injectable()
export class MediaIngestionEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    assertMediaIngestionEnabled(
      this.config.get<boolean>('media.ingestionEnabled') ?? false,
    );
    return true;
  }
}
