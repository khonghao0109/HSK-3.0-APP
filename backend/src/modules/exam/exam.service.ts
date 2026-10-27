import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ExamAttemptStatus, Prisma } from '@prisma/client';

import type { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { CMS_MEDIA_SELECT, type CmsMediaRecord } from '../cms/media-usability';
import {
  collectTestPublishBlockers,
  type TestPublishBlockerQuestion,
} from '../cms/test-publish-blockers';
import {
  ExamAnswerBatchResultDto,
  ExamAnswerBatchViewDto,
  ExamAnswerSaveViewDto,
  ExamAttemptViewDto,
  ExamTestIntroDto,
} from './dto/exam-response.dto';
import {
  toExamAnswerHashBody,
  tryExamAnswerBodySha256,
} from './exam-answer-hash';
import {
  decideRecoveredAnswerConflict,
  isSameExamAnswerRequest,
} from './exam-answer-replay';
import { validateExamAnswerShape } from './exam-answer.validator';
import { isExamTestVisible } from './exam-eligibility';
import {
  EXAM_ERROR_CODES,
  examAnswerInvalid,
  examAnswerVersionConflict,
  examAttemptClosed,
  examAttemptExpired,
  examAttemptNotFound,
  examBatchValidationFailed,
  examIdempotencyKeyReused,
  examQuestionNotFound,
  examTestNotFound,
  examTestUnavailable,
} from './exam-errors';
import { classifyExamPersistenceError } from './exam-persistence';
import { markAttemptTimedOut } from './exam-attempt-timeout';
import {
  buildExamSnapshot,
  EXAM_SECTION_MAX_SCORE,
  projectExamSnapshotMedia,
  type ExamSnapshotPayload,
  type ExamSnapshotQuestion,
  type ExamSnapshotSource,
} from './exam-snapshot.builder';
import { readExamSnapshotPayload } from './exam-snapshot.reader';
import {
  remainingSeconds,
  toExamAnswerSaveView,
  toExamAnswerView,
  toExamAttemptView,
  toExamTestIntro,
  type ExamStoredAnswer,
} from './exam.serializer';
import {
  ExamTransactionCoordinator,
  type ExamAttemptLockOperation,
} from './exam-transaction-coordinator';

/**
 * Learner exam engine. M4.2a: the intro, the "start attempt" transaction that
 * freezes a snapshot, and the attempt read. M4.2b (TL-121…TL-127): per-question
 * autosave with idempotent replay and optimistic versioning, the batch save
 * used after a reconnect, and the lazy timeout applied by GET/save. Submit and
 * scoring stay in M4.2c/M4.3.
 */

/** TL-126: a save that lands just after `expiresAt` is still accepted. */
export const EXAM_SAVE_GRACE_SECONDS = 5;

const EXAM_INTRO_SELECT = {
  id: true,
  title: true,
  instruction: true,
  duration: true,
  passScore: true,
  status: true,
  deletedAt: true,
  availableFrom: true,
  availableTo: true,
  level: { select: { code: true } },
  sections: {
    orderBy: [{ orderIndex: 'asc' as const }],
    select: {
      orderIndex: true,
      title: true,
      skill: true,
      groups: { select: { _count: { select: { placements: true } } } },
    },
  },
} satisfies Prisma.TestSelect;

const EXAM_TEST_TREE_SELECT = {
  id: true,
  levelId: true,
  title: true,
  instruction: true,
  duration: true,
  passScore: true,
  scoringVersion: true,
  version: true,
  status: true,
  deletedAt: true,
  availableFrom: true,
  availableTo: true,
  level: { select: { code: true } },
  sections: {
    orderBy: [{ orderIndex: 'asc' as const }],
    select: {
      orderIndex: true,
      skill: true,
      title: true,
      instruction: true,
      groups: {
        orderBy: [{ orderIndex: 'asc' as const }],
        select: {
          orderIndex: true,
          title: true,
          instruction: true,
          content: true,
          audioId: true,
          imageId: true,
          placements: {
            orderBy: [{ orderIndex: 'asc' as const }],
            select: {
              orderIndex: true,
              testQuestion: { select: { questionId: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.TestSelect;

type ExamTestTree = Prisma.TestGetPayload<{
  select: typeof EXAM_TEST_TREE_SELECT;
}>;

const EXAM_QUESTION_SELECT = {
  id: true,
  version: true,
  type: true,
  skill: true,
  content: true,
  answers: true,
  correctAnswer: true,
  explanation: true,
  status: true,
  deletedAt: true,
  levelId: true,
  audio: { select: CMS_MEDIA_SELECT },
  image: { select: CMS_MEDIA_SELECT },
} satisfies Prisma.QuestionSelect;

type ExamQuestionRow = Prisma.QuestionGetPayload<{
  select: typeof EXAM_QUESTION_SELECT;
}>;

const EXAM_ATTEMPT_SELECT = {
  id: true,
  testId: true,
  status: true,
  startedAt: true,
  expiresAt: true,
  maxScore: true,
} satisfies Prisma.ExamAttemptSelect;

const EXAM_ANSWER_SELECT = {
  id: true,
  snapshotQuestionKey: true,
  answer: true,
  isFlagged: true,
  version: true,
  answeredAt: true,
  lastSavedAt: true,
} satisfies Prisma.ExamAnswerSelect;

type ExamAnswerRow = Prisma.ExamAnswerGetPayload<{
  select: typeof EXAM_ANSWER_SELECT;
}>;

type ExamAnswerBody = {
  answer: unknown;
  isFlagged: boolean;
  expectedVersion: number | null;
  idempotencyKey: string;
  clientElapsedMs?: number;
};

type LockedAttempt = Prisma.ExamAttemptGetPayload<{
  select: typeof EXAM_ATTEMPT_SELECT;
}>;

type SaveOutcome =
  | { status: 'saved'; record: ExamAnswerRow }
  | { status: 'replayed'; record: ExamAnswerRow }
  | { status: 'conflict'; current: ExamAnswerRow | null }
  | { status: 'invalid'; field: string }
  | { status: 'key_reused' }
  | { status: 'not_found' };

type AttemptWriteResult =
  | { kind: 'not_found' }
  | { kind: 'closed'; status: ExamAttemptStatus }
  | { kind: 'expired' }
  | {
      kind: 'open';
      attempt: LockedAttempt;
      now: Date;
      outcome: SaveOutcome;
    };

type OpenBatchResult = {
  kind: 'open';
  attempt: LockedAttempt;
  now: Date;
  results: Array<{ questionKey: string; outcome: SaveOutcome }>;
};

type AttemptBatchResult =
  | { kind: 'not_found' }
  | { kind: 'closed'; status: ExamAttemptStatus }
  | { kind: 'expired' }
  | OpenBatchResult;

type AttemptLockResult =
  | { kind: 'not_found' }
  | { kind: 'open'; attempt: LockedAttempt; now: Date };

type AttemptReadResult =
  | { kind: 'not_found' }
  | { kind: 'open'; view: ExamAttemptViewDto };

type AttemptGrantResult =
  | { kind: 'not_found' }
  | { kind: 'closed'; status: ExamAttemptStatus }
  | { kind: 'expired' }
  | { kind: 'ok'; mediaIds: number[]; remainingSeconds: number };

type StartAttemptResult = {
  created: boolean;
  data: ExamAttemptViewDto;
};

@Injectable()
export class ExamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: ExamTransactionCoordinator,
  ) {}

  async getTestIntro(
    userId: number,
    testId: number,
  ): Promise<ApiSuccessResponse<ExamTestIntroDto>> {
    const now = await this.databaseNow(this.prisma);
    const test = await this.prisma.test.findFirst({
      where: { id: testId },
      select: EXAM_INTRO_SELECT,
    });
    if (test === null || !isExamTestVisible(test, now)) {
      throw examTestNotFound();
    }

    const sections = test.sections.map((section) => ({
      orderIndex: section.orderIndex,
      title: section.title,
      skill: section.skill,
      questionCount: section.groups.reduce(
        (total, group) => total + group._count.placements,
        0,
      ),
    }));
    const questionCount = sections.reduce(
      (total, section) => total + section.questionCount,
      0,
    );

    // TL-112: an in-progress attempt whose clock already ran out is not
    // "active" any more, and the intro must not change any row.
    const active = await this.prisma.examAttempt.findFirst({
      where: {
        userId,
        testId,
        status: ExamAttemptStatus.in_progress,
        expiresAt: { gt: now },
      },
      orderBy: { id: 'desc' },
      select: { id: true, startedAt: true, expiresAt: true },
    });
    const answeredCount =
      active === null
        ? 0
        : await this.prisma.examAnswer.count({
            where: {
              attemptId: active.id,
              // F3: a flagged row whose answer was cleared is not an answered
              // question; only a non-null JSON payload counts.
              NOT: { answer: { equals: Prisma.JsonNull } },
            },
          });

    return {
      success: true,
      data: toExamTestIntro({
        test: {
          id: test.id,
          title: test.title,
          instruction: test.instruction,
          levelCode: test.level.code,
          duration: test.duration,
          passScore: test.passScore,
          maxScore: EXAM_SECTION_MAX_SCORE * sections.length,
          questionCount,
          sections,
        },
        activeAttempt:
          active === null
            ? null
            : {
                id: active.id,
                startedAt: active.startedAt,
                expiresAt: active.expiresAt,
                answeredCount,
              },
      }),
    };
  }

  /**
   * TL-127: unlike M4.2a, this route may write — exactly once, when an
   * in-progress attempt whose clock ran out is moved to `timed_out` with the
   * `expired_on_read` event. A second read writes nothing.
   */
  async getAttemptView(
    userId: number,
    attemptId: number,
  ): Promise<ApiSuccessResponse<ExamAttemptViewDto>> {
    const result = await this.prisma.$transaction(
      async (tx): Promise<AttemptReadResult> => {
        const locked = await this.lockAttempt(
          tx,
          userId,
          attemptId,
          'exam.attempt.read',
        );
        if (locked.kind === 'not_found') return { kind: 'not_found' };
        const { attempt, now } = locked;
        if (
          attempt.status === ExamAttemptStatus.in_progress &&
          this.isPastSaveGrace(attempt.expiresAt, now)
        ) {
          await this.applyLazyTimeout(tx, attempt, now, 'expired_on_read');
        }
        return {
          kind: 'open',
          view: await this.loadAttemptView(tx, userId, attemptId, now),
        };
      },
    );
    if (result.kind === 'not_found') throw examAttemptNotFound();
    return { success: true, data: result.view };
  }

  /** TL-121: save one answer (create, update or idempotent replay). */
  async saveAnswer(
    userId: number,
    attemptId: number,
    questionKey: string,
    body: ExamAnswerBody,
  ): Promise<ApiSuccessResponse<ExamAnswerSaveViewDto>> {
    let result: AttemptWriteResult;
    try {
      result = await this.prisma.$transaction(
        async (tx): Promise<AttemptWriteResult> => {
          const locked = await this.lockAttempt(
            tx,
            userId,
            attemptId,
            'exam.answer.save',
          );
          if (locked.kind === 'not_found') return { kind: 'not_found' };
          const { attempt, now } = locked;
          if (attempt.status !== ExamAttemptStatus.in_progress) {
            return { kind: 'closed', status: attempt.status };
          }
          if (this.isPastSaveGrace(attempt.expiresAt, now)) {
            // The timeout is committed even though the request answers 409, so
            // a later GET/save observes the same terminal state (TL-126).
            await this.applyLazyTimeout(tx, attempt, now, 'expired_on_save');
            return { kind: 'expired' };
          }
          const payload = await this.loadSnapshotPayload(tx, attemptId);
          const outcome = await this.saveAnswerItem({
            tx,
            attemptId,
            now,
            questions: this.indexSnapshotQuestions(payload),
            questionKey,
            body,
          });
          return { kind: 'open', attempt, now, outcome };
        },
      );
    } catch (error: unknown) {
      // TL-125: a P2002/23505 on the answer unique key can only come from a
      // writer that bypassed the attempt lock. Re-read the winner instead of
      // surfacing a 500; the replay ledger decides replay vs conflict.
      if (classifyExamPersistenceError(error) === 'unique_conflict') {
        return this.recoverAnswerUniqueConflict(
          userId,
          attemptId,
          questionKey,
          body,
        );
      }
      throw error;
    }

    this.assertSingleSaveWritable(result);
    const { outcome, now, attempt } = result;
    switch (outcome.status) {
      case 'saved':
      case 'replayed':
        return {
          success: true,
          data: toExamAnswerSaveView({
            answer: this.toStoredAnswer(outcome.record),
            now,
            expiresAt: attempt.expiresAt,
          }),
        };
      case 'conflict':
        throw examAnswerVersionConflict(
          outcome.current === null
            ? null
            : toExamAnswerView(this.toStoredAnswer(outcome.current)),
        );
      case 'invalid':
        throw examAnswerInvalid(outcome.field);
      case 'key_reused':
        throw examIdempotencyKeyReused();
      case 'not_found':
        throw examQuestionNotFound();
    }
  }

  /** TL-124: save up to 20 answers in one transaction, per-item results. */
  async saveAnswers(
    userId: number,
    attemptId: number,
    items: Array<ExamAnswerBody & { questionKey: string }>,
  ): Promise<ApiSuccessResponse<ExamAnswerBatchViewDto>> {
    this.assertUniqueQuestionKeys(items);
    let result: AttemptBatchResult;
    try {
      result = await this.prisma.$transaction((tx) =>
        this.saveAnswersInTransaction(tx, userId, attemptId, items),
      );
    } catch (error: unknown) {
      if (classifyExamPersistenceError(error) !== 'unique_conflict')
        throw error;
      // TL-125: a writer that bypassed the attempt lock can win a unique key
      // mid-batch. The transaction rolled back as a whole, so re-running it
      // once makes every item read the committed winner and report `conflict`
      // instead of surfacing a 500.
      result = await this.prisma.$transaction((tx) =>
        this.saveAnswersInTransaction(tx, userId, attemptId, items),
      );
    }

    this.assertBatchWritable(result);
    const { results, now, attempt } = result;
    return {
      success: true,
      data: {
        results: results.map(({ questionKey, outcome }) =>
          this.toBatchResult(questionKey, outcome),
        ),
        serverNow: now,
        remainingSeconds: remainingSeconds(attempt.expiresAt, now),
      },
    };
  }

  /**
   * TL-128: the attempt must belong to the learner, be `in_progress` and still
   * be inside the clock (plus the save grace window). This read is read-only:
   * unlike GET attempt it does not apply the lazy timeout.
   */
  async getMediaGrantTarget(
    userId: number,
    attemptId: number,
  ): Promise<{ mediaIds: number[]; remainingSeconds: number }> {
    // F4: the clock and the deadline check are read after the attempt lock,
    // like save/GET. The transaction is read-only: it never changes the status.
    const result = await this.prisma.$transaction(
      async (tx): Promise<AttemptGrantResult> => {
        const locked = await this.lockAttempt(
          tx,
          userId,
          attemptId,
          'exam.attempt.read',
        );
        if (locked.kind === 'not_found') return { kind: 'not_found' };
        const { attempt, now } = locked;
        if (attempt.status !== ExamAttemptStatus.in_progress) {
          return { kind: 'closed', status: attempt.status };
        }
        if (this.isPastSaveGrace(attempt.expiresAt, now)) {
          return { kind: 'expired' };
        }
        const payload = await this.loadSnapshotPayload(tx, attemptId);
        return {
          kind: 'ok',
          mediaIds: this.collectSnapshotMediaIds(payload),
          remainingSeconds: remainingSeconds(attempt.expiresAt, now),
        };
      },
    );
    if (result.kind === 'not_found') throw examAttemptNotFound();
    if (result.kind === 'closed') throw examAttemptClosed(result.status);
    if (result.kind === 'expired') throw examAttemptExpired();
    return {
      mediaIds: result.mediaIds,
      remainingSeconds: result.remainingSeconds,
    };
  }

  /**
   * TL-112: (a) replay the same key, (b) return the live attempt, (c) time out
   * an expired one and start a new attempt, (d) create the first attempt.
   */
  async startAttempt(
    userId: number,
    testId: number,
    idempotencyKey: string,
  ): Promise<StartAttemptResult> {
    try {
      return await this.prisma.$transaction((tx) =>
        this.startAttemptInTransaction(tx, userId, testId, idempotencyKey),
      );
    } catch (error: unknown) {
      const kind = classifyExamPersistenceError(error);
      if (kind === 'unique_conflict') {
        // TL-112: the partial unique index is the backstop when two writers
        // bypass the user lock. Re-read the winner instead of surfacing a 500.
        const winner = await this.findWinnerAttempt(userId, testId);
        if (winner !== null) {
          const now = await this.databaseNow(this.prisma);
          return {
            created: false,
            data: await this.loadAttemptView(
              this.prisma,
              userId,
              winner.id,
              now,
            ),
          };
        }
      }
      throw error;
    }
  }

  private async startAttemptInTransaction(
    tx: Prisma.TransactionClient,
    userId: number,
    testId: number,
    idempotencyKey: string,
  ): Promise<StartAttemptResult> {
    // TL-115 lock order when a new attempt is created: User -> Test FOR SHARE
    // -> Question FOR SHARE (id asc) -> Media FOR SHARE (id asc). TL-97 uses
    // Test FOR UPDATE and Question FOR UPDATE on the authoring side, so this
    // order cannot deadlock. TL-112b: a live attempt returns before the
    // Question/Media locks and before the publish gate, so those two locks are
    // only taken on the create path.
    await this.coordinator.checkpoint({
      operation: 'exam.start',
      phase: 'before_user_lock',
      userId,
      testId,
      transaction: tx,
    });
    const users = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE
    `;
    if (users.length !== 1) {
      throw new UnauthorizedException('Session is no longer valid.');
    }
    await this.coordinator.checkpoint({
      operation: 'exam.start',
      phase: 'after_user_lock',
      userId,
      testId,
      transaction: tx,
    });

    const lockedTests = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "Test" WHERE "id" = ${testId} FOR SHARE
    `;
    if (lockedTests.length !== 1) throw examTestNotFound();
    const test = await tx.test.findUniqueOrThrow({
      where: { id: testId },
      select: EXAM_TEST_TREE_SELECT,
    });
    const now = await this.databaseNow(tx);
    if (!isExamTestVisible(test, now)) throw examTestNotFound();
    await this.coordinator.checkpoint({
      operation: 'exam.start',
      phase: 'after_test_lock',
      userId,
      testId,
      transaction: tx,
    });

    // (a) TL-112(a): the same key on the same test replays the stored attempt.
    const replay = await tx.examAttempt.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      select: EXAM_ATTEMPT_SELECT,
    });
    if (replay !== null) {
      if (replay.testId !== testId) throw examIdempotencyKeyReused();
      return {
        created: false,
        data: await this.loadAttemptView(tx, userId, replay.id, now),
      };
    }

    // (b) TL-112(b)/TL-112b: one live attempt per (user, test). It is returned
    // before any content lock or publish gate: the attempt owns a frozen
    // snapshot (Q121), so archiving a question or revoking media after the
    // start must not block resuming it (Q120).
    const active = await tx.examAttempt.findFirst({
      where: {
        userId,
        testId,
        status: ExamAttemptStatus.in_progress,
      },
      orderBy: { id: 'desc' },
      select: EXAM_ATTEMPT_SELECT,
    });
    if (active !== null && active.expiresAt.getTime() > now.getTime()) {
      return {
        created: false,
        data: await this.loadAttemptView(tx, userId, active.id, now),
      };
    }

    const questionIds = this.collectQuestionIds(test);
    if (questionIds.length > 0) {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Question" WHERE "id" IN (${Prisma.join(
          questionIds,
        )}) ORDER BY "id" FOR SHARE`,
      );
    }
    const questions = await this.loadQuestions(tx, questionIds);
    await this.coordinator.checkpoint({
      operation: 'exam.start',
      phase: 'after_question_locks',
      userId,
      testId,
      transaction: tx,
    });

    const mediaIds = this.collectMediaIds(test, questions);
    if (mediaIds.length > 0) {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Media" WHERE "id" IN (${Prisma.join(
          mediaIds,
        )}) ORDER BY "id" FOR SHARE`,
      );
    }
    const media =
      mediaIds.length === 0
        ? []
        : await tx.media.findMany({
            where: { id: { in: mediaIds } },
            select: CMS_MEDIA_SELECT,
          });
    await this.coordinator.checkpoint({
      operation: 'exam.start',
      phase: 'after_media_locks',
      userId,
      testId,
      transaction: tx,
    });

    // TL-111: starting re-runs the publish gate. Anything that changed since
    // publish (question archived, media revoked, …) blocks the start.
    const reasons = collectTestPublishBlockers({
      test,
      questions: questions.map(
        (question): TestPublishBlockerQuestion => ({
          id: question.id,
          status: question.status,
          deletedAt: question.deletedAt,
          levelId: question.levelId,
          skill: question.skill,
          audioId: question.audio?.id ?? null,
          imageId: question.image?.id ?? null,
        }),
      ),
      media,
      levelExists: await this.levelExists(tx, test.levelId),
    });
    if (reasons.length > 0) throw examTestUnavailable(reasons);

    // (c) TL-112(c)/F1: an expired attempt is closed only when a new attempt is
    // actually created; a publish-gate 409 above rolls this branch back.
    //
    // The row is locked before it is read again. Lock order is User (held) ->
    // ExamAttempt; the Test/Question/Media locks held above are FOR SHARE. A
    // save takes ExamAttempt FOR UPDATE and, on its first insert, an implicit
    // Question FOR KEY SHARE (compatible with this transaction's FOR SHARE), so
    // no cycle can form. Re-reading under the lock is the F1 defence: if another
    // transaction already closed the attempt this branch does nothing, and the
    // conditional update inside markAttemptTimedOut is the final guard so no
    // second `timed_out` event can be appended.
    if (active !== null) {
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: number;
          status: ExamAttemptStatus;
          expiresAt: Date;
        }>
      >`
        SELECT "id", "status", "expiresAt" FROM "ExamAttempt"
        WHERE "id" = ${active.id}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      // F4: the clock is read after the lock is held.
      const lockedNow = await this.databaseNow(tx);
      if (
        locked !== undefined &&
        locked.status === ExamAttemptStatus.in_progress
      ) {
        await markAttemptTimedOut(tx, {
          attemptId: locked.id,
          expiresAt: locked.expiresAt,
          occurredAt: lockedNow,
          reason: 'expired_on_start',
        });
      }
    }

    // (d) Freeze the snapshot and create the attempt in one transaction.
    const snapshot = buildExamSnapshot(
      this.toSnapshotSource(test, questions, media),
    );
    const expiresAt = new Date(now.getTime() + test.duration * 60_000);
    const attempt = await tx.examAttempt.create({
      data: {
        userId,
        testId,
        status: ExamAttemptStatus.in_progress,
        startedAt: now,
        expiresAt,
        remainingSeconds: test.duration * 60,
        maxScore: snapshot.payload.test.maxScore,
        scoringVersion: test.scoringVersion,
        snapshotVersion: snapshot.snapshotVersion,
        idempotencyKey,
      },
      select: EXAM_ATTEMPT_SELECT,
    });
    await tx.examAttemptSnapshot.create({
      data: {
        attemptId: attempt.id,
        testVersion: snapshot.testVersion,
        snapshotVersion: snapshot.snapshotVersion,
        contentHash: snapshot.contentHash,
        payload: snapshot.payload,
      },
    });
    await tx.examAttemptEvent.create({
      data: {
        attemptId: attempt.id,
        type: 'started',
        idempotencyKey,
        occurredAt: now,
      },
    });

    return {
      created: true,
      data: toExamAttemptView({
        attempt,
        snapshot: { payload: snapshot.payload },
        now,
        answers: [],
      }),
    };
  }

  /**
   * TL-125: the only row this path locks is the attempt itself, and only after
   * filtering by `userId` — another learner's attempt is indistinguishable from
   * a missing one (404). No User/Test/Question/Media lock is taken, so the
   * start chain (User → Test → Question → Media) cannot form a cycle with it.
   */
  private async lockAttempt(
    tx: Prisma.TransactionClient,
    userId: number,
    attemptId: number,
    operation: ExamAttemptLockOperation,
  ): Promise<AttemptLockResult> {
    await this.coordinator.checkpoint({
      operation,
      phase: 'before_attempt_lock',
      userId,
      attemptId,
      transaction: tx,
    });
    const locked = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "ExamAttempt"
      WHERE "id" = ${attemptId} AND "userId" = ${userId}
      FOR UPDATE
    `;
    if (locked.length !== 1) return { kind: 'not_found' };
    // F4: the current time is read with `clock_timestamp()` *after* the lock is
    // held (and before the observation checkpoint), so the grace window is
    // judged at the moment this transaction actually owns the row (TL-126).
    const now = await this.databaseNow(tx);
    await this.coordinator.checkpoint({
      operation,
      phase: 'after_attempt_lock',
      userId,
      attemptId,
      transaction: tx,
    });
    const attempt = await tx.examAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: EXAM_ATTEMPT_SELECT,
    });
    return { kind: 'open', attempt, now };
  }

  private isPastSaveGrace(expiresAt: Date, now: Date): boolean {
    return (
      now.getTime() >= expiresAt.getTime() + EXAM_SAVE_GRACE_SECONDS * 1_000
    );
  }

  /**
   * TL-126/TL-127 + F1: the one-way transition to `timed_out`. The conditional
   * update is the guard; only the winner writes the event, so a start racing
   * this transaction cannot double-write it.
   */
  private async applyLazyTimeout(
    tx: Prisma.TransactionClient,
    attempt: LockedAttempt,
    now: Date,
    reason: 'expired_on_save' | 'expired_on_read',
  ): Promise<void> {
    await markAttemptTimedOut(tx, {
      attemptId: attempt.id,
      expiresAt: attempt.expiresAt,
      occurredAt: now,
      reason,
    });
  }

  private async loadSnapshotPayload(
    client: Prisma.TransactionClient | PrismaService,
    attemptId: number,
  ): Promise<ExamSnapshotPayload> {
    const snapshot = await client.examAttemptSnapshot.findUnique({
      where: { attemptId },
      select: { payload: true },
    });
    if (snapshot === null) {
      throw new InternalServerErrorException(
        'Exam attempt snapshot is missing.',
      );
    }
    return readExamSnapshotPayload(snapshot.payload);
  }

  private indexSnapshotQuestions(
    payload: ExamSnapshotPayload,
  ): Map<string, ExamSnapshotQuestion> {
    const questions = new Map<string, ExamSnapshotQuestion>();
    for (const section of payload.sections) {
      for (const group of section.groups) {
        for (const question of group.questions) {
          questions.set(question.key, question);
        }
      }
    }
    return questions;
  }

  private collectSnapshotMediaIds(payload: ExamSnapshotPayload): number[] {
    const ids = new Set<number>();
    for (const section of payload.sections) {
      for (const group of section.groups) {
        if (group.audio !== null) ids.add(group.audio.mediaId);
        if (group.image !== null) ids.add(group.image.mediaId);
        for (const question of group.questions) {
          if (question.audio !== null) ids.add(question.audio.mediaId);
          if (question.image !== null) ids.add(question.image.mediaId);
        }
      }
    }
    return [...ids].sort((left, right) => left - right);
  }

  /**
  /** TL-124: one transaction, per-item outcomes, shared by both batch attempts. */
  private async saveAnswersInTransaction(
    tx: Prisma.TransactionClient,
    userId: number,
    attemptId: number,
    items: Array<ExamAnswerBody & { questionKey: string }>,
  ): Promise<AttemptBatchResult> {
    const locked = await this.lockAttempt(
      tx,
      userId,
      attemptId,
      'exam.answer.save',
    );
    if (locked.kind === 'not_found') return { kind: 'not_found' };
    const { attempt, now } = locked;
    if (attempt.status !== ExamAttemptStatus.in_progress) {
      return { kind: 'closed', status: attempt.status };
    }
    if (this.isPastSaveGrace(attempt.expiresAt, now)) {
      await this.applyLazyTimeout(tx, attempt, now, 'expired_on_save');
      return { kind: 'expired' };
    }
    const questions = this.indexSnapshotQuestions(
      await this.loadSnapshotPayload(tx, attemptId),
    );
    const results: OpenBatchResult['results'] = [];
    for (const item of items) {
      results.push({
        questionKey: item.questionKey,
        outcome: await this.saveAnswerItem({
          tx,
          attemptId,
          now,
          questions,
          questionKey: item.questionKey,
          body: item,
        }),
      });
    }
    return { kind: 'open', attempt, now, results };
  }

  /**
   * TL-121…TL-124 per-item logic, shared by the single and batch routes. It
   * never throws a domain error: the caller decides whether an outcome becomes
   * a 4xx (single) or one row of `results` (batch).
   */
  private async saveAnswerItem(input: {
    tx: Prisma.TransactionClient;
    attemptId: number;
    now: Date;
    questions: Map<string, ExamSnapshotQuestion>;
    questionKey: string;
    body: ExamAnswerBody;
  }): Promise<SaveOutcome> {
    const { tx, attemptId, now, questionKey, body } = input;
    const question = input.questions.get(questionKey);
    if (!/^q\d+$/u.test(questionKey) || question === undefined) {
      return { status: 'not_found' };
    }
    if (body.answer === undefined) {
      // `answer` is a required body field (TL-121); a missing one is a shape
      // error of the answer, not of the batch envelope.
      return { status: 'invalid', field: 'answer' };
    }

    // TL-123: the append-only event log is the replay ledger. The answer row
    // only remembers the newest key, so an older retry is recognised here.
    const replay = await tx.examAttemptEvent.findUnique({
      where: {
        attemptId_idempotencyKey: {
          attemptId,
          idempotencyKey: body.idempotencyKey,
        },
      },
      select: { type: true, metadata: true },
    });
    if (replay !== null) {
      // F2: hashing an arbitrary retry body may throw (deep/typed input); that
      // is a bad request, not a server fault.
      const replayHash = tryExamAnswerBodySha256(
        toExamAnswerHashBody(questionKey, body),
      );
      // F2: an unhashable retry is a bad answer body, not a key conflict.
      if (replayHash === null) return { status: 'invalid', field: 'answer' };
      if (!isSameExamAnswerRequest(replay, questionKey, replayHash)) {
        return { status: 'key_reused' };
      }
      const replayed = await this.findAnswerRow(tx, attemptId, questionKey);
      if (replayed === null) return { status: 'conflict', current: null };
      return { status: 'replayed', record: replayed };
    }

    // F2: validate the shape *before* hashing the body on the new-save path, so
    // a deeply nested answer is a 400 answer-shape error instead of a 500.
    let answerValue: Prisma.InputJsonValue | null = null;
    if (body.answer !== null) {
      const validated = validateExamAnswerShape(question, body.answer);
      if (!validated.ok) return { status: 'invalid', field: validated.field };
      answerValue = validated.value;
    }
    const bodySha256 = tryExamAnswerBodySha256(
      toExamAnswerHashBody(questionKey, body),
    );
    if (bodySha256 === null) return { status: 'invalid', field: 'answer' };

    const current = await this.findAnswerRow(tx, attemptId, questionKey);
    const expectedVersion = body.expectedVersion;
    if (expectedVersion === null) {
      // `null` means "this question has no answer yet"; an existing row must be
      // updated through its version instead (TL-123).
      if (current !== null) return { status: 'conflict', current };
    } else if (current === null || current.version !== expectedVersion) {
      return { status: 'conflict', current };
    }

    const answerJson: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      answerValue === null ? Prisma.JsonNull : answerValue;
    const record =
      current === null
        ? await tx.examAnswer.create({
            data: {
              attemptId,
              snapshotQuestionKey: questionKey,
              questionId: question.questionId,
              answer: answerJson,
              isFlagged: body.isFlagged,
              answeredAt: body.answer === null ? null : now,
              lastSavedAt: now,
              version: 1,
              saveIdempotencyKey: body.idempotencyKey,
            },
            select: EXAM_ANSWER_SELECT,
          })
        : await tx.examAnswer.update({
            where: { id: current.id },
            data: {
              answer: answerJson,
              isFlagged: body.isFlagged,
              // Clearing keeps the first answer time: the row remembers that
              // the learner did answer this question at some point.
              answeredAt:
                body.answer === null
                  ? current.answeredAt
                  : (current.answeredAt ?? now),
              lastSavedAt: now,
              version: current.version + 1,
              saveIdempotencyKey: body.idempotencyKey,
            },
            select: EXAM_ANSWER_SELECT,
          });

    await tx.examAttemptEvent.create({
      data: {
        attemptId,
        type: 'autosaved',
        idempotencyKey: body.idempotencyKey,
        // No answer content here: the event is metadata-only (TL-123/R11).
        metadata: {
          questionKey,
          version: record.version,
          clientElapsedMs: body.clientElapsedMs ?? null,
          bodySha256,
        },
        occurredAt: now,
      },
    });
    return { status: 'saved', record };
  }

  private findAnswerRow(
    client: Prisma.TransactionClient | PrismaService,
    attemptId: number,
    questionKey: string,
  ): Promise<ExamAnswerRow | null> {
    return client.examAnswer.findUnique({
      where: {
        attemptId_snapshotQuestionKey: {
          attemptId,
          snapshotQuestionKey: questionKey,
        },
      },
      select: EXAM_ANSWER_SELECT,
    });
  }

  private toStoredAnswer(row: ExamAnswerRow): ExamStoredAnswer {
    return {
      snapshotQuestionKey: row.snapshotQuestionKey,
      answer: row.answer,
      isFlagged: row.isFlagged,
      version: row.version,
      answeredAt: row.answeredAt,
      lastSavedAt: row.lastSavedAt,
    };
  }

  private toBatchResult(
    questionKey: string,
    outcome: SaveOutcome,
  ): ExamAnswerBatchResultDto {
    switch (outcome.status) {
      case 'saved':
        return {
          questionKey,
          status: 'saved',
          answer: toExamAnswerView(this.toStoredAnswer(outcome.record)),
        };
      case 'replayed':
        return {
          questionKey,
          status: 'replayed',
          answer: toExamAnswerView(this.toStoredAnswer(outcome.record)),
        };
      case 'conflict':
        return {
          questionKey,
          status: 'conflict',
          current:
            outcome.current === null
              ? null
              : toExamAnswerView(this.toStoredAnswer(outcome.current)),
        };
      case 'invalid':
        return {
          questionKey,
          status: 'invalid',
          code: EXAM_ERROR_CODES.answerInvalid,
        };
      case 'key_reused':
        return {
          questionKey,
          status: 'invalid',
          code: EXAM_ERROR_CODES.idempotencyKeyReused,
        };
      case 'not_found':
        return { questionKey, status: 'not_found' };
    }
  }

  /**
   * TL-124: `questionKey` must not repeat inside one batch (not even for two
   * different idempotency keys), because one transaction would then write two
   * versions of the same row and the result order would be ambiguous.
   */
  private assertUniqueQuestionKeys(
    items: Array<{ questionKey: string }>,
  ): void {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.questionKey)) {
        throw examBatchValidationFailed(['arrayUnique']);
      }
      seen.add(item.questionKey);
    }
  }

  private assertSingleSaveWritable(
    result: AttemptWriteResult,
  ): asserts result is Extract<AttemptWriteResult, { kind: 'open' }> {
    if (result.kind === 'not_found') throw examAttemptNotFound();
    if (result.kind === 'closed') throw examAttemptClosed(result.status);
    if (result.kind === 'expired') throw examAttemptExpired();
  }

  private assertBatchWritable(
    result: AttemptBatchResult,
  ): asserts result is OpenBatchResult {
    if (result.kind === 'not_found') throw examAttemptNotFound();
    if (result.kind === 'closed') throw examAttemptClosed(result.status);
    if (result.kind === 'expired') throw examAttemptExpired();
  }

  /**
   * TL-125 fallback: another writer won the `(attemptId, snapshotQuestionKey)`
   * unique key without holding the attempt lock. The committed state decides
   * whether this request is the same one (replay) or a stale version.
   */
  private async recoverAnswerUniqueConflict(
    userId: number,
    attemptId: number,
    questionKey: string,
    body: ExamAnswerBody,
  ): Promise<ApiSuccessResponse<ExamAnswerSaveViewDto>> {
    // F4/F6: read the committed winner under the same attempt lock, so the
    // deadline check uses the clock after the lock and the replay ledger is
    // classified consistently with saveAnswer.
    const result = await this.prisma.$transaction(
      async (
        tx,
      ): Promise<
        | { kind: 'not_found' }
        | { kind: 'closed'; status: ExamAttemptStatus }
        | { kind: 'expired' }
        | { kind: 'invalid' }
        | { kind: 'key_reused' }
        | { kind: 'replay'; row: ExamAnswerRow; now: Date; expiresAt: Date }
        | {
            kind: 'conflict';
            row: ExamAnswerRow | null;
          }
      > => {
        const locked = await this.lockAttempt(
          tx,
          userId,
          attemptId,
          'exam.answer.save',
        );
        if (locked.kind === 'not_found') return { kind: 'not_found' };
        const { attempt, now } = locked;
        if (attempt.status !== ExamAttemptStatus.in_progress) {
          return { kind: 'closed', status: attempt.status };
        }
        if (this.isPastSaveGrace(attempt.expiresAt, now)) {
          return { kind: 'expired' };
        }
        const row = await this.findAnswerRow(tx, attemptId, questionKey);
        const bodySha256 = tryExamAnswerBodySha256(
          toExamAnswerHashBody(questionKey, body),
        );
        if (bodySha256 === null) return { kind: 'invalid' };
        const event = await tx.examAttemptEvent.findUnique({
          where: {
            attemptId_idempotencyKey: {
              attemptId,
              idempotencyKey: body.idempotencyKey,
            },
          },
          select: { type: true, metadata: true },
        });
        const decision = decideRecoveredAnswerConflict({
          event,
          questionKey,
          bodySha256,
          rowExists: row !== null,
        });
        if (decision === 'key_reused') return { kind: 'key_reused' };
        if (decision === 'replay' && row !== null) {
          return { kind: 'replay', row, now, expiresAt: attempt.expiresAt };
        }
        return { kind: 'conflict', row };
      },
    );

    if (result.kind === 'not_found') throw examAttemptNotFound();
    if (result.kind === 'closed') throw examAttemptClosed(result.status);
    if (result.kind === 'expired') throw examAttemptExpired();
    if (result.kind === 'invalid') throw examAnswerInvalid('answer');
    if (result.kind === 'key_reused') throw examIdempotencyKeyReused();
    if (result.kind === 'replay') {
      return {
        success: true,
        data: toExamAnswerSaveView({
          answer: this.toStoredAnswer(result.row),
          now: result.now,
          expiresAt: result.expiresAt,
        }),
      };
    }
    throw examAnswerVersionConflict(
      result.row === null
        ? null
        : toExamAnswerView(this.toStoredAnswer(result.row)),
    );
  }

  private async findWinnerAttempt(
    userId: number,
    testId: number,
  ): Promise<{ id: number } | null> {
    const inProgress = await this.prisma.examAttempt.findFirst({
      where: { userId, testId, status: ExamAttemptStatus.in_progress },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return inProgress;
  }

  private async loadAttemptView(
    client: Prisma.TransactionClient | PrismaService,
    userId: number,
    attemptId: number,
    now: Date,
  ): Promise<ExamAttemptViewDto> {
    const attempt = await client.examAttempt.findFirst({
      where: { id: attemptId, userId },
      select: EXAM_ATTEMPT_SELECT,
    });
    if (attempt === null) throw examAttemptNotFound();

    const payload = await this.loadSnapshotPayload(client, attemptId);
    const answers = await client.examAnswer.findMany({
      where: { attemptId },
      orderBy: [{ lastSavedAt: 'asc' }, { id: 'asc' }],
      select: EXAM_ANSWER_SELECT,
    });

    return toExamAttemptView({
      attempt,
      snapshot: { payload },
      now,
      answers: answers.map(
        (answer): ExamStoredAnswer => ({
          snapshotQuestionKey: answer.snapshotQuestionKey,
          answer: answer.answer,
          isFlagged: answer.isFlagged,
          version: answer.version,
          answeredAt: answer.answeredAt,
          lastSavedAt: answer.lastSavedAt,
        }),
      ),
    });
  }

  private toSnapshotSource(
    test: ExamTestTree,
    questions: ExamQuestionRow[],
    media: CmsMediaRecord[],
  ): ExamSnapshotSource {
    const questionsById = new Map(
      questions.map((question) => [question.id, question]),
    );
    const mediaById = new Map(media.map((item) => [item.id, item]));
    const mediaOf = (mediaId: number | null) =>
      projectExamSnapshotMedia(
        mediaId === null ? null : (mediaById.get(mediaId) ?? null),
      );

    return {
      test: {
        id: test.id,
        title: test.title,
        instruction: test.instruction,
        levelCode: test.level.code,
        duration: test.duration,
        passScore: test.passScore,
        // Recomputed by the builder from the frozen structure (Q118).
        maxScore: EXAM_SECTION_MAX_SCORE * test.sections.length,
        scoringVersion: test.scoringVersion,
        version: test.version,
      },
      sections: test.sections.map((section) => ({
        orderIndex: section.orderIndex,
        skill: section.skill,
        title: section.title,
        instruction: section.instruction,
        groups: section.groups.map((group) => ({
          orderIndex: group.orderIndex,
          title: group.title,
          instruction: group.instruction,
          content: group.content,
          audio: mediaOf(group.audioId),
          image: mediaOf(group.imageId),
          questions: group.placements.map((placement) => {
            const question = questionsById.get(
              placement.testQuestion.questionId,
            );
            if (question === undefined) {
              // The publish gate already rejected this case above.
              throw new InternalServerErrorException(
                'Exam test question is missing from the locked tree.',
              );
            }
            return {
              placementOrderIndex: placement.orderIndex,
              question: {
                id: question.id,
                version: question.version,
                type: question.type,
                skill: question.skill,
                content: question.content,
                answers: question.answers,
                correctAnswer: question.correctAnswer,
                explanation: question.explanation,
                audio: projectExamSnapshotMedia(question.audio),
                image: projectExamSnapshotMedia(question.image),
              },
            };
          }),
        })),
      })),
    };
  }

  private collectQuestionIds(test: ExamTestTree): number[] {
    const ids = new Set<number>();
    for (const section of test.sections) {
      for (const group of section.groups) {
        for (const placement of group.placements) {
          ids.add(placement.testQuestion.questionId);
        }
      }
    }
    return [...ids].sort((left, right) => left - right);
  }

  private collectMediaIds(
    test: ExamTestTree,
    questions: ExamQuestionRow[],
  ): number[] {
    const ids = new Set<number>();
    for (const section of test.sections) {
      for (const group of section.groups) {
        if (group.audioId !== null) ids.add(group.audioId);
        if (group.imageId !== null) ids.add(group.imageId);
      }
    }
    for (const question of questions) {
      if (question.audio !== null) ids.add(question.audio.id);
      if (question.image !== null) ids.add(question.image.id);
    }
    return [...ids].sort((left, right) => left - right);
  }

  private async loadQuestions(
    tx: Prisma.TransactionClient,
    questionIds: number[],
  ): Promise<ExamQuestionRow[]> {
    if (questionIds.length === 0) return [];
    return tx.question.findMany({
      where: { id: { in: questionIds } },
      select: EXAM_QUESTION_SELECT,
    });
  }

  private async levelExists(
    tx: Prisma.TransactionClient,
    levelId: number,
  ): Promise<boolean> {
    const level = await tx.level.findUnique({
      where: { id: levelId },
      select: { id: true },
    });
    return level !== null;
  }

  private async databaseNow(
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<Date> {
    // F4: statement/clock time, not the transaction start time. Every caller
    // that checks a deadline reads it after acquiring the lock it uses (start:
    // User lock then attempt lock; save/GET/media-grants: attempt lock), so the
    // grace window is judged when the row is actually held.
    const rows = await client.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new InternalServerErrorException('Database clock is unavailable.');
    }
    return row.now;
  }
}
