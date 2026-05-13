/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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
        en: string;
        vi: string | null;
      }>;
    }>;
    stories: Array<{
      id: number;
      title: string;
      content: string;
      slug: string;
    }>;
  };
};

describe('Learning Lesson Detail E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const levelName = `E2E HSK Lesson Detail ${suffix}`;
  const lessonSlug = `e2e-lesson-detail-${suffix}`;
  const storySlug = `e2e-story-detail-${suffix}`;
  const hanzi = `测${suffix}`;
  const pinyin = `ce ${suffix}`;

  let levelId: number;
  let lessonId: number;
  let wordId: number;

  beforeAll(async () => {
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
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const level = await prisma.level.create({
      data: {
        name: levelName,
        orderIndex: 9000,
      },
      select: {
        id: true,
      },
    });
    levelId = level.id;

    const lesson = await prisma.lesson.create({
      data: {
        levelId,
        title: 'E2E Lesson Detail',
        description: 'Lesson detail e2e fixture',
        orderIndex: 1,
        slug: lessonSlug,
      },
      select: {
        id: true,
      },
    });
    lessonId = lesson.id;

    await prisma.topic.createMany({
      data: [
        {
          lessonId,
          title: 'Second Topic',
          content: 'This topic should come second.',
          orderIndex: 2,
        },
        {
          lessonId,
          title: 'First Topic',
          content: 'This topic should come first.',
          orderIndex: 1,
        },
      ],
    });

    await prisma.story.create({
      data: {
        levelId,
        title: 'E2E Story',
        content: 'Story linked through lesson level.',
        slug: storySlug,
      },
    });

    const word = await prisma.word.create({
      data: {
        hanzi,
        pinyin,
        pinyinTone: `ce4 ${suffix}`,
        isPure: true,
        meanings: {
          create: {
            meaningEn: 'test word',
            meaningVi: 'tu kiem thu',
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
    wordId = word.id;

    await prisma.lessonWord.create({
      data: {
        lessonId,
        wordId,
      },
    });
  });

  afterAll(async () => {
    await prisma.lessonWord.deleteMany({
      where: {
        lessonId,
      },
    });
    await prisma.wordLevel.deleteMany({
      where: {
        wordId,
      },
    });
    await prisma.wordMeaning.deleteMany({
      where: {
        wordId,
      },
    });
    await prisma.topic.deleteMany({
      where: {
        lessonId,
      },
    });
    await prisma.story.deleteMany({
      where: {
        levelId,
      },
    });
    await prisma.lesson.deleteMany({
      where: {
        id: lessonId,
      },
    });
    await prisma.word.deleteMany({
      where: {
        id: wordId,
      },
    });
    await prisma.level.deleteMany({
      where: {
        id: levelId,
      },
    });
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
  });

  it('GET /topics?lessonId returns topics sorted by orderIndex', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/topics?lessonId=${lessonId}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.map((topic: { title: string }) => topic.title))
      .toEqual(['First Topic', 'Second Topic']);
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

  it('GET /lessons/:id returns lesson title, level, topics, words and stories', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/lessons/${lessonId}`)
      .expect(200);

    const body = response.body as LessonDetailResponseBody;

    expect(body.success).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual([
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
      name: levelName,
      orderIndex: 9000,
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
  });

  it('GET /lessons/:id returns 404 when lesson does not exist', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/lessons/999999999')
      .expect(404);
  });

  it('GET /lessons/:id returns 400 when id is not an integer', async () => {
    await request(app.getHttpServer()).get('/api/v1/lessons/abc').expect(400);
  });
});
