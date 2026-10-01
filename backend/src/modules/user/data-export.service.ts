import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Prisma } from '@prisma/client';

import {
  JOB_NAMES,
  JobQueuePort,
} from '../../infrastructure/jobs/job-queue.port';
import {
  OBJECT_STORAGE,
  ObjectStorageError,
  type ObjectStoragePort,
  type StoredObject,
} from '../../infrastructure/storage/object-storage.port';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDataExportResponseDto } from './dto/create-data-export-response.dto';
import { DataExportItemDto } from './dto/data-export-response.dto';

@Injectable()
export class DataExportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(JobQueuePort) private readonly jobQueue: JobQueuePort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async requestDataExport(
    userId: number,
  ): Promise<CreateDataExportResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Check user exists, active and deletedAt IS NULL
      const userRows = await tx.$queryRaw<
        Array<{ id: number; status: string; deletedAt: Date | null }>
      >(Prisma.sql`
        SELECT id, status, "deletedAt"
        FROM "User"
        WHERE id = ${userId}
        FOR UPDATE
      `);

      if (
        userRows.length === 0 ||
        userRows[0].status !== 'active' ||
        userRows[0].deletedAt !== null
      ) {
        throw new NotFoundException('User not found.');
      }

      // 2. Check 24-hour rate limit
      const existingRows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT id
        FROM "DataExportJob"
        WHERE "userId" = ${userId}
          AND "createdAt" > CURRENT_TIMESTAMP - INTERVAL '24 hours'
          AND status IN ('requested', 'processing', 'completed')
        LIMIT 1
      `);

      if (existingRows.length > 0) {
        throw new HttpException(
          {
            code: 'EXPORT_RATE_LIMITED',
            message:
              'A data export was already requested within the last 24 hours.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 3. Insert new DataExportJob with status = 'requested'
      const insertRows = await tx.$queryRaw<
        Array<{ id: number; status: string }>
      >(Prisma.sql`
        INSERT INTO "DataExportJob" ("userId", status, "createdAt", "updatedAt")
        VALUES (${userId}, 'requested', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id, status
      `);

      const exportJob = insertRows[0];

      // 4. Enqueue in tx
      await this.jobQueue.send(
        JOB_NAMES.DATA_EXPORT,
        { exportId: exportJob.id },
        {
          singletonKey: `export:${exportJob.id}`,
          tx,
        },
      );

      return {
        exportId: exportJob.id,
        status: exportJob.status,
      };
    });
  }

  async listDataExports(userId: number): Promise<DataExportItemDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        status: string;
        createdAt: Date;
        completedAt: Date | null;
        outputExpiresAt: Date | null;
        downloadable: boolean;
      }>
    >(Prisma.sql`
      SELECT
        id,
        status,
        "createdAt",
        "completedAt",
        "outputExpiresAt",
        (status = 'completed' AND "outputExpiresAt" > CURRENT_TIMESTAMP AND "outputStorageKey" IS NOT NULL) AS downloadable
      FROM "DataExportJob"
      WHERE "userId" = ${userId}
      ORDER BY "createdAt" DESC
      LIMIT 10
    `);

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      outputExpiresAt: r.outputExpiresAt
        ? r.outputExpiresAt.toISOString()
        : null,
      downloadable: Boolean(r.downloadable),
    }));
  }

  async getDownloadableExport(
    userId: number,
    exportId: number,
  ): Promise<StoredObject> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        outputStorageKey: string;
      }>
    >(Prisma.sql`
      SELECT id, "outputStorageKey"
      FROM "DataExportJob"
      WHERE id = ${exportId}
        AND "userId" = ${userId}
        AND status = 'completed'
        AND "outputExpiresAt" > CURRENT_TIMESTAMP
        AND "outputStorageKey" IS NOT NULL
    `);

    if (rows.length === 0) {
      throw new NotFoundException('Data export not found or expired.');
    }

    const storageKey = rows[0].outputStorageKey;

    let stored: StoredObject;
    try {
      stored = await this.storage.getPrivateObject(storageKey);
    } catch (err: unknown) {
      if (err instanceof ObjectStorageError && err.kind === 'not_found') {
        throw new NotFoundException('Data export file not found in storage.');
      }
      throw new InternalServerErrorException(
        'Failed to read data export from storage.',
      );
    }

    const calculatedChecksum = crypto
      .createHash('sha256')
      .update(stored.body)
      .digest('hex');

    if (stored.checksum !== calculatedChecksum) {
      throw new InternalServerErrorException(
        'Data export checksum verification failed.',
      );
    }

    return stored;
  }
}
