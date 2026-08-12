import { Module } from '@nestjs/common';

import { StorageModule } from '../../infrastructure/storage/storage.module';
import { MediaAccessService } from './media-access.service';
import { MediaController } from './media.controller';

@Module({
  imports: [StorageModule],
  controllers: [MediaController],
  providers: [MediaAccessService],
})
export class MediaModule {}
