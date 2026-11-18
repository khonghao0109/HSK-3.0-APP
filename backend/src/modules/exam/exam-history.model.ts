import { InternalServerErrorException } from '@nestjs/common';
import { ExamAttemptStatus, type Prisma, type Skill } from '@prisma/client';

import type { ExamHistoryItemDto } from './dto/exam-response.dto';

/**
 * M4.5 B3: pure rules of the learner exam history (`GET /exam/attempts`), kept
 * out of the service like `exam-list.model.ts`. The route only reads: an
 * in-progress attempt past its grace window is reported as timed out here and
 * stays untouched in the database until a route that may write opens it.
 */
export type ExamHistoryAttemptRow = {
  id: number;
  testId: number;
  status: ExamAttemptStatus;
  submittedAt: Date | null;
  expiresAt: Date;
  result: {
    score: number;
    maxScore: number | null;
    passed: boolean | null;
    skillScores: Array<{ skill: Skill; score: number; total: number }>;
  } | null;
};

export type ExamHistorySnapshotFields = {
  title: string;
  levelCode: string;
  passScore: number | null;
  maxScore: number;
};

/** Frozen JSON values as extracted by the database, not yet validated. */
export type ExamHistorySnapshotRow = {
  attemptId: number;
  title: unknown;
  levelCode: unknown;
  passScore: unknown;
  maxScore: unknown;
};

export function examHistoryWhere(
  userId: number,
  now: Date,
  graceSeconds: number,
  levelCode?: string,
): Prisma.ExamAttemptWhereInput {
  return {
    userId,
    OR: [
      {
        status: {
          in: [ExamAttemptStatus.submitted, ExamAttemptStatus.timed_out],
        },
      },
      {
        status: ExamAttemptStatus.in_progress,
        // Same boundary as the lazy timeout: now >= expiresAt + grace.
        expiresAt: { lte: new Date(now.getTime() - graceSeconds * 1_000) },
      },
    ],
    ...(levelCode === undefined
      ? {}
      : {
          snapshot: {
            payload: { path: ['test', 'levelCode'], equals: levelCode },
          },
        }),
  };
}

/** Fails closed like `readExamSnapshotPayload`: the snapshot is server-written. */
export function readExamHistorySnapshot(
  row: ExamHistorySnapshotRow | undefined,
): ExamHistorySnapshotFields {
  if (row === undefined) {
    throw new InternalServerErrorException('Exam attempt snapshot is missing.');
  }
  const { title, levelCode, passScore, maxScore } = row;
  if (
    typeof title !== 'string' ||
    typeof levelCode !== 'string' ||
    typeof maxScore !== 'number' ||
    (passScore !== null && typeof passScore !== 'number')
  ) {
    throw new InternalServerErrorException('Exam snapshot payload is invalid.');
  }
  return { title, levelCode, passScore, maxScore };
}

export function toExamHistoryItem(
  attempt: ExamHistoryAttemptRow,
  snapshot: ExamHistorySnapshotFields,
): ExamHistoryItemDto {
  const result = attempt.result;
  return {
    attemptId: attempt.id,
    testId: attempt.testId,
    testTitle: snapshot.title,
    levelCode: snapshot.levelCode,
    status:
      attempt.status === ExamAttemptStatus.submitted
        ? 'submitted'
        : 'timed_out',
    finishedAt: attempt.submittedAt ?? attempt.expiresAt,
    score: result?.score ?? null,
    maxScore: result === null ? null : (result.maxScore ?? snapshot.maxScore),
    passScore: snapshot.passScore,
    passed: result?.passed ?? null,
    skills: (result?.skillScores ?? []).map((row) => ({
      skill: row.skill,
      score: row.score,
      maxScore: row.total,
    })),
  };
}
