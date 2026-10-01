import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  JOB_NAMES,
  PG_BOSS_INSTANCE,
} from '../../../infrastructure/jobs/job-queue.port';
import {
  OBJECT_STORAGE,
  ObjectStorageError,
  type ObjectStoragePort,
} from '../../../infrastructure/storage/object-storage.port';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };

@Injectable()
export class PurgeExpiredExportsJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(PurgeExpiredExportsJob.name);

  constructor(
    @Inject(PG_BOSS_INSTANCE) private readonly boss: PgBoss | null,
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.boss) return;

    await this.boss.schedule(
      JOB_NAMES.PURGE_EXPIRED_EXPORTS,
      '0 * * * *',
      null,
      {
        retryLimit: 3,
        retryBackoff: true,
      },
    );

    await this.boss.work(JOB_NAMES.PURGE_EXPIRED_EXPORTS, async (jobs) => {
      for (const job of jobs) {
        try {
          await this.purge();
        } catch (error) {
          this.logger.error(
            `Job ${job.name} failed (id: ${job.id}, error: ${error instanceof Error ? error.name : 'UnknownError'})`,
          );
          throw error;
        }
      }
    });
  }

  async purge(): Promise<number> {
    let totalPurged = 0;

    const expiredExports = await this.prisma.$queryRaw<
      Array<{
        id: number;
        outputStorageKey: string;
      }>
    >(Prisma.sql`
      SELECT id, "outputStorageKey"
      FROM "DataExportJob"
      WHERE "completedAt" < CURRENT_TIMESTAMP - INTERVAL '7 days'
        AND "outputStorageKey" IS NOT NULL
      ORDER BY id ASC
      LIMIT 100
    `);

    for (const exp of expiredExports) {
      try {
        await this.storage.deletePrivateObject(exp.outputStorageKey);
      } catch (err: unknown) {
        if (err instanceof ObjectStorageError && err.kind === 'not_found') {
          // not_found is considered already deleted
        } else {
          throw err;
        }
      }

      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "DataExportJob"
        SET "outputStorageKey" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${exp.id}
      `);

      totalPurged++;
    }

    if (totalPurged > 0) {
      this.logger.log(`Purged ${totalPurged} expired data export objects.`);
    }

    return totalPurged;
  }
}
