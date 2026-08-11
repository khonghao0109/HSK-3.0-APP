import { Module } from '@nestjs/common';

import { CmsController } from './cms.controller';
import { CmsService } from './cms.service';
import { CmsTransactionCoordinator } from './cms-transaction-coordinator';
import { ExerciseAuthoringService } from './exercise-authoring.service';
import { ExerciseImportService } from './exercise-import/exercise-import.service';

@Module({
  controllers: [CmsController],
  providers: [
    CmsService,
    CmsTransactionCoordinator,
    ExerciseAuthoringService,
    ExerciseImportService,
  ],
  exports: [CmsService, ExerciseAuthoringService, ExerciseImportService],
})
export class CmsModule {}
