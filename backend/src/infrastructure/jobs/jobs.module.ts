import { Global, Module, DynamicModule, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JobQueuePort, JOB_NAMES, PG_BOSS_INSTANCE } from './job-queue.port';
import { PgBossJobQueue } from './pgboss-job-queue.adapter';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };
import { InMemoryJobQueue } from './in-memory-job-queue.adapter';
import { assertPgBossVersion } from './assert-pgboss-version';
import { PgBossLifecycle } from './pgboss-lifecycle';

export { PG_BOSS_INSTANCE } from './job-queue.port';

export interface JobsModuleOptions {
  isWorker: boolean;
}

@Global()
@Module({})
export class JobsModule {
  static register(options: JobsModuleOptions): DynamicModule {
    return {
      module: JobsModule,
      providers: [
        {
          provide: PG_BOSS_INSTANCE,
          inject: [ConfigService, PrismaService],
          useFactory: async (config: ConfigService, prisma: PrismaService) => {
            const provider = config.get<string>('JOB_QUEUE_PROVIDER');
            if (provider === 'memory') {
              return null; // Not using PgBoss
            }

            const databaseUrl = config.get<string>('DATABASE_URL');
            if (!databaseUrl)
              throw new Error('DATABASE_URL is required for pg-boss');

            // Dynamic import ESM
            const { PgBoss } = await import('pg-boss');

            const boss = new PgBoss({
              connectionString: databaseUrl,
              migrate: false,
              supervise: options.isWorker,
              schedule: options.isWorker,
              max: 4, // "Pool của pg-boss nhỏ và cố định (≤ 4 kết nối)"
            });

            boss.on('error', (err: Error) => {
              Logger.error(err, 'PgBoss');
            });

            // "K2. Lúc khởi động, nếu pgboss.version khác 43 thì fail fast"
            await assertPgBossVersion(prisma);

            await boss.start();

            // "Queue được tạo idempotent khi cả hai process khởi động"
            const queuesToCreate: Array<{
              name: string;
              options: Parameters<PgBoss['createQueue']>[1];
            }> = [
              {
                name: JOB_NAMES.PURGE_EXPIRED_SESSIONS,
                options: { retryLimit: 3, retryBackoff: true },
              },
              {
                name: JOB_NAMES.SEND_EMAIL_VERIFICATION,
                options: { policy: 'short', retryLimit: 3, retryBackoff: true },
              },
              {
                name: JOB_NAMES.SEND_PASSWORD_RESET,
                options: { policy: 'short', retryLimit: 3, retryBackoff: true },
              },
            ];

            for (const queue of queuesToCreate) {
              try {
                await boss.createQueue(queue.name, queue.options);
              } catch (err: unknown) {
                const message =
                  err instanceof Error ? err.message : String(err);
                if (!message.includes('already exists')) {
                  throw err;
                }
              }
            }

            return boss;
          },
        },
        {
          provide: JobQueuePort,
          inject: [ConfigService, PG_BOSS_INSTANCE],
          useFactory: (config: ConfigService, boss: PgBoss) => {
            const provider = config.get<string>('JOB_QUEUE_PROVIDER');
            if (provider === 'memory') {
              return new InMemoryJobQueue();
            }
            return new PgBossJobQueue(boss);
          },
        },
        PgBossLifecycle,
      ],
      exports: [JobQueuePort, PG_BOSS_INSTANCE, PgBossLifecycle],
    };
  }
}
