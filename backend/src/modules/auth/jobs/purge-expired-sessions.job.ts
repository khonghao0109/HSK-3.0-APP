import {
  Injectable,
  OnApplicationBootstrap,
  Logger,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JOB_NAMES } from '../../../infrastructure/jobs/job-queue.port';
import { PG_BOSS_INSTANCE } from '../../../infrastructure/jobs/jobs.module';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };

@Injectable()
export class PurgeExpiredSessionsJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(PurgeExpiredSessionsJob.name);

  constructor(
    @Inject(PG_BOSS_INSTANCE) private readonly boss: PgBoss | null,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.boss) return;

    // Schedule the job
    await this.boss.schedule(
      JOB_NAMES.PURGE_EXPIRED_SESSIONS,
      '17 3 * * *',
      null,
      {
        retryLimit: 3,
        retryBackoff: true,
      },
    );

    // Register handler
    await this.boss.work(JOB_NAMES.PURGE_EXPIRED_SESSIONS, async (jobs) => {
      for (const job of jobs) {
        try {
          await this.purge();
        } catch (error) {
          this.logger.error(
            `Job ${job.name} failed (id: ${job.id}, retry: ${job.retryCount}): ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }
      }
    });
  }

  async purge(): Promise<number> {
    let totalDeleted = 0;
    const maxLoops = 1000;
    let loops = 0;

    while (loops < maxLoops) {
      loops++;
      const result = await this.prisma.$executeRaw`
        DELETE FROM "UserSession"
        WHERE id IN (
          SELECT id FROM "UserSession"
          WHERE "expiresAt" < CURRENT_TIMESTAMP - INTERVAL '30 days'
          LIMIT 1000
        )
      `;

      totalDeleted += result;
      if (result < 1000) {
        break;
      }
    }

    this.logger.log(
      `Purged ${totalDeleted} expired sessions in ${loops} batches.`,
    );
    return totalDeleted;
  }
}
