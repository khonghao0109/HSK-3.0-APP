import { PrismaClient } from '@prisma/client';
import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { JobsModule } from '../../src/infrastructure/jobs/jobs.module';
import { PurgeExpiredSessionsJob } from '../../src/modules/auth/jobs/purge-expired-sessions.job';
import { PurgeExpiredExportsJob } from '../../src/modules/user/jobs/purge-expired-exports.job';
import { OBJECT_STORAGE } from '../../src/infrastructure/storage/object-storage.port';
import { InMemoryObjectStorageAdapter } from '../../src/infrastructure/storage/in-memory-object-storage.adapter';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  JobQueuePort,
  JOB_NAMES,
} from '../../src/infrastructure/jobs/job-queue.port';
import { INestApplicationContext } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PG_BOSS_INSTANCE } from '../../src/infrastructure/jobs/jobs.module';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';

declare module '../../src/infrastructure/jobs/job-queue.port' {
  interface JobDataMap {
    'test-job': { hello: string };
    'test-tx-job': { rolled?: string; committed?: string };
    'test-singleton-job-short': Record<string, never>;
  }
}

let prisma: PrismaClient;

before(async () => {
  assertDisposableTestDatabase();
  prisma = new PrismaClient();
  await prisma.$connect();
});

after(async () => {
  await prisma.$disconnect();
});

