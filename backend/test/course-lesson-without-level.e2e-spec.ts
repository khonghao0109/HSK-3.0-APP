/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import {
  buildAnyLessonReadyWhere,
  buildLessonReadyWhere,
} from '../src/common/policies/lesson-readiness.policy';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage.port';
import { InMemoryObjectStorageAdapter } from '../src/infrastructure/storage/in-memory-object-storage.adapter';
import { DataExportJob } from '../src/modules/user/jobs/data-export.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * ADR-009 C3b-1: a ready lesson without a Level lives only in its course.
 * Routes that predate courses never show it. Fixtures are new courses, units
 * and lessons of this suite only (no Level is created or changed except the
 * HSK4 status flip in [N6], restored at once), archived in `afterAll`.
 */
describe('Course lesson without a Level (ADR-009 C3b-1) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let lessonId: number;
  let draftUnitLessonId: number;
  let draftCourseLessonId: number;
  const createdLessonIds: number[] = [];
  const createdCourseIds: number[] = [];

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const code = `C3B1_TB_${suffix}`.replace(/-/g, '_');
  const password = 'StrongPassword123!';

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

    const course = await createCourse(code, 'published');
    const unit = await createUnit(course, 1, 'published');
    const draftUnit = await createUnit(course, 2, 'draft');
    const draftCourse = await createCourse(`${code}_DRAFT`, 'draft');
    const draftCourseUnit = await createUnit(draftCourse, 1, 'published');
    lessonId = await createLesson(unit, 'ready');
    draftUnitLessonId = await createLesson(draftUnit, 'draft-unit');
    draftCourseLessonId = await createLesson(draftCourseUnit, 'draft-course');
  });

  afterAll(async () => {
    await prisma.lesson.updateMany({
      where: { id: { in: createdLessonIds } },
      data: { status: 'archived', deletedAt: new Date() },
    });
    await prisma.course.updateMany({
      where: { id: { in: createdCourseIds } },
      data: { status: 'archived', deletedAt: new Date() },
    });
    await app.close();
  });

  it('[N1] shows the lesson in its course only', async () => {
    const learner = await register('n1');
    const course = await get(learner.token, `/learning/courses/${code}`).expect(
      200,
    );
    const ids = (
      course.body.data.units as Array<{ lessons: Array<{ id: number }> }>
    ).flatMap((unit) => unit.lessons.map((lesson) => lesson.id));
    expect(ids).toEqual([lessonId]);
    expect(course.body.data.progress).toEqual({
      completedLessons: 0,
      totalLessons: 1,
    });
  });

  it('[N2] keeps the lesson off every route that predates courses', async () => {
    const learner = await register('n2');
    await prisma.progress.create({
      data: { userId: learner.userId, lessonId, status: 'learning' },
    });
    const absent = (body: unknown) =>
      expect(JSON.stringify(body)).not.toMatch(
        new RegExp(`"(id|lessonId)":${lessonId}[,}]`),
      );

    absent((await get(learner.token, '/learning/path').expect(200)).body);
    absent((await get(learner.token, '/learning/home').expect(200)).body);
    absent((await get(learner.token, '/progress/lessons').expect(200)).body);
    // Both lists take a required levelId; scan them for every Level.
    for (const level of await prisma.level.findMany({ select: { id: true } })) {
      for (const path of ['/lessons', '/learning/lessons']) {
        for (const page of await allPages(
          learner.token,
          `${path}?levelId=${level.id}`,
        )) {
          absent(page);
        }
      }
    }
    for (const path of [
      `/lessons/${lessonId}`,
      `/learning/lessons/${lessonId}`,
      `/learning/lessons/${lessonId}/activity`,
      `/progress/lessons/${lessonId}`,
    ]) {
      await get(learner.token, path).expect(404);
    }
  });

  it('[N3] answers 404 to starting the lesson, without side effects', async () => {
    const learner = await register('n3');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${lessonId}/start`)
      .set('Authorization', `Bearer ${learner.token}`)
      .set('Idempotency-Key', `n3-${suffix}`)
      .send({})
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    await expect(
      prisma.progress.count({ where: { userId: learner.userId } }),
    ).resolves.toBe(0);
  });

  it('[N4] lets the CMS list and read the lesson', async () => {
    const admin = await register('n4');
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: emailOf('n4'), password })
      .expect(201);
    const token = login.body.data.accessToken as string;

    const pages = await allPages(token, '/admin/cms/lessons');
    const listed = pages
      .flatMap((page) => (page as { data: Array<{ id: number }> }).data)
      .find((lesson) => lesson.id === lessonId);
    expect(listed).toMatchObject({ id: lessonId, levelId: null });

    const detail = await get(token, `/admin/cms/lessons/${lessonId}`).expect(
      200,
    );
    expect(detail.body.data.lesson).toMatchObject({
      id: lessonId,
      levelId: null,
    });
  });

  it('[N5] exports a learner with Progress on the lesson', async () => {
    const learner = await register('n5');
    await prisma.progress.create({
      data: { userId: learner.userId, lessonId, status: 'learning' },
    });
    const requested = await request(app.getHttpServer())
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(202);
    const exportId = requested.body.data.exportId as number;
    const storage = app.get<InMemoryObjectStorageAdapter>(OBJECT_STORAGE);
    await expect(
      new DataExportJob(null, prisma, storage).process({ exportId }),
    ).resolves.toBe(true);
    await expect(
      prisma.dataExportJob.findUniqueOrThrow({
        where: { id: exportId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'completed' });

    const download = await get(
      learner.token,
      `/users/me/data-exports/${exportId}/download`,
    ).expect(200);
    const payload = JSON.parse(download.text) as {
      progresses: Array<{ lessonId: number }>;
    };
    expect(payload.progresses.map((row) => row.lessonId)).toEqual([lessonId]);
  });

  it('[N6] applies the four readiness cases on the database', async () => {
    const hsk4 = await prisma.level.findUnique({
      where: { code: 'HSK4' },
      select: { id: true, status: true, publishedAt: true, deletedAt: true },
    });
    const withoutLevel = [lessonId, draftUnitLessonId, draftCourseLessonId];
    const ready = async (ids: number[]) =>
      (
        await prisma.lesson.findMany({
          where: buildAnyLessonReadyWhere({ id: { in: ids } }),
          select: { id: true },
        })
      ).map((row) => row.id);

    // No Level: only the lesson whose unit and course are both public.
    await expect(ready(withoutLevel)).resolves.toEqual([lessonId]);
    // Routes that predate courses see none of them.
    await expect(
      prisma.lesson.count({
        where: buildLessonReadyWhere({ id: { in: withoutLevel } }),
      }),
    ).resolves.toBe(0);

    // With a Level: public Level ready, hidden Level not.
    const level =
      hsk4 ??
      (await prisma.level.create({
        data: {
          code: 'HSK4',
          name: 'HSK4',
          orderIndex: 4,
          minBand: 4,
          maxBand: 4,
        },
        select: { id: true, status: true, publishedAt: true, deletedAt: true },
      }));
    const levelLesson = await createLesson(null, 'with-level', level.id);
    try {
      await prisma.level.update({
        where: { id: level.id },
        data: { status: 'published', publishedAt: new Date(), deletedAt: null },
      });
      await expect(ready([levelLesson])).resolves.toEqual([levelLesson]);
      await prisma.level.update({
        where: { id: level.id },
        data: { status: 'draft' },
      });
      await expect(ready([levelLesson])).resolves.toEqual([]);
    } finally {
      await prisma.level.update({
        where: { id: level.id },
        data: {
          status: level.status,
          publishedAt: level.publishedAt,
          deletedAt: level.deletedAt,
        },
      });
    }
  });

  async function createCourse(
    courseCode: string,
    status: 'published' | 'draft',
  ) {
    const course = await prisma.course.create({
      data: {
        code: courseCode,
        kind: 'textbook',
        curriculumVersion: 'HSK_2_0',
        title: courseCode,
        orderIndex: 800_000 + Math.floor(Math.random() * 90_000),
        status,
      },
      select: { id: true },
    });
    createdCourseIds.push(course.id);
    return course.id;
  }

  async function createUnit(
    courseId: number,
    orderIndex: number,
    status: 'published' | 'draft',
  ) {
    const unit = await prisma.courseUnit.create({
      data: { courseId, orderIndex, title: `Unit ${orderIndex}`, status },
      select: { id: true },
    });
    return unit.id;
  }

  async function createLesson(
    courseUnitId: number | null,
    slug: string,
    levelId: number | null = null,
  ) {
    const lesson = await prisma.lesson.create({
      data: {
        courseUnitId,
        levelId,
        title: `No-level lesson ${slug}`,
        orderIndex: levelId === null ? 1 : 950,
        slug: `c3b1-${slug}-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
        topics: {
          create: {
            title: `Topic ${slug}`,
            content: [{ type: 'text', value: 'C3b-1' }],
            orderIndex: 1,
            status: 'published',
            publishedAt: new Date(),
          },
        },
      },
      select: { id: true },
    });
    createdLessonIds.push(lesson.id);
    return lesson.id;
  }

  async function allPages(token: string, path: string): Promise<unknown[]> {
    const pages: unknown[] = [];
    for (let page = 1; ; page += 1) {
      const response = await get(
        token,
        `${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=100`,
      ).expect(200);
      pages.push(response.body);
      const total = (
        response.body.meta as { pagination?: { totalPages: number } }
      ).pagination?.totalPages;
      if (total === undefined) throw new Error(`${path} is not paginated`);
      if (page >= total) return pages;
    }
  }

  function get(token: string, path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function emailOf(label: string) {
    return `c3b1-${label}-${suffix}@example.com`;
  }

  async function register(label: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: emailOf(label), password, name: label })
      .expect(201);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as number,
    };
  }
});
