/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { normalizeMeaning } from '../src/common/utils/normalize-meaning';
import { normalizePinyin } from '../src/common/utils/normalize-pinyin';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { dictionaryReadLimit } from '../src/modules/dictionary/dictionary.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/** M2.6b: the dictionary GET routes have their own per-route read limit. */
describe('Dictionary read limit E2E (M2.6b)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wordId: number;

  beforeAll(async () => {
    assertDisposableTestDatabase();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: createSafeValidationException,
      }),
    );
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    // Earlier suites may have spent part of the 127.0.0.1 bucket.
    await prisma.rateLimitCounter.deleteMany();

    wordId = (
      await prisma.word.create({
        data: {
          hanzi: '学习',
          pinyin: 'xué xí',
          pinyinNormalized: normalizePinyin('xué xí'),
          status: 'published',
          isPure: true,
          meanings: {
            create: [
              {
                meaningOrder: 1,
                meaningEn: 'to study',
                meaningEnNormalized: normalizeMeaning('to study'),
              },
            ],
          },
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    // Counters are keyed by 127.0.0.1; drop them so later suites start empty.
    await prisma?.rateLimitCounter.deleteMany();
    if (app) await app.close();
  });

  it('allows dictionaryReadLimit anonymous searches per minute, then 429, per route', async () => {
    const limit = dictionaryReadLimit();
    const search = () =>
      request(app.getHttpServer()).get('/api/v1/dictionary?query=xue');

    const statuses: number[] = [];
    // Sequential batches keep the count exact: every request lands before the next batch.
    for (let sent = 0; sent < limit; sent += 50) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(50, limit - sent) }, () => search()),
      );
      statuses.push(...batch.map((response) => response.status));
    }

    expect(statuses).toHaveLength(limit);
    expect(statuses.filter((status) => status !== 200)).toEqual([]);
    const blocked = await search().expect(429);
    expect(blocked.body.success).toBe(false);

    // The word route keeps its own bucket for the same IP.
    const word = await request(app.getHttpServer())
      .get(`/api/v1/dictionary/words/${wordId}`)
      .expect(200);
    expect(word.body.data.id).toBe(wordId);
  }, 30_000);
});
