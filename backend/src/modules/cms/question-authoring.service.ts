import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ContentEntityType,
  ContentStatus,
  MediaProcessingStatus,
  MediaType,
  Prisma,
  QuestionType,
  Skill,
} from '@prisma/client';

import { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import {
  canonicalJson,
  sha256CanonicalJson,
} from '../../common/utils/canonical-json';
import { escapeLike } from '../../common/utils/sql-pattern';
import {
  QUESTION_SNAPSHOT_FIELDS,
  QuestionAuthoringValidationError,
  QuestionSnapshot,
  normalizeQuestionTagName,
  slugifyQuestionTag,
  validateQuestionAuthoring,
} from '../../common/validation/question-authoring.validator';
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
import { AdminQuestionsQueryDto } from './dto/admin-questions-query.dto';
import { AdminTagDto } from './dto/admin-tag-response.dto';
import { AdminTagsQueryDto } from './dto/admin-tags-query.dto';
import {
  AdminQuestionCountsDto,
  AdminQuestionDetailDto,
  AdminQuestionDto,
  AdminQuestionRevisionDto,
} from './dto/admin-question-response.dto';
import { CreateQuestionRevisionDto } from './dto/create-question-revision.dto';
import { ReviewRevisionDto } from './dto/review-revision.dto';

const QUESTION_ADMIN_SELECT = {
  id: true,
  content: true,
  type: true,
  skill: true,
  audioId: true,
  imageId: true,
  answers: true,
  correctAnswer: true,
  explanation: true,
  objective: true,
  levelId: true,
  difficulty: true,
  version: true,
  contentHash: true,
  status: true,
  dataSourceId: true,
  createdById: true,
  updatedById: true,
  publishedById: true,
  publishedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  level: { select: { id: true, code: true } },
  tags: {
    select: { tag: { select: { slug: true, name: true } } },
  },
} satisfies Prisma.QuestionSelect;

type QuestionAdminRecord = Prisma.QuestionGetPayload<{
  select: typeof QUESTION_ADMIN_SELECT;
}>;

const QUESTION_REVISION_SELECT = {
  id: true,
  entityId: true,
  revision: true,
  snapshot: true,
  contentHash: true,
  authorId: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
  reviews: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      reviewerId: true,
      decision: true,
      note: true,
      createdAt: true,
      reviewer: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ContentRevisionSelect;

type QuestionRevisionRecord = Prisma.ContentRevisionGetPayload<{
  select: typeof QUESTION_REVISION_SELECT;
}>;

type QuestionMediaRecord = {
  id: number;
  url: string;
  type: MediaType;
  mimeType: string | null;
  duration: number | null;
  processingStatus: MediaProcessingStatus;
  deletedAt: Date | null;
};

export type QuestionMutationContext = {
  correlationId: string;
};

type PublishBlocker = {
  code: string;
  field: string;
};

const LIVE_QUESTION_WHERE: Prisma.QuestionWhereInput = {
  status: { not: ContentStatus.archived },
  deletedAt: null,
};

const VOCABULARY_GRAMMAR_SLUGS = ['tu-vung', 'ngu-phap'];
@Injectable()
export class QuestionAuthoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionCoordinator: CmsTransactionCoordinator,
  ) {}

  async listQuestions(
    actor: CmsActor,
    query: AdminQuestionsQueryDto,
  ): Promise<ApiSuccessResponse<AdminQuestionDto[]>> {
    assertAdminActor(actor);
    const page = await this.findQuestionPage(query);
    const questions =
      page.ids.length === 0
        ? []
        : await this.prisma.question.findMany({
            where: { id: { in: page.ids } },
            select: QUESTION_ADMIN_SELECT,
          });
    const byId = new Map(questions.map((question) => [question.id, question]));
    const latest = await this.getLatestRevisionMap(page.ids);
    const data = page.ids
      .map((id) => byId.get(id))
      .filter((question): question is QuestionAdminRecord => Boolean(question))
      .map((question) =>
        this.toAdminQuestion(question, latest.get(question.id)),
      );
    return {
      success: true,
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total: page.total,
        totalPages: Math.ceil(page.total / query.limit),
      },
    };
  }

  async listTags(
    actor: CmsActor,
    query: AdminTagsQueryDto,
  ): Promise<ApiSuccessResponse<AdminTagDto[]>> {
    assertAdminActor(actor);
    const filters: Prisma.Sql[] = [];
    if (query.q !== undefined) {
      // TL-93: ILIKE over Tag.name; escapeLike makes `%`/`_` literal.
      const pattern = `%${escapeLike(query.q)}%`;
      filters.push(Prisma.sql`t."name" ILIKE ${pattern}`);
    }
    const whereSql =
      filters.length === 0 ? Prisma.sql`TRUE` : Prisma.join(filters, ' AND ');
    // The archived filter lives in the LEFT JOIN condition so tags with no live
    // questions still come back with questionCount = 0 (suggestion list).
    const rows = await this.prisma.$queryRaw<AdminTagDto[]>(Prisma.sql`
      SELECT
        t."slug" AS "slug",
        t."name" AS "name",
        count(q."id")::int AS "questionCount"
      FROM "Tag" t
      LEFT JOIN "QuestionTag" qt ON qt."tagId" = t."id"
      LEFT JOIN "Question" q
        ON q."id" = qt."questionId"
        AND q."status" <> 'archived'
        AND q."deletedAt" IS NULL
      WHERE ${whereSql}
      GROUP BY t."id", t."slug", t."name"
      ORDER BY t."name" ASC, t."id" ASC
      LIMIT ${query.limit}
    `);
    return { success: true, data: rows };
  }

  async getQuestionCounts(
    actor: CmsActor,
  ): Promise<ApiSuccessResponse<AdminQuestionCountsDto>> {
    assertAdminActor(actor);
    const [total, bySkillGroups, vocabularyGrammar] = await Promise.all([
      this.prisma.question.count({ where: LIVE_QUESTION_WHERE }),
      this.prisma.question.groupBy({
        by: ['skill'],
        where: LIVE_QUESTION_WHERE,
        _count: { _all: true },
      }),
      this.prisma.question.count({
        where: {
          ...LIVE_QUESTION_WHERE,
          tags: {
            some: { tag: { slug: { in: VOCABULARY_GRAMMAR_SLUGS } } },
          },
        },
      }),
    ]);
    const bySkill = {
      listening: 0,
      reading: 0,
      writing: 0,
      speaking: 0,
    };
    for (const group of bySkillGroups) {
      bySkill[group.skill] = group._count._all;
    }
    return {
      success: true,
      data: { total, bySkill, vocabularyGrammar },
    };
  }

  async getQuestion(
    actor: CmsActor,
    questionId: number,
  ): Promise<ApiSuccessResponse<AdminQuestionDetailDto>> {
    assertAdminActor(actor);
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: QUESTION_ADMIN_SELECT,
    });
    if (!question) throw new NotFoundException('Question not found.');
    const revisions = await this.buildRevisionHistory(questionId);
    return {
      success: true,
      data: {
        ...this.toAdminQuestionBase(question),
        revisions,
      },
    };
  }

  async createQuestion(
    actor: CmsActor,
    dto: CreateQuestionRevisionDto,
    context: QuestionMutationContext,
  ) {
    assertAdminActor(actor);
    const snapshot = createQuestionSnapshot(dto);
    const tagNames = tagNamesFromDto(dto);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        await lockActiveCmsActor(tx, actor.id);
        await this.assertLevelExists(tx, snapshot.levelId);
        await this.assertMedia(tx, snapshot);
        const question = await tx.question.create({
          data: {
            ...questionPersistence(snapshot, {
              version: 1,
              status: ContentStatus.draft,
            }),
            createdById: actor.id,
            updatedById: actor.id,
          },
          select: QUESTION_ADMIN_SELECT,
        });
        const revision = await tx.contentRevision.create({
          data: {
            entityType: ContentEntityType.question,
            entityId: question.id,
            revision: 1,
            snapshot: toJson(snapshot),
            contentHash: sha256CanonicalJson(snapshot),
            authorId: actor.id,
          },
          select: QUESTION_REVISION_SELECT,
        });
        await this.syncQuestionTags(tx, question.id, snapshot.tags, tagNames);
        const created = await this.reloadQuestion(tx, question.id);
        await this.writeAudit(tx, actor.id, context, {
          action: 'question.created',
          questionId: created.id,
          revision: 1,
          status: created.status,
          contentHash: revision.contentHash,
        });
        return {
          success: true as const,
          data: {
            question: this.toAdminQuestionBase(created),
            revision,
            idempotent: false,
          },
        };
      }),
    );
  }

  async createQuestionRevision(
    actor: CmsActor,
    questionId: number,
    dto: CreateQuestionRevisionDto,
    context: QuestionMutationContext,
  ) {
    assertAdminActor(actor);
    const snapshot = createQuestionSnapshot(dto);
    const tagNames = tagNamesFromDto(dto);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const question = await this.lockQuestion(
          tx,
          'question.create_revision',
          questionId,
          actor.id,
        );
        this.assertMutableQuestion(question);
        await this.assertLevelExists(tx, snapshot.levelId);
        await this.assertMedia(tx, snapshot);
        const latest = await this.getLatestRevision(tx, questionId);
        const contentHash = sha256CanonicalJson(snapshot);
        if (
          latest &&
          (latest.contentHash === contentHash ||
            canonicalJson(latest.snapshot) === canonicalJson(snapshot))
        ) {
          return {
            success: true as const,
            data: {
              question: this.toAdminQuestionBase(question),
              revision: latest,
              idempotent: true,
            },
          };
        }
        const nextRevision = (latest?.revision ?? 0) + 1;
        const revision = await tx.contentRevision.create({
          data: {
            entityType: ContentEntityType.question,
            entityId: questionId,
            revision: nextRevision,
            snapshot: toJson(snapshot),
            contentHash,
            authorId: actor.id,
          },
          select: QUESTION_REVISION_SELECT,
        });
        const currentQuestion = shouldMaterializeQuestionRevision(
          question.status,
        )
          ? await tx.question.update({
              where: { id: questionId },
              data: {
                ...questionPersistence(snapshot, {
                  version: nextRevision,
                  status: question.status,
                }),
                updatedById: actor.id,
              },
              select: QUESTION_ADMIN_SELECT,
            })
          : question;
        await this.syncQuestionTags(
          tx,
          questionId,
          snapshot.tags,
          tagNames,
          shouldMaterializeQuestionRevision(question.status),
        );
        const persisted = shouldMaterializeQuestionRevision(question.status)
          ? await this.reloadQuestion(tx, questionId)
          : currentQuestion;
        await this.writeAudit(tx, actor.id, context, {
          action: 'question.revision_created',
          questionId,
          revision: nextRevision,
          status: persisted.status,
          contentHash,
        });
        return {
          success: true as const,
          data: {
            question: this.toAdminQuestionBase(persisted),
            revision,
            idempotent: false,
          },
        };
      }),
    );
  }

  async reviewQuestionRevision(
    actor: CmsActor,
    questionId: number,
    revisionId: number,
    dto: ReviewRevisionDto,
    context: QuestionMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const question = await this.lockQuestion(
          tx,
          'question.review',
          questionId,
          actor.id,
        );
        this.assertMutableQuestion(question);
        const revision = await this.getRequestedLatestRevision(
          tx,
          questionId,
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
            reviewer: { select: { id: true, name: true } },
          },
        });
        await this.writeAudit(tx, actor.id, context, {
          action: 'question.reviewed',
          questionId,
          revision: revision.revision,
          status: dto.decision,
          contentHash: revision.contentHash,
          decision: dto.decision,
        });
        return {
          success: true as const,
          data: { revision, review, idempotent: false },
        };
      }),
    );
  }

  async publishQuestionRevision(
    actor: CmsActor,
    questionId: number,
    revisionId: number,
    context: QuestionMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const question = await this.lockQuestion(
          tx,
          'question.publish',
          questionId,
          actor.id,
        );
        this.assertMutableQuestion(question);
        const revision = await this.getRequestedLatestRevision(
          tx,
          questionId,
          revisionId,
        );
        const snapshot = parseQuestionSnapshot(revision.snapshot);
        const revisionHash = assertQuestionRevisionHash(
          snapshot,
          revision.contentHash,
        );
        const action = decidePublishAction({
          requestedRevisionId: revisionId,
          latestRevisionId: revision.id,
          latestDecision: revision.reviews[0]?.decision ?? null,
          liveContentHash:
            question.status === ContentStatus.published
              ? sha256CanonicalJson(snapshotFromQuestion(question))
              : null,
          requestedContentHash: revisionHash,
          liveContentMatchesRevision:
            question.status === ContentStatus.published &&
            question.version === revision.revision &&
            canonicalJson(snapshotFromQuestion(question)) ===
              canonicalJson(snapshot),
        });
        const blockers = await this.collectPublishBlockers(tx, snapshot);
        if (blockers.length > 0) {
          // GlobalExceptionFilter flattens non-framework fields into
          // error.details, so `reasons` is the documented details.reasons.
          throw new ConflictException({
            code: 'QUESTION_NOT_PUBLISHABLE',
            message: 'Question does not meet the publish requirements.',
            reasons: blockers,
          });
        }
        if (action === 'idempotent') {
          return {
            success: true as const,
            data: {
              question: this.toAdminQuestionBase(question),
              revision,
              idempotent: true,
            },
          };
        }

        const published = await tx.question.update({
          where: { id: questionId },
          data: {
            ...questionPersistence(snapshot, {
              version: revision.revision,
              status: ContentStatus.published,
              publishedAt: new Date(),
              publishedById: actor.id,
            }),
            updatedById: actor.id,
          },
          select: QUESTION_ADMIN_SELECT,
        });
        await this.syncQuestionTags(tx, questionId, snapshot.tags, new Map());
        await this.writeAudit(tx, actor.id, context, {
          action: 'question.published',
          questionId,
          revision: revision.revision,
          status: published.status,
          contentHash: revision.contentHash,
        });
        return {
          success: true as const,
          data: { question: published, revision, idempotent: false },
        };
      }),
    );
  }

  async archiveQuestion(
    actor: CmsActor,
    questionId: number,
    context: QuestionMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const question = await this.lockQuestion(
          tx,
          'question.archive',
          questionId,
          actor.id,
        );
        if (isQuestionArchived(question)) {
          return {
            success: true as const,
            data: {
              question: this.toAdminQuestionBase(question),
              idempotent: true,
            },
          };
        }
        const publishedTestLinks = await tx.testQuestion.count({
          where: {
            questionId,
            test: { status: ContentStatus.published, deletedAt: null },
          },
        });
        if (publishedTestLinks > 0) {
          throw new ConflictException({
            code: 'QUESTION_IN_PUBLISHED_TEST',
            message:
              'Question belongs to a published test and cannot be archived.',
          });
        }
        const archived = await tx.question.update({
          where: { id: questionId },
          data: {
            status: ContentStatus.archived,
            deletedAt: new Date(),
            updatedById: actor.id,
          },
          select: QUESTION_ADMIN_SELECT,
        });
        const latest = await this.getLatestRevision(tx, questionId);
        await this.writeAudit(tx, actor.id, context, {
          action: 'question.archived',
          questionId,
          revision: latest?.revision ?? null,
          status: archived.status,
          contentHash: latest?.contentHash ?? null,
        });
        return {
          success: true as const,
          data: {
            question: this.toAdminQuestionBase(archived),
            idempotent: false,
          },
        };
      }),
    );
  }

  private async findQuestionPage(
    query: AdminQuestionsQueryDto,
  ): Promise<{ ids: number[]; total: number }> {
    const filters: Prisma.Sql[] = [];
    if (query.levelId !== undefined) {
      filters.push(Prisma.sql`q."levelId" = ${query.levelId}`);
    }
    if (query.skill !== undefined) {
      filters.push(Prisma.sql`q."skill" = ${query.skill}::"Skill"`);
    }
    if (query.type !== undefined) {
      filters.push(Prisma.sql`q."type" = ${query.type}::"QuestionType"`);
    }
    if (query.difficulty !== undefined) {
      filters.push(Prisma.sql`q."difficulty" = ${query.difficulty}`);
    }
    if (query.status !== undefined) {
      filters.push(Prisma.sql`q."status" = ${query.status}::"ContentStatus"`);
    } else {
      // TL-82a: danh sách mặc định chỉ gồm câu chưa lưu trữ, để
      // `counts.total` (vốn bỏ archived) bằng `meta.total` khi không lọc.
      filters.push(Prisma.sql`q."status" <> 'archived'::"ContentStatus"`);
      filters.push(Prisma.sql`q."deletedAt" IS NULL`);
    }
    if (query.tag !== undefined && query.tag.length > 0) {
      // TL-82b: nhiều tag kết hợp OR qua `slug IN (…)`.
      const slugs = query.tag.map((slug) => Prisma.sql`${slug}`);
      filters.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "QuestionTag" qt
        JOIN "Tag" t ON t."id" = qt."tagId"
        WHERE qt."questionId" = q."id"
          AND t."slug" IN (${Prisma.join(slugs)})
      )`);
    }
    if (query.q !== undefined) {
      // TL-82: ILIKE over Question.content; escapeLike makes `%`/`_` literal.
      const pattern = `%${escapeLike(query.q)}%`;
      filters.push(Prisma.sql`q."content" ILIKE ${pattern}`);
    }
    const whereSql =
      filters.length === 0 ? Prisma.sql`TRUE` : Prisma.join(filters, ' AND ');
    const skip = (query.page - 1) * query.limit;
    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT q."id" FROM "Question" q
        WHERE ${whereSql}
        ORDER BY q."updatedAt" DESC, q."id" DESC
        LIMIT ${query.limit} OFFSET ${skip}
      `),
      this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT count(*)::int AS total FROM "Question" q
        WHERE ${whereSql}
      `),
    ]);
    return {
      ids: rows.map((row) => row.id),
      total: counts[0]?.total ?? 0,
    };
  }

  private async lockQuestion(
    tx: Prisma.TransactionClient,
    operation: CmsTransactionOperation,
    questionId: number,
    actorId: number,
  ): Promise<QuestionAdminRecord> {
    const identity = await tx.question.findUnique({
      where: { id: questionId },
      select: { id: true },
    });
    if (!identity) throw new NotFoundException('Question not found.');
    await this.transactionCoordinator.checkpoint({
      operation,
      phase: 'before_lock',
      entityType: 'question',
      entityId: questionId,
      transaction: tx,
    });
    await lockActiveCmsActor(tx, actorId);
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "Question" WHERE "id" = ${questionId} FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new NotFoundException('Question not found.');
    }
    await this.transactionCoordinator.checkpoint({
      operation,
      phase: 'after_lock',
      entityType: 'question',
      entityId: questionId,
      transaction: tx,
    });
    const question = await tx.question.findUnique({
      where: { id: questionId },
      select: QUESTION_ADMIN_SELECT,
    });
    if (!question) throw new NotFoundException('Question not found.');
    return question;
  }

  private reloadQuestion(
    tx: Prisma.TransactionClient,
    questionId: number,
  ): Promise<QuestionAdminRecord> {
    return tx.question.findUniqueOrThrow({
      where: { id: questionId },
      select: QUESTION_ADMIN_SELECT,
    });
  }

  private async assertLevelExists(
    tx: Prisma.TransactionClient,
    levelId: number,
  ): Promise<void> {
    const level = await tx.level.findUnique({
      where: { id: levelId },
      select: { id: true },
    });
    if (!level) throw new NotFoundException('Level not found.');
  }

  private async assertMedia(
    tx: Prisma.TransactionClient,
    snapshot: QuestionSnapshot,
  ): Promise<void> {
    await this.assertUsableMedia(
      tx,
      snapshot.audioId,
      MediaType.audio,
      'audioId',
    );
    await this.assertUsableMedia(
      tx,
      snapshot.imageId,
      MediaType.image,
      'imageId',
    );
  }

  private async assertUsableMedia(
    tx: Prisma.TransactionClient,
    mediaId: number | null,
    expectedType: MediaType,
    field: 'audioId' | 'imageId',
  ): Promise<void> {
    if (mediaId === null) return;
    const media = await this.getLockedMedia(tx, mediaId);
    const reason = unusableMediaReason(media, expectedType);
    if (reason !== null) {
      throw new ConflictException({
        code: 'MEDIA_NOT_USABLE',
        message: 'Question media must exist, be live and of the right type.',
        field,
        reason,
      });
    }
  }

  private async getLockedMedia(
    tx: Prisma.TransactionClient,
    mediaId: number,
  ): Promise<QuestionMediaRecord | null> {
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

  private async collectPublishBlockers(
    tx: Prisma.TransactionClient,
    snapshot: QuestionSnapshot,
  ): Promise<PublishBlocker[]> {
    const blockers: PublishBlocker[] = [];
    const level = await tx.level.findUnique({
      where: { id: snapshot.levelId },
      select: { id: true },
    });
    if (!level) blockers.push({ code: 'level_not_found', field: 'levelId' });
    if (!snapshot.explanation) {
      blockers.push({ code: 'explanation_required', field: 'explanation' });
    }
    if (snapshot.skill === Skill.listening && snapshot.audioId === null) {
      blockers.push({ code: 'audio_required', field: 'audioId' });
    }
    if (snapshot.audioId !== null) {
      const audio = await this.getLockedMedia(tx, snapshot.audioId);
      if (publishMediaBlocker(audio, MediaType.audio) !== null) {
        blockers.push({ code: 'audio_not_ready', field: 'audioId' });
      }
    }
    if (snapshot.imageId !== null) {
      const image = await this.getLockedMedia(tx, snapshot.imageId);
      if (publishMediaBlocker(image, MediaType.image) !== null) {
        blockers.push({ code: 'image_not_ready', field: 'imageId' });
      }
    }
    return blockers;
  }

  private assertMutableQuestion(question: {
    status: ContentStatus;
    deletedAt: Date | null;
  }): void {
    if (isQuestionArchived(question)) {
      throw new ConflictException({
        code: 'QUESTION_ARCHIVED',
        message: 'Archived Question cannot be changed.',
      });
    }
  }

  private getLatestRevision(
    tx: Prisma.TransactionClient,
    questionId: number,
  ): Promise<QuestionRevisionRecord | null> {
    return tx.contentRevision.findFirst({
      where: {
        entityType: ContentEntityType.question,
        entityId: questionId,
      },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: QUESTION_REVISION_SELECT,
    });
  }

  private async getRequestedLatestRevision(
    tx: Prisma.TransactionClient,
    questionId: number,
    revisionId: number,
  ): Promise<QuestionRevisionRecord> {
    const [requested, latest] = await Promise.all([
      tx.contentRevision.findFirst({
        where: {
          id: revisionId,
          entityType: ContentEntityType.question,
          entityId: questionId,
        },
        select: QUESTION_REVISION_SELECT,
      }),
      this.getLatestRevision(tx, questionId),
    ]);
    if (!requested) throw new NotFoundException('Content revision not found.');
    if (!latest || latest.id !== requested.id) {
      throw new ConflictException({
        code: 'REVISION_NOT_LATEST',
        message:
          'Only the latest content revision can be used for this action.',
      });
    }
    return requested;
  }

  private async getLatestRevisionMap(
    questionIds: number[],
  ): Promise<Map<number, QuestionRevisionRecord>> {
    const result = new Map<number, QuestionRevisionRecord>();
    if (questionIds.length === 0) return result;
    const revisions = await this.prisma.contentRevision.findMany({
      where: {
        entityType: ContentEntityType.question,
        entityId: { in: questionIds },
      },
      orderBy: [{ entityId: 'asc' }, { revision: 'desc' }, { id: 'desc' }],
      select: QUESTION_REVISION_SELECT,
    });
    for (const revision of revisions) {
      if (!result.has(revision.entityId)) {
        result.set(revision.entityId, revision);
      }
    }
    return result;
  }

  private async buildRevisionHistory(
    questionId: number,
  ): Promise<AdminQuestionRevisionDto[]> {
    const revisions = await this.prisma.contentRevision.findMany({
      where: {
        entityType: ContentEntityType.question,
        entityId: questionId,
      },
      orderBy: [{ revision: 'asc' }, { id: 'asc' }],
      select: QUESTION_REVISION_SELECT,
    });
    let previous: Prisma.JsonValue | null = null;
    const ascending = revisions.map((revision) => {
      const changedFields = changedSnapshotFields(previous, revision.snapshot);
      previous = revision.snapshot;
      return {
        id: revision.id,
        revision: revision.revision,
        contentHash: revision.contentHash,
        createdAt: revision.createdAt,
        author: revision.author,
        changedFields,
        reviews: revision.reviews.map((review) => ({
          decision: review.decision,
          note: review.note,
          reviewer: review.reviewer,
          createdAt: review.createdAt,
        })),
      };
    });
    return ascending.reverse();
  }

  private async syncQuestionTags(
    tx: Prisma.TransactionClient,
    questionId: number,
    slugs: string[],
    names: Map<string, string>,
    linkToQuestion = true,
  ): Promise<void> {
    const tagIds: number[] = [];
    for (const slug of slugs) {
      const name = names.get(slug) ?? slug;
      await tx.$executeRaw`
        INSERT INTO "Tag" ("name", "slug", "createdAt", "updatedAt")
        VALUES (${name}, ${slug}, now(), now())
        ON CONFLICT ("slug") DO NOTHING
      `;
      const tag = await tx.tag.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (tag) tagIds.push(tag.id);
    }
    if (!linkToQuestion) return;
    const existing = await tx.questionTag.findMany({
      where: { questionId },
      select: { tagId: true },
    });
    const keep = new Set(tagIds);
    const toDelete = existing
      .map((link) => link.tagId)
      .filter((tagId) => !keep.has(tagId));
    if (toDelete.length > 0) {
      await tx.questionTag.deleteMany({
        where: { questionId, tagId: { in: toDelete } },
      });
    }
    const existingIds = new Set(existing.map((link) => link.tagId));
    const toCreate = tagIds.filter((tagId) => !existingIds.has(tagId));
    if (toCreate.length > 0) {
      await tx.questionTag.createMany({
        data: toCreate.map((tagId) => ({ questionId, tagId })),
        skipDuplicates: true,
      });
    }
  }

  private writeAudit(
    tx: Prisma.TransactionClient,
    actorId: number,
    context: QuestionMutationContext,
    input: {
      action: string;
      questionId: number;
      revision: number | null;
      status: string;
      contentHash: string | null;
      decision?: string;
    },
  ) {
    return tx.auditLog.create({
      data: {
        actorId,
        action: input.action,
        targetType: 'question',
        targetId: String(input.questionId),
        correlationId: context.correlationId,
        afterSummary: {
          entityType: 'question',
          entityId: input.questionId,
          revision: input.revision,
          status: input.status,
          contentHash: input.contentHash,
          ...(input.decision ? { decision: input.decision } : {}),
        },
      },
      select: { id: true },
    });
  }

  private toAdminQuestion(
    question: QuestionAdminRecord,
    latest: QuestionRevisionRecord | undefined,
  ): AdminQuestionDto {
    return {
      ...this.toAdminQuestionBase(question),
      latestRevision: latest
        ? {
            id: latest.id,
            revision: latest.revision,
            decision: latest.reviews[0]?.decision ?? null,
          }
        : null,
    };
  }

  private toAdminQuestionBase(question: QuestionAdminRecord) {
    const { tags, ...rest } = question;
    return {
      ...rest,
      tags: tags
        .map((link) => link.tag)
        .sort((left, right) => compareStrings(left.slug, right.slug)),
    };
  }

  private async executeMutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (error instanceof QuestionAuthoringValidationError) {
        throw authoringException(error);
      }
      const classification = classifyCmsPersistenceError(error);
      if (classification === 'unique_conflict') {
        throw new ConflictException({
          code: 'QUESTION_UNIQUE_CONFLICT',
          message: 'Question content conflicts.',
        });
      }
      if (classification === 'constraint_conflict') {
        throw new ConflictException({
          code: 'QUESTION_CONSTRAINT_CONFLICT',
          message: 'Question violates a database integrity constraint.',
        });
      }
      if (classification === 'concurrent_retry') {
        throw new ConflictException({
          code: 'QUESTION_CONCURRENT_UPDATE',
          message: 'Concurrent Question update detected; retry the request.',
        });
      }
      if (classification === 'timeout' || classification === 'connection') {
        throw new ServiceUnavailableException(
          'Question operation is temporarily unavailable; retry the request.',
        );
      }
      throw new InternalServerErrorException('Question operation failed.');
    }
  }
}

export function createQuestionSnapshot(
  dto: CreateQuestionRevisionDto,
): QuestionSnapshot {
  try {
    return validateQuestionAuthoring({
      type: dto.type,
      skill: dto.skill,
      levelId: dto.levelId,
      content: dto.content,
      answers: dto.answers,
      correctAnswer: dto.correctAnswer,
      explanation: dto.explanation ?? null,
      objective: dto.objective ?? null,
      difficulty: dto.difficulty ?? null,
      audioId: dto.audioId ?? null,
      imageId: dto.imageId ?? null,
      tags: dto.tags ?? [],
    });
  } catch (error) {
    if (error instanceof QuestionAuthoringValidationError) {
      throw authoringException(error);
    }
    throw error;
  }
}

export function parseQuestionSnapshot(
  snapshot: Prisma.JsonValue,
): QuestionSnapshot {
  try {
    return validateQuestionAuthoring(snapshot);
  } catch (error) {
    if (error instanceof QuestionAuthoringValidationError) {
      throw new ConflictException({
        code: 'CONTENT_REVISION_INVALID',
        message: 'Question revision snapshot is invalid.',
      });
    }
    throw error;
  }
}

export function assertQuestionRevisionHash(
  snapshot: QuestionSnapshot,
  contentHash: string | null,
): string {
  if (!contentHash) {
    throw new ConflictException({
      code: 'CONTENT_REVISION_INVALID',
      message: 'Content revision hash is missing.',
    });
  }
  if (sha256CanonicalJson(snapshot) !== contentHash) {
    throw new ConflictException({
      code: 'CONTENT_REVISION_INVALID',
      message: 'Question revision snapshot integrity check failed.',
    });
  }
  return contentHash;
}

export function shouldMaterializeQuestionRevision(status: string): boolean {
  return status === ContentStatus.draft;
}

export function isQuestionArchived(question: {
  status: string;
  deletedAt: Date | null;
}): boolean {
  return (
    question.status === ContentStatus.archived || question.deletedAt !== null
  );
}

function questionPersistence(
  snapshot: QuestionSnapshot,
  options: {
    version: number;
    status: ContentStatus;
    publishedAt?: Date;
    publishedById?: number;
  },
): Prisma.QuestionUncheckedCreateInput {
  return {
    content: snapshot.content,
    type: snapshot.type,
    skill: snapshot.skill,
    levelId: snapshot.levelId,
    audioId: snapshot.audioId,
    imageId: snapshot.imageId,
    answers: toJson(snapshot.answers),
    correctAnswer: toJson(snapshot.correctAnswer),
    explanation: snapshot.explanation,
    objective: snapshot.objective,
    difficulty: snapshot.difficulty,
    version: options.version,
    status: options.status,
    contentHash: sha256CanonicalJson(snapshot),
    ...(options.publishedAt ? { publishedAt: options.publishedAt } : {}),
    ...(options.publishedById ? { publishedById: options.publishedById } : {}),
  };
}

function snapshotFromQuestion(question: {
  type: QuestionType;
  skill: Skill;
  levelId: number;
  content: string;
  answers: Prisma.JsonValue;
  correctAnswer: Prisma.JsonValue;
  explanation: string | null;
  objective: string | null;
  difficulty: number | null;
  audioId: number | null;
  imageId: number | null;
  tags: Array<{ tag: { slug: string; name: string } }>;
}): QuestionSnapshot {
  return {
    type: question.type as QuestionSnapshot['type'],
    skill: question.skill,
    levelId: question.levelId,
    content: question.content,
    answers: toRecord(question.answers),
    correctAnswer: toRecord(question.correctAnswer),
    explanation: question.explanation,
    objective: question.objective,
    difficulty: question.difficulty,
    audioId: question.audioId,
    imageId: question.imageId,
    tags: question.tags.map((link) => link.tag.slug).sort(compareStrings),
  };
}

/**
 * TL-81a: saving a draft only rejects references that can never become usable
 * (missing, wrong type, quarantined, archived). A media row that is still
 * pending/processing is allowed so authors can prepare the question while the
 * file is being processed; publish re-checks readiness (publishMediaBlocker).
 */
function unusableMediaReason(
  media: QuestionMediaRecord | null,
  expectedType: MediaType,
): string | null {
  if (!media) return 'not_found';
  if (media.type !== expectedType) return 'wrong_type';
  if (media.processingStatus === MediaProcessingStatus.quarantined) {
    return 'quarantined';
  }
  if (media.deletedAt !== null) return 'archived';
  return null;
}

/** Publish gate: additionally requires the media to be fully ready. */
function publishMediaBlocker(
  media: QuestionMediaRecord | null,
  expectedType: MediaType,
): string | null {
  const unusable = unusableMediaReason(media, expectedType);
  if (unusable !== null) return unusable;
  if (media && media.processingStatus !== MediaProcessingStatus.ready) {
    return 'not_ready';
  }
  return null;
}

function changedSnapshotFields(
  previous: Prisma.JsonValue | null,
  current: Prisma.JsonValue,
): string[] {
  if (previous === null) return [];
  const before = toRecord(previous);
  const after = toRecord(current);
  return QUESTION_SNAPSHOT_FIELDS.filter(
    (field) =>
      canonicalJsonOrNull(before[field]) !== canonicalJsonOrNull(after[field]),
  );
}

function canonicalJsonOrNull(value: unknown): string {
  if (value === undefined) return 'null';
  try {
    return canonicalJson(value);
  } catch {
    return 'invalid';
  }
}

function tagNamesFromDto(dto: CreateQuestionRevisionDto): Map<string, string> {
  const names = new Map<string, string>();
  for (const raw of dto.tags ?? []) {
    const name = normalizeQuestionTagName(raw);
    names.set(slugifyQuestionTag(name), name);
  }
  return names;
}

function authoringException(
  error: QuestionAuthoringValidationError,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: error.code,
    path: error.path,
    message: `Question validation failed at ${error.path}.`,
  });
}

function toRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
