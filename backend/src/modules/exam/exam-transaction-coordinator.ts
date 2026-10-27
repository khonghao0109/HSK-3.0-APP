import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type ExamTransactionOperation = 'exam.start';

export type ExamTransactionCheckpoint = {
  operation: ExamTransactionOperation;
  phase:
    | 'before_user_lock'
    | 'after_user_lock'
    | 'after_test_lock'
    | 'after_question_locks'
    | 'after_media_locks';
  userId: number;
  testId: number;
  transaction: Prisma.TransactionClient;
};

/**
 * Production-path observation point for the learner -> Test -> Question ->
 * Media lock chain (TL-115). Runtime behaviour is a no-op; the concurrency
 * harness injects a barrier coordinator.
 */
@Injectable()
export class ExamTransactionCoordinator {
  checkpoint(checkpoint: ExamTransactionCheckpoint): Promise<void> {
    void checkpoint;
    return Promise.resolve();
  }
}
