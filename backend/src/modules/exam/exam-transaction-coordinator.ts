import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type ExamTransactionOperation =
  | 'exam.start'
  | 'exam.answer.save'
  | 'exam.attempt.read';

/** Operations that lock one `ExamAttempt` row (TL-125/TL-127). */
export type ExamAttemptLockOperation = Extract<
  ExamTransactionOperation,
  'exam.answer.save' | 'exam.attempt.read'
>;

export type ExamStartCheckpoint = {
  operation: 'exam.start';
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
 * TL-125 + F8(d): the autosave path locks `ExamAttempt` by id (filtered by
 * `userId`) and then the answer row. It locks User/Test/Media never and
 * Question only implicitly: the first insert of an answer carries FK
 * `questionId`, so PostgreSQL takes an implicit `FOR KEY SHARE` on that
 * `Question` row, and a first save can wait for an admin transaction that is
 * editing the question (`Question FOR UPDATE`). That wait cannot close a cycle
 * with start: start holds `Question FOR SHARE`, which is compatible with
 * `FOR KEY SHARE`, so the save that owns the attempt lock never waits for the
 * start transaction; and the admin writer never waits for an `ExamAttempt`.
 */
export type ExamAnswerSaveCheckpoint = {
  operation: 'exam.answer.save';
  phase: 'before_attempt_lock' | 'after_attempt_lock';
  userId: number;
  attemptId: number;
  transaction: Prisma.TransactionClient;
};

/** TL-127: GET attempt takes the same attempt lock before its lazy timeout. */
export type ExamAttemptReadCheckpoint = {
  operation: 'exam.attempt.read';
  phase: 'before_attempt_lock' | 'after_attempt_lock';
  userId: number;
  attemptId: number;
  transaction: Prisma.TransactionClient;
};

export type ExamTransactionCheckpoint =
  | ExamStartCheckpoint
  | ExamAnswerSaveCheckpoint
  | ExamAttemptReadCheckpoint;

/**
 * Production-path observation point for the learner -> Test -> Question ->
 * Media lock chain (TL-115) and for the answer-save attempt lock (TL-125).
 * Runtime behaviour is a no-op; the concurrency harness injects a barrier
 * coordinator.
 */
@Injectable()
export class ExamTransactionCoordinator {
  checkpoint(checkpoint: ExamTransactionCheckpoint): Promise<void> {
    void checkpoint;
    return Promise.resolve();
  }
}
