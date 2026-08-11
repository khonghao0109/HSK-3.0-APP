import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ContentEntityType, ExerciseType, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  ApiSuccessResponse,
  PaginationMeta,
} from '../../common/interfaces/api-response.interface';
import {
  LessonExerciseAuthoringValidationError,
  LessonExerciseAuthoringValue,
  validateLessonExerciseAuthoring,
} from '../../common/validation/lesson-exercise-authoring.validator';
import {
  canonicalJson,
  sha256CanonicalJson,
} from '../../common/utils/canonical-json';
import { PrismaService } from '../../prisma/prisma.service';

import {
  assertAdminActor,
  classifyCmsPersistenceError,
  CmsActor,
  decidePublishAction,
} from './cms-workflow';
import {
  CmsTransactionCoordinator,
  CmsTransactionOperation,
} from './cms-transaction-coordinator';
import { lockActiveCmsActor } from './cms-actor-lock';
import { AdminExercisesQueryDto } from './dto/admin-exercises-query.dto';
import { CreateExerciseRevisionDto } from './dto/create-exercise-revision.dto';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { ReviewRevisionDto } from './dto/review-revision.dto';
import { assertExerciseMediaPublishReady } from './exercise-publish-readiness';

const EXERCISE_REVISION_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  revision: true,
  snapshot: true,
  contentHash: true,
  authorId: true,
  createdAt: true,
  reviews: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      reviewerId: true,
      decision: true,
      note: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ContentRevisionSelect;

export const EXERCISE_ADMIN_SELECT = {
  id: true,
  lessonId: true,
  topicId: true,
  mediaId: true,
  type: true,
  prompt: true,
  content: true,
  answer: true,
  explanation: true,
  version: true,
  orderIndex: true,
  status: true,
  dataSourceId: true,
  sourceKey: true,
  createdById: true,
  updatedById: true,
  publishedById: true,
  publishedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  media: {
    select: {
      id: true,
      url: true,
      type: true,
      mimeType: true,
      duration: true,
      processingStatus: true,
      deletedAt: true,
    },
  },
  lesson: {
    select: {
      id: true,
      title: true,
      slug: true,
    },
  },
  topic: {
    select: {
      id: true,
      title: true,
    },
  },
  dataSource: {
    select: {
      id: true,
      code: true,
      name: true,
      version: true,
    },
  },
} satisfies Prisma.LessonExerciseSelect;

export type ExerciseSnapshot = LessonExerciseAuthoringValue & {
  orderIndex: number;
  explanation: string | null;
  mediaId: number | null;
};

export type ExerciseMutationContext = {
  correlationId: string;
};

