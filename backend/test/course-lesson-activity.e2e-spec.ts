/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * ADR-009 C3b-3: a ready lesson without a Level is learned through the
 * activity routes, unlocked by its course. Fixtures are a new textbook course
 * of this suite and one lesson at a random high orderIndex of HSK7_9 for the
 * Level regression; all are archived in `afterAll`.
 */
describe('Course lesson activity (ADR-009 C3b-3) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let courseId: number;
  let unitId: number;
  const lessons: Array<{ id: number; topicId: number; exerciseId: number }> =
    [];
  const hidden: number[] = [];
  let levelLessonId: number;
  let levelId: number;
  const createdLessonIds: number[] = [];
  const createdCourseIds: number[] = [];

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const code = `C3B3_TB_${suffix}`.replace(/-/g, '_');
  const password = 'StrongPassword123!';
  let keySeq = 0;

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

    courseId = await createCourse(code, 'published');
    unitId = await createUnit(courseId, 1, 'published');
    for (const order of [1, 2, 3]) {
      lessons.push(await createLesson(unitId, order, `l${order}`, 'published'));
    }
    // 404 cases: draft course, draft unit, draft lesson.
    const draftCourse = await createCourse(`${code}_DRAFT`, 'draft');
    hidden.push(
      (
        await createLesson(
          await createUnit(draftCourse, 1, 'published'),
          1,
          'draft-course',
          'published',
        )
      ).id,
      (
        await createLesson(
          await createUnit(courseId, 2, 'draft'),
          1,
          'draft-unit',
          'published',
        )
      ).id,
      (await createLesson(unitId, 9, 'draft-lesson', 'draft')).id,
    );

    const level = await prisma.level.upsert({
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
    });
    levelId = level.id;
    levelLessonId = (
      await createLesson(
        null,
        70_000 + Math.floor(Math.random() * 20_000),
        'level',
        'published',
        levelId,
      )
    ).id;
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

  it('[A1] reads and starts the first lesson of the course', async () => {
    const learner = await register('a1');
    const [first] = lessons;
    const detail = await get(
      learner.token,
      `/learning/lessons/${first.id}`,
    ).expect(200);
    expect(detail.body.data).toMatchObject({
      id: first.id,
      level: null,
      course: { code, title: code },
      unit: { orderIndex: 1, title: 'Unit 1', gradeNumber: 1, volume: null },
    });
    const activity = await get(
      learner.token,
      `/learning/lessons/${first.id}/activity`,
    ).expect(200);
    expect(activity.body.data).toMatchObject({
      lesson: { id: first.id, levelId: null },
      level: null,
      course: { code, title: code },
      unit: { orderIndex: 1, title: 'Unit 1', gradeNumber: 1, volume: null },
      position: 1,
      state: 'current',
      nextAction: 'start_lesson',
    });
    const started = await post(
      learner.token,
      `/learning/lessons/${first.id}/start`,
    ).expect(201);
    expect(started.body.data).toMatchObject({
      lessonId: first.id,
      status: 'learning',
    });
  });

  it('[A2] keeps lesson 2 locked until lesson 1 is done, through topic, attempt and complete', async () => {
    const learner = await register('a2');
    const [first, second] = lessons;
    const locked = await post(
      learner.token,
      `/learning/lessons/${second.id}/start`,
    ).expect(409);
    expect(locked.body.error.code).toBe('lesson_locked');
    await expect(
      prisma.progress.count({ where: { userId: learner.userId } }),
    ).resolves.toBe(0);
    const lockedActivity = await get(
      learner.token,
      `/learning/lessons/${second.id}/activity`,
    ).expect(200);
    expect(lockedActivity.body.data).toMatchObject({
      position: 2,
      state: 'locked',
    });

    await finishLesson(learner.token, first);
    const attempts = await get(
      learner.token,
      `/learning/exercises/${first.exerciseId}/attempts`,
    ).expect(200);
    expect(attempts.body.data).toHaveLength(1);

    await post(learner.token, `/learning/lessons/${second.id}/start`).expect(
      201,
    );
  });

  it('[A3] opens a lesson that already has Progress', async () => {
    const learner = await register('a3');
    const third = lessons[2];
    await prisma.progress.create({
      data: { userId: learner.userId, lessonId: third.id, status: 'learning' },
    });
    await post(learner.token, `/learning/lessons/${third.id}/start`).expect(
      201,
    );
  });

  it('[A4] stamps lastActivityAt of an active enrollment and never creates one', async () => {
    const enrolled = await register('a4-enrolled');
    await post(
      enrolled.token,
      `/learning/courses/${code}/enrollment`,
      false,
    ).expect(200);
    const before = await enrollment(enrolled.userId);
    expect(before).toMatchObject({ lastActivityAt: null, isCurrent: false });
    await post(
      enrolled.token,
      `/learning/lessons/${lessons[0].id}/start`,
    ).expect(201);
    const afterStart = await enrollment(enrolled.userId);
    expect(afterStart?.lastActivityAt).toBeInstanceOf(Date);
    expect(afterStart?.isCurrent).toBe(false);
    await finishLesson(enrolled.token, lessons[0], false);
    const afterComplete = await enrollment(enrolled.userId);
    expect(afterComplete?.lastActivityAt?.getTime()).toBeGreaterThanOrEqual(
      afterStart?.lastActivityAt?.getTime() ?? 0,
    );
    expect(afterComplete?.isCurrent).toBe(false);

    const stranger = await register('a4-stranger');
    await finishLesson(stranger.token, lessons[0]);
    await expect(enrollment(stranger.userId)).resolves.toBeNull();

    const left = await register('a4-left');
    await post(left.token, `/learning/courses/${code}/enrollment`, false);
    await request(app.getHttpServer())
      .delete(`/api/v1/learning/courses/${code}/enrollment`)
      .set('Authorization', `Bearer ${left.token}`)
      .expect(204);
    await finishLesson(left.token, lessons[0]);
    await expect(enrollment(left.userId)).resolves.toMatchObject({
      status: 'left',
      lastActivityAt: null,
    });
  });

  it('[A5] returns the lesson progress on /progress/lessons*', async () => {
    const learner = await register('a5');
    await post(
      learner.token,
      `/learning/lessons/${lessons[0].id}/start`,
    ).expect(201);
    const one = await get(
      learner.token,
      `/progress/lessons/${lessons[0].id}`,
    ).expect(200);
    expect(one.body.data).toMatchObject({
      lessonId: lessons[0].id,
      status: 'learning',
    });
    const list = await get(learner.token, '/progress/lessons').expect(200);
    expect(
      (list.body.data as Array<{ lessonId: number }>).map((p) => p.lessonId),
    ).toEqual([lessons[0].id]);
  });

  it('[A6] answers 404 alike for a draft course, unit or lesson', async () => {
    const learner = await register('a6');
    for (const id of hidden) {
      for (const path of [
        `/learning/lessons/${id}`,
        `/learning/lessons/${id}/activity`,
      ]) {
        const response = await get(learner.token, path).expect(404);
        expect(response.body.error.code).toBe('NOT_FOUND');
      }
      const started = await post(
        learner.token,
        `/learning/lessons/${id}/start`,
      ).expect(404);
      expect(started.body.error.code).toBe('NOT_FOUND');
    }
    await expect(
      prisma.progress.count({ where: { userId: learner.userId } }),
    ).resolves.toBe(0);
  });

  it('[A7] keeps the response of a lesson with a Level as before', async () => {
    const learner = await register('a7');
    const activity = await get(
      learner.token,
      `/learning/lessons/${levelLessonId}/activity`,
    ).expect(200);
    const data = activity.body.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(
      [
        'currentExercise',
        'currentTopic',
        'lesson',
        'level',
        'nextAction',
        'position',
        'progress',
        'sections',
        'standaloneExercises',
        'state',
        'topics',
      ].sort(),
    );
    expect(Object.keys(data.lesson as object).sort()).toEqual(
      [
        'coverImage',
        'description',
        'id',
        'levelId',
        'orderIndex',
        'slug',
        'title',
      ].sort(),
    );
    expect(data.lesson).toMatchObject({ id: levelLessonId, levelId });
    expect(data.level).toEqual({
      id: levelId,
      code: 'HSK7_9',
      name: expect.any(String),
    });
    const detail = await get(
      learner.token,
      `/learning/lessons/${levelLessonId}`,
    ).expect(200);
    const body = detail.body.data as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        'coverImage',
        'exercises',
        'id',
        'level',
        'stories',
        'title',
        'topics',
        'words',
      ].sort(),
    );
    expect(Object.keys(body.level as object).sort()).toEqual([
      'id',
      'name',
      'orderIndex',
    ]);
  });

  async function finishLesson(
    token: string,
    lesson: { id: number; topicId: number; exerciseId: number },
    start = true,
  ) {
    if (start) {
      await post(token, `/learning/lessons/${lesson.id}/start`).expect(201);
    }
    await post(token, `/learning/topics/${lesson.topicId}/start`).expect(201);
    await post(token, `/learning/exercises/${lesson.exerciseId}/attempts`)
      .send({ answer: { optionId: 'a' }, durationSeconds: 5 })
      .expect(201);
    await post(token, `/learning/topics/${lesson.topicId}/complete`).expect(
      201,
    );
    await post(token, `/learning/lessons/${lesson.id}/complete`).expect(201);
  }

  function enrollment(userId: number) {
    return prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { status: true, isCurrent: true, lastActivityAt: true },
    });
  }

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
        orderIndex: 700_000 + Math.floor(Math.random() * 90_000),
        status,
      },
      select: { id: true },
    });
    createdCourseIds.push(course.id);
    return course.id;
  }

  async function createUnit(
    parentId: number,
    orderIndex: number,
    status: 'published' | 'draft',
  ) {
    const unit = await prisma.courseUnit.create({
      data: {
        courseId: parentId,
        orderIndex,
        title: `Unit ${orderIndex}`,
        gradeNumber: 1,
        status,
      },
      select: { id: true },
    });
    return unit.id;
  }

  async function createLesson(
    courseUnitId: number | null,
    orderIndex: number,
    slug: string,
    status: 'published' | 'draft',
    lessonLevelId: number | null = null,
  ) {
    const lesson = await prisma.lesson.create({
      data: {
        courseUnitId,
        levelId: lessonLevelId,
        title: `C3b-3 lesson ${slug}`,
        orderIndex,
        slug: `c3b3-${slug}-${suffix}`,
        status,
        publishedAt: status === 'published' ? new Date() : null,
        topics: {
          create: {
            title: `Topic ${slug}`,
            content: [{ type: 'text', value: 'C3b-3' }],
            orderIndex: 1,
            status: 'published',
            publishedAt: new Date(),
          },
        },
      },
      select: { id: true, topics: { select: { id: true } } },
    });
    createdLessonIds.push(lesson.id);
    const topicId = lesson.topics[0].id;
    const exercise = await prisma.lessonExercise.create({
      data: {
        lessonId: lesson.id,
        topicId,
        type: 'mcq',
        prompt: 'Chọn đáp án',
        content: {
          options: [
            { id: 'a', text: '你好' },
            { id: 'b', text: '再见' },
          ],
        },
        answer: { optionId: 'a' },
        explanation: '你好 là lời chào.',
        orderIndex: 1,
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    return { id: lesson.id, topicId, exerciseId: exercise.id };
  }

  function get(token: string, path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function post(token: string, path: string, withKey = true) {
    keySeq += 1;
    const req = request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
    return (
      withKey
        ? req.set('Idempotency-Key', `c3b3-${String(keySeq)}-${suffix}`)
        : req
    ).send({});
  }

  async function register(label: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `c3b3-${label}-${suffix}@example.com`,
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
