import {
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';

import { StorageModule } from '../../infrastructure/storage/storage.module';
import { ExamAnswerBodyPrototypeMiddleware } from './exam-answer-body-prototype.middleware';
import { ExamController } from './exam.controller';
import { ExamMediaGrantsService } from './exam-media-grants.service';
import { ExamService } from './exam.service';
import { ExamTransactionCoordinator } from './exam-transaction-coordinator';

/**
 * M4.2a/M4.2b — learner exam start, immutable snapshot, autosave/resume, lazy
 * timeout and snapshot media grants (TL-110, TL-121…TL-128). `StorageModule`
 * is imported for the object-storage provider that media grants must match.
 */
@Module({
  imports: [StorageModule],
  controllers: [ExamController],
  providers: [ExamService, ExamMediaGrantsService, ExamTransactionCoordinator],
})
export class ExamModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // F2: reject an own `__proto__` key in the autosave bodies before the DTO
    // pipeline rebuilds them (and hides the key from the service validator).
    consumer.apply(ExamAnswerBodyPrototypeMiddleware).forRoutes(
      {
        path: 'exam/attempts/:attemptId/answers',
        method: RequestMethod.PUT,
      },
      {
        path: 'exam/attempts/:attemptId/answers/:questionKey',
        method: RequestMethod.PUT,
      },
    );
  }
}
