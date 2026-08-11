import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type LessonActivityTransactionOperation =
  | 'lesson.start'
  | 'lesson.complete'
  | 'topic.start'
  | 'topic.complete'
  | 'exercise.submit';

export type LessonActivityTransactionCheckpoint = {
  operation: LessonActivityTransactionOperation;
  phase: 'before_user_lock' | 'after_user_lock';
  userId: number;
  transaction: Prisma.TransactionClient;
};

/**
 * Production-path observation point for the per-user PostgreSQL lock. Runtime
 * behavior is a no-op; the concurrency harness injects a barrier coordinator.
 */
@Injectable()
export class LessonActivityTransactionCoordinator {
  checkpoint(checkpoint: LessonActivityTransactionCheckpoint): Promise<void> {
    void checkpoint;
    return Promise.resolve();
  }
}
