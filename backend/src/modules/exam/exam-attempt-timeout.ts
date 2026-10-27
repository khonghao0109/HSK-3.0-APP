import { ExamAttemptStatus } from '@prisma/client';

/**
 * F1 / TL-125b: `in_progress -> timed_out` is a one-way, exactly-once
 * transition. Every writer (start, save, GET attempt) goes through this
 * conditional update, and only the transaction that actually wins the row
 * writes the `timed_out` event. That is what keeps the append-only event log to
 * exactly one terminal event per attempt even when a start races a lazy
 * timeout.
 */
export type AttemptTimeoutReason =
  | 'expired_on_start'
  | 'expired_on_save'
  | 'expired_on_read';

export type AttemptTimeoutWriter = {
  examAttempt: {
    updateMany: (input: {
      where: { id: number; status: 'in_progress' };
      data: {
        status: 'timed_out';
        submittedAt: Date;
        remainingSeconds: number;
      };
    }) => Promise<{ count: number }>;
  };
  examAttemptEvent: {
    create: (input: {
      data: {
        attemptId: number;
        type: 'timed_out';
        metadata: { reason: AttemptTimeoutReason };
        occurredAt: Date;
      };
    }) => Promise<unknown>;
  };
};

export type AttemptTimeoutInput = {
  attemptId: number;
  /** The attempt's own deadline; `submittedAt` is set to it, not to `now`. */
  expiresAt: Date;
  occurredAt: Date;
  reason: AttemptTimeoutReason;
};

export async function markAttemptTimedOut(
  writer: AttemptTimeoutWriter,
  input: AttemptTimeoutInput,
): Promise<boolean> {
  const updated = await writer.examAttempt.updateMany({
    where: { id: input.attemptId, status: ExamAttemptStatus.in_progress },
    data: {
      status: ExamAttemptStatus.timed_out,
      submittedAt: input.expiresAt,
      remainingSeconds: 0,
    },
  });
  if (updated.count !== 1) return false;
  await writer.examAttemptEvent.create({
    data: {
      attemptId: input.attemptId,
      type: 'timed_out',
      metadata: { reason: input.reason },
      occurredAt: input.occurredAt,
    },
  });
  return true;
}
