/// <reference types="jest" />

import { randomBytes, randomUUID } from 'node:crypto';

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getStorageToken, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { CustomThrottlerGuard } from '../src/common/guards/custom-throttler.guard';
import { configureTrustProxy } from '../src/config/runtime-security';
import { PostgresThrottlerStorage } from '../src/infrastructure/rate-limit/postgres-throttler.storage';
import { RateLimitModule } from '../src/infrastructure/rate-limit/rate-limit.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

const TTL_MS = 60_000;
const LIMIT = 20;
const CONCURRENT_HITS = 50;

@Controller()
class ProbeController {
  @Get('probe')
  probe() {
    return { ok: true };
  }
}

/** One backend replica: its own Nest app and Prisma pool, shared database. */
async function createReplica(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        load: [
          () => ({
            app: { trustProxyHops: 1 },
            jwt: { secrets: {}, activeKid: 'none' },
          }),
        ],
      }),
      PrismaModule,
      ThrottlerModule.forRootAsync({
        imports: [RateLimitModule],
        inject: [PostgresThrottlerStorage],
        useFactory: (storage: PostgresThrottlerStorage) => ({
          throttlers: [{ ttl: TTL_MS, limit: LIMIT }],
          storage,
        }),
      }),
    ],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: CustomThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureTrustProxy(app, app.get(ConfigService));
  await app.listen(0, '127.0.0.1');
  return app;
}

describe('PostgreSQL rate limit storage (e2e)', () => {
  let replicas: INestApplication[];
  let storage: PostgresThrottlerStorage;
  let prisma: PrismaService;
  const keyPrefix = `h4b-e2e-${randomUUID()}`;

  beforeAll(async () => {
    assertDisposableTestDatabase();
    replicas = [await createReplica(), await createReplica()];
    storage = replicas[0].get(PostgresThrottlerStorage);
    prisma = replicas[0].get(PrismaService);
  });

  afterAll(async () => {
    await prisma?.rateLimitCounter.deleteMany({
      where: { key: { startsWith: keyPrefix } },
    });
    await Promise.all((replicas ?? []).map((replica) => replica.close()));
  });

  const counter = (key: string) =>
    prisma.rateLimitCounter.findUniqueOrThrow({ where: { key } });

  it('never admits more than the limit under concurrent increments', async () => {
    const key = `${keyPrefix}-concurrent`;

    const records = await Promise.all(
      Array.from({ length: CONCURRENT_HITS }, () =>
        storage.increment(key, TTL_MS, LIMIT, TTL_MS, 'default'),
      ),
    );

    const admitted = records.filter((record) => !record.isBlocked);
    expect(admitted).toHaveLength(LIMIT);
    expect(new Set(admitted.map((record) => record.totalHits))).toEqual(
      new Set(Array.from({ length: LIMIT }, (_, index) => index + 1)),
    );
    expect(records.filter((record) => record.isBlocked)).toHaveLength(
      CONCURRENT_HITS - LIMIT,
    );
    await expect(counter(key)).resolves.toMatchObject({ points: LIMIT + 1 });
  });

  it('enforces one limit across replicas for concurrent HTTP requests', async () => {
    const clientIp = `2001:db8::${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}`;

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_HITS }, (_, index) =>
        request(replicas[index % replicas.length].getHttpServer())
          .get('/probe')
          .set('X-Forwarded-For', clientIp),
      ),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(LIMIT);
    expect(statuses.filter((status) => status === 429)).toHaveLength(
      CONCURRENT_HITS - LIMIT,
    );
  });

  it('keeps blocked hits uncounted and restarts the window after expiry', async () => {
    const key = `${keyPrefix}-window`;
    for (let hit = 1; hit <= 2; hit += 1) {
      await expect(
        storage.increment(key, TTL_MS, 2, 5_000, 'default'),
      ).resolves.toMatchObject({ totalHits: hit, isBlocked: false });
    }

    const blocked = await storage.increment(key, TTL_MS, 2, 5_000, 'default');
    expect(blocked).toMatchObject({ totalHits: 3, isBlocked: true });
    expect(blocked.timeToBlockExpire).toBeGreaterThan(0);
    expect(blocked.timeToBlockExpire).toBeLessThanOrEqual(5);
    const blockedRow = await counter(key);

    await storage.increment(key, TTL_MS, 2, 5_000, 'default');
    await expect(counter(key)).resolves.toEqual(blockedRow);

    await prisma.$executeRaw`
      UPDATE "RateLimitCounter"
      SET "expireAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
      WHERE "key" = ${key}
    `;
    await expect(
      storage.increment(key, TTL_MS, 2, 5_000, 'default'),
    ).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('purges expired counters and keeps live ones', async () => {
    const expired = `${keyPrefix}-expired`;
    const live = `${keyPrefix}-live`;
    await prisma.$executeRaw`
      INSERT INTO "RateLimitCounter" ("key", "points", "expireAt") VALUES
        (${expired}, 3, CURRENT_TIMESTAMP - INTERVAL '1 second'),
        (${live}, 3, CURRENT_TIMESTAMP + INTERVAL '60 seconds')
    `;

    await expect(storage.purgeExpired()).resolves.toBeGreaterThanOrEqual(1);

    await expect(
      prisma.rateLimitCounter.findMany({
        where: { key: { in: [expired, live] } },
        select: { key: true },
      }),
    ).resolves.toEqual([{ key: live }]);
  });

  it('wires the application throttler to PostgreSQL storage', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    try {
      expect(moduleRef.get(getStorageToken())).toBeInstanceOf(
        PostgresThrottlerStorage,
      );
    } finally {
      await moduleRef.close();
    }
  });
});
