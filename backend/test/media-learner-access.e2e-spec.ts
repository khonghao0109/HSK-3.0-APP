/// <reference types="jest" />

import { createHash, randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { InMemoryObjectStorageAdapter } from '../src/infrastructure/storage/in-memory-object-storage.adapter';
import { mediaContentIpLimit } from '../src/modules/media/media-content-ip-throttle';
import { mediaContentGrantLimit } from '../src/modules/media/media-content-throttle';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/** M2.B12: learner media grants, Range and per-grant/per-IP content limits. */
describe('Learner media access E2E (M2.B12)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: InMemoryObjectStorageAdapter;
  let token: string;
  let publishedLevelId: number;
  let readyMediaId: number;
  const deniedMedia: Record<string, number> = {};
  const audio = Buffer.from('ID3-m2b12-synthetic-audio-bytes');

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

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

    publishedLevelId = (
      await prisma.level.upsert({
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
      })
    ).id;
    readyMediaId = await exerciseMedia('ready', publishedLevelId);
    deniedMedia['a lesson without a published topic or story'] =
      await exerciseMedia('no-block', publishedLevelId, { withStory: false });
    deniedMedia['a draft listening exercise'] = await exerciseMedia(
      'draft-exercise',
      publishedLevelId,
      { draft: true },
    );

    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `m2b12-learner-${suffix}@example.com`,
        password: 'StrongPassword123!',
        name: 'M2.B12 learner',
      })
      .expect(201);
    token = registered.body.data.accessToken as string;
  });

  afterAll(async () => {
    // The content-route counters below are keyed by 127.0.0.1; drop them so
    // later suites start from an empty per-IP ceiling.
    await prisma?.rateLimitCounter.deleteMany();
    if (app) await app.close();
  });

  it('grants a learner 300-second access to media of a ready public exercise', async () => {
    const before = Math.floor(Date.now() / 1000);
    const grant = await access(readyMediaId).expect(200);
    const url = new URL(grant.body.data.url as string, 'http://local.test');
    const expires = Number(url.searchParams.get('expires'));

    expect(expires).toBeGreaterThanOrEqual(before + 300);
    expect(expires).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 300);
  });

  it.each([
    ['a draft Level', { status: 'draft' as const }],
    ['a soft-deleted Level', { deletedAt: new Date() }],
  ])(
    'refuses a learner grant while the exercise sits in %s',
    async (_label, change) => {
      // Level codes are fixed by Level_code_band_check, so the shared HSK7_9
      // row is flipped and restored instead of creating a new Level.
      await prisma.level.update({
        where: { id: publishedLevelId },
        data: change,
      });
      try {
        await access(readyMediaId).expect(403);
      } finally {
        await prisma.level.update({
          where: { id: publishedLevelId },
          data: { status: 'published', deletedAt: null },
        });
      }
      await access(readyMediaId).expect(200);
    },
  );

  it.each([
    'a lesson without a published topic or story',
    'a draft listening exercise',
  ])('refuses a learner grant for media used only by %s', async (label) => {
    const response = await access(deniedMedia[label]).expect(403);

    expect(response.body.success).toBe(false);
  });

  it('serves a single byte range as 206 and an unsatisfiable one as JSON 416', async () => {
    const url = (await access(readyMediaId).expect(200)).body.data
      .url as string;

    const partial = await request(app.getHttpServer())
      .get(url)
      .set('Range', 'bytes=0-2')
      .responseType('blob')
      .expect(206);
    expect(partial.headers['content-range']).toBe(`bytes 0-2/${audio.length}`);
    expect(partial.headers['content-length']).toBe('3');
    expect(partial.headers['accept-ranges']).toBe('bytes');
    expect(partial.headers['content-type']).toBe('audio/mpeg');
    expect(partial.headers['cache-control']).toBe('private, no-store');
    expect((partial.body as Buffer).toString()).toBe('ID3');

    const whole = await request(app.getHttpServer())
      .get(url)
      .responseType('blob')
      .expect(200);
    expect(whole.headers['accept-ranges']).toBe('bytes');
    expect((whole.body as Buffer).equals(audio)).toBe(true);

    const unsatisfiable = await request(app.getHttpServer())
      .get(url)
      .set('Range', `bytes=${audio.length}-`)
      .expect(416);
    expect(unsatisfiable.headers['content-range']).toBe(
      `bytes */${audio.length}`,
    );
    expect(unsatisfiable.headers['content-type']).toMatch(
      /^application\/json/u,
    );
    expect(unsatisfiable.headers['cache-control']).toBe('private, no-store');
    expect(unsatisfiable.body).toMatchObject({
      success: false,
      error: { code: 'MEDIA_RANGE_NOT_SATISFIABLE' },
    });

    await request(app.getHttpServer())
      .get(
        url.replace(/signature=[a-f0-9]{64}/u, `signature=${'e'.repeat(64)}`),
      )
      .set('Range', 'bytes=0-2')
      .expect(403);
  });

  it('limits one forged grant, then the per-IP ceiling, without touching the access route', async () => {
    const expires = Math.floor(Date.now() / 1000) + 300;
    const content = (signature: string) =>
      request(app.getHttpServer()).get(
        `/api/v1/media/${readyMediaId}/content?expires=${expires}&signature=${signature}`,
      );

    // One grant: its own bucket (NODE_ENV=test limit).
    const replayed = 'f'.repeat(64);
    const grantStatuses = await burst(mediaContentGrantLimit(), () =>
      content(replayed),
    );
    expect(grantStatuses.every((status) => status === 403)).toBe(true);
    await content(replayed).expect(429);
    // A different grant from the same IP is still served.
    await content('0'.repeat(64)).expect(403);

    // Distinct forged grants each get a fresh grant bucket; only the per-IP
    // ceiling can stop them. Earlier tests in this file also hit the route, so
    // the switch from 403 to 429 must come at or before the ceiling.
    const ipStatuses = await burst(
      mediaContentIpLimit() - mediaContentGrantLimit(),
      (index) =>
        content(createHash('sha256').update(`forged-${index}`).digest('hex')),
    );
    // Batches run 50 at a time, so 403/429 can interleave inside the last
    // batch; count instead of relying on order.
    const served = ipStatuses.filter((status) => status === 403).length;
    expect(ipStatuses.every((s) => s === 403 || s === 429)).toBe(true);
    expect(ipStatuses).toContain(429);
    expect(mediaContentGrantLimit() + 1 + served).toBeLessThanOrEqual(
      mediaContentIpLimit(),
    );
    const blocked = await content('1'.repeat(64)).expect(429);
    expect(blocked.body.success).toBe(false);

    // The access route keeps its own per-user bucket.
    await access(readyMediaId).expect(200);
  }, 300_000);

  function access(mediaId: number) {
    return request(app.getHttpServer())
      .get(`/api/v1/media/${mediaId}/access`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function burst(
    count: number,
    send: (index: number) => request.Test,
  ): Promise<number[]> {
    const statuses: number[] = [];
    for (let start = 0; start < count; start += 50) {
      const batch = Array.from(
        { length: Math.min(50, count - start) },
        (_unused, offset) => send(start + offset),
      );
      for (const response of await Promise.all(batch)) {
        statuses.push(response.status);
      }
    }
    return statuses;
  }

  async function exerciseMedia(
    label: string,
    levelId: number,
    options: {
      withStory?: boolean;
      draft?: boolean;
    } = {},
  ): Promise<number> {
    const key = `media/m2b12/${label}-${randomUUID()}.mp3`;
    const checksum = createHash('sha256').update(audio).digest('hex');
    await storage.putPrivateObject({
      key,
      body: audio,
      contentType: 'audio/mpeg',
      checksum,
    });
    const media = await prisma.media.create({
      data: {
        url: `urn:hsk:test:m2b12-${label}-${randomUUID()}`,
        type: 'audio',
        mimeType: 'audio/mpeg',
        size: audio.length,
        storageProvider: storage.provider,
        storageKey: key,
        checksum,
        processingStatus: 'ready',
      },
    });
    const lesson = await prisma.lesson.create({
      data: {
        levelId,
        title: `M2.B12 ${label}`,
        orderIndex: 800_000 + Math.floor(Math.random() * 100_000),
        slug: `m2b12-${label}-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
        ...(options.withStory === false
          ? {}
          : {
              stories: {
                create: {
                  levelId,
                  title: `M2.B12 story ${label}`,
                  slug: `m2b12-story-${label}-${suffix}`,
                  content: {},
                  status: 'published',
                  publishedAt: new Date(),
                },
              },
            }),
      },
    });
    await prisma.lessonExercise.create({
      data: {
        lessonId: lesson.id,
        mediaId: media.id,
        type: 'listening_choice',
        prompt: 'Choose the word you hear',
        content: {
          options: [
            { id: 'a', text: '你好' },
            { id: 'b', text: '再见' },
          ],
        },
        answer: { optionId: 'a' },
        orderIndex: 1,
        // Media may only sit on listening_choice (LessonExercise_media_type_scope_check),
        // so a non-public type cannot reference media; a draft exercise is the reachable case.
        ...(options.draft
          ? { status: 'draft' as const }
          : { status: 'published' as const, publishedAt: new Date() }),
      },
    });
    return media.id;
  }
});
