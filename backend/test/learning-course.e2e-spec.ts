/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type LevelState = {
  status: 'draft' | 'published' | 'archived';
  publishedAt: Date | null;
  deletedAt: Date | null;
  name: string;
};

type CourseLesson = { id: number; state: string; position: number };
type CourseUnitBody = {
  orderIndex: number;
  title: string;
  gradeNumber: number | null;
  volume: string | null;
  levelCode: string | null;
  lessons: CourseLesson[];
};

/**
 * ADR-009 C3a. Lessons here sit in HSK4 at orderIndex >= 900, after any
 * HSK4 lesson another suite (onboarding) may leave published. Textbook
 * lessons are created after [E1] so the per-level comparison does not mix
 * them in. `afterAll` withdraws these lessons, restores HSK4 and archives the
 * textbook and draft courses; HSK3_TOPIC stays.
 */
describe('Learner courses and enrollment (ADR-009 C3a) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hsk4: number;
  let topicCourseId: number;
  let topicLessonIds: number[];
  let textbookLessonIds: number[];
  let hiddenLessonId: number;
  const priorLevels = new Map<number, LevelState | null>();
  const createdLessonIds: number[] = [];
  const createdCourseIds: number[] = [];

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const TEXTBOOK = `C3A_TB_${suffix}`.replace(/-/g, '_');
  const DRAFT = `C3A_DRAFT_${suffix}`.replace(/-/g, '_');
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

    hsk4 = await publishLevel('HSK4', 4);
    topicLessonIds = [
      await createLesson(hsk4, 901, 'topic-a'),
      await createLesson(hsk4, 902, 'topic-b'),
      await createLesson(hsk4, 903, 'topic-c'),
    ];

    // HSK3_TOPIC as C2 backfills it: one unit per Level, every lesson in its
    // Level's unit. Upserted back to published so an archived or deleted copy
    // from an earlier run still works; left in place afterwards, since the C2
    // backfill creates it too. Units are published explicitly: whether a
    // lesson is visible is then decided by the Level, as on /learning/path.
    const topic = await prisma.course.upsert({
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
      select: { id: true },
    });
    topicCourseId = topic.id;
    for (const level of await prisma.level.findMany({
      select: { id: true, orderIndex: true, name: true },
    })) {
      const existingUnit = await prisma.courseUnit.findFirst({
        where: { courseId: topic.id, levelId: level.id },
        select: { id: true },
      });
      const unit = existingUnit
        ? await prisma.courseUnit.update({
            where: { id: existingUnit.id },
            data: { status: 'published', deletedAt: null },
            select: { id: true },
          })
        : await prisma.courseUnit.create({
            data: {
              courseId: topic.id,
              levelId: level.id,
              orderIndex: level.orderIndex,
              title: level.name,
              status: 'published',
            },
            select: { id: true },
          });
      await prisma.lesson.updateMany({
        where: { levelId: level.id, courseUnitId: null },
        data: { courseUnitId: unit.id },
      });
    }
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
    for (const [id, state] of priorLevels) {
      await prisma.level.update({
        where: { id },
        data: state ?? { status: 'draft', publishedAt: null, deletedAt: null },
      });
    }
    await app.close();
  });

  describe('HSK3_TOPIC against the per-level path', () => {
    it('[E1] gives every lesson the same state as GET /learning/path', async () => {
      const learner = await register('e1');
      await markDone(learner.userId, topicLessonIds[0]);
      await prisma.progress.create({
        data: { userId: learner.userId, lessonId: topicLessonIds[2] },
      });

      const path = await get(learner.token, '/learning/path').expect(200);
      const pathStates = new Map<number, string>();
      for (const level of path.body.data.levels as Array<{
        lessons: CourseLesson[];
      }>) {
        for (const lesson of level.lessons)
          pathStates.set(lesson.id, lesson.state);
      }

      const course = await get(
        learner.token,
        '/learning/courses/HSK3_TOPIC',
      ).expect(200);
      const courseStates = new Map<number, string>();
      for (const unit of course.body.data.units as CourseUnitBody[]) {
        for (const lesson of unit.lessons)
          courseStates.set(lesson.id, lesson.state);
      }

      expect(courseStates).toEqual(pathStates);
      // Other suites may leave earlier HSK4 lessons, so only order-free facts here;
      // which open lesson is `current` is covered by the policy unit tests.
      expect(courseStates.get(topicLessonIds[0])).toBe('done');
      expect(courseStates.get(topicLessonIds[1])).not.toBe('locked');
      expect(courseStates.get(topicLessonIds[2])).not.toBe('locked');
      const hsk4 = (course.body.data.units as CourseUnitBody[]).find(
        (unit) => unit.levelCode === 'HSK4',
      );
      expect(hsk4).toMatchObject({ gradeNumber: null, volume: null });
    });
  });

  describe('textbook course', () => {
    beforeAll(async () => {
      const course = await prisma.course.create({
        data: {
          code: TEXTBOOK,
          kind: 'textbook',
          curriculumVersion: 'HSK_2_0',
          title: 'Giáo trình thử',
          description: 'C3a',
          orderIndex: 900_000 + Math.floor(Math.random() * 90_000),
          status: 'published',
          publishedAt: new Date(),
          units: {
            create: [
              {
                orderIndex: 2,
                title: 'Quyển 1 下',
                gradeNumber: 1,
                volume: 'lower',
                status: 'published',
              },
              {
                orderIndex: 1,
                title: 'Quyển 1 上',
                gradeNumber: 1,
                volume: 'upper',
                status: 'published',
              },
              { orderIndex: 3, title: 'Nháp', status: 'draft' },
            ],
          },
        },
        select: { id: true, units: { select: { id: true, orderIndex: true } } },
      });
      createdCourseIds.push(course.id);
      const unit = (order: number) =>
        course.units.find((u) => u.orderIndex === order)?.id ?? 0;
      textbookLessonIds = [
        await createLesson(hsk4, 911, 'tb-a', unit(1)),
        await createLesson(hsk4, 912, 'tb-b', unit(1)),
        await createLesson(hsk4, 913, 'tb-c', unit(2)),
      ];
      hiddenLessonId = await createLesson(hsk4, 914, 'tb-hidden', unit(3));
      const draft = await prisma.course.create({
        data: {
          code: DRAFT,
          kind: 'textbook',
          title: 'Draft',
          orderIndex: 900_000 + Math.floor(Math.random() * 90_000) + 1,
        },
        select: { id: true },
      });
      createdCourseIds.push(draft.id);
    });

    it('[E2] requires a login on every course route', async () => {
      const server = app.getHttpServer();
      await request(server).get('/api/v1/learning/courses').expect(401);
      await request(server)
        .get(`/api/v1/learning/courses/${TEXTBOOK}`)
        .expect(401);
      await request(server)
        .post(`/api/v1/learning/courses/${TEXTBOOK}/enrollment`)
        .expect(401);
      await request(server)
        .delete(`/api/v1/learning/courses/${TEXTBOOK}/enrollment`)
        .expect(401);
      await request(server)
        .put('/api/v1/learning/current-course')
        .send({ courseCode: TEXTBOOK })
        .expect(401);
    });

    it('[E3] answers 404 NOT_FOUND alike for a draft or unknown course', async () => {
      const learner = await register('e3');
      for (const code of [DRAFT, `NOPE_${suffix}`]) {
        const calls = [
          get(learner.token, `/learning/courses/${code}`),
          send(learner.token, 'post', `/learning/courses/${code}/enrollment`),
          send(learner.token, 'delete', `/learning/courses/${code}/enrollment`),
          send(learner.token, 'put', '/learning/current-course', {
            courseCode: code,
          }),
        ];
        for (const call of calls) {
          const response = await call.expect(404);
          expect(response.body.error).toEqual({
            code: 'NOT_FOUND',
            message: 'Course not found.',
          });
        }
      }
      await expect(
        prisma.courseEnrollment.count({ where: { userId: learner.userId } }),
      ).resolves.toBe(0);
      const list = await get(learner.token, '/learning/courses').expect(200);
      expect(
        (list.body.data.courses as Array<{ code: string }>).map((c) => c.code),
      ).not.toContain(DRAFT);
    });

    it('[E4] lists courses with the default current course and progress, without writing', async () => {
      const learner = await register('e4');
      await markDone(learner.userId, textbookLessonIds[0]);
      const before = await snapshot(learner.userId);

      const response = await get(learner.token, '/learning/courses').expect(
        200,
      );
      expect(response.headers['cache-control']).toBe('no-store');
      const courses = response.body.data.courses as Array<{
        code: string;
        enrolled: boolean;
        isCurrent: boolean;
        progress: { completedLessons: number; totalLessons: number };
      }>;
      expect(courses.map((c) => c.code)).toEqual(
        expect.arrayContaining(['HSK3_TOPIC', TEXTBOOK]),
      );
      expect(courses.filter((c) => c.isCurrent).map((c) => c.code)).toEqual([
        'HSK3_TOPIC',
      ]);
      expect(courses.find((c) => c.code === TEXTBOOK)).toMatchObject({
        kind: 'textbook',
        curriculumVersion: 'HSK_2_0',
        title: 'Giáo trình thử',
        description: 'C3a',
        enrolled: false,
        isCurrent: false,
        progress: { completedLessons: 1, totalLessons: 3 },
      });
      await get(learner.token, `/learning/courses/${TEXTBOOK}`).expect(200);
      await expect(snapshot(learner.userId)).resolves.toEqual(before);
    });

    it('[E5] chains textbook lessons across units and hides draft units', async () => {
      const learner = await register('e5');
      const fresh = await get(
        learner.token,
        `/learning/courses/${TEXTBOOK}`,
      ).expect(200);
      const units = fresh.body.data.units as CourseUnitBody[];
      expect(
        units.map((u) => [
          u.orderIndex,
          u.title,
          u.gradeNumber,
          u.volume,
          u.levelCode,
        ]),
      ).toEqual([
        [1, 'Quyển 1 上', 1, 'upper', null],
        [2, 'Quyển 1 下', 1, 'lower', null],
      ]);
      expect(
        units.flatMap((u) => u.lessons.map((l) => [l.id, l.position, l.state])),
      ).toEqual([
        [textbookLessonIds[0], 1, 'current'],
        [textbookLessonIds[1], 2, 'locked'],
        [textbookLessonIds[2], 1, 'locked'],
      ]);
      expect(JSON.stringify(fresh.body.data)).not.toContain(
        `"id":${hiddenLessonId},`,
      );

      await markDone(learner.userId, textbookLessonIds[0]);
      await markDone(learner.userId, textbookLessonIds[1]);
      const later = await get(
        learner.token,
        `/learning/courses/${TEXTBOOK}`,
      ).expect(200);
      expect(
        (later.body.data.units as CourseUnitBody[]).flatMap((u) =>
          u.lessons.map((l) => l.state),
        ),
      ).toEqual(['done', 'done', 'current']);
      expect(later.body.data.progress).toEqual({
        completedLessons: 2,
        totalLessons: 3,
      });
    });

    it('[E6] enrolls idempotently and keeps progress when leaving and coming back', async () => {
      const learner = await register('e6');
      const first = await send(
        learner.token,
        'post',
        `/learning/courses/${TEXTBOOK}/enrollment`,
      ).expect(200);
      expect(first.body.data).toMatchObject({
        courseCode: TEXTBOOK,
        status: 'active',
        isCurrent: false,
        leftAt: null,
      });
      const again = await send(
        learner.token,
        'post',
        `/learning/courses/${TEXTBOOK}/enrollment`,
      ).expect(200);
      expect(again.body.data).toEqual(first.body.data);
      await markDone(learner.userId, textbookLessonIds[0]);

      await send(
        learner.token,
        'delete',
        `/learning/courses/${TEXTBOOK}/enrollment`,
      ).expect(204);
      const left = await enrollmentOf(learner.userId);
      expect(left).toMatchObject({ status: 'left', isCurrent: false });
      expect(left?.leftAt).toBeInstanceOf(Date);
      await send(
        learner.token,
        'delete',
        `/learning/courses/${TEXTBOOK}/enrollment`,
      ).expect(204);
      await expect(enrollmentOf(learner.userId)).resolves.toEqual(left);

      const back = await send(
        learner.token,
        'post',
        `/learning/courses/${TEXTBOOK}/enrollment`,
      ).expect(200);
      expect(back.body.data).toEqual(first.body.data);
      await expect(
        prisma.progress.findMany({
          where: { userId: learner.userId },
          select: { lessonId: true, status: true },
        }),
      ).resolves.toEqual([{ lessonId: textbookLessonIds[0], status: 'done' }]);
      await expect(
        prisma.courseEnrollment.count({ where: { userId: learner.userId } }),
      ).resolves.toBe(1);
    });

    it('[E7] answers 204 to leaving a course never followed, creating nothing', async () => {
      const learner = await register('e7');
      await send(
        learner.token,
        'delete',
        `/learning/courses/${TEXTBOOK}/enrollment`,
      ).expect(204);
      await expect(
        prisma.courseEnrollment.count({ where: { userId: learner.userId } }),
      ).resolves.toBe(0);
    });

    it('[E8] switches the current course and never keeps two current rows', async () => {
      const learner = await register('e8');
      const picked = await send(
        learner.token,
        'put',
        '/learning/current-course',
        {
          courseCode: TEXTBOOK,
        },
      ).expect(200);
      expect(picked.body.data).toMatchObject({
        courseCode: TEXTBOOK,
        status: 'active',
        isCurrent: true,
      });
      expect(await currentCodes(learner.token)).toEqual([TEXTBOOK]);

      await send(learner.token, 'put', '/learning/current-course', {
        courseCode: 'HSK3_TOPIC',
      }).expect(200);
      expect(await currentCodes(learner.token)).toEqual(['HSK3_TOPIC']);
      await expect(storedCurrent(learner.userId)).resolves.toEqual([
        topicCourseId,
      ]);
      const textbook = await prisma.courseEnrollment.findFirstOrThrow({
        where: { userId: learner.userId, course: { code: TEXTBOOK } },
        select: { status: true, isCurrent: true },
      });
      expect(textbook).toEqual({ status: 'active', isCurrent: false });

      // Leaving the current course falls back to the default without a write.
      await send(learner.token, 'put', '/learning/current-course', {
        courseCode: TEXTBOOK,
      }).expect(200);
      await send(
        learner.token,
        'delete',
        `/learning/courses/${TEXTBOOK}/enrollment`,
      ).expect(204);
      await expect(storedCurrent(learner.userId)).resolves.toEqual([]);
      expect(await currentCodes(learner.token)).toEqual(['HSK3_TOPIC']);
    });

    it('[E9] keeps at most one current row under concurrent switches', async () => {
      const learner = await register('e9');
      const codes = Array.from({ length: 12 }, (_, i) =>
        i % 2 === 0 ? TEXTBOOK : 'HSK3_TOPIC',
      );
      const responses = await Promise.all(
        codes.map((courseCode) =>
          send(learner.token, 'put', '/learning/current-course', {
            courseCode,
          }),
        ),
      );
      expect(responses.map((r) => r.status)).toEqual(codes.map(() => 200));
      await expect(storedCurrent(learner.userId)).resolves.toHaveLength(1);
      await expect(
        prisma.courseEnrollment.count({ where: { userId: learner.userId } }),
      ).resolves.toBe(2);
    });

    it('[E10] keeps each learner to their own enrollments', async () => {
      const a = await register('e10a');
      const b = await register('e10b');
      await send(b.token, 'put', '/learning/current-course', {
        courseCode: TEXTBOOK,
      }).expect(200);
      const bBefore = await enrollmentOf(b.userId);

      await send(
        a.token,
        'delete',
        `/learning/courses/${TEXTBOOK}/enrollment`,
      ).expect(204);
      await send(a.token, 'put', '/learning/current-course', {
        courseCode: 'HSK3_TOPIC',
      }).expect(200);
      await expect(enrollmentOf(b.userId)).resolves.toEqual(bBefore);

      const list = await get(a.token, '/learning/courses').expect(200);
      expect(
        (
          list.body.data.courses as Array<{ code: string; enrolled: boolean }>
        ).find((c) => c.code === TEXTBOOK)?.enrolled,
      ).toBe(false);
    });

    it('[E12] keeps one row when the same learner enrolls concurrently', async () => {
      const learner = await register('e12');
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          send(
            learner.token,
            'post',
            `/learning/courses/${TEXTBOOK}/enrollment`,
          ),
        ),
      );
      expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
      await expect(
        prisma.courseEnrollment.count({ where: { userId: learner.userId } }),
      ).resolves.toBe(1);
    });

    it('[E13] keeps one current row when enrolling races picking the course', async () => {
      const learner = await register('e13');
      const responses = await Promise.all([
        send(learner.token, 'post', `/learning/courses/${TEXTBOOK}/enrollment`),
        send(learner.token, 'put', '/learning/current-course', {
          courseCode: TEXTBOOK,
        }),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      await expect(
        prisma.courseEnrollment.findMany({
          where: { userId: learner.userId },
          select: { status: true, isCurrent: true },
        }),
      ).resolves.toEqual([{ status: 'active', isCurrent: true }]);
    });

    it('[E11] rejects an invalid current-course body', async () => {
      const learner = await register('e11');
      for (const body of [
        {},
        { courseCode: '' },
        { courseCode: 'X'.repeat(65) },
      ]) {
        await send(
          learner.token,
          'put',
          '/learning/current-course',
          body,
        ).expect(400);
      }
      await expect(
        prisma.courseEnrollment.count({ where: { userId: learner.userId } }),
      ).resolves.toBe(0);
    });
  });

  async function currentCodes(token: string): Promise<string[]> {
    const list = await get(token, '/learning/courses').expect(200);
    return (
      list.body.data.courses as Array<{ code: string; isCurrent: boolean }>
    )
      .filter((c) => c.isCurrent)
      .map((c) => c.code);
  }

  async function storedCurrent(userId: number): Promise<number[]> {
    const rows = await prisma.courseEnrollment.findMany({
      where: { userId, isCurrent: true },
      select: { courseId: true },
    });
    return rows.map((row) => row.courseId);
  }

  function enrollmentOf(userId: number) {
    return prisma.courseEnrollment.findFirst({
      where: { userId, course: { code: TEXTBOOK } },
      select: { status: true, isCurrent: true, enrolledAt: true, leftAt: true },
    });
  }

  async function snapshot(userId: number) {
    return {
      enrollments: await prisma.courseEnrollment.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
      }),
      progress: await prisma.progress.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
      }),
      courses: await prisma.course.findMany({ orderBy: { id: 'asc' } }),
    };
  }

  async function markDone(userId: number, lessonId: number) {
    const now = new Date();
    await prisma.progress.create({
      data: {
        userId,
        lessonId,
        status: 'done',
        completionPercent: 100,
        startedAt: now,
        completedAt: now,
        lastActivityAt: now,
      },
    });
  }

  async function publishLevel(code: string, band: number) {
    const prior = await prisma.level.findUnique({
      where: { code },
      select: { status: true, publishedAt: true, deletedAt: true, name: true },
    });
    const level = await prisma.level.upsert({
      where: { code },
      update: { status: 'published', publishedAt: new Date(), deletedAt: null },
      create: {
        code,
        name: code,
        orderIndex: band,
        minBand: band,
        maxBand: band,
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    priorLevels.set(level.id, prior);
    return level.id;
  }

  async function createLesson(
    levelId: number,
    orderIndex: number,
    slug: string,
    courseUnitId?: number,
  ) {
    const title = `Course lesson ${slug}`;
    const lesson = await prisma.lesson.create({
      data: {
        levelId,
        courseUnitId,
        title,
        orderIndex,
        slug: `course-${slug}-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
        stories: {
          create: {
            levelId,
            title: `${title} story`,
            slug: `course-${slug}-story-${suffix}`,
            content: {},
            status: 'published',
          },
        },
      },
      select: { id: true },
    });
    createdLessonIds.push(lesson.id);
    return lesson.id;
  }

  function get(token: string, path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function send(
    token: string,
    method: 'post' | 'delete' | 'put',
    path: string,
    body: object = {},
  ) {
    return request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function register(label: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `course-${label}-${suffix}@example.com`,
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
