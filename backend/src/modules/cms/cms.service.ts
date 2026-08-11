import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ContentEntityType, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  ApiSuccessResponse,
  PaginationMeta,
} from '../../common/interfaces/api-response.interface';
import { PUBLIC_CONTENT_WHERE } from '../../common/policies/lesson-readiness.policy';
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
import { AdminLessonsQueryDto } from './dto/admin-lessons-query.dto';
import { CreateLessonRevisionDto } from './dto/create-lesson-revision.dto';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { CreateTopicRevisionDto } from './dto/create-topic-revision.dto';
import { CreateTopicDto } from './dto/create-topic.dto';
import { ReviewRevisionDto } from './dto/review-revision.dto';

const REVISION_SELECT = {
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

const LESSON_ADMIN_SELECT = {
  id: true,
  levelId: true,
  title: true,
  description: true,
  orderIndex: true,
  slug: true,
  status: true,
  createdById: true,
  updatedById: true,
  publishedById: true,
  publishedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LessonSelect;

const TOPIC_ADMIN_SELECT = {
  id: true,
  lessonId: true,
  title: true,
  subtitle: true,
  type: true,
  content: true,
  orderIndex: true,
  isPremium: true,
  isLocked: true,
  status: true,
  createdById: true,
  updatedById: true,
  publishedById: true,
  publishedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TopicSelect;

type LessonSnapshot = {
  title: string;
  description: string | null;
  orderIndex: number;
  slug: string;
};

type TopicSnapshot = {
  title: string;
  subtitle: string | null;
  type: CreateTopicRevisionDto['type'];
  content: Prisma.InputJsonValue;
  orderIndex: number;
  isPremium: boolean;
  isLocked: boolean;
};

type MutationContext = {
  correlationId: string;
};

@Injectable()
export class CmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionCoordinator: CmsTransactionCoordinator,
  ) {}

  async listLessons(
    actor: CmsActor,
    query: AdminLessonsQueryDto,
  ): Promise<ApiSuccessResponse<unknown[], PaginationMeta>> {
    assertAdminActor(actor);
    const where: Prisma.LessonWhereInput = {
      ...(query.levelId ? { levelId: query.levelId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [lessons, total] = await this.prisma.$transaction([
      this.prisma.lesson.findMany({
        where,
        orderBy: [{ levelId: 'asc' }, { orderIndex: 'asc' }, { id: 'asc' }],
        skip,
        take: query.limit,
        select: LESSON_ADMIN_SELECT,
      }),
      this.prisma.lesson.count({ where }),
    ]);
    const latestRevisions = await this.getLatestRevisionMap(
      'lesson',
      lessons.map((lesson) => lesson.id),
    );

    return {
      success: true,
      data: lessons.map((lesson) => ({
        ...lesson,
        latestRevision: latestRevisions.get(lesson.id) ?? null,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getLesson(actor: CmsActor, lessonId: number) {
    assertAdminActor(actor);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId },
      select: LESSON_ADMIN_SELECT,
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');

    const revisions = await this.prisma.contentRevision.findMany({
      where: { entityType: 'lesson', entityId: lessonId },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: REVISION_SELECT,
    });
    return { success: true as const, data: { lesson, revisions } };
  }

  async createLesson(
    actor: CmsActor,
    dto: CreateLessonDto,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    const snapshot = lessonSnapshot(dto);

    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.assertLevelExists(tx, dto.levelId);
        const lesson = await tx.lesson.create({
          data: {
            levelId: dto.levelId,
            ...snapshot,
            status: 'draft',
            createdById: actor.id,
            updatedById: actor.id,
          },
          select: LESSON_ADMIN_SELECT,
        });
        const revision = await tx.contentRevision.create({
          data: {
            entityType: 'lesson',
            entityId: lesson.id,
            revision: 1,
            snapshot,
            contentHash: sha256CanonicalJson(snapshot),
            authorId: actor.id,
          },
          select: REVISION_SELECT,
        });
        await this.writeAudit(tx, actor.id, context, {
          action: 'lesson.created',
          entityType: 'lesson',
          entityId: lesson.id,
          revision: revision.revision,
          status: lesson.status,
          contentHash: revision.contentHash,
        });
        return {
          success: true as const,
          data: { lesson, revision, idempotent: false },
        };
      }),
    );
  }

  async createLessonRevision(
    actor: CmsActor,
    lessonId: number,
    dto: CreateLessonRevisionDto,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    const snapshot = lessonSnapshot(dto);

    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockLessonForOperation(
          tx,
          'lesson.create_revision',
          lessonId,
        );
        const lesson = await tx.lesson.findFirst({
          where: { id: lessonId },
          select: LESSON_ADMIN_SELECT,
        });
        this.assertMutableEntity(lesson, 'Lesson');

        const latest = await this.getLatestRevision(tx, 'lesson', lessonId);
        const contentHash = sha256CanonicalJson(snapshot);
        if (
          latest &&
          (latest.contentHash === contentHash ||
            canonicalJson(latest.snapshot) === canonicalJson(snapshot))
        ) {
          return {
            success: true as const,
            data: { lesson, revision: latest, idempotent: true },
          };
        }

        const revision = await tx.contentRevision.create({
          data: {
            entityType: 'lesson',
            entityId: lessonId,
            revision: (latest?.revision ?? 0) + 1,
            snapshot,
            contentHash,
            authorId: actor.id,
          },
          select: REVISION_SELECT,
        });

        let currentLesson = lesson;
        if (lesson.status === 'draft') {
          currentLesson = await tx.lesson.update({
            where: { id: lessonId },
            data: { ...snapshot, updatedById: actor.id },
            select: LESSON_ADMIN_SELECT,
          });
        }
        await this.writeAudit(tx, actor.id, context, {
          action: 'lesson.revision_created',
          entityType: 'lesson',
          entityId: lessonId,
          revision: revision.revision,
          status: currentLesson.status,
          contentHash,
        });
        return {
          success: true as const,
          data: { lesson: currentLesson, revision, idempotent: false },
        };
      }),
    );
  }

  async reviewLessonRevision(
    actor: CmsActor,
    lessonId: number,
    revisionId: number,
    dto: ReviewRevisionDto,
    context: MutationContext,
  ) {
    return this.reviewRevision(
      actor,
      'lesson',
      lessonId,
      revisionId,
      dto,
      context,
    );
  }

  async publishLessonRevision(
    actor: CmsActor,
    lessonId: number,
    revisionId: number,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockLessonForOperation(tx, 'lesson.publish', lessonId);
        const lesson = await tx.lesson.findFirst({
          where: { id: lessonId },
          select: LESSON_ADMIN_SELECT,
        });
        this.assertMutableEntity(lesson, 'Lesson');
        const revision = await this.getRequestedLatestRevision(
          tx,
          'lesson',
          lessonId,
          revisionId,
        );
        const latestReview = revision.reviews[0] ?? null;
        const snapshot = parseLessonSnapshot(revision.snapshot);
        const liveHash =
          lesson.status === 'published'
            ? sha256CanonicalJson(lessonSnapshot(lesson))
            : null;
        const action = decidePublishAction({
          requestedRevisionId: revisionId,
          latestRevisionId: revision.id,
          latestDecision: latestReview?.decision ?? null,
          liveContentHash: liveHash,
          requestedContentHash: requireContentHash(revision.contentHash),
          liveContentMatchesRevision:
            lesson.status === 'published' &&
            canonicalJson(lessonSnapshot(lesson)) === canonicalJson(snapshot),
        });
        if (action === 'idempotent') {
          return {
            success: true as const,
            data: { lesson, revision, idempotent: true },
          };
        }

        await this.assertLessonPublishReady(tx, lesson.levelId, lessonId);
        const publishedLesson = await tx.lesson.update({
          where: { id: lessonId },
          data: {
            ...snapshot,
            status: 'published',
            publishedAt: new Date(),
            publishedById: actor.id,
            updatedById: actor.id,
          },
          select: LESSON_ADMIN_SELECT,
        });
        await this.writeAudit(tx, actor.id, context, {
          action: 'lesson.published',
          entityType: 'lesson',
          entityId: lessonId,
          revision: revision.revision,
          status: publishedLesson.status,
          contentHash: revision.contentHash,
        });
        return {
          success: true as const,
          data: {
            lesson: publishedLesson,
            revision,
            idempotent: false,
          },
        };
      }),
    );
  }

  async archiveLesson(
    actor: CmsActor,
    lessonId: number,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockLessonForOperation(tx, 'lesson.archive', lessonId);
        const lesson = await tx.lesson.findFirst({
          where: { id: lessonId },
          select: LESSON_ADMIN_SELECT,
        });
        if (!lesson) throw new NotFoundException('Lesson not found.');
        if (lesson.deletedAt !== null || lesson.status === 'archived') {
          return {
            success: true as const,
            data: { lesson, idempotent: true },
          };
        }
        const archived = await tx.lesson.update({
          where: { id: lessonId },
          data: {
            status: 'archived',
            deletedAt: new Date(),
            updatedById: actor.id,
          },
          select: LESSON_ADMIN_SELECT,
        });
        const latest = await this.getLatestRevision(tx, 'lesson', lessonId);
        await this.writeAudit(tx, actor.id, context, {
          action: 'lesson.archived',
          entityType: 'lesson',
          entityId: lessonId,
          revision: latest?.revision ?? null,
          status: archived.status,
          contentHash: latest?.contentHash ?? null,
        });
        return {
          success: true as const,
          data: { lesson: archived, idempotent: false },
        };
      }),
    );
  }

  async getTopic(actor: CmsActor, topicId: number) {
    assertAdminActor(actor);
    const topic = await this.prisma.topic.findFirst({
      where: { id: topicId },
      select: TOPIC_ADMIN_SELECT,
    });
    if (!topic) throw new NotFoundException('Topic not found.');
    const revisions = await this.prisma.contentRevision.findMany({
      where: { entityType: 'topic', entityId: topicId },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: REVISION_SELECT,
    });
    return { success: true as const, data: { topic, revisions } };
  }

  async createTopic(
    actor: CmsActor,
    dto: CreateTopicDto,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    const snapshot = topicSnapshot(dto);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockLessonForOperation(tx, 'topic.create', dto.lessonId);
        await this.assertLessonParentExists(tx, dto.lessonId);
        const topic = await tx.topic.create({
          data: {
            lessonId: dto.lessonId,
            ...snapshot,
            status: 'draft',
            createdById: actor.id,
            updatedById: actor.id,
          },
          select: TOPIC_ADMIN_SELECT,
        });
        const revision = await tx.contentRevision.create({
          data: {
            entityType: 'topic',
            entityId: topic.id,
            revision: 1,
            snapshot,
            contentHash: sha256CanonicalJson(snapshot),
            authorId: actor.id,
          },
          select: REVISION_SELECT,
        });
        await this.writeAudit(tx, actor.id, context, {
          action: 'topic.created',
          entityType: 'topic',
          entityId: topic.id,
          revision: revision.revision,
          status: topic.status,
          contentHash: revision.contentHash,
        });
        return {
          success: true as const,
          data: { topic, revision, idempotent: false },
        };
      }),
    );
  }

  async createTopicRevision(
    actor: CmsActor,
    topicId: number,
    dto: CreateTopicRevisionDto,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    const snapshot = topicSnapshot(dto);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const parentLessonId = await this.lockTopicHierarchyForOperation(
          tx,
          'topic.create_revision',
          topicId,
        );
        await this.assertLessonParentExists(tx, parentLessonId);
        const topic = await tx.topic.findFirst({
          where: { id: topicId },
          select: TOPIC_ADMIN_SELECT,
        });
        this.assertMutableEntity(topic, 'Topic');
        const latest = await this.getLatestRevision(tx, 'topic', topicId);
        const contentHash = sha256CanonicalJson(snapshot);
        if (
          latest &&
          (latest.contentHash === contentHash ||
            canonicalJson(latest.snapshot) === canonicalJson(snapshot))
        ) {
          return {
            success: true as const,
            data: { topic, revision: latest, idempotent: true },
          };
        }
        const revision = await tx.contentRevision.create({
          data: {
            entityType: 'topic',
            entityId: topicId,
            revision: (latest?.revision ?? 0) + 1,
            snapshot,
            contentHash,
            authorId: actor.id,
          },
          select: REVISION_SELECT,
        });
        let currentTopic = topic;
        if (topic.status === 'draft') {
          currentTopic = await tx.topic.update({
            where: { id: topicId },
            data: { ...snapshot, updatedById: actor.id },
            select: TOPIC_ADMIN_SELECT,
          });
        }
        await this.writeAudit(tx, actor.id, context, {
          action: 'topic.revision_created',
          entityType: 'topic',
          entityId: topicId,
          revision: revision.revision,
          status: currentTopic.status,
          contentHash,
        });
        return {
          success: true as const,
          data: { topic: currentTopic, revision, idempotent: false },
        };
      }),
    );
  }

  async reviewTopicRevision(
    actor: CmsActor,
    topicId: number,
    revisionId: number,
    dto: ReviewRevisionDto,
    context: MutationContext,
  ) {
    return this.reviewRevision(
      actor,
      'topic',
      topicId,
      revisionId,
      dto,
      context,
    );
  }

  async publishTopicRevision(
    actor: CmsActor,
    topicId: number,
    revisionId: number,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockTopicHierarchyForOperation(tx, 'topic.publish', topicId);
        const topic = await tx.topic.findFirst({
          where: { id: topicId },
          select: TOPIC_ADMIN_SELECT,
        });
        this.assertMutableEntity(topic, 'Topic');
        const revision = await this.getRequestedLatestRevision(
          tx,
          'topic',
          topicId,
          revisionId,
        );
        const snapshot = parseTopicSnapshot(revision.snapshot);
        const liveHash =
          topic.status === 'published'
            ? sha256CanonicalJson(topicSnapshot(topic))
            : null;
        const action = decidePublishAction({
          requestedRevisionId: revisionId,
          latestRevisionId: revision.id,
          latestDecision: revision.reviews[0]?.decision ?? null,
          liveContentHash: liveHash,
          requestedContentHash: requireContentHash(revision.contentHash),
          liveContentMatchesRevision:
            topic.status === 'published' &&
            canonicalJson(topicSnapshot(topic)) === canonicalJson(snapshot),
        });
        if (action === 'idempotent') {
          return {
            success: true as const,
            data: { topic, revision, idempotent: true },
          };
        }
        await this.assertLessonParentExists(tx, topic.lessonId);
        const publishedTopic = await tx.topic.update({
          where: { id: topicId },
          data: {
            ...snapshot,
            status: 'published',
            publishedAt: new Date(),
            publishedById: actor.id,
            updatedById: actor.id,
          },
          select: TOPIC_ADMIN_SELECT,
        });
        await this.writeAudit(tx, actor.id, context, {
          action: 'topic.published',
          entityType: 'topic',
          entityId: topicId,
          revision: revision.revision,
          status: publishedTopic.status,
          contentHash: revision.contentHash,
        });
        return {
          success: true as const,
          data: {
            topic: publishedTopic,
            revision,
            idempotent: false,
          },
        };
      }),
    );
  }

  async archiveTopic(
    actor: CmsActor,
    topicId: number,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockTopicHierarchyForOperation(tx, 'topic.archive', topicId);
        const topic = await tx.topic.findFirst({
          where: { id: topicId },
          select: TOPIC_ADMIN_SELECT,
        });
        if (!topic) throw new NotFoundException('Topic not found.');
        if (topic.deletedAt !== null || topic.status === 'archived') {
          return {
            success: true as const,
            data: { topic, idempotent: true },
          };
        }
        const archived = await tx.topic.update({
          where: { id: topicId },
          data: {
            status: 'archived',
            deletedAt: new Date(),
            updatedById: actor.id,
          },
          select: TOPIC_ADMIN_SELECT,
        });
        const latest = await this.getLatestRevision(tx, 'topic', topicId);
        await this.writeAudit(tx, actor.id, context, {
          action: 'topic.archived',
          entityType: 'topic',
          entityId: topicId,
          revision: latest?.revision ?? null,
          status: archived.status,
          contentHash: latest?.contentHash ?? null,
        });
        return {
          success: true as const,
          data: { topic: archived, idempotent: false },
        };
      }),
    );
  }

  private async reviewRevision(
    actor: CmsActor,
    entityType: 'lesson' | 'topic',
    entityId: number,
    revisionId: number,
    dto: ReviewRevisionDto,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        if (entityType === 'topic') {
          const parentLessonId = await this.lockTopicHierarchyForOperation(
            tx,
            'topic.review',
            entityId,
          );
          await this.assertLessonParentExists(tx, parentLessonId);
        } else {
          await this.lockLessonForOperation(tx, 'lesson.review', entityId);
        }
        await this.assertEntityExists(tx, entityType, entityId);
        const revision = await this.getRequestedLatestRevision(
          tx,
          entityType,
          entityId,
          revisionId,
        );
        const note = dto.note?.trim() || null;
        const latestReview = revision.reviews[0];
        if (
          latestReview &&
          latestReview.reviewerId === actor.id &&
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
          action: `${entityType}.reviewed`,
          entityType,
          entityId,
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

  private async getRequestedLatestRevision(
    tx: Prisma.TransactionClient,
    entityType: 'lesson' | 'topic',
    entityId: number,
    revisionId: number,
  ) {
    const [requested, latest] = await Promise.all([
      tx.contentRevision.findFirst({
        where: { id: revisionId, entityType, entityId },
        select: REVISION_SELECT,
      }),
      this.getLatestRevision(tx, entityType, entityId),
    ]);
    if (!requested) throw new NotFoundException('Content revision not found.');
    if (!latest || requested.id !== latest.id) {
      throw new ConflictException(
        'Only the latest content revision can be used for this action.',
      );
    }
    return requested;
  }

  private getLatestRevision(
    tx: Prisma.TransactionClient,
    entityType: 'lesson' | 'topic',
    entityId: number,
  ) {
    return tx.contentRevision.findFirst({
      where: { entityType, entityId },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: REVISION_SELECT,
    });
  }

  private async getLatestRevisionMap(
    entityType: ContentEntityType,
    entityIds: number[],
  ) {
    if (entityIds.length === 0) return new Map<number, unknown>();
    const revisions = await this.prisma.contentRevision.findMany({
      where: { entityType, entityId: { in: entityIds } },
      orderBy: [{ entityId: 'asc' }, { revision: 'desc' }, { id: 'desc' }],
      select: REVISION_SELECT,
    });
    const result = new Map<number, (typeof revisions)[number]>();
    for (const revision of revisions) {
      if (!result.has(revision.entityId))
        result.set(revision.entityId, revision);
    }
    return result;
  }

  private async lockEntity(
    tx: Prisma.TransactionClient,
    entityType: 'lesson' | 'topic',
    entityId: number,
  ) {
    const rows =
      entityType === 'lesson'
        ? await tx.$queryRaw<Array<{ id: number }>>`
            SELECT "id" FROM "Lesson" WHERE "id" = ${entityId} FOR UPDATE
          `
        : await tx.$queryRaw<Array<{ id: number }>>`
            SELECT "id" FROM "Topic" WHERE "id" = ${entityId} FOR UPDATE
          `;
    if (rows.length !== 1) {
      throw new NotFoundException(
        entityType === 'lesson' ? 'Lesson not found.' : 'Topic not found.',
      );
    }
  }

  private async lockTopicHierarchy(
    tx: Prisma.TransactionClient,
    topicId: number,
  ): Promise<number> {
    const topic = await tx.topic.findUnique({
      where: { id: topicId },
      select: { lessonId: true },
    });
    if (!topic) throw new NotFoundException('Topic not found.');

    await this.lockEntity(tx, 'lesson', topic.lessonId);
    await this.lockEntity(tx, 'topic', topicId);
    return topic.lessonId;
  }

  private async lockLessonForOperation(
    tx: Prisma.TransactionClient,
    operation: CmsTransactionOperation,
    lessonId: number,
  ): Promise<void> {
    await this.transactionCoordinator.checkpoint({
      operation,
      phase: 'before_lock',
      entityType: 'lesson',
      entityId: lessonId,
      transaction: tx,
    });
    await this.lockEntity(tx, 'lesson', lessonId);
    await this.transactionCoordinator.checkpoint({
      operation,
      phase: 'after_lock',
      entityType: 'lesson',
      entityId: lessonId,
      parentLessonId: lessonId,
      transaction: tx,
    });
  }

  private async lockTopicHierarchyForOperation(
    tx: Prisma.TransactionClient,
    operation: CmsTransactionOperation,
    topicId: number,
  ): Promise<number> {
    await this.transactionCoordinator.checkpoint({
      operation,
      phase: 'before_lock',
      entityType: 'topic',
      entityId: topicId,
      transaction: tx,
    });
    const parentLessonId = await this.lockTopicHierarchy(tx, topicId);
    await this.transactionCoordinator.checkpoint({
      operation,
      phase: 'after_lock',
      entityType: 'topic',
      entityId: topicId,
      parentLessonId,
      transaction: tx,
    });
    return parentLessonId;
  }

  private async assertEntityExists(
    tx: Prisma.TransactionClient,
    entityType: 'lesson' | 'topic',
    entityId: number,
  ) {
    const entity =
      entityType === 'lesson'
        ? await tx.lesson.findFirst({
            where: { id: entityId, deletedAt: null },
            select: { id: true },
          })
        : await tx.topic.findFirst({
            where: { id: entityId, deletedAt: null },
            select: { id: true },
          });
    if (!entity) {
      throw new ConflictException('Archived content cannot be changed.');
    }
  }

  private assertMutableEntity<T extends { deletedAt: Date | null }>(
    entity: T | null,
    label: string,
  ): asserts entity is T {
    if (!entity) throw new NotFoundException(`${label} not found.`);
    if (entity.deletedAt !== null) {
      throw new ConflictException(`Archived ${label} cannot be changed.`);
    }
  }

  private async assertLevelExists(
    tx: Prisma.TransactionClient,
    levelId: number,
  ) {
    const level = await tx.level.findFirst({
      where: { id: levelId, deletedAt: null },
      select: { id: true },
    });
    if (!level) throw new NotFoundException('Level not found.');
  }

  private async assertLessonParentExists(
    tx: Prisma.TransactionClient,
    lessonId: number,
  ) {
    const lesson = await tx.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      select: { id: true },
    });
    if (!lesson) throw new NotFoundException('Parent lesson not found.');
  }

  private async assertLessonPublishReady(
    tx: Prisma.TransactionClient,
    levelId: number,
    lessonId: number,
  ) {
    const [level, topicCount, storyCount] = await Promise.all([
      tx.level.findFirst({
        where: { id: levelId, ...PUBLIC_CONTENT_WHERE },
        select: { id: true },
      }),
      tx.topic.count({
        where: { lessonId, ...PUBLIC_CONTENT_WHERE },
      }),
      tx.story.count({
        where: { lessonId, levelId, ...PUBLIC_CONTENT_WHERE },
      }),
    ]);
    if (!level) {
      throw new ConflictException(
        'Lesson requires a published, non-deleted parent level.',
      );
    }
    if (topicCount + storyCount === 0) {
      throw new ConflictException(
        'Lesson requires at least one published Topic or Story.',
      );
    }
  }

  private writeAudit(
    tx: Prisma.TransactionClient,
    actorId: number,
    context: MutationContext,
    input: {
      action: string;
      entityType: 'lesson' | 'topic';
      entityId: number;
      revision: number | null;
      status: string;
      contentHash: string | null;
    },
  ) {
    return tx.auditLog.create({
      data: {
        actorId,
        action: input.action,
        targetType: input.entityType,
        targetId: String(input.entityId),
        correlationId: context.correlationId,
        afterSummary: {
          entityType: input.entityType,
          entityId: input.entityId,
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
      const classification = classifyCmsPersistenceError(error);
      if (classification === 'unique_conflict') {
        throw new ConflictException(
          'Content conflicts with an existing slug or order.',
        );
      }
      if (classification === 'constraint_conflict') {
        throw new ConflictException(
          'Content violates a database integrity constraint.',
        );
      }
      if (classification === 'concurrent_retry') {
        throw new ConflictException(
          'Concurrent content update detected; retry the request.',
        );
      }
      if (classification === 'timeout' || classification === 'connection') {
        throw new ServiceUnavailableException(
          'Content operation is temporarily unavailable; retry the request.',
        );
      }
      throw new InternalServerErrorException('Content operation failed.');
    }
  }
}

function lessonSnapshot(input: {
  title: string;
  description?: string | null;
  orderIndex: number;
  slug: string;
}): LessonSnapshot {
  return {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    orderIndex: input.orderIndex,
    slug: input.slug.trim().toLowerCase(),
  };
}

function topicSnapshot(input: {
  title: string;
  subtitle?: string | null;
  type: CreateTopicRevisionDto['type'];
  content: unknown;
  orderIndex: number;
  isPremium: boolean;
  isLocked: boolean;
}): TopicSnapshot {
  return {
    title: input.title.trim(),
    subtitle: input.subtitle?.trim() || null,
    type: input.type,
    content: input.content as Prisma.InputJsonValue,
    orderIndex: input.orderIndex,
    isPremium: input.isPremium,
    isLocked: input.isLocked,
  };
}

function parseLessonSnapshot(snapshot: Prisma.JsonValue): LessonSnapshot {
  const dto = plainToInstance(CreateLessonRevisionDto, snapshot);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    throw new ConflictException('Lesson revision snapshot is invalid.');
  }
  return lessonSnapshot(dto);
}

function parseTopicSnapshot(snapshot: Prisma.JsonValue): TopicSnapshot {
  const dto = plainToInstance(CreateTopicRevisionDto, snapshot);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    throw new ConflictException('Topic revision snapshot is invalid.');
  }
  return topicSnapshot(dto);
}

function requireContentHash(value: string | null): string {
  if (!value) throw new ConflictException('Content revision hash is missing.');
  return value;
}
