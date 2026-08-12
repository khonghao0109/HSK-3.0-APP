import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ApiSuccessResponse,
  PaginationMeta,
} from '../../common/interfaces/api-response.interface';
import { PrismaService } from '../../prisma/prisma.service';

import {
  assertAdminActor,
  classifyCmsPersistenceError,
  CmsActor,
} from './cms-workflow';
import { lockActiveCmsActor } from './cms-actor-lock';
import { AdminMediaQueryDto } from './dto/admin-media-query.dto';
import {
  mediaLifecycleDecision,
  MediaLifecycleOperation,
  projectAdminMedia,
} from './media-admin.policy';

const MEDIA_USAGE_COUNT_SELECT = {
  lessonCoverImage: true,
  wordAudio: true,
  wordImage: true,
  wordStrokeAnimation: true,
  questionAudio: true,
  questionImage: true,
  sentenceAudio: true,
  pronunciationPracticeAudio: true,
  pronunciationAttemptAudio: true,
  questionGroupAudio: true,
  questionGroupImage: true,
  lessonExercises: true,
} satisfies Prisma.MediaCountOutputTypeSelect;

const MEDIA_ADMIN_SELECT = {
  id: true,
  url: true,
  type: true,
  mimeType: true,
  size: true,
  duration: true,
  storageProvider: true,
  storageKey: true,
  originalFilename: true,
  checksum: true,
  processingStatus: true,
  metadata: true,
  dataSourceId: true,
  uploadedById: true,
  updatedById: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  dataSource: {
    select: { id: true, code: true, name: true, version: true },
  },
  _count: { select: MEDIA_USAGE_COUNT_SELECT },
} satisfies Prisma.MediaSelect;

type MediaAdminRecord = Prisma.MediaGetPayload<{
  select: typeof MEDIA_ADMIN_SELECT;
}>;

export type MediaMutationContext = { correlationId: string };

@Injectable()
export class MediaAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listMedia(
    actor: CmsActor,
    query: AdminMediaQueryDto,
  ): Promise<ApiSuccessResponse<unknown[], PaginationMeta>> {
    assertAdminActor(actor);
    const where: Prisma.MediaWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.processingStatus
        ? { processingStatus: query.processingStatus }
        : {}),
      ...(query.lifecycle === 'active' ? { deletedAt: null } : {}),
      ...(query.lifecycle === 'archived' ? { deletedAt: { not: null } } : {}),
      ...(query.dataSourceId ? { dataSourceId: query.dataSourceId } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [media, total] = await this.prisma.$transaction([
      this.prisma.media.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.limit,
        select: MEDIA_ADMIN_SELECT,
      }),
      this.prisma.media.count({ where }),
    ]);
    return {
      success: true,
      data: media.map(projectRecord),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getMedia(actor: CmsActor, mediaId: number) {
    assertAdminActor(actor);
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: {
        ...MEDIA_ADMIN_SELECT,
        lessonExercises: {
          orderBy: [{ id: 'asc' }],
          take: 50,
          select: {
            id: true,
            lessonId: true,
            topicId: true,
            prompt: true,
            status: true,
          },
        },
      },
    });
    if (!media) throw new NotFoundException('Media asset not found.');
    const usageCount = totalUsage(media._count);
    return {
      success: true as const,
      data: {
        ...projectAdminMedia(media, {
          usageCount,
          dataSource: media.dataSource,
        }),
        usage: {
          lessonExercises: media.lessonExercises,
          counts: {
            lessonExercises: media._count.lessonExercises,
            otherContent: usageCount - media._count.lessonExercises,
          },
        },
      },
    };
  }

  quarantineMedia(
    actor: CmsActor,
    mediaId: number,
    context: MediaMutationContext,
  ) {
    return this.changeLifecycle(actor, mediaId, 'quarantine', context);
  }

  archiveMedia(
    actor: CmsActor,
    mediaId: number,
    context: MediaMutationContext,
  ) {
    return this.changeLifecycle(actor, mediaId, 'archive', context);
  }

  private async changeLifecycle(
    actor: CmsActor,
    mediaId: number,
    operation: MediaLifecycleOperation,
    context: MediaMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(() =>
      this.prisma.$transaction(async (tx) => {
        await lockActiveCmsActor(tx, actor.id);
        const rows = await tx.$queryRaw<Array<{ id: number }>>(
          Prisma.sql`SELECT id FROM "Media" WHERE id = ${mediaId} FOR UPDATE`,
        );
        if (rows.length !== 1) {
          throw new NotFoundException('Media asset not found.');
        }
        const current = await tx.media.findUniqueOrThrow({
          where: { id: mediaId },
          select: MEDIA_ADMIN_SELECT,
        });
        const decision = mediaLifecycleDecision(operation, current);
        if (decision === 'idempotent') {
          return {
            success: true as const,
            data: { idempotent: true, media: projectRecord(current) },
          };
        }
        const updated = await tx.media.update({
          where: { id: mediaId },
          data:
            operation === 'archive'
              ? { deletedAt: new Date(), updatedById: actor.id }
              : {
                  processingStatus: 'quarantined',
                  updatedById: actor.id,
                },
          select: MEDIA_ADMIN_SELECT,
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action:
              operation === 'archive' ? 'media.archived' : 'media.quarantined',
            targetType: 'media',
            targetId: String(mediaId),
            correlationId: context.correlationId,
            beforeSummary: safeAuditSummary(current),
            afterSummary: safeAuditSummary(updated),
          },
          select: { id: true },
        });
        return {
          success: true as const,
          data: { idempotent: false, media: projectRecord(updated) },
        };
      }),
    );
  }

  private async executeMutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      const classification = classifyCmsPersistenceError(error);
      if (
        classification === 'unique_conflict' ||
        classification === 'constraint_conflict'
      ) {
        throw new ConflictException('Media lifecycle conflict.');
      }
      if (
        classification === 'concurrent_retry' ||
        classification === 'timeout' ||
        classification === 'connection'
      ) {
        throw new ServiceUnavailableException(
          'Media operation is temporarily unavailable.',
        );
      }
      throw new InternalServerErrorException('Media operation failed.');
    }
  }
}

function totalUsage(counts: MediaAdminRecord['_count']): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function projectRecord(media: MediaAdminRecord) {
  return projectAdminMedia(media, {
    usageCount: totalUsage(media._count),
    dataSource: media.dataSource,
  });
}

function safeAuditSummary(media: MediaAdminRecord) {
  return {
    entityType: 'media',
    entityId: media.id,
    type: media.type,
    processingStatus: media.processingStatus,
    lifecycle: media.deletedAt ? 'archived' : 'active',
    usageCount: totalUsage(media._count),
  };
}
