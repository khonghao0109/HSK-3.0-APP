import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { LearningEventType, Prisma, ProgressStatus } from '@prisma/client';

import {
  buildLessonReadyWhere,
  PUBLIC_CONTENT_WHERE,
} from '../../../common/policies/lesson-readiness.policy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PUBLIC_EXERCISE_MEDIA_SELECT,
  PUBLIC_LESSON_EXERCISE_WHERE,
  projectPublicExerciseMedia,
} from '../public-exercise.policy';
import { SubmitLessonExerciseAttemptDto } from './dto/lesson-activity-write.dto';
import {
  buildActivityRequestHash,
  parseIdempotencyKey,
} from './lesson-activity-idempotency';
import { classifyLessonActivityPersistenceError } from './lesson-activity-persistence';
import {
  calculateCompletionPercent,
  calculateLessonScore,
  selectNextActivity,
} from './lesson-activity-progress';
import {
  LESSON_ACTIVITY_SCORING_VERSION,
  scoreLessonExercise,
} from './lesson-activity-scorer';
import {
  serializeLessonAttempt,
  type LessonAttemptSummary,
} from './lesson-activity.serializer';
import {
  LessonActivityTransactionCoordinator,
  type LessonActivityTransactionOperation,
} from './lesson-activity-transaction-coordinator';

