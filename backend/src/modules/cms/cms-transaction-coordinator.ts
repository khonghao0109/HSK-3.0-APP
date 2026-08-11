import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type CmsTransactionOperation =
  | 'lesson.create_revision'
  | 'lesson.review'
  | 'lesson.publish'
  | 'lesson.archive'
  | 'topic.create'
  | 'topic.create_revision'
  | 'topic.review'
  | 'topic.publish'
  | 'topic.archive'
  | 'exercise.create'
  | 'exercise.create_revision'
  | 'exercise.review'
  | 'exercise.publish'
  | 'exercise.archive'
  | 'exercise_import.commit';

export type CmsTransactionCheckpoint = {
  operation: CmsTransactionOperation;
  phase: 'before_lock' | 'after_lock';
  entityType: 'lesson' | 'topic' | 'lesson_exercise' | 'exercise_import';
  entityId: number;
  parentLessonId?: number;
  transaction: Prisma.TransactionClient;
};

/**
 * Production extension point around the real CMS transaction lock boundary.
 * Runtime behavior is intentionally a no-op; reliability harnesses may inject
 * a coordinator that observes the PostgreSQL backend and controls a barrier.
 */
@Injectable()
export class CmsTransactionCoordinator {
  checkpoint(checkpoint: CmsTransactionCheckpoint): Promise<void> {
    void checkpoint;
    return Promise.resolve();
  }
}
