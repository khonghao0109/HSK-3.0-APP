import { Module } from '@nestjs/common';

import { ExamController } from './exam.controller';
import { ExamService } from './exam.service';
import { ExamTransactionCoordinator } from './exam-transaction-coordinator';

/** M4.2a — learner exam start and immutable snapshot (TL-110). */
@Module({
  controllers: [ExamController],
  providers: [ExamService, ExamTransactionCoordinator],
})
export class ExamModule {}
