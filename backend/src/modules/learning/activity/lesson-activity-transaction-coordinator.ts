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
  phase:
    | 'before_user_lock'
    | 'after_user_lock'
    | 'before_content_lock'
    | 'after_content_lock';
  userId: number;
  transaction: Prisma.TransactionClient;
};

/**
 * Production-path observation point for the per-user PostgreSQL lock and the
 * Lesson -> Topic -> LessonExercise content lock chain. Runtime behavior is a
 * no-op; the concurrency harness injects a barrier coordinator.
 */
@Injectable()
export class LessonActivityTransactionCoordinator {
  checkpoint(checkpoint: LessonActivityTransactionCheckpoint): Promise<void> {
    void checkpoint;
    return Promise.resolve();
  }
}
