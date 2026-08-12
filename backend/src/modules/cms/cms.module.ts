import { Module } from '@nestjs/common';

import { MalwareModule } from '../../infrastructure/malware/malware.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';

import { CmsController } from './cms.controller';
import { CmsService } from './cms.service';
import { CmsTransactionCoordinator } from './cms-transaction-coordinator';
import { ExerciseAuthoringService } from './exercise-authoring.service';
import { ExerciseImportService } from './exercise-import/exercise-import.service';
import { MediaAdminService } from './media-admin.service';
import { MediaFileProcessor } from './media-ingestion/media-file.processor';
import { MediaIngestionService } from './media-ingestion/media-ingestion.service';
import { MediaUploadRateLimitGuard } from './media-ingestion/media-upload-rate-limit.guard';
import { SafeMediaUploadExceptionFilter } from './media-ingestion/safe-media-upload-exception.filter';

@Module({
  imports: [MalwareModule, StorageModule],
  controllers: [CmsController],
  providers: [
    CmsService,
    CmsTransactionCoordinator,
    ExerciseAuthoringService,
    ExerciseImportService,
    MediaAdminService,
    MediaFileProcessor,
    MediaIngestionService,
    MediaUploadRateLimitGuard,
    SafeMediaUploadExceptionFilter,
  ],
  exports: [
    CmsService,
    ExerciseAuthoringService,
    ExerciseImportService,
    MediaAdminService,
    MediaIngestionService,
  ],
})
export class CmsModule {}
