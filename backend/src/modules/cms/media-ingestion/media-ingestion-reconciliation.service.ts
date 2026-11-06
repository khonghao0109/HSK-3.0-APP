import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import { OBJECT_STORAGE } from '../../../infrastructure/storage/object-storage.port';
import type { ObjectStoragePort } from '../../../infrastructure/storage/object-storage.port';
import { PrismaService } from '../../../prisma/prisma.service';
import { assertAdminActor, CmsActor } from '../cms-workflow';
import { AdminMediaIngestionDto } from '../dto/admin-media-ingestion-response.dto';
import { safeMediaFilename } from '../media-admin.policy';

import { MEDIA_INGESTION_STUCK_PROCESSING_SQL } from './media-ingestion.policy';

/**
 * TL-46/TL-47: rows that need an operator. failed/rejected/completed are
 * settled and never listed. Storage key, tokens, hashes, checksum, provider,
 * source snapshots, actor and media ids are deliberately not selected.
 */
const NEEDS_RECONCILIATION_SQL = Prisma.sql`(i.status = 'cleanup_required'
  OR (${MEDIA_INGESTION_STUCK_PROCESSING_SQL}))`;

export const MEDIA_INGESTION_LIST_COLUMNS_SQL = Prisma.sql`i.id, i.status::text AS status,
  i."failureCode", i."originalFilename", i.size,
  d.id AS "dataSourceId", d.code AS "dataSourceCode",
  d.name AS "dataSourceName", d.version AS "dataSourceVersion",
  i."startedAt", i."processingStartedAt", i."cleanupRequiredAt",
  i."cleanupAttempts", i."cleanupLastAttemptAt"`;

type IngestionRow = {
  id: number;
  status: 'cleanup_required' | 'processing';
  failureCode: string | null;
  originalFilename: string;
  size: number;
  dataSourceId: number;
  dataSourceCode: string;
  dataSourceName: string;
  dataSourceVersion: string;
  startedAt: Date;
  processingStartedAt: Date | null;
  cleanupRequiredAt: Date | null;
  cleanupAttempts: number;
  cleanupLastAttemptAt: Date | null;
  cleanupAvailable: boolean;
};

@Injectable()
export class MediaIngestionReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async listIngestions(
    actor: CmsActor,
    query: PaginationQueryDto,
  ): Promise<ApiSuccessResponse<AdminMediaIngestionDto[]>> {
    assertAdminActor(actor);
    const skip = (query.page - 1) * query.limit;
    // Columns are unqualified inside the shared stuck predicate; it only
    // names MediaIngestion columns, which no joined DataSource column shadows.
    const [rows, counts] = await this.prisma.$transaction([
      this.prisma.$queryRaw<IngestionRow[]>(
        Prisma.sql`SELECT ${MEDIA_INGESTION_LIST_COLUMNS_SQL},
          (i.status = 'cleanup_required'
            AND i."storageProvider" = ${this.storage.provider}) AS "cleanupAvailable"
          FROM "MediaIngestion" i
          JOIN "DataSource" d ON d.id = i."dataSourceId"
          WHERE ${NEEDS_RECONCILIATION_SQL}
          ORDER BY i."startedAt" DESC, i.id DESC
          LIMIT ${query.limit} OFFSET ${skip}`,
      ),
      this.prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT count(*)::int AS total FROM "MediaIngestion" i
          WHERE ${NEEDS_RECONCILIATION_SQL}`,
      ),
    ]);
    const total = counts[0]?.total ?? 0;
    return {
      success: true,
      data: rows.map(projectIngestion),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}

function projectIngestion(row: IngestionRow): AdminMediaIngestionDto {
  return {
    id: row.id,
    status: row.status,
    failureCode: row.failureCode,
    filename: safeMediaFilename(row.originalFilename),
    size: row.size,
    dataSource: {
      id: row.dataSourceId,
      code: row.dataSourceCode,
      name: row.dataSourceName,
      version: row.dataSourceVersion,
    },
    startedAt: row.startedAt,
    processingStartedAt: row.processingStartedAt,
    cleanupRequiredAt: row.cleanupRequiredAt,
    cleanupAttempts: row.cleanupAttempts,
    cleanupLastAttemptAt: row.cleanupLastAttemptAt,
    cleanupAvailable: row.cleanupAvailable,
  };
}