const PUBLIC_LESSON_GRAPH_SELECT = {
  id: true,
  title: true,
  description: true,
  slug: true,
  orderIndex: true,
  levelId: true,
  topics: {
    where: PUBLIC_CONTENT_WHERE,
    orderBy: [{ orderIndex: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      title: true,
      subtitle: true,
      type: true,
      content: true,
      orderIndex: true,
      isPremium: true,
      isLocked: true,
    },
  },
  exercises: {
    where: PUBLIC_LESSON_EXERCISE_WHERE,
    orderBy: [{ orderIndex: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      topicId: true,
      type: true,
      prompt: true,
      content: true,
      answer: true,
      explanation: true,
      version: true,
      orderIndex: true,
      media: { select: PUBLIC_EXERCISE_MEDIA_SELECT },
    },
  },
} satisfies Prisma.LessonSelect;

type PublicLessonGraph = Prisma.LessonGetPayload<{
  select: typeof PUBLIC_LESSON_GRAPH_SELECT;
}>;

const ATTEMPT_SELECT = {
  id: true,
  exerciseId: true,
  attemptNumber: true,
  isCorrect: true,
  score: true,
  durationSeconds: true,
  exerciseVersion: true,
  feedbackVersion: true,
  submittedAt: true,
  contentSnapshot: true,
  detailJson: true,
} satisfies Prisma.LessonExerciseAttemptSelect;

type StoredAttempt = Prisma.LessonExerciseAttemptGetPayload<{
  select: typeof ATTEMPT_SELECT;
}>;

type StoredEvent = {
  id: bigint;
  type: LearningEventType;
  lessonId: number | null;
  topicId: number | null;
  exerciseId: number | null;
  attemptId: number | null;
  occurredAt: Date;
};

type ActivityFacts = {
  attempts: Array<{
    exerciseId: number;
    score: number | null;
    durationSeconds: number | null;
  }>;
  attemptedExerciseIds: Set<number>;
  topicProgresses: Map<
    number,
    {
      status: ProgressStatus;
      completionPercent: number;
      timeSpentSeconds: number;
      startedAt: Date | null;
      completedAt: Date | null;
      lastActivityAt: Date | null;
    }
  >;
};

@Injectable()
export class LessonActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: LessonActivityTransactionCoordinator,
  ) {}

  async startLesson(userId: number, lessonId: number, rawKey: unknown) {
    const idempotencyKey = parseIdempotencyKey(rawKey);
    return this.write('lesson.start', userId, async (tx) => {
      await this.lockLesson(tx, lessonId);
      const graph = await this.requirePublicLesson(tx, lessonId);
      const replay = await this.findEvent(tx, userId, idempotencyKey);
      if (replay) {
        this.assertEvent(replay, 'lesson_started', { lessonId });
        return this.eventResult(replay, { lessonId, status: 'learning' });
      }

      await this.lockProgressRows(tx, userId, lessonId);
      const existing = await tx.progress.findUnique({
        where: { userId_lessonId: { userId, lessonId } },
      });
      if (existing?.startedAt) {
        throw new ConflictException(
          'Lesson was already started with a different Idempotency-Key.',
        );
      }

      const now = new Date();
      const pointer = selectNextActivity({
        topics: this.orderedTopics(graph),
        standaloneExercises: this.standaloneExercises(graph),
        completedTopicIds: new Set(),
        attemptedExerciseIds: new Set(),
      });
      await tx.progress.upsert({
        where: { userId_lessonId: { userId, lessonId } },
        create: {
          userId,
          lessonId,
          status: 'learning',
          completionPercent: 0,
          currentTopicId: pointer.currentTopicId,
          currentExerciseId: pointer.currentExerciseId,
          startedAt: now,
          lastActivityAt: now,
        },
        update: {
          status: existing?.status === 'done' ? 'done' : 'learning',
          currentTopicId: pointer.currentTopicId,
          currentExerciseId: pointer.currentExerciseId,
          startedAt: existing?.startedAt ?? now,
          lastActivityAt: now,
        },
      });

      await this.startActivePlanItems(tx, userId, lessonId, now);
      const event = await tx.learningEvent.create({
        data: {
          userId,
          type: 'lesson_started',
          lessonId,
          idempotencyKey,
          occurredAt: now,
        },
        select: this.eventSelect(),
      });
      return this.eventResult(event, { lessonId, status: 'learning' });
    });
  }

  async startTopic(userId: number, topicId: number, rawKey: unknown) {
    const idempotencyKey = parseIdempotencyKey(rawKey);
    return this.write('topic.start', userId, async (tx) => {
      const { graph, topic } = await this.requirePublicTopic(tx, topicId);
      const replay = await this.findEvent(tx, userId, idempotencyKey);
      if (replay) {
        this.assertEvent(replay, 'topic_started', { topicId });
        return this.eventResult(replay, { topicId, status: 'learning' });
      }

      await this.lockProgressRows(tx, userId, graph.id, topicId);
      await this.requireStartedLessonProgress(tx, userId, graph.id);
      const existing = await tx.userTopicProgress.findUnique({
        where: { userId_topicId: { userId, topicId } },
      });
      if (existing?.startedAt) {
        throw new ConflictException(
          'Topic was already started with a different Idempotency-Key.',
        );
      }

      const now = new Date();
      const firstExercise = graph.exercises
        .filter((exercise) => exercise.topicId === topicId)
        .sort((left, right) => this.compareOrdered(left, right))[0];
      await tx.userTopicProgress.upsert({
        where: { userId_topicId: { userId, topicId } },
        create: {
          userId,
          topicId,
          status: 'learning',
          startedAt: now,
          lastActivityAt: now,
        },
        update: {
          status: existing?.status === 'done' ? 'done' : 'learning',
          startedAt: existing?.startedAt ?? now,
          lastActivityAt: now,
        },
      });
      await tx.progress.update({
        where: { userId_lessonId: { userId, lessonId: graph.id } },
        data: {
          currentTopicId: topic.id,
          currentExerciseId: firstExercise?.id ?? null,
          lastActivityAt: now,
        },
      });
      const event = await tx.learningEvent.create({
        data: {
          userId,
          type: 'topic_started',
          lessonId: graph.id,
          topicId,
          idempotencyKey,
          occurredAt: now,
        },
        select: this.eventSelect(),
      });
      return this.eventResult(event, { topicId, status: 'learning' });
    });
  }

  async submitAttempt(
    userId: number,
    exerciseId: number,
    dto: SubmitLessonExerciseAttemptDto,
    rawKey: unknown,
  ) {
    const idempotencyKey = parseIdempotencyKey(rawKey);
    const requestHash = buildActivityRequestHash({
      exerciseId,
      answer: dto.answer,
      durationSeconds: dto.durationSeconds ?? null,
    });

    return this.write('exercise.submit', userId, async (tx) => {
      const replay = await this.findEvent(tx, userId, idempotencyKey);
      if (replay) {
        this.assertEvent(replay, 'exercise_submitted', { exerciseId });
        const attempt = await this.requireReplayAttempt(
          tx,
          userId,
          replay,
          requestHash,
        );
        return {
          success: true as const,
          data: serializeLessonAttempt(attempt),
        };
      }

      const { graph, exercise } = await this.requirePublicExercise(
        tx,
        exerciseId,
        userId,
      );

      await this.lockProgressRows(tx, userId, graph.id, exercise.topicId);
      await this.requireStartedLessonProgress(tx, userId, graph.id);
      const score = scoreLessonExercise({
        type: exercise.type,
        content: exercise.content,
        authoritativeAnswer: exercise.answer,
        submittedAnswer: dto.answer,
      });
      const latest = await tx.lessonExerciseAttempt.aggregate({
        where: { userId, exerciseId },
        _max: { attemptNumber: true },
      });
      const now = new Date();
      const media = projectPublicExerciseMedia(exercise.type, exercise.media);
      const attempt = await tx.lessonExerciseAttempt.create({
        data: {
          userId,
          exerciseId,
          attemptNumber: (latest._max.attemptNumber ?? 0) + 1,
          answer: dto.answer as Prisma.InputJsonValue,
          contentSnapshot: {
            exerciseId: exercise.id,
            lessonId: graph.id,
            topicId: exercise.topicId,
            exerciseVersion: exercise.version,
            type: exercise.type,
            prompt: exercise.prompt,
            content: exercise.content,
            authoritativeAnswer: exercise.answer,
            explanation: exercise.explanation,
            media,
            scoringVersion: LESSON_ACTIVITY_SCORING_VERSION,
          },
          exerciseVersion: exercise.version,
          isCorrect: score.isCorrect,
          score: score.score,
          durationSeconds: dto.durationSeconds,
          detailJson: { requestHash },
          feedbackVersion: score.feedbackVersion,
          idempotencyKey,
          submittedAt: now,
        },
        select: ATTEMPT_SELECT,
      });

      if (exercise.topicId !== null) {
        await this.recomputeTopicProgress(
          tx,
          userId,
          graph,
          exercise.topicId,
          now,
        );
      }
      await this.recomputeLessonProgress(tx, userId, graph, now);
      await tx.learningEvent.create({
        data: {
          userId,
          type: 'exercise_submitted',
          lessonId: graph.id,
          topicId: exercise.topicId,
          exerciseId,
          attemptId: attempt.id,
          idempotencyKey,
          occurredAt: now,
          metadata: {
            score: score.score,
            isCorrect: score.isCorrect,
            attemptNumber: attempt.attemptNumber,
            exerciseVersion: exercise.version,
            durationSeconds: dto.durationSeconds ?? null,
            feedbackVersion: score.feedbackVersion,
          },
        },
      });
      return { success: true as const, data: serializeLessonAttempt(attempt) };
    });
  }

  async completeTopic(userId: number, topicId: number, rawKey: unknown) {
    const idempotencyKey = parseIdempotencyKey(rawKey);
    return this.write('topic.complete', userId, async (tx) => {
      const { graph } = await this.requirePublicTopic(tx, topicId);
      const replay = await this.findEvent(tx, userId, idempotencyKey);
      if (replay) {
        this.assertEvent(replay, 'topic_completed', { topicId });
        return this.eventResult(replay, { topicId, status: 'done' });
      }

      await this.lockProgressRows(tx, userId, graph.id, topicId);
      await this.requireStartedLessonProgress(tx, userId, graph.id);
      const topicProgress = await tx.userTopicProgress.findUnique({
        where: { userId_topicId: { userId, topicId } },
      });
      if (!topicProgress?.startedAt) {
        throw new ConflictException('Topic must be started before completion.');
      }
      if (topicProgress.status === 'done') {
        throw new ConflictException(
          'Topic was already completed with a different Idempotency-Key.',
        );
      }

      const requiredIds = graph.exercises
        .filter((exercise) => exercise.topicId === topicId)
        .map((exercise) => exercise.id);
      const attemptedCount =
        requiredIds.length === 0
          ? 0
          : (
              await tx.lessonExerciseAttempt.groupBy({
                by: ['exerciseId'],
                where: {
                  userId,
                  exerciseId: { in: requiredIds },
                  submittedAt: { not: null },
                },
              })
            ).length;
      if (attemptedCount !== requiredIds.length) {
        throw new ConflictException(
          'All required public topic exercises must be attempted first.',
        );
      }

      const now = new Date();
      await tx.userTopicProgress.update({
        where: { userId_topicId: { userId, topicId } },
        data: {
          status: 'done',
          completionPercent: 100,
          completedAt: topicProgress.completedAt ?? now,
          lastActivityAt: now,
        },
      });
      await this.recomputeLessonProgress(tx, userId, graph, now);
      const event = await tx.learningEvent.create({
        data: {
          userId,
          type: 'topic_completed',
          lessonId: graph.id,
          topicId,
          idempotencyKey,
          occurredAt: now,
        },
        select: this.eventSelect(),
      });
      return this.eventResult(event, { topicId, status: 'done' });
    });
  }

  async completeLesson(userId: number, lessonId: number, rawKey: unknown) {
    const idempotencyKey = parseIdempotencyKey(rawKey);
    return this.write('lesson.complete', userId, async (tx) => {
      await this.lockLesson(tx, lessonId);
      const graph = await this.requirePublicLesson(tx, lessonId);
      const replay = await this.findEvent(tx, userId, idempotencyKey);
      if (replay) {
        this.assertEvent(replay, 'lesson_completed', { lessonId });
        return this.eventResult(replay, { lessonId, status: 'done' });
      }

      await this.lockProgressRows(tx, userId, lessonId);
      const progress = await this.requireStartedLessonProgress(
        tx,
        userId,
        lessonId,
      );
      if (progress.status === 'done') {
        throw new ConflictException(
          'Lesson was already completed with a different Idempotency-Key.',
        );
      }

      const facts = await this.loadFacts(tx, userId, graph);
      if (
        graph.topics.some(
          (topic) => facts.topicProgresses.get(topic.id)?.status !== 'done',
        )
      ) {
        throw new ConflictException(
          'All public topics must be completed before the lesson.',
        );
      }
      if (
        this.standaloneExercises(graph).some(
          (exercise) => !facts.attemptedExerciseIds.has(exercise.id),
        )
      ) {
        throw new ConflictException(
          'All public standalone exercises must be attempted before the lesson.',
        );
      }

      const now = new Date();
      await tx.progress.update({
        where: { userId_lessonId: { userId, lessonId } },
        data: {
          status: 'done',
          completionPercent: 100,
          score: calculateLessonScore(facts.attempts),
          timeSpentSeconds: this.totalDuration(facts.attempts),
          currentTopicId: null,
          currentExerciseId: null,
          completedAt: progress.completedAt ?? now,
          lastActivityAt: now,
        },
      });
      await this.completeActivePlanItems(tx, userId, lessonId, now);
      const event = await tx.learningEvent.create({
        data: {
          userId,
          type: 'lesson_completed',
          lessonId,
          idempotencyKey,
          occurredAt: now,
        },
        select: this.eventSelect(),
      });
      return this.eventResult(event, { lessonId, status: 'done' });
    });
  }

  async getAttempts(userId: number, exerciseId: number) {
    const attempts = await this.prisma.lessonExerciseAttempt.findMany({
      where: { userId, exerciseId, submittedAt: { not: null } },
      orderBy: [{ attemptNumber: 'asc' }, { id: 'asc' }],
      select: ATTEMPT_SELECT,
    });
    if (attempts.length === 0) {
      const visible = await this.prisma.lessonExercise.findFirst({
        where: {
          id: exerciseId,
          AND: [
            PUBLIC_LESSON_EXERCISE_WHERE,
            { lesson: { is: buildLessonReadyWhere() } },
          ],
        },
        select: { id: true },
      });
      if (!visible) throw new NotFoundException('Exercise not found.');
    }
    return {
      success: true as const,
      data: attempts.map(serializeLessonAttempt),
    };
  }

  async getLessonActivity(userId: number, lessonId: number) {
    return this.prisma.$transaction(async (tx) => {
      const graph = await this.requirePublicLesson(tx, lessonId);
      const progress = await tx.progress.findUnique({
        where: { userId_lessonId: { userId, lessonId } },
      });
      const facts = await this.loadFacts(tx, userId, graph, true);
      const completedTopicIds = new Set(
        [...facts.topicProgresses.entries()]
          .filter(([, value]) => value.status === 'done')
          .map(([topicId]) => topicId),
      );
      const pointer = selectNextActivity({
        topics: this.orderedTopics(graph),
        standaloneExercises: this.standaloneExercises(graph),
        completedTopicIds,
        attemptedExerciseIds: facts.attemptedExerciseIds,
        lessonCompleted: progress?.status === 'done',
      });
      const latestAttempts = await this.latestAttempts(tx, userId, graph);
      const publicExercises = graph.exercises.map((exercise) => ({
        id: exercise.id,
        topicId: exercise.topicId,
        type: exercise.type,
        prompt: exercise.prompt,
        content: exercise.content,
        version: exercise.version,
        orderIndex: exercise.orderIndex,
        media: projectPublicExerciseMedia(exercise.type, exercise.media),
        latestAttempt: latestAttempts.get(exercise.id) ?? null,
      }));
      const currentExercise =
        publicExercises.find(
          (exercise) => exercise.id === pointer.currentExerciseId,
        ) ?? null;
      const currentTopic =
        graph.topics.find((topic) => topic.id === pointer.currentTopicId) ??
        null;

      return {
        success: true as const,
        data: {
          lesson: {
            id: graph.id,
            title: graph.title,
            description: graph.description,
            slug: graph.slug,
            orderIndex: graph.orderIndex,
            levelId: graph.levelId,
          },
          progress: this.serializeProgress(progress),
          topics: graph.topics.map((topic) => ({
            ...topic,
            progress:
              facts.topicProgresses.get(topic.id) ??
              this.emptyProgressSummary(),
            exercises: publicExercises.filter(
              (exercise) => exercise.topicId === topic.id,
            ),
          })),
          standaloneExercises: publicExercises.filter(
            (exercise) => exercise.topicId === null,
          ),
          currentTopic: currentTopic
            ? {
                id: currentTopic.id,
                title: currentTopic.title,
                orderIndex: currentTopic.orderIndex,
              }
            : null,
          currentExercise,
          nextAction: progress === null ? 'start_lesson' : pointer.nextAction,
        },
      };
    });
  }

  async getLessonProgressList(userId: number) {
    const progresses = await this.prisma.progress.findMany({
      where: { userId },
      orderBy: [{ lastActivityAt: 'desc' }, { lessonId: 'asc' }],
      select: {
        lessonId: true,
        status: true,
        score: true,
        completionPercent: true,
        timeSpentSeconds: true,
        startedAt: true,
        completedAt: true,
        lastActivityAt: true,
        lesson: { select: { title: true, slug: true } },
      },
    });
    return {
      success: true as const,
      data: progresses.map(({ lesson, ...progress }) => ({
        ...progress,
        lesson,
      })),
    };
  }

  async getLessonProgress(userId: number, lessonId: number) {
    const progress = await this.prisma.progress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
      select: {
        lessonId: true,
        status: true,
        score: true,
        completionPercent: true,
        timeSpentSeconds: true,
        startedAt: true,
        completedAt: true,
        lastActivityAt: true,
        currentTopicId: true,
        currentExerciseId: true,
        lesson: { select: { title: true, slug: true } },
      },
    });
    if (!progress) throw new NotFoundException('Lesson progress not found.');
    return { success: true as const, data: progress };
  }

  private async write<T>(
    operation: LessonActivityTransactionOperation,
    userId: number,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.coordinator.checkpoint({
          operation,
          phase: 'before_user_lock',
          userId,
          transaction: tx,
        });
        const activeRows = await tx.$queryRaw<Array<{ id: number }>>(
          Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} AND status = 'active' AND "deletedAt" IS NULL FOR UPDATE`,
        );
        if (activeRows.length !== 1) {
          throw new UnauthorizedException('Account is not available.');
        }
        await this.coordinator.checkpoint({
          operation,
          phase: 'after_user_lock',
          userId,
          transaction: tx,
        });
        return callback(tx);
      });
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      const kind = classifyLessonActivityPersistenceError(error);
      if (kind === 'unique_conflict') {
        throw new ConflictException(
          'Activity write conflicted with an existing idempotency key or attempt.',
        );
      }
      if (kind === 'concurrent_retry') {
        throw new ConflictException(
          'Concurrent activity update detected; retry the request.',
        );
      }
      if (kind === 'timeout') {
        throw new ServiceUnavailableException(
          'Activity write timed out; retry with the same Idempotency-Key.',
        );
      }
      if (kind === 'connection_error') {
        throw new ServiceUnavailableException(
          'Activity storage is unavailable; retry with the same Idempotency-Key.',
        );
      }
      throw new InternalServerErrorException('Unable to persist activity.');
    }
  }

  private async lockLesson(tx: Prisma.TransactionClient, lessonId: number) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "Lesson" WHERE id = ${lessonId} FOR SHARE`,
    );
  }

  private async lockProgressRows(
    tx: Prisma.TransactionClient,
    userId: number,
    lessonId: number,
    topicId?: number | null,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "Progress" WHERE "userId" = ${userId} AND "lessonId" = ${lessonId} FOR UPDATE`,
    );
    if (topicId !== undefined && topicId !== null) {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "UserTopicProgress" WHERE "userId" = ${userId} AND "topicId" = ${topicId} FOR UPDATE`,
      );
    }
  }

  private async requirePublicLesson(
    tx: Prisma.TransactionClient,
    lessonId: number,
  ): Promise<PublicLessonGraph> {
    const graph = await tx.lesson.findFirst({
      where: buildLessonReadyWhere({ id: lessonId }),
      select: PUBLIC_LESSON_GRAPH_SELECT,
    });
    if (!graph) throw new NotFoundException('Lesson not found or not ready.');
    return graph;
  }

  private async requirePublicTopic(
    tx: Prisma.TransactionClient,
    topicId: number,
  ) {
    const location = await tx.topic.findUnique({
      where: { id: topicId },
      select: { lessonId: true },
    });
    if (!location) throw new NotFoundException('Topic not found.');
    await this.lockLesson(tx, location.lessonId);
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "Topic" WHERE id = ${topicId} FOR SHARE`,
    );
    const graph = await this.requirePublicLesson(tx, location.lessonId);
    const topic = graph.topics.find((candidate) => candidate.id === topicId);
    if (!topic) throw new NotFoundException('Topic not found or not public.');
    return { graph, topic };
  }

  private async requirePublicExercise(
    tx: Prisma.TransactionClient,
    exerciseId: number,
    userId: number,
  ) {
    const location = await tx.lessonExercise.findUnique({
      where: { id: exerciseId },
      select: { lessonId: true, topicId: true },
    });
    if (!location) throw new NotFoundException('Exercise not found.');
    await this.coordinator.checkpoint({
      operation: 'exercise.submit',
      phase: 'before_content_lock',
      userId,
      transaction: tx,
    });
    await this.lockLesson(tx, location.lessonId);
    if (location.topicId !== null) {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "Topic" WHERE id = ${location.topicId} FOR SHARE`,
      );
    }
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "LessonExercise" WHERE id = ${exerciseId} FOR SHARE`,
    );
    await this.coordinator.checkpoint({
      operation: 'exercise.submit',
      phase: 'after_content_lock',
      userId,
      transaction: tx,
    });
    const graph = await this.requirePublicLesson(tx, location.lessonId);
    const exercise = graph.exercises.find(
      (candidate) => candidate.id === exerciseId,
    );
    if (!exercise) {
      throw new NotFoundException('Exercise not found or not public.');
    }
    if (
      exercise.topicId !== null &&
      !graph.topics.some((topic) => topic.id === exercise.topicId)
    ) {
      throw new NotFoundException('Exercise topic is not public.');
    }
    return { graph, exercise };
  }

  private async requireStartedLessonProgress(
    tx: Prisma.TransactionClient,
    userId: number,
    lessonId: number,
  ) {
    const progress = await tx.progress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
    if (!progress?.startedAt) {
      throw new ConflictException('Lesson must be started first.');
    }
    return progress;
  }

  private async recomputeTopicProgress(
    tx: Prisma.TransactionClient,
    userId: number,
    graph: PublicLessonGraph,
    topicId: number,
    now: Date,
  ) {
    const exerciseIds = graph.exercises
      .filter((exercise) => exercise.topicId === topicId)
      .map((exercise) => exercise.id);
    const attempts =
      exerciseIds.length === 0
        ? []
        : await tx.lessonExerciseAttempt.findMany({
            where: {
              userId,
              exerciseId: { in: exerciseIds },
              submittedAt: { not: null },
            },
            select: { exerciseId: true, durationSeconds: true },
          });
    const attempted = new Set(attempts.map((attempt) => attempt.exerciseId));
    const existing = await tx.userTopicProgress.findUnique({
      where: { userId_topicId: { userId, topicId } },
    });
    const done = existing?.status === 'done';
    await tx.userTopicProgress.upsert({
      where: { userId_topicId: { userId, topicId } },
      create: {
        userId,
        topicId,
        status: 'learning',
        completionPercent: calculateCompletionPercent(
          attempted.size,
          exerciseIds.length,
        ),
        timeSpentSeconds: this.totalDuration(attempts),
        startedAt: now,
        lastActivityAt: now,
      },
      update: {
        status: done ? 'done' : 'learning',
        completionPercent: done
          ? 100
          : calculateCompletionPercent(attempted.size, exerciseIds.length),
        timeSpentSeconds: this.totalDuration(attempts),
        startedAt: existing?.startedAt ?? now,
        lastActivityAt: now,
      },
    });
  }

  private async recomputeLessonProgress(
    tx: Prisma.TransactionClient,
    userId: number,
    graph: PublicLessonGraph,
    now: Date,
  ) {
    const existing = await this.requireStartedLessonProgress(
      tx,
      userId,
      graph.id,
    );
    const facts = await this.loadFacts(tx, userId, graph);
    const completedTopicIds = new Set(
      [...facts.topicProgresses.entries()]
        .filter(([, progress]) => progress.status === 'done')
        .map(([topicId]) => topicId),
    );
    const standalone = this.standaloneExercises(graph);
    const completedStandalone = standalone.filter((exercise) =>
      facts.attemptedExerciseIds.has(exercise.id),
    ).length;
    const pointer = selectNextActivity({
      topics: this.orderedTopics(graph),
      standaloneExercises: standalone,
      completedTopicIds,
      attemptedExerciseIds: facts.attemptedExerciseIds,
      lessonCompleted: existing.status === 'done',
    });
    const done = existing.status === 'done';
    await tx.progress.update({
      where: { userId_lessonId: { userId, lessonId: graph.id } },
      data: {
        status: done ? 'done' : 'learning',
        completionPercent: done
          ? 100
          : calculateCompletionPercent(
              completedTopicIds.size + completedStandalone,
              graph.topics.length + standalone.length,
            ),
        score: calculateLessonScore(facts.attempts),
        timeSpentSeconds: this.totalDuration(facts.attempts),
        currentTopicId: pointer.currentTopicId,
        currentExerciseId: pointer.currentExerciseId,
        lastActivityAt: now,
      },
    });
  }

  private async loadFacts(
    tx: Prisma.TransactionClient,
    userId: number,
    graph: PublicLessonGraph,
    includeEmptyTopics = false,
  ): Promise<ActivityFacts> {
    const exerciseIds = graph.exercises.map((exercise) => exercise.id);
    const topicIds = graph.topics.map((topic) => topic.id);
    const [attempts, topicRows] = await Promise.all([
      exerciseIds.length === 0
        ? Promise.resolve([])
        : tx.lessonExerciseAttempt.findMany({
            where: {
              userId,
              exerciseId: { in: exerciseIds },
              submittedAt: { not: null },
            },
            select: {
              exerciseId: true,
              score: true,
              durationSeconds: true,
            },
          }),
      topicIds.length === 0
        ? Promise.resolve([])
        : tx.userTopicProgress.findMany({
            where: { userId, topicId: { in: topicIds } },
            select: {
              topicId: true,
              status: true,
              completionPercent: true,
              timeSpentSeconds: true,
              startedAt: true,
              completedAt: true,
              lastActivityAt: true,
            },
          }),
    ]);
    const topicProgresses = new Map(
      topicRows.map(({ topicId, ...progress }) => [topicId, progress]),
    );
    if (includeEmptyTopics) {
      for (const topicId of topicIds) {
        if (!topicProgresses.has(topicId)) {
          topicProgresses.set(topicId, this.emptyProgressSummary());
        }
      }
    }
    return {
      attempts,
      attemptedExerciseIds: new Set(
        attempts.map((attempt) => attempt.exerciseId),
      ),
      topicProgresses,
    };
  }

  private async latestAttempts(
    tx: Prisma.TransactionClient,
    userId: number,
    graph: PublicLessonGraph,
  ): Promise<Map<number, LessonAttemptSummary>> {
    const exerciseIds = graph.exercises.map((exercise) => exercise.id);
    if (exerciseIds.length === 0) return new Map();
    const attempts = await tx.lessonExerciseAttempt.findMany({
      where: {
        userId,
        exerciseId: { in: exerciseIds },
        submittedAt: { not: null },
      },
      orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
      select: ATTEMPT_SELECT,
    });
    const latest = new Map<number, LessonAttemptSummary>();
    for (const attempt of attempts) {
      if (!latest.has(attempt.exerciseId)) {
        latest.set(attempt.exerciseId, serializeLessonAttempt(attempt));
      }
    }
    return latest;
  }

  private async findEvent(
    tx: Prisma.TransactionClient,
    userId: number,
    idempotencyKey: string,
  ): Promise<StoredEvent | null> {
    return tx.learningEvent.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      select: this.eventSelect(),
    });
  }

  private assertEvent(
    event: StoredEvent,
    type: LearningEventType,
    expected: { lessonId?: number; topicId?: number; exerciseId?: number },
  ) {
    if (
      event.type !== type ||
      (expected.lessonId !== undefined &&
        event.lessonId !== expected.lessonId) ||
      (expected.topicId !== undefined && event.topicId !== expected.topicId) ||
      (expected.exerciseId !== undefined &&
        event.exerciseId !== expected.exerciseId)
    ) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different request.',
      );
    }
  }

  private async requireReplayAttempt(
    tx: Prisma.TransactionClient,
    userId: number,
    event: StoredEvent,
    requestHash: string,
  ): Promise<StoredAttempt> {
    if (event.attemptId === null) {
      throw new InternalServerErrorException('Stored activity is incomplete.');
    }
    const attempt = await tx.lessonExerciseAttempt.findFirst({
      where: { id: event.attemptId, userId, submittedAt: { not: null } },
      select: ATTEMPT_SELECT,
    });
    if (!attempt || this.readRequestHash(attempt.detailJson) !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different request.',
      );
    }
    return attempt;
  }

  private readRequestHash(value: Prisma.JsonValue | null): string | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const requestHash = value.requestHash;
    return typeof requestHash === 'string' ? requestHash : null;
  }

  private eventSelect() {
    return {
      id: true,
      type: true,
      lessonId: true,
      topicId: true,
      exerciseId: true,
      attemptId: true,
      occurredAt: true,
    } as const;
  }

  private eventResult(event: StoredEvent, value: Record<string, unknown>) {
    return {
      success: true as const,
      data: {
        ...value,
        eventId: event.id.toString(),
        occurredAt: event.occurredAt,
      },
    };
  }

  private orderedTopics(graph: PublicLessonGraph) {
    return graph.topics.map((topic) => ({
      id: topic.id,
      orderIndex: topic.orderIndex,
      exercises: graph.exercises
        .filter((exercise) => exercise.topicId === topic.id)
        .map((exercise) => ({
          id: exercise.id,
          orderIndex: exercise.orderIndex,
        })),
    }));
  }

  private standaloneExercises(graph: PublicLessonGraph) {
    return graph.exercises
      .filter((exercise) => exercise.topicId === null)
      .map((exercise) => ({
        id: exercise.id,
        orderIndex: exercise.orderIndex,
      }));
  }

  private compareOrdered(
    left: { id: number; orderIndex: number },
    right: { id: number; orderIndex: number },
  ) {
    return left.orderIndex - right.orderIndex || left.id - right.id;
  }

  private totalDuration(
    attempts: Array<{ durationSeconds: number | null }>,
  ): number {
    return attempts.reduce(
      (sum, attempt) => sum + (attempt.durationSeconds ?? 0),
      0,
    );
  }

  private emptyProgressSummary() {
    return {
      status: 'not_started' as const,
      completionPercent: 0,
      timeSpentSeconds: 0,
      startedAt: null,
      completedAt: null,
      lastActivityAt: null,
    };
  }

  private serializeProgress(
    progress: {
      status: ProgressStatus;
      score: number | null;
      completionPercent: number;
      timeSpentSeconds: number;
      startedAt: Date | null;
      completedAt: Date | null;
      lastActivityAt: Date | null;
    } | null,
  ) {
    if (!progress) {
      return { ...this.emptyProgressSummary(), score: null };
    }
    return {
      status: progress.status,
      score: progress.score,
      completionPercent: progress.completionPercent,
      timeSpentSeconds: progress.timeSpentSeconds,
      startedAt: progress.startedAt,
      completedAt: progress.completedAt,
      lastActivityAt: progress.lastActivityAt,
    };
  }

  private async startActivePlanItems(
    tx: Prisma.TransactionClient,
    userId: number,
    lessonId: number,
    now: Date,
  ) {
    const items = await tx.learningPlanItem.findMany({
      where: {
        lessonId,
        status: 'planned',
        learningPlan: { is: { userId, status: 'active' } },
      },
      select: { id: true },
    });
    if (items.length > 0) {
      await tx.learningPlanItem.updateMany({
        where: { id: { in: items.map((item) => item.id) } },
        data: { status: 'in_progress', startedAt: now },
      });
    }
  }

  private async completeActivePlanItems(
    tx: Prisma.TransactionClient,
    userId: number,
    lessonId: number,
    now: Date,
  ) {
    const items = await tx.learningPlanItem.findMany({
      where: {
        lessonId,
        status: { in: ['planned', 'in_progress'] },
        learningPlan: { is: { userId, status: 'active' } },
      },
      select: { id: true },
    });
    if (items.length > 0) {
      await tx.learningPlanItem.updateMany({
        where: { id: { in: items.map((item) => item.id) } },
        data: { status: 'completed', completedAt: now },
      });
    }
  }
}
