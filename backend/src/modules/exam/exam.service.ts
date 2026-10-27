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
import { ExamAttemptViewDto, ExamTestIntroDto } from './dto/exam-response.dto';
import { isExamTestVisible } from './exam-eligibility';
import {
  examAttemptNotFound,
  examIdempotencyKeyReused,
  examTestNotFound,
  examTestUnavailable,
} from './exam-errors';
import { classifyExamPersistenceError } from './exam-persistence';
import {
  buildExamSnapshot,
  EXAM_SECTION_MAX_SCORE,
  projectExamSnapshotMedia,
  type ExamSnapshotSource,
} from './exam-snapshot.builder';
import { readExamSnapshotPayload } from './exam-snapshot.reader';
import {
  toExamAttemptView,
  toExamTestIntro,
  type ExamStoredAnswer,
} from './exam.serializer';
import { ExamTransactionCoordinator } from './exam-transaction-coordinator';

/**
 * M4.2a learner exam engine: the intro, the "start attempt" transaction that
 * freezes a snapshot, and the in-progress attempt read. Autosave, submit and
 * resume land in M4.2b; nothing here writes answer rows.
 */

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
  snapshotQuestionKey: true,
  answer: true,
  isFlagged: true,
  version: true,
  lastSavedAt: true,
} satisfies Prisma.ExamAnswerSelect;

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
            where: { attemptId: active.id },
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

  async getAttemptView(
    userId: number,
    attemptId: number,
  ): Promise<ApiSuccessResponse<ExamAttemptViewDto>> {
    const now = await this.databaseNow(this.prisma);
    return {
      success: true,
      data: await this.loadAttemptView(this.prisma, userId, attemptId, now),
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
        }),
      ),
      media,
      levelExists: await this.levelExists(tx, test.levelId),
    });
    if (reasons.length > 0) throw examTestUnavailable(reasons);

    // (c) TL-112(c): an expired attempt is closed only when a new attempt is
    // actually created; a publish-gate 409 above rolls this branch back.
    if (active !== null) {
      await tx.examAttempt.update({
        where: { id: active.id },
        data: {
          status: ExamAttemptStatus.timed_out,
          submittedAt: active.expiresAt,
          remainingSeconds: 0,
        },
      });
      await tx.examAttemptEvent.create({
        data: {
          attemptId: active.id,
          type: 'timed_out',
          metadata: { reason: 'expired_on_start' },
          occurredAt: now,
        },
      });
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

    const snapshot = await client.examAttemptSnapshot.findUnique({
      where: { attemptId },
      select: { payload: true },
    });
    if (snapshot === null) {
      throw new InternalServerErrorException(
        'Exam attempt snapshot is missing.',
      );
    }
    const answers = await client.examAnswer.findMany({
      where: { attemptId },
      orderBy: [{ lastSavedAt: 'asc' }, { id: 'asc' }],
      select: EXAM_ANSWER_SELECT,
    });

    return toExamAttemptView({
      attempt,
      snapshot: { payload: readExamSnapshotPayload(snapshot.payload) },
      now,
      answers: answers.map(
        (answer): ExamStoredAnswer => ({
          snapshotQuestionKey: answer.snapshotQuestionKey,
          answer: answer.answer,
          isFlagged: answer.isFlagged,
          version: answer.version,
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
    const rows = await client.$queryRaw<Array<{ now: Date }>>`
      SELECT now() AS "now"
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new InternalServerErrorException('Database clock is unavailable.');
    }
    return row.now;
  }
}
