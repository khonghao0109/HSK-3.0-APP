/// <reference types="jest" />

import { createHash, randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { InMemoryObjectStorageAdapter } from '../src/infrastructure/storage/in-memory-object-storage.adapter';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * M2.13c2 — `Word.audioId` reaches learners in the dictionary detail and the
 * lesson words, through the existing grant route `GET /media/:id/access`.
 * Synthetic lesson of this suite at a random high orderIndex of HSK7_9;
 * audio bytes are self-made, never seeddata. `afterAll` archives and deletes.
 */
describe('Word audio for learners (M2.13c2) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: InMemoryObjectStorageAdapter;
  let token: string;
  let lessonId: number;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const audio = Buffer.from(`ID3-m213c2-${suffix}`);
  const wordIds: Record<string, number> = {};
  const mediaIds: Record<string, number> = {};

  async function audioMedia(
    label: string,
    state: 'ready' | 'processing' | 'deleted',
  ): Promise<number> {
    const key = `media/m213c2/${label}-${randomUUID()}.mp3`;
    const checksum = createHash('sha256').update(audio).digest('hex');
    await storage.putPrivateObject({
      key,
      body: audio,
      contentType: 'audio/mpeg',
      checksum,
    });
    return (
      await prisma.media.create({
        data: {
          url: `urn:hsk:test:m213c2-${label}-${randomUUID()}`,
          type: 'audio',
          mimeType: 'audio/mpeg',
          size: audio.length,
          duration: 2,
          storageProvider: storage.provider,
          storageKey: key,
          checksum,
          processingStatus: state === 'processing' ? 'processing' : 'ready',
          ...(state === 'deleted' ? { deletedAt: new Date() } : {}),
        },
        select: { id: true },
      })
    ).id;
  }

  async function word(
    label: string,
    audioId: number | null,
    status: 'published' | 'draft' = 'published',
  ): Promise<number> {
    const created = await prisma.word.create({
      data: {
        hanzi: `測${label}`,
        pinyin: `ce${label}${suffix}`,
        pinyinNormalized: `ce${label}${suffix}`,
        status,
        publishedAt: status === 'published' ? new Date() : null,
        audioId,
        meanings: { create: { meaningOrder: 1, meaningVi: `nghĩa ${label}` } },
      },
      select: { id: true },
    });
    return created.id;
  }

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
    storage = app.get(InMemoryObjectStorageAdapter);

    mediaIds.ready = await audioMedia('ready', 'ready');
    mediaIds.processing = await audioMedia('processing', 'processing');
    mediaIds.deleted = await audioMedia('deleted', 'deleted');
    mediaIds.draftOnly = await audioMedia('draft', 'ready');
    wordIds.ready = await word('a', mediaIds.ready);
    wordIds.processing = await word('b', mediaIds.processing);
    wordIds.deleted = await word('c', mediaIds.deleted);
    wordIds.none = await word('d', null);
    wordIds.draft = await word('e', mediaIds.draftOnly, 'draft');

    const level = await prisma.level.upsert({
      where: { code: 'HSK7_9' },
      update: { status: 'published', deletedAt: null },
      create: {
        code: 'HSK7_9',
        name: 'HSK 7-9',
        orderIndex: 7,
        minBand: 7,
        maxBand: 9,
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    lessonId = (
      await prisma.lesson.create({
        data: {
          levelId: level.id,
          title: `M2.13c2 ${suffix}`,
          slug: `m213c2-${suffix}`,
          orderIndex: 70_000 + Math.floor(Math.random() * 20_000),
          status: 'published',
          publishedAt: new Date(),
          topics: {
            create: {
              title: 'Từ vựng',
              content: [{ type: 'vocabulary_list', value: 'lesson_words' }],
              orderIndex: 1,
              status: 'published',
              publishedAt: new Date(),
            },
          },
        },
        select: { id: true },
      })
    ).id;
    for (const [index, key] of [
      'ready',
      'processing',
      'deleted',
      'none',
    ].entries()) {
      await prisma.lessonWord.create({
        data: { lessonId, wordId: wordIds[key], orderIndex: index },
      });
    }

    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `m213c2-learner-${suffix}@example.com`,
        password: 'StrongPassword123!',
        name: 'M2.13c2 learner',
      })
      .expect(201);
    token = registered.body.data.accessToken as string;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.lesson.update({
        where: { id: lessonId },
        data: { status: 'archived', deletedAt: new Date() },
      });
      await prisma.word.deleteMany({
        where: { id: { in: Object.values(wordIds) } },
      });
    }
    if (app) await app.close();
  });

  const get = (path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);

  it('W1. the dictionary detail returns ready Word audio, else null', async () => {
    const ready = await get(`/dictionary/words/${wordIds.ready}`).expect(200);
    expect(ready.body.data.audio).toEqual({
      mediaId: mediaIds.ready,
      mimeType: 'audio/mpeg',
      duration: 2,
    });
    expect(JSON.stringify(ready.body)).not.toMatch(/storageKey|media\/m213c2/u);
    for (const key of ['processing', 'deleted', 'none']) {
      const body = (await get(`/dictionary/words/${wordIds[key]}`).expect(200))
        .body;
      expect(body.data.audio).toBeNull();
    }
  });

  it('W2. the lesson words carry the same audio rule', async () => {
    const response = await get(`/learning/lessons/${lessonId}`).expect(200);
    const byId = new Map<number, unknown>(
      (response.body.data.words as Array<{ id: number; audio: unknown }>).map(
        (row) => [row.id, row.audio],
      ),
    );
    expect(byId.get(wordIds.ready)).toEqual({
      mediaId: mediaIds.ready,
      mimeType: 'audio/mpeg',
      duration: 2,
    });
    expect(byId.get(wordIds.processing)).toBeNull();
    expect(byId.get(wordIds.deleted)).toBeNull();
    expect(byId.get(wordIds.none)).toBeNull();
    expect(JSON.stringify(response.body)).not.toMatch(
      /storageKey|media\/m213c2/u,
    );
  });

  it('W3. a learner gets a signed grant for public Word audio only', async () => {
    const grant = await get(`/media/${mediaIds.ready}/access`).expect(200);
    expect(grant.body.data.url).toMatch(
      new RegExp(
        `^/api/v1/media/${String(mediaIds.ready)}/content\\?expires=\\d+&signature=`,
        'u',
      ),
    );
    await get(`/media/${mediaIds.draftOnly}/access`).expect(403);
    await get(`/media/${mediaIds.processing}/access`).expect(404);
    await get(`/media/${mediaIds.deleted}/access`).expect(404);
  });
});
