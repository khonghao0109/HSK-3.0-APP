/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { normalizePinyin } from '../src/common/utils/normalize-pinyin';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';
import { envelopeMeta } from './utils/api-envelope';

type LessonDetailResponseBody = {
  success: boolean;
  data: {
    id: number;
    title: string;
    level: {
      id: number;
      name: string;
      orderIndex: number;
    };
    topics: Array<{
      id: number;
      title: string;
      content: string;
      orderIndex: number;
    }>;
    words: Array<{
      id: number;
      hanzi: string;
      pinyin: string;
      pinyinTone: string | null;
      meanings: Array<{
        en: string | null;
        vi: string | null;
      }>;
    }>;
    stories: Array<{
      id: number;
      title: string;
      content: string;
      slug: string;
    }>;
    exercises: Array<{
      id: number;
      type: string;
      prompt: string;
      content: unknown;
      version: number;
      orderIndex: number;
      media: {
        id: number;
        url: string;
        type: 'audio';
        mimeType: string | null;
        duration: number | null;
      } | null;
    }>;
  };
};

describe('Learning Lesson Detail E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const lessonSlug = `e2e-lesson-detail-${suffix}`;
  const storySlug = `e2e-story-detail-${suffix}`;
  const hanzi = `测${suffix}`;
  const pinyin = `ce ${suffix}`;
  const publicVisibilityPinyin = 'ke jian gong kai';
  const draftVisibilityPinyin = 'ke jian cao gao';
  const deletedVisibilityPinyin = 'ke jian shan chu';

  let levelId: number;
  let draftLevelId: number;
  let deletedLevelId: number;
  let lessonId: number;
  let draftLessonId: number;

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
        exceptionFactory: createSafeValidationException,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const level = await prisma.level.upsert({
      where: { code: 'HSK1' },
      update: {
        status: 'published',
        publishedAt: new Date(),
        deletedAt: null,
      },
      create: {
        name: 'HSK1',
        code: 'HSK1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
      },
      select: {
        id: true,
      },
    });
    levelId = level.id;

    const draftLevel = await prisma.level.upsert({
      where: { code: 'HSK2' },
      update: {
        status: 'draft',
        publishedAt: null,
        deletedAt: null,
      },
      create: {
        name: 'HSK2',
        code: 'HSK2',
        orderIndex: 2,
        minBand: 2,
        maxBand: 2,
        curriculumVersion: 'HSK_3_0',
      },
      select: { id: true },
    });
    draftLevelId = draftLevel.id;

    const deletedLevel = await prisma.level.upsert({
      where: { code: 'HSK3' },
      update: {
        status: 'published',
        publishedAt: new Date(),
        deletedAt: new Date(),
      },
      create: {
        name: 'HSK3',
        code: 'HSK3',
        orderIndex: 3,
        minBand: 3,
        maxBand: 3,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
        deletedAt: new Date(),
      },
      select: { id: true },
    });
    deletedLevelId = deletedLevel.id;

    const lesson = await prisma.lesson.create({
      data: {
        levelId,
        title: 'E2E Lesson Detail',
        description: 'Lesson detail e2e fixture',
        orderIndex: 1,
        slug: lessonSlug,
        status: 'published',
      },
      select: {
        id: true,
      },
    });
    lessonId = lesson.id;

    const draftLesson = await prisma.lesson.create({
      data: {
        levelId,
        title: 'Hidden Draft Lesson',
        description: 'Should not be visible in public learning API',
        orderIndex: 2,
        slug: `hidden-draft-lesson-${suffix}`,
      },
      select: {
        id: true,
      },
    });
    draftLessonId = draftLesson.id;

    await prisma.lesson.create({
      data: {
        levelId,
        title: 'Hidden Deleted Lesson',
        description: 'Should not be visible in public learning API',
        orderIndex: 3,
        slug: `hidden-deleted-lesson-${suffix}`,
        status: 'published',
        deletedAt: new Date(),
      },
    });

    await prisma.topic.createMany({
      data: [
        {
          lessonId,
          title: 'Second Topic',
          content: [
            {
              type: 'text',
              value: 'This topic should come second.',
            },
          ],
          orderIndex: 2,
          status: 'published',
        },
        {
          lessonId,
          title: 'First Topic',
          content: [
            {
              type: 'text',
              value: 'This topic should come first.',
            },
          ],
          orderIndex: 1,
          status: 'published',
        },
        {
          lessonId,
          title: 'Hidden Draft Topic',
          content: [
            {
              type: 'text',
              value: 'This draft topic should not be returned.',
            },
          ],
          orderIndex: 3,
        },
        {
          lessonId,
          title: 'Hidden Deleted Topic',
          content: [
            {
              type: 'text',
              value: 'This deleted topic should not be returned.',
            },
          ],
          orderIndex: 4,
          status: 'published',
          deletedAt: new Date(),
        },
      ],
    });
    const hiddenDraftTopic = await prisma.topic.findFirstOrThrow({
      where: { lessonId, title: 'Hidden Draft Topic' },
      select: { id: true },
    });

    await prisma.story.create({
      data: {
        levelId,
        lessonId,
        title: 'E2E Story',
        content: 'Story linked through lesson level.',
        slug: storySlug,
        status: 'published',
        orderIndex: 1,
      },
    });

    await prisma.story.createMany({
      data: [
        {
          levelId,
          title: 'Hidden Draft Story',
          content: 'This draft story should not be returned.',
          slug: `hidden-draft-story-${suffix}`,
          orderIndex: 2,
        },
        {
          levelId,
          title: 'Hidden Deleted Story',
          content: 'This deleted story should not be returned.',
          slug: `hidden-deleted-story-${suffix}`,
          orderIndex: 3,
          status: 'published',
          deletedAt: new Date(),
        },
      ],
    });

    const word = await prisma.word.create({
      data: {
        hanzi,
        pinyin,
        pinyinNormalized: normalizePinyin(pinyin),
        pinyinTone: `ce4 ${suffix}`,
        isPure: true,
        status: 'published',
        publishedAt: new Date(),
        meanings: {
          create: {
            meaningOrder: 1,
            meaningEn: 'test word',
            meaningEnNormalized: 'test word',
            meaningVi: 'tu kiem thu',
            meaningViNormalized: 'tu kiem thu',
          },
        },
        wordLevels: {
          create: {
            levelId,
          },
        },
      },
      select: {
        id: true,
      },
    });
    await prisma.lessonWord.create({
      data: {
        lessonId,
        wordId: word.id,
      },
    });

    await prisma.lessonExercise.create({
      data: {
        lessonId,
        type: 'mcq',
        prompt: 'Public prompt',
        content: {
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
        answer: { optionId: 'a' },
        explanation: 'Internal explanation',
        orderIndex: 1,
        status: 'published',
        publishedAt: new Date(),
      },
    });

    await prisma.lessonExercise.create({
      data: {
        lessonId,
        topicId: hiddenDraftTopic.id,
        type: 'mcq',
        prompt: 'Hidden exercise under draft topic',
        content: {
          options: [
            { id: 'hidden-a', text: 'A' },
            { id: 'hidden-b', text: 'B' },
          ],
        },
        answer: { optionId: 'hidden-a' },
        orderIndex: 99,
        status: 'published',
        publishedAt: new Date(),
      },
    });

    const publicAudio = await prisma.media.create({
      data: {
        url: `https://cdn.example.test/learning-public-${suffix}.mp3`,
        type: 'audio',
        mimeType: 'audio/mpeg',
        duration: 11,
        processingStatus: 'ready',
        storageProvider: 's3',
        storageKey: `private/learning-public-${suffix}.mp3`,
        checksum: `internal-${suffix}`,
        metadata: { internal: true },
      },
    });
    const quarantinedAudio = await prisma.media.create({
      data: {
        url: `https://cdn.example.test/learning-hidden-${suffix}.mp3`,
        type: 'audio',
        processingStatus: 'ready',
      },
    });
    await prisma.lessonExercise.createMany({
      data: [
        {
          lessonId,
          mediaId: publicAudio.id,
          type: 'listening_choice',
          prompt: 'Public listening prompt',
          content: {
            options: [
              { id: 'heard-a', text: 'A' },
              { id: 'heard-b', text: 'B' },
            ],
          },
          answer: { optionId: 'heard-a' },
          orderIndex: 2,
          status: 'published',
          publishedAt: new Date(),
        },
        {
          lessonId,
          mediaId: quarantinedAudio.id,
          type: 'listening_choice',
          prompt: 'Hidden quarantined listening prompt',
          content: {
            options: [
              { id: 'hidden-a', text: 'A' },
              { id: 'hidden-b', text: 'B' },
            ],
          },
          answer: { optionId: 'hidden-a' },
          orderIndex: 3,
          status: 'published',
          publishedAt: new Date(),
        },
        {
          lessonId,
          type: 'speaking_repeat',
          prompt: 'Future speaking prompt',
          content: {},
          answer: {},
          orderIndex: 4,
          status: 'draft',
        },
      ],
    });
    await prisma.media.update({
      where: { id: quarantinedAudio.id },
      data: { processingStatus: 'quarantined' },
    });

    for (const visibilityWord of [
      {
        hanzi: '可见性公开',
        pinyin: publicVisibilityPinyin,
        status: 'published' as const,
        deletedAt: null,
      },
      {
        hanzi: '可见性草稿',
        pinyin: draftVisibilityPinyin,
        status: 'draft' as const,
        deletedAt: null,
      },
      {
        hanzi: '可见性删除',
        pinyin: deletedVisibilityPinyin,
        status: 'published' as const,
        deletedAt: new Date(),
      },
    ]) {
      await prisma.word.create({
        data: {
          ...visibilityWord,
          pinyinNormalized: normalizePinyin(visibilityWord.pinyin),
          isPure: true,
          ...(visibilityWord.status === 'published'
            ? { publishedAt: new Date() }
            : {}),
          meanings: {
            create: {
              meaningOrder: 1,
              meaningEn: 'visibility fixture',
              meaningEnNormalized: 'visibility fixture',
            },
          },
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /levels returns levels', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/levels')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(
      response.body.data.some(
        (level: { id: number; name: string }) => level.id === levelId,
      ),
    ).toBe(true);
    expect(
      response.body.data.some(
        (level: { id: number }) => level.id === draftLevelId,
      ),
    ).toBe(false);
    expect(
      response.body.data.some(
        (level: { id: number }) => level.id === deletedLevelId,
      ),
    ).toBe(false);
  });

  it('GET /dictionary uses normalized pinyin and hides non-public words', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dictionary')
      .query({ query: 'Ke3 Jian4' })
      .expect(200);

    const pinyins = (response.body.data as Array<{ pinyin: string }>).map(
      (word) => word.pinyin,
    );
    expect(pinyins).toContain(publicVisibilityPinyin);
    expect(pinyins).not.toContain(draftVisibilityPinyin);
    expect(pinyins).not.toContain(deletedVisibilityPinyin);
  });

  it('GET /lessons?levelId returns lessons by level', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/lessons?levelId=${levelId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: [
        {
          id: lessonId,
          title: 'E2E Lesson Detail',
          slug: lessonSlug,
          orderIndex: 1,
        },
      ],
    });
    expect(response.body.meta.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('GET /learning/lessons supports pagination', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons?levelId=${levelId}&page=1&limit=1`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 1,
      totalPages: 1,
    });
  });

  it('GET /learning/lessons returns 400 when levelId is missing', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/learning/lessons')
      .expect(400);
  });

  it('GET /learning/lessons returns 400 when levelId is invalid', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/learning/lessons?levelId=abc')
      .expect(400);
  });

  it('GET /learning/lessons returns 400 when limit is too large', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons?levelId=${levelId}&limit=101`)
      .expect(400);
  });

  it('GET /topics?lessonId returns topics sorted by orderIndex', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/topics?lessonId=${lessonId}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(
      response.body.data.map((topic: { title: string }) => topic.title),
    ).toEqual(['First Topic', 'Second Topic']);
    expect(response.body.meta.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    });
  });

  it('GET /learning/topics?lessonId returns published topics sorted by orderIndex', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/learning/topics?lessonId=${lessonId}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([
      {
        id: expect.any(Number),
        lessonId,
        title: 'First Topic',
        content: [
          {
            type: 'text',
            value: 'This topic should come first.',
          },
        ],
        orderIndex: 1,
      },
      {
        id: expect.any(Number),
        lessonId,
        title: 'Second Topic',
        content: [
          {
            type: 'text',
            value: 'This topic should come second.',
          },
        ],
        orderIndex: 2,
      },
    ]);
  });

  it('GET /learning/topics returns 400 when lessonId is missing', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/learning/topics')
      .expect(400);
  });

  it('GET /learning/topics returns 400 when lessonId is invalid', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/learning/topics?lessonId=abc')
      .expect(400);
  });

  it('GET /stories?levelId returns stories by level', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/stories?levelId=${levelId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: [
        {
          title: 'E2E Story',
          content: 'Story linked through lesson level.',
          slug: storySlug,
        },
      ],
    });
  });

  it('GET /learning/stories?levelId returns stories by level', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/learning/stories?levelId=${levelId}`)
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: [
        {
          id: expect.any(Number),
          levelId,
          title: 'E2E Story',
          content: 'Story linked through lesson level.',
          slug: storySlug,
        },
      ],
      meta: envelopeMeta({ page: 1, limit: 20, total: 1, totalPages: 1 }),
    });
  });

  it('GET /learning/stories supports pagination', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/learning/stories?levelId=${levelId}&page=1&limit=1`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 1,
      totalPages: 1,
    });
  });

  it('GET /learning/stories returns 400 when levelId is missing', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/learning/stories')
      .expect(400);
  });

  it('GET /learning/stories returns 400 when levelId is invalid', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/learning/stories?levelId=abc')
      .expect(400);
  });

  it('GET /lessons/:id returns lesson title, level, topics, words and stories', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/lessons/${lessonId}`)
      .expect(200);

    const body = response.body as LessonDetailResponseBody;

    expect(body.success).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual([
      'exercises',
      'id',
      'level',
      'stories',
      'title',
      'topics',
      'words',
    ]);
    expect(body.data.id).toBe(lessonId);
    expect(body.data.title).toBe('E2E Lesson Detail');
    expect(body.data.level).toEqual({
      id: levelId,
      name: 'HSK1',
      orderIndex: 1,
    });

    expect(body.data.topics).toHaveLength(2);
    expect(body.data.topics.map((topic) => topic.title)).toEqual([
      'First Topic',
      'Second Topic',
    ]);

    expect(body.data.words).toHaveLength(1);
    expect(body.data.words[0]).toMatchObject({
      hanzi,
      pinyin,
      pinyinTone: `ce4 ${suffix}`,
    });
    expect(body.data.words[0].meanings).toEqual([
      {
        en: 'test word',
        vi: 'tu kiem thu',
      },
    ]);

    expect(body.data.stories).toHaveLength(1);
    expect(body.data.stories[0]).toMatchObject({
      title: 'E2E Story',
      content: 'Story linked through lesson level.',
      slug: storySlug,
    });
    expect(body.data.exercises).toEqual([
      expect.objectContaining({
        type: 'mcq',
        prompt: 'Public prompt',
        media: null,
      }),
      expect.objectContaining({
        type: 'listening_choice',
        prompt: 'Public listening prompt',
        media: {
          id: expect.any(Number),
          url: `https://cdn.example.test/learning-public-${suffix}.mp3`,
          type: 'audio',
          mimeType: 'audio/mpeg',
          duration: 11,
        },
      }),
    ]);
    expect(JSON.stringify(body.data)).not.toContain('answer');
    expect(JSON.stringify(body.data)).not.toContain('Internal explanation');
    expect(JSON.stringify(body.data)).not.toContain('storageKey');
    expect(JSON.stringify(body.data)).not.toContain('checksum');
    expect(JSON.stringify(body.data)).not.toContain('internal');
    expect(JSON.stringify(body.data)).not.toContain('quarantined');
    expect(JSON.stringify(body.data)).not.toContain('speaking_repeat');
    expect(JSON.stringify(body.data)).not.toContain(
      'Hidden exercise under draft topic',
    );
  });

  it('GET /learning/lessons/:id returns lesson title, level, topics, words and stories', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(200);

    const body = response.body as LessonDetailResponseBody;

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      id: lessonId,
      title: 'E2E Lesson Detail',
      level: {
        id: levelId,
        name: 'HSK1',
        orderIndex: 1,
      },
    });
    expect(body.data.topics).toHaveLength(2);
    expect(body.data.words).toHaveLength(1);
    expect(body.data.stories).toHaveLength(1);
  });

  it('GET /lessons/:id returns 404 when lesson does not exist', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/lessons/999999999')
      .expect(404);
  });

  it('GET /learning/lessons/:id returns 404 for draft lessons', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${draftLessonId}`)
      .expect(404);
  });

  it('GET /lessons/:id returns 400 when id is not an integer', async () => {
    await request(app.getHttpServer()).get('/api/v1/lessons/abc').expect(400);
  });
});
