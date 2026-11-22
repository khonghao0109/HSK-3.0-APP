/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { dictionaryReadLimit } from '../src/modules/dictionary/dictionary.controller';
import { MAKEMEAHANZI_SOURCE_CODE } from '../src/modules/dictionary-data/hanzi-strokes';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/** G2d: GET /dictionary/characters/strokes. */
describe('Dictionary character strokes E2E (G2d)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const chars = ['鑫', '燚'];
  const strokeData = {
    strokes: ['M 0 0 L 9 9 Z', 'M 1 0 L 1 9 Z'],
    medians: [
      [
        [0, 0],
        [9, 9],
      ],
      [
        [1, 0],
        [1, 9],
      ],
    ],
  };
  const url = (query: string) =>
    request(app.getHttpServer()).get(
      `/api/v1/dictionary/characters/strokes${query}`,
    );
  const q = (hanzi: string) => url(`?hanzi=${encodeURIComponent(hanzi)}`);

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
    await prisma.rateLimitCounter.deleteMany();
    await prisma.character.deleteMany({ where: { hanzi: { in: chars } } });
    const source = await prisma.dataSource.upsert({
      where: { code: MAKEMEAHANZI_SOURCE_CODE },
      update: {},
      create: {
        code: MAKEMEAHANZI_SOURCE_CODE,
        name: 'Make Me a Hanzi',
        version: 'test',
        license: 'Arphic Public License',
        referenceUrl: 'https://github.com/skishore/makemeahanzi',
      },
    });
    await prisma.character.create({
      data: {
        hanzi: '鑫',
        strokeCount: 2,
        strokeData,
        dataSourceId: source.id,
      },
    });
    await prisma.character.create({ data: { hanzi: '燚' } });
  });

  afterAll(async () => {
    await prisma?.character.deleteMany({ where: { hanzi: { in: chars } } });
    await prisma?.rateLimitCounter.deleteMany();
    if (app) await app.close();
  });

  it('returns strokes in request order, nulls for missing data, and distinct sources', async () => {
    const response = await q('鑫燚𠀀鑫').expect(200);
    expect(response.body.success).toBe(true);
    const { characters, sources } = response.body.data;
    expect(characters).toEqual([
      {
        hanzi: '鑫',
        strokeCount: 2,
        ...strokeData,
        sourceCode: MAKEMEAHANZI_SOURCE_CODE,
      },
      {
        hanzi: '燚',
        strokeCount: null,
        strokes: null,
        medians: null,
        sourceCode: null,
      },
      {
        hanzi: '𠀀',
        strokeCount: null,
        strokes: null,
        medians: null,
        sourceCode: null,
      },
    ]);
    expect(sources).toHaveLength(1);
    expect(Object.keys(sources[0]).sort()).toEqual([
      'attribution',
      'code',
      'license',
      'name',
      'referenceUrl',
      'version',
    ]);
    expect(sources[0].code).toBe(MAKEMEAHANZI_SOURCE_CODE);
    expect(sources[0]).not.toHaveProperty('id');
  });

  it('sets Cache-Control: public, max-age=86400', async () => {
    const response = await q('鑫').expect(200);
    expect(response.headers['cache-control']).toBe('public, max-age=86400');
  });

  const rejects = (name: string, query: string) =>
    it(`400 when ${name}`, async () => {
      const response = await url(query).expect(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    });
  rejects('hanzi is missing', '');
  rejects('hanzi is empty', '?hanzi=');
  rejects(
    'hanzi is repeated',
    `?hanzi=${encodeURIComponent('鑫')}&hanzi=${encodeURIComponent('燚')}`,
  );
  rejects(
    'more than 16 raw characters',
    `?hanzi=${encodeURIComponent('鑫'.repeat(17))}`,
  );
  rejects(
    'a non-Han character is present',
    `?hanzi=${encodeURIComponent('鑫a')}`,
  );
  rejects(
    'more than 8 distinct characters',
    `?hanzi=${encodeURIComponent('一二三四五六七八九')}`,
  );

  it('allows dictionaryReadLimit requests per minute, then 429', async () => {
    await prisma.rateLimitCounter.deleteMany();
    const limit = dictionaryReadLimit();
    const statuses: number[] = [];
    for (let sent = 0; sent < limit; sent += 50) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(50, limit - sent) }, () => q('鑫')),
      );
      statuses.push(...batch.map((response) => response.status));
    }
    expect(statuses.filter((status) => status !== 200)).toEqual([]);
    await q('鑫').expect(429);
  }, 30_000);
});
