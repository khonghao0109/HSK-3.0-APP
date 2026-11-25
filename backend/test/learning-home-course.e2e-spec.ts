/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * ADR-009 C3b-UI2: `/learning/home` continues in the current course. A
 * learner who never picked a course keeps the per-level pick (same fields
 * and values as before) plus an additive `currentCourse`; a learner on a
 * textbook course continues in its chained path. Fixtures are a new textbook
 * course of this suite (archived in `afterAll`); HSK3_TOPIC is upserted back
 * to published like learning-course.e2e-spec.ts and left in place. The
 * levelled lesson of [H1] lives in HSK7_9, published for the suite and put
 * back afterwards like learning-home.e2e-spec.ts.
 */
describe('Learning home by current course (ADR-009 C3b-UI2) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let levelledLessonId: number;
  let levelId: number;
  let priorLevel: {
    status: 'draft' | 'published' | 'archived';
    publishedAt: Date | null;
    deletedAt: Date | null;
  } | null = null;
  const lessonIds: number[] = [];
  const createdCourseIds: number[] = [];

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const TEXTBOOK = `UI2_TB_${suffix}`.replace(/-/g, '_');
  const password = 'StrongPassword123!';

  /** Home fields that existed before C3b-UI2. */
  const LEGACY_KEYS = [
    'continueLesson',
    'dailyGoal',
    'greetingName',
    'nextStep',
    'streakDays',
  ];

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
    await app.init();
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);

    await prisma.course.upsert({
      where: { code: 'HSK3_TOPIC' },
      update: { status: 'published', publishedAt: new Date(), deletedAt: null },
      create: {
        code: 'HSK3_TOPIC',
        kind: 'topic',
        curriculumVersion: 'HSK_3_0',
        title: 'Chủ đề HSK 3.0',
        orderIndex: 1,
        status: 'published',
        publishedAt: new Date(),
      },
    });

    priorLevel = await prisma.level.findUnique({
      where: { code: 'HSK7_9' },
      select: { status: true, publishedAt: true, deletedAt: true },
    });
    levelId = (
      await prisma.level.upsert({
        where: { code: 'HSK7_9' },
        update: {
          status: 'published',
          publishedAt: new Date(),
          deletedAt: null,
        },
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
    levelledLessonId = await createLesson(null, 1, levelId);

    const course = await prisma.course.create({
      data: {
        code: TEXTBOOK,
        kind: 'textbook',
        curriculumVersion: 'HSK_2_0',
        title: `Giáo trình ${suffix}`,
        orderIndex: 700_000 + Math.floor(Math.random() * 90_000),
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    createdCourseIds.push(course.id);
    for (const [orderIndex, count] of [
      [1, 2],
      [2, 1],
    ] as const) {
      const unit = await prisma.courseUnit.create({
        data: {
          courseId: course.id,
          orderIndex,
          title: `Cấp ${orderIndex}`,
          status: 'published',
        },
        select: { id: true },
      });
      for (let index = 1; index <= count; index += 1) {
        lessonIds.push(await createLesson(unit.id, index));
      }
    }
  });

  afterAll(async () => {
    // A failed beforeAll must not stop app.close(), or jest never exits.
    try {
      if (prisma) {
        const ids = [...lessonIds, levelledLessonId].filter(
          (id): id is number => id !== undefined,
        );
        await prisma.lesson.updateMany({
          where: { id: { in: ids } },
          data: { status: 'archived', deletedAt: new Date() },
        });
        await prisma.course.updateMany({
          where: { id: { in: createdCourseIds } },
          data: { status: 'archived', deletedAt: new Date() },
        });
        if (levelId !== undefined) {
          await prisma.level.update({
            where: { id: levelId },
            data: priorLevel ?? {
              status: 'draft',
              publishedAt: null,
              deletedAt: null,
            },
          });
        }
      }
    } finally {
      await app?.close();
    }
  });

  it('[H1] keeps the per-level pick for a learner who never picked a course', async () => {
    const learner = await register('h1');
    await prisma.progress.create({
      data: {
        userId: learner.userId,
        lessonId: levelledLessonId,
        status: 'learning',
        completionPercent: 40,
        lastActivityAt: new Date(),
      },
    });

    const home = (await get(learner.token, '/learning/home').expect(200)).body
      .data;
    const path = (await get(learner.token, '/learning/path').expect(200)).body
      .data;

    // Same fields and values as before: only `currentCourse` is added.
    expect(Object.keys(home).sort()).toEqual(
      [...LEGACY_KEYS, 'currentCourse'].sort(),
    );
    expect(path.nextLesson).toMatchObject({
      lessonId: levelledLessonId,
      levelCode: 'HSK7_9',
    });
    expect(home.continueLesson).toEqual({
      ...path.nextLesson,
      completionPercent: 40,
    });
    expect(home.currentCourse).toMatchObject({
      code: 'HSK3_TOPIC',
      kind: 'topic',
      nextLesson: {
        lessonId: home.continueLesson.lessonId,
        title: home.continueLesson.title,
        slug: home.continueLesson.slug,
        position: home.continueLesson.position,
        completionPercent: 40,
      },
    });
  });

  it('[H2] continues in the first lesson not done of a textbook course', async () => {
    const learner = await register('h2');
    await request(app.getHttpServer())
      .put('/api/v1/learning/current-course')
      .set('Authorization', `Bearer ${learner.token}`)
      .send({ courseCode: TEXTBOOK })
      .expect(200);

    const first = (await get(learner.token, '/learning/home').expect(200)).body
      .data;
    expect(first.continueLesson).toBeNull();
    expect(first.currentCourse).toEqual({
      code: TEXTBOOK,
      title: `Giáo trình ${suffix}`,
      kind: 'textbook',
      progress: { completedLessons: 0, totalLessons: 3 },
      nextLesson: {
        lessonId: lessonIds[0],
        title: 'Bài 1 của Cấp 1',
        slug: `ui2-${lessonIds[0]}`,
        position: 1,
        completionPercent: 0,
      },
    });

    await prisma.progress.create({
      data: {
        userId: learner.userId,
        lessonId: lessonIds[0],
        status: 'done',
        completionPercent: 100,
        completedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
    const second = (await get(learner.token, '/learning/home').expect(200)).body
      .data;
    expect(second.continueLesson).toBeNull();
    expect(second.currentCourse.progress).toEqual({
      completedLessons: 1,
      totalLessons: 3,
    });
    expect(second.currentCourse.nextLesson).toMatchObject({
      lessonId: lessonIds[1],
      position: 2,
    });
  });

  async function createLesson(
    courseUnitId: number | null,
    index: number,
    lessonLevelId: number | null = null,
  ) {
    const unit = courseUnitId
      ? await prisma.courseUnit.findUniqueOrThrow({
          where: { id: courseUnitId },
          select: { title: true },
        })
      : { title: 'HSK7_9' };
    const lesson = await prisma.lesson.create({
      data: {
        courseUnitId,
        levelId: lessonLevelId,
        title: `Bài ${index} của ${unit.title}`,
        // A levelled lesson goes after every other lesson of HSK7_9.
        orderIndex: lessonLevelId === null ? index : 990_000,
        slug: `ui2-pending-${courseUnitId}-${index}-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
        topics: {
          create: {
            title: `Topic ${index}`,
            content: [{ type: 'text', value: 'C3b-UI2' }],
            orderIndex: 1,
            status: 'published',
            publishedAt: new Date(),
          },
        },
      },
      select: { id: true },
    });
    await prisma.lesson.update({
      where: { id: lesson.id },
      data: { slug: `ui2-${lesson.id}` },
    });
    return lesson.id;
  }

  function get(token: string, path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function register(label: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `ui2-${label}-${suffix}@example.com`,
        password,
        name: label,
      })
      .expect(201);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as number,
    };
  }
});