@Injectable()
export class ExerciseAuthoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionCoordinator: CmsTransactionCoordinator,
  ) {}

  async listExercises(
    actor: CmsActor,
    query: AdminExercisesQueryDto,
  ): Promise<ApiSuccessResponse<unknown[], PaginationMeta>> {
    assertAdminActor(actor);
    const where: Prisma.LessonExerciseWhereInput = {
      ...(query.lessonId ? { lessonId: query.lessonId } : {}),
      ...(query.topicId ? { topicId: query.topicId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [exercises, total] = await this.prisma.$transaction([
      this.prisma.lessonExercise.findMany({
        where,
        orderBy: [{ lessonId: 'asc' }, { orderIndex: 'asc' }, { id: 'asc' }],
        skip,
        take: query.limit,
        select: EXERCISE_ADMIN_SELECT,
      }),
      this.prisma.lessonExercise.count({ where }),
    ]);
    const latest = await this.getLatestRevisionMap(
      exercises.map((exercise) => exercise.id),
    );
    return {
      success: true,
      data: exercises.map((exercise) => ({
        ...exercise,
        latestRevision: latest.get(exercise.id) ?? null,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getExercise(actor: CmsActor, exerciseId: number) {
    assertAdminActor(actor);
    const exercise = await this.prisma.lessonExercise.findUnique({
      where: { id: exerciseId },
      select: EXERCISE_ADMIN_SELECT,
    });
    if (!exercise) throw new NotFoundException('Lesson exercise not found.');
    const revisions = await this.prisma.contentRevision.findMany({
      where: { entityType: 'lesson_exercise', entityId: exerciseId },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: EXERCISE_REVISION_SELECT,
    });
    return { success: true as const, data: { ...exercise, revisions } };
  }

  async createExercise(
    actor: CmsActor,
    dto: CreateExerciseDto,
    context: ExerciseMutationContext,
  ) {
    assertAdminActor(actor);
    const snapshot = createExerciseSnapshot(dto);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockParentHierarchy(
          tx,
          'exercise.create',
          dto.lessonId,
          dto.topicId ?? null,
          { actorId: actor.id },
        );
        await this.assertParentCoherence(tx, dto.lessonId, dto.topicId ?? null);
        const exercise = await tx.lessonExercise.create({
          data: {
            lessonId: dto.lessonId,
            topicId: dto.topicId ?? null,
            ...snapshotPersistence(snapshot),
            status: 'draft',
            version: 1,
            createdById: actor.id,
            updatedById: actor.id,
          },
          select: EXERCISE_ADMIN_SELECT,
        });
        const revision = await tx.contentRevision.create({
          data: {
            entityType: 'lesson_exercise',
            entityId: exercise.id,
            revision: 1,
            snapshot: toJson(snapshot),
            contentHash: sha256CanonicalJson(snapshot),
            authorId: actor.id,
          },
          select: EXERCISE_REVISION_SELECT,
        });
        await this.writeAudit(tx, actor.id, context, {
          action: 'lesson_exercise.created',
          exerciseId: exercise.id,
          revision: 1,
          status: exercise.status,
          contentHash: revision.contentHash,
        });
        return {
          success: true as const,
          data: { exercise, revision, idempotent: false },
        };
      }),
    );
  }

  async createExerciseRevision(
    actor: CmsActor,
    exerciseId: number,
    dto: CreateExerciseRevisionDto,
    context: ExerciseMutationContext,
  ) {
    assertAdminActor(actor);
    const snapshot = createExerciseSnapshot(dto);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const exercise = await this.lockExerciseHierarchy(
          tx,
          'exercise.create_revision',
          exerciseId,
          actor.id,
        );
        this.assertMutableExercise(exercise);
        await this.assertParentCoherence(
          tx,
          exercise.lessonId,
          exercise.topicId,
        );
        const latest = await this.getLatestRevision(tx, exerciseId);
        const contentHash = sha256CanonicalJson(snapshot);
        if (
          latest &&
          (latest.contentHash === contentHash ||
            canonicalJson(latest.snapshot) === canonicalJson(snapshot))
        ) {
          return {
            success: true as const,
            data: { exercise, revision: latest, idempotent: true },
          };
        }
        const nextRevision = (latest?.revision ?? 0) + 1;
        const revision = await tx.contentRevision.create({
          data: {
            entityType: 'lesson_exercise',
            entityId: exerciseId,
            revision: nextRevision,
            snapshot: toJson(snapshot),
            contentHash,
            authorId: actor.id,
          },
          select: EXERCISE_REVISION_SELECT,
        });
        const currentExercise = shouldMaterializeExerciseRevision(
          exercise.status,
        )
          ? await tx.lessonExercise.update({
              where: { id: exerciseId },
              data: {
                ...snapshotPersistence(snapshot),
                version: nextRevision,
                updatedById: actor.id,
              },
              select: EXERCISE_ADMIN_SELECT,
            })
          : exercise;
        await this.writeAudit(tx, actor.id, context, {
          action: 'lesson_exercise.revision_created',
          exerciseId,
          revision: nextRevision,
          status: currentExercise.status,
          contentHash,
        });
        return {
          success: true as const,
          data: {
            exercise: currentExercise,
            revision,
            idempotent: false,
          },
        };
      }),
    );
  }

  async reviewExerciseRevision(
    actor: CmsActor,
    exerciseId: number,
    revisionId: number,
    dto: ReviewRevisionDto,
    context: ExerciseMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const exercise = await this.lockExerciseHierarchy(
          tx,
          'exercise.review',
          exerciseId,
          actor.id,
        );
        this.assertMutableExercise(exercise);
        await this.assertParentCoherence(
          tx,
          exercise.lessonId,
          exercise.topicId,
        );
        const revision = await this.getRequestedLatestRevision(
          tx,
          exerciseId,
          revisionId,
        );
        const note = dto.note?.trim() || null;
        const latestReview = revision.reviews[0];
        if (
          latestReview?.reviewerId === actor.id &&
          latestReview.decision === dto.decision &&
          latestReview.note === note
        ) {
          return {
            success: true as const,
            data: { revision, review: latestReview, idempotent: true },
          };
        }
        const review = await tx.contentReview.create({
          data: {
            revisionId,
            reviewerId: actor.id,
            decision: dto.decision,
            note,
          },
          select: {
            id: true,
            revisionId: true,
            reviewerId: true,
            decision: true,
            note: true,
            createdAt: true,
          },
        });
        await this.writeAudit(tx, actor.id, context, {
          action: 'lesson_exercise.reviewed',
          exerciseId,
          revision: revision.revision,
          status: dto.decision,
          contentHash: revision.contentHash,
        });
        return {
          success: true as const,
          data: { revision, review, idempotent: false },
        };
      }),
    );
  }

  async publishExerciseRevision(
    actor: CmsActor,
    exerciseId: number,
    revisionId: number,
    context: ExerciseMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const exercise = await this.lockExerciseHierarchy(
          tx,
          'exercise.publish',
          exerciseId,
          actor.id,
        );
        this.assertMutableExercise(exercise);
        await this.assertParentCoherence(
          tx,
          exercise.lessonId,
          exercise.topicId,
        );
        const revision = await this.getRequestedLatestRevision(
          tx,
          exerciseId,
          revisionId,
        );
        const snapshot = parseExerciseSnapshot(revision.snapshot, 'publish');
        if (snapshot.type === ExerciseType.speaking_repeat) {
          throw new UnprocessableEntityException(
            'speaking_repeat is unsupported for publishing in Lesson Activity V1.',
          );
        }
        const revisionHash = assertExerciseRevisionHash(
          snapshot,
          revision.contentHash,
        );
        const media = snapshot.mediaId
          ? await this.getLockedMedia(tx, snapshot.mediaId)
          : null;
        assertExerciseMediaPublishReady(snapshot.type, snapshot.mediaId, media);
        const action = decidePublishAction({
          requestedRevisionId: revisionId,
          latestRevisionId: revision.id,
          latestDecision: revision.reviews[0]?.decision ?? null,
          liveContentHash:
            exercise.status === 'published'
              ? sha256CanonicalJson(snapshotFromExercise(exercise))
              : null,
          requestedContentHash: revisionHash,
          liveContentMatchesRevision:
            exercise.status === 'published' &&
            exercise.version === revision.revision &&
            canonicalJson(snapshotFromExercise(exercise)) ===
              canonicalJson(snapshot),
        });
        if (action === 'idempotent') {
          return {
            success: true as const,
            data: { exercise, revision, idempotent: true },
          };
        }

        const published = await tx.lessonExercise.update({
          where: { id: exerciseId },
          data: {
            ...snapshotPersistence(snapshot),
            version: revision.revision,
            status: 'published',
            publishedAt: new Date(),
            publishedById: actor.id,
            updatedById: actor.id,
          },
          select: EXERCISE_ADMIN_SELECT,
        });
        await this.writeAudit(tx, actor.id, context, {
          action: 'lesson_exercise.published',
          exerciseId,
          revision: revision.revision,
          status: published.status,
          contentHash: revision.contentHash,
        });
        return {
          success: true as const,
          data: { exercise: published, revision, idempotent: false },
        };
      }),
    );
  }

  async archiveExercise(
    actor: CmsActor,
    exerciseId: number,
    context: ExerciseMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const exercise = await this.lockExerciseHierarchy(
          tx,
          'exercise.archive',
          exerciseId,
          actor.id,
        );
        if (isExerciseArchived(exercise)) {
          return {
            success: true as const,
            data: { exercise, idempotent: true },
          };
        }
        const archived = await tx.lessonExercise.update({
          where: { id: exerciseId },
          data: {
            status: 'archived',
            deletedAt: new Date(),
            updatedById: actor.id,
          },
          select: EXERCISE_ADMIN_SELECT,
        });
        const latest = await this.getLatestRevision(tx, exerciseId);
        await this.writeAudit(tx, actor.id, context, {
          action: 'lesson_exercise.archived',
          exerciseId,
          revision: latest?.revision ?? null,
          status: archived.status,
          contentHash: latest?.contentHash ?? null,
        });
        return {
          success: true as const,
          data: { exercise: archived, idempotent: false },
        };
      }),
    );
  }

  private async lockExerciseHierarchy(
    tx: Prisma.TransactionClient,
    operation: CmsTransactionOperation,
    exerciseId: number,
    actorId: number,
  ) {
    const identity = await tx.lessonExercise.findUnique({
      where: { id: exerciseId },
      select: { lessonId: true, topicId: true },
    });
    if (!identity) throw new NotFoundException('Lesson exercise not found.');
    await this.transactionCoordinator.checkpoint({
      operation,
      phase: 'before_lock',
      entityType: 'lesson_exercise',
      entityId: exerciseId,
      parentLessonId: identity.lessonId,
      transaction: tx,
    });
    await lockActiveCmsActor(tx, actorId);
    await this.lockParentHierarchy(
      tx,
      operation,
      identity.lessonId,
      identity.topicId,
      { emitCheckpoint: false },
    );
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "LessonExercise"
      WHERE "id" = ${exerciseId}
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new NotFoundException('Lesson exercise not found.');
    }
    await this.transactionCoordinator.checkpoint({
      operation,
      phase: 'after_lock',
      entityType: 'lesson_exercise',
      entityId: exerciseId,
      parentLessonId: identity.lessonId,
      transaction: tx,
    });
    const exercise = await tx.lessonExercise.findUnique({
      where: { id: exerciseId },
      select: EXERCISE_ADMIN_SELECT,
    });
    if (!exercise) throw new NotFoundException('Lesson exercise not found.');
    return exercise;
  }

  private async lockParentHierarchy(
    tx: Prisma.TransactionClient,
    operation: CmsTransactionOperation,
    lessonId: number,
    topicId: number | null,
    options: { emitCheckpoint?: boolean; actorId?: number } = {},
  ): Promise<void> {
    const emitCheckpoint = options.emitCheckpoint ?? true;
    if (emitCheckpoint) {
      await this.transactionCoordinator.checkpoint({
        operation,
        phase: 'before_lock',
        entityType: 'lesson_exercise',
        entityId: lessonId,
        parentLessonId: lessonId,
        transaction: tx,
      });
      if (options.actorId !== undefined) {
        await lockActiveCmsActor(tx, options.actorId);
      }
    }
    const lessonRows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "Lesson" WHERE "id" = ${lessonId} FOR UPDATE
    `;
    if (lessonRows.length !== 1) {
      throw new NotFoundException('Parent lesson not found.');
    }
    if (topicId !== null) {
      const topicRows = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Topic"
        WHERE "id" = ${topicId} AND "lessonId" = ${lessonId}
        FOR UPDATE
      `;
      if (topicRows.length !== 1) {
        throw new ConflictException(
          'Topic must belong to the exercise parent lesson.',
        );
      }
    }
    if (emitCheckpoint) {
      await this.transactionCoordinator.checkpoint({
        operation,
        phase: 'after_lock',
        entityType: 'lesson_exercise',
        entityId: lessonId,
        parentLessonId: lessonId,
        transaction: tx,
      });
    }
  }

  private async assertParentCoherence(
    tx: Prisma.TransactionClient,
    lessonId: number,
    topicId: number | null,
  ): Promise<void> {
    const lesson = await tx.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      select: { id: true },
    });
    if (!lesson) throw new NotFoundException('Parent lesson not found.');
    if (topicId === null) return;
    const topic = await tx.topic.findFirst({
      where: { id: topicId, lessonId, deletedAt: null },
      select: { id: true },
    });
    if (!topic) {
      throw new ConflictException(
        'Topic must be live and belong to the exercise parent lesson.',
      );
    }
  }

  private async getLockedMedia(tx: Prisma.TransactionClient, mediaId: number) {
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM "Media" WHERE id = ${mediaId} FOR SHARE
    `;
    if (rows.length !== 1) return null;
    return tx.media.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        url: true,
        type: true,
        mimeType: true,
        duration: true,
        processingStatus: true,
        deletedAt: true,
      },
    });
  }

  private assertMutableExercise<
    T extends { deletedAt: Date | null; status: string },
  >(exercise: T): void {
    if (isExerciseArchived(exercise)) {
      throw new ConflictException('Archived LessonExercise cannot be changed.');
    }
  }

  private getLatestRevision(tx: Prisma.TransactionClient, exerciseId: number) {
    return tx.contentRevision.findFirst({
      where: { entityType: 'lesson_exercise', entityId: exerciseId },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: EXERCISE_REVISION_SELECT,
    });
  }

  private async getRequestedLatestRevision(
    tx: Prisma.TransactionClient,
    exerciseId: number,
    revisionId: number,
  ) {
    const [requested, latest] = await Promise.all([
      tx.contentRevision.findFirst({
        where: {
          id: revisionId,
          entityType: 'lesson_exercise',
          entityId: exerciseId,
        },
        select: EXERCISE_REVISION_SELECT,
      }),
      this.getLatestRevision(tx, exerciseId),
    ]);
    if (!requested) throw new NotFoundException('Content revision not found.');
    if (!latest || latest.id !== requested.id) {
      throw new ConflictException(
        'Only the latest content revision can be used for this action.',
      );
    }
    return requested;
  }

  private async getLatestRevisionMap(exerciseIds: number[]) {
    if (exerciseIds.length === 0) return new Map<number, unknown>();
    const revisions = await this.prisma.contentRevision.findMany({
      where: {
        entityType: ContentEntityType.lesson_exercise,
        entityId: { in: exerciseIds },
      },
      orderBy: [{ entityId: 'asc' }, { revision: 'desc' }, { id: 'desc' }],
      select: EXERCISE_REVISION_SELECT,
    });
    const result = new Map<number, (typeof revisions)[number]>();
    for (const revision of revisions) {
      if (!result.has(revision.entityId)) {
        result.set(revision.entityId, revision);
      }
    }
    return result;
  }

  private writeAudit(
    tx: Prisma.TransactionClient,
    actorId: number,
    context: ExerciseMutationContext,
    input: {
      action: string;
      exerciseId: number;
      revision: number | null;
      status: string;
      contentHash: string | null;
    },
  ) {
    return tx.auditLog.create({
      data: {
        actorId,
        action: input.action,
        targetType: 'lesson_exercise',
        targetId: String(input.exerciseId),
        correlationId: context.correlationId,
        afterSummary: {
          entityType: 'lesson_exercise',
          entityId: input.exerciseId,
          revision: input.revision,
          status: input.status,
          contentHash: input.contentHash,
        },
      },
      select: { id: true },
    });
  }

  private async executeMutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (error instanceof LessonExerciseAuthoringValidationError) {
        throw authoringException(error);
      }
      const classification = classifyCmsPersistenceError(error);
      if (classification === 'unique_conflict') {
        throw new ConflictException('LessonExercise content conflicts.');
      }
      if (classification === 'constraint_conflict') {
        throw new ConflictException(
          'LessonExercise violates a database integrity constraint.',
        );
      }
      if (classification === 'concurrent_retry') {
        throw new ConflictException(
          'Concurrent LessonExercise update detected; retry the request.',
        );
      }
      if (classification === 'timeout' || classification === 'connection') {
        throw new ServiceUnavailableException(
          'LessonExercise operation is temporarily unavailable; retry the request.',
        );
      }
      throw new InternalServerErrorException(
        'LessonExercise operation failed.',
      );
    }
  }
}

export function createExerciseSnapshot(input: {
  type: ExerciseType;
  prompt: string;
  content: unknown;
  answer: unknown;
  explanation?: string | null;
  orderIndex: number;
  mediaId?: number | null;
}): ExerciseSnapshot {
  try {
    const value = validateLessonExerciseAuthoring(
      {
        type: input.type,
        prompt: input.prompt,
        content: input.content,
        answer: input.answer,
        ...(input.explanation === undefined
          ? {}
          : { explanation: input.explanation }),
        ...(input.mediaId === undefined ? {} : { mediaId: input.mediaId }),
      },
      'draft',
    );
    return {
      ...value,
      explanation: value.explanation ?? null,
      mediaId: value.mediaId ?? null,
      orderIndex: input.orderIndex,
    };
  } catch (error) {
    if (error instanceof LessonExerciseAuthoringValidationError) {
      throw authoringException(error);
    }
    throw error;
  }
}

function parseExerciseSnapshot(
  snapshot: Prisma.JsonValue,
  mode: 'draft' | 'publish',
): ExerciseSnapshot {
  const dto = plainToInstance(CreateExerciseRevisionDto, snapshot);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    throw new ConflictException('LessonExercise revision snapshot is invalid.');
  }
  let value: LessonExerciseAuthoringValue;
  try {
    value = validateLessonExerciseAuthoring(
      {
        type: dto.type,
        prompt: dto.prompt,
        content: dto.content,
        answer: dto.answer,
        ...(dto.explanation === undefined
          ? {}
          : { explanation: dto.explanation }),
        ...(dto.mediaId === undefined ? {} : { mediaId: dto.mediaId }),
      },
      mode,
    );
  } catch (error) {
    if (error instanceof LessonExerciseAuthoringValidationError) {
      if (error.code === 'unsupported_publish_type') {
        throw new UnprocessableEntityException(
          'speaking_repeat is unsupported for publishing in Lesson Activity V1.',
        );
      }
      throw authoringException(error);
    }
    throw error;
  }
  return {
    ...value,
    explanation: value.explanation ?? null,
    mediaId: value.mediaId ?? null,
    orderIndex: dto.orderIndex,
  };
}

function snapshotFromExercise(exercise: {
  type: ExerciseType;
  prompt: string;
  content: Prisma.JsonValue;
  answer: Prisma.JsonValue;
  explanation: string | null;
  orderIndex: number;
  mediaId: number | null;
}): ExerciseSnapshot {
  return {
    type: exercise.type,
    prompt: exercise.prompt,
    content: exercise.content as Record<string, unknown>,
    answer: exercise.answer as Record<string, unknown>,
    explanation: exercise.explanation,
    orderIndex: exercise.orderIndex,
    mediaId: exercise.mediaId,
  };
}

function authoringException(
  error: LessonExerciseAuthoringValidationError,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: error.code,
    path: error.path,
    message: `LessonExercise validation failed at ${error.path}.`,
  });
}

export function assertExerciseRevisionHash(
  snapshot: ExerciseSnapshot,
  contentHash: string | null,
): string {
  const expected = requireContentHash(contentHash);
  if (sha256CanonicalJson(snapshot) !== expected) {
    throw new ConflictException(
      'LessonExercise revision snapshot integrity check failed.',
    );
  }
  return expected;
}

export function shouldMaterializeExerciseRevision(status: string): boolean {
  return status === 'draft';
}

export function isExerciseArchived(exercise: {
  status: string;
  deletedAt: Date | null;
}): boolean {
  return exercise.status === 'archived' || exercise.deletedAt !== null;
}

function requireContentHash(value: string | null): string {
  if (!value) throw new ConflictException('Content revision hash is missing.');
  return value;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function snapshotPersistence(snapshot: ExerciseSnapshot) {
  return {
    type: snapshot.type,
    prompt: snapshot.prompt,
    content: toJson(snapshot.content),
    answer: toJson(snapshot.answer),
    explanation: snapshot.explanation,
    mediaId: snapshot.mediaId,
    orderIndex: snapshot.orderIndex,
  };
}