describe('Job Queue Integration (J1-J8)', () => {
  it('J1: pgboss.version = 43 sau migrate; không có BEGIN;/COMMIT; top-level trong migration', async () => {
    const res = await prisma.$queryRawUnsafe<{ version: number }[]>(
      'SELECT version FROM pgboss.version',
    );
    assert.strictEqual(String(res[0]?.version), '43');

    const migrationsDir = path.join(__dirname, '../../prisma/migrations');
    const dirs = fs
      .readdirSync(migrationsDir)
      .filter((d) => d.endsWith('_pgboss_schema'));
    assert.strictEqual(dirs.length, 1);
    const sql = fs.readFileSync(
      path.join(migrationsDir, dirs[0], 'migration.sql'),
      'utf-8',
    );

    assert.ok(
      !/^\s*BEGIN;\s*$/m.test(sql),
      'Should not contain top-level BEGIN;',
    );
    assert.ok(
      !/^\s*COMMIT;\s*$/m.test(sql),
      'Should not contain top-level COMMIT;',
    );
  });

  describe('Worker and API process flows', () => {
    let apiApp: INestApplicationContext;
    let workerApp: INestApplicationContext;
    let apiQueue: JobQueuePort;
    let purgeJob: PurgeExpiredSessionsJob;
    let workerBoss: PgBoss;
    let apiAppClosed = false;

    before(async () => {
      apiApp = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [],
            ignoreEnvFile: true,
          }),
          PrismaModule,
          JobsModule.register({ isWorker: false }),
        ],
      }).compile();

      apiApp.enableShutdownHooks();
      await apiApp.init();
      apiQueue = apiApp.get(JobQueuePort);

      workerApp = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [],
            ignoreEnvFile: true,
          }),
          PrismaModule,
          JobsModule.register({ isWorker: true }),
        ],
        providers: [
          PurgeExpiredSessionsJob,
          PurgeExpiredExportsJob,
          {
            provide: OBJECT_STORAGE,
            useClass: InMemoryObjectStorageAdapter,
          },
        ],
      }).compile();

      await workerApp.init();
      purgeJob = workerApp.get(PurgeExpiredSessionsJob);
      workerBoss = workerApp.get(PG_BOSS_INSTANCE);
    });

    after(async () => {
      try {
        if (!apiAppClosed) {
          await apiApp.close();
        }
      } finally {
        await workerApp.close();
      }
    });

    it('J2: gửi và xử lý thật qua adapter pg-boss', async () => {
      const testJobName = 'test-job';
      await workerBoss.createQueue(testJobName);
      let receivedData: { hello: string } | null = null;
      await workerBoss.work<{ hello: string }>(testJobName, (jobs) => {
        receivedData = jobs[0].data;
        return Promise.resolve();
      });

      const id = await apiQueue.send(testJobName, { hello: 'world' });
      assert.ok(id);

      for (let i = 0; i < 20; i++) {
        if (receivedData) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.deepStrictEqual(receivedData, { hello: 'world' });
    });

    it('J3: send with tx rollback -> 0 job; commit -> 1 job', async () => {
      await prisma.$executeRawUnsafe('TRUNCATE pgboss.job CASCADE');
      const testJobName = 'test-tx-job';
      await workerBoss.createQueue(testJobName);

      try {
        await prisma.$transaction(async (tx) => {
          await apiQueue.send(testJobName, { rolled: 'back' }, { tx });
          throw new Error('rollback');
        });
      } catch (e: unknown) {
        assert.strictEqual(
          e instanceof Error ? e.message : String(e),
          'rollback',
        );
      }

      let sentId: string | null = null;
      await prisma.$transaction(async (tx) => {
        sentId = await apiQueue.send(
          testJobName,
          { committed: 'true' },
          { tx },
        );
      });

      assert.ok(sentId);

      const res = await prisma.$queryRawUnsafe<
        { data: { committed: string } }[]
      >(`SELECT data FROM pgboss.job WHERE name = $1`, testJobName);
      assert.strictEqual(res.length, 1);
      assert.deepStrictEqual(res[0].data, { committed: 'true' });
    });

    it('J4: singletonKey trùng -> lần hai trả null', async () => {
      const testJobName = 'test-singleton-job-short';
      await workerBoss.createQueue(testJobName, { policy: 'short' });

      const id1 = await apiQueue.send(
        testJobName,
        {},
        { singletonKey: 'key1' },
      );
      const id2 = await apiQueue.send(
        testJobName,
        {},
        { singletonKey: 'key1' },
      );

      assert.ok(id1);
      assert.strictEqual(
        id2,
        null,
        `apiQueue is ${apiQueue.constructor.name}, id2 is ${id2}`,
      );
    });

    it('J5: purge expired sessions', async () => {
      await prisma.$executeRaw`DELETE FROM "UserSession"`;
      await prisma.$executeRaw`DELETE FROM "User" WHERE email = 'test_purge@example.com'`;

      const resUser = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'INSERT INTO "User" (email, password, name, "updatedAt") VALUES ($1, $2, $3, NOW()) RETURNING id',
        'test_purge@example.com',
        'hash',
        'Test Purge',
      );
      const userId = resUser[0].id;

      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "UserSession" (id, "userId", "tokenHash", "expiresAt", "createdAt")
        VALUES (1001, $1, 'hash1', CURRENT_TIMESTAMP - INTERVAL '31 days', CURRENT_TIMESTAMP - INTERVAL '38 days')
      `,
        userId,
      );
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "UserSession" (id, "userId", "tokenHash", "expiresAt", "createdAt")
        VALUES (1002, $1, 'hash2', CURRENT_TIMESTAMP - INTERVAL '29 days', CURRENT_TIMESTAMP - INTERVAL '36 days')
      `,
        userId,
      );
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "UserSession" (id, "userId", "tokenHash", "expiresAt", "createdAt")
        VALUES (1003, $1, 'hash3', CURRENT_TIMESTAMP + INTERVAL '1 days', CURRENT_TIMESTAMP - INTERVAL '6 days')
      `,
        userId,
      );

      const deletedCount = await purgeJob.purge();
      assert.strictEqual(deletedCount, 1);

      const remaining = await prisma.$queryRawUnsafe<{ id: number }[]>(
        'SELECT id FROM "UserSession" ORDER BY id',
      );
      assert.deepStrictEqual(remaining.map((r) => r.id).sort(), [1002, 1003]);

      const deletedCount2 = await purgeJob.purge();
      assert.strictEqual(deletedCount2, 0);

      const remaining2 = await prisma.$queryRawUnsafe<{ id: number }[]>(
        'SELECT id FROM "UserSession" ORDER BY id',
      );
      assert.strictEqual(remaining2.length, 2);
    });

    it('J6: queue tạo idempotent', async () => {
      const duplicateApp = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [],
            ignoreEnvFile: true,
          }),
          PrismaModule,
          JobsModule.register({ isWorker: false }),
        ],
      }).compile();

      try {
        await assert.doesNotReject(duplicateApp.init());
      } finally {
        await duplicateApp.close();
      }
    });

    it('J8: register-like: gửi trong tx rồi rollback -> 0 job; commit -> 1 job; gửi lần 2 cùng singletonKey -> null', async () => {
      // 1. Rollback in transaction -> 0 job in pgboss.job
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          await apiQueue.send(
            JOB_NAMES.SEND_EMAIL_VERIFICATION,
            { userId: 9991 },
            { singletonKey: 'email-verification:9991', tx },
          );
          throw new Error('Rollback simulated');
        }),
      );

      const rolledJobs = await prisma.$queryRawUnsafe<
        { id: string; data: unknown }[]
      >(
        `SELECT id, data FROM pgboss.job WHERE name = $1 AND data->>'userId' = '9991'`,
        JOB_NAMES.SEND_EMAIL_VERIFICATION,
      );
      assert.strictEqual(rolledJobs.length, 0);

      // 2. Commit in transaction -> exactly 1 job with data = { userId: 9992 }
      await prisma.$transaction(async (tx) => {
        await apiQueue.send(
          JOB_NAMES.SEND_EMAIL_VERIFICATION,
          { userId: 9992 },
          { singletonKey: 'email-verification:9992', tx },
        );
      });

      const committedJobs = await prisma.$queryRawUnsafe<
        { id: string; data: { userId: number } }[]
      >(
        `SELECT id, data FROM pgboss.job WHERE name = $1 AND data->>'userId' = '9992'`,
        JOB_NAMES.SEND_EMAIL_VERIFICATION,
      );
      assert.strictEqual(committedJobs.length, 1);
      assert.deepStrictEqual(committedJobs[0].data, { userId: 9992 });

      // 3. Second send with identical singletonKey -> null
      const secondSend = await apiQueue.send(
        JOB_NAMES.SEND_EMAIL_VERIFICATION,
        { userId: 9992 },
        { singletonKey: 'email-verification:9992' },
      );
      assert.strictEqual(secondSend, null);
    });

    it('J9: queue mail.password-reset tồn tại với policy short; gửi lần 2 cùng singletonKey -> null', async () => {
      const queues = await prisma.$queryRawUnsafe<
        { name: string; policy: string }[]
      >(
        `SELECT name, policy FROM pgboss.queue WHERE name = $1`,
        JOB_NAMES.SEND_PASSWORD_RESET,
      );
      assert.strictEqual(queues.length, 1);
      assert.strictEqual(queues[0].policy, 'short');

      const firstJobId = await apiQueue.send(
        JOB_NAMES.SEND_PASSWORD_RESET,
        { userId: 9993 },
        { singletonKey: 'password-reset:9993' },
      );
      assert.ok(firstJobId);

      const jobs = await prisma.$queryRawUnsafe<
        { id: string; data: { userId: number } }[]
      >(
        `SELECT id, data FROM pgboss.job WHERE name = $1 AND data->>'userId' = '9993'`,
        JOB_NAMES.SEND_PASSWORD_RESET,
      );
      assert.strictEqual(jobs.length, 1);
      assert.deepStrictEqual(jobs[0].data, { userId: 9993 });

      const secondSend = await apiQueue.send(
        JOB_NAMES.SEND_PASSWORD_RESET,
        { userId: 9993 },
        { singletonKey: 'password-reset:9993' },
      );
      assert.strictEqual(secondSend, null);
    });

    it('J10: 2 queue account deletion tồn tại; job có startAfter trong tương lai không được fetch ngay', async () => {
      const anonQueues = await prisma.$queryRawUnsafe<
        { name: string; policy: string }[]
      >(
        `SELECT name, policy FROM pgboss.queue WHERE name = $1`,
        JOB_NAMES.ANONYMIZE_ACCOUNT,
      );
      assert.strictEqual(anonQueues.length, 1);
      assert.strictEqual(anonQueues[0].policy, 'standard');

      const mailQueues = await prisma.$queryRawUnsafe<
        { name: string; policy: string }[]
      >(
        `SELECT name, policy FROM pgboss.queue WHERE name = $1`,
        JOB_NAMES.SEND_ACCOUNT_DELETION_SCHEDULED,
      );
      assert.strictEqual(mailQueues.length, 1);
      assert.strictEqual(mailQueues[0].policy, 'short');

      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const futureJobId = await apiQueue.send(
        JOB_NAMES.ANONYMIZE_ACCOUNT,
        { requestId: 9994 },
        {
          startAfter: futureDate,
          singletonKey: 'anonymize:9994',
        },
      );
      assert.ok(futureJobId);

      const jobs = await prisma.$queryRawUnsafe<
        { id: string; state: string; start_after: Date }[]
      >(
        `SELECT id, state, start_after FROM pgboss.job WHERE id = $1::uuid`,
        futureJobId,
      );
      assert.strictEqual(jobs.length, 1);
      assert.strictEqual(jobs[0].state, 'created');
      assert.ok(new Date(jobs[0].start_after).getTime() > Date.now());

      const fetched = await workerBoss.fetch(JOB_NAMES.ANONYMIZE_ACCOUNT);
      assert.strictEqual(fetched.length, 0);
    });

    it('J11: queue privacy.data-export tồn tại; schedule privacy.purge-expired-exports được đăng ký khi worker boot', async () => {
      const exportQueues = await prisma.$queryRawUnsafe<
        { name: string; policy: string }[]
      >(
        `SELECT name, policy FROM pgboss.queue WHERE name = $1`,
        JOB_NAMES.DATA_EXPORT,
      );
      assert.strictEqual(exportQueues.length, 1);
      assert.strictEqual(exportQueues[0].policy, 'standard');

      const schedules = await prisma.$queryRawUnsafe<
        { name: string; cron: string }[]
      >(
        `SELECT name, cron FROM pgboss.schedule WHERE name = $1`,
        JOB_NAMES.PURGE_EXPIRED_EXPORTS,
      );
      assert.strictEqual(schedules.length, 1);
      assert.strictEqual(schedules[0].cron, '0 * * * *');
    });

    it('J7: app.close() dừng pg-boss', async () => {
      const apiBoss = apiApp.get<PgBoss>(PG_BOSS_INSTANCE);
      const stopped = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('timeout: app.close() did not stop pg-boss')),
          10000,
        );
        apiBoss.once('stopped', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      apiAppClosed = true;
      await apiApp.close();
      await stopped;
    });
  });
});
