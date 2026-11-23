/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * ADR-009 C3b-2: CMS for Course, CourseUnit and lessons of a unit.
 * Fixtures are courses, units and lessons of this suite only (unique codes,
 * no Level created except HSK4 when missing, never modified); `afterAll`
 * archives them. Tests do not depend on each other's order.
 */
describe('CMS course authoring (ADR-009 C3b-2) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let learnerToken: string;
  let levelId: number;
  const createdCourseIds: number[] = [];

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const password = 'StrongPassword123!';
  let seq = 0;
  const nextCode = () => `C3B2_${suffix}_${++seq}`;
  const nextOrder = () =>
    700_000_000 + Math.floor(Math.random() * 100_000_000) + seq;

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
    prisma = app.get(PrismaService);

    const admin = await register('admin');
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    });
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: emailOf('admin'), password })
        .expect(201)
    ).body.data.accessToken as string;
    learnerToken = (await register('learner')).token;

    const hsk4 = await prisma.level.findUnique({
      where: { code: 'HSK4' },
      select: { id: true },
    });
    levelId = (
      hsk4 ??
      (await prisma.level.create({
        data: {
          code: 'HSK4',
          name: 'HSK4',
          orderIndex: 4,
          minBand: 4,
          maxBand: 4,
        },
        select: { id: true },
      }))
    ).id;
  });

  afterAll(async () => {
    const now = new Date();
    await prisma.lesson.updateMany({
      where: { courseUnit: { courseId: { in: createdCourseIds } } },
      data: { status: 'archived', deletedAt: now },
    });
    await prisma.courseUnit.updateMany({
      where: { courseId: { in: createdCourseIds } },
      data: { status: 'archived', deletedAt: now },
    });
    await prisma.course.updateMany({
      where: { id: { in: createdCourseIds } },
      data: { status: 'archived', deletedAt: now },
    });
    await app.close();
  });

  it('[K1] guards every new route: 401 without login, 403 for a learner', async () => {
    const routes: Array<['get' | 'post' | 'patch', string]> = [
      ['get', '/admin/cms/courses'],
      ['get', '/admin/cms/courses/1'],
      ['post', '/admin/cms/courses'],
      ['patch', '/admin/cms/courses/1'],
      ['post', '/admin/cms/courses/1/publish'],
      ['post', '/admin/cms/courses/1/archive'],
      ['get', '/admin/cms/course-units?courseId=1'],
      ['post', '/admin/cms/course-units'],
      ['patch', '/admin/cms/course-units/1'],
      ['post', '/admin/cms/course-units/1/publish'],
      ['post', '/admin/cms/course-units/1/archive'],
      ['post', '/admin/cms/course-units/1/lessons'],
    ];
    for (const [method, path] of routes) {
      await request(app.getHttpServer())[method](`/api/v1${path}`).expect(401);
      await request(app.getHttpServer())
        [method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${learnerToken}`)
        .expect(403);
    }
  });

  it('[K2] creates a draft course and answers 400 for each CHECK', async () => {
    const created = await createCourse({ kind: 'textbook' });
    expect(created).toMatchObject({
      status: 'draft',
      kind: 'textbook',
      curriculumVersion: 'HSK_2_0',
      keyTextVisible: true,
    });

    for (const bad of [
      { code: 'lower_case' },
      { code: 'AB' },
      { code: 'X'.repeat(41) },
      { curriculumVersion: 'HSK_9_0' },
      { orderIndex: 0 },
      { title: '   ' },
      { kind: 'novel' },
      { keyTextVisible: 'false' },
    ]) {
      const response = await admin('post', '/admin/cms/courses')
        .send({ ...coursePayload(), ...bad })
        .expect(400);
      expect(response.body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    }
  });

  it('[K3] answers 409, not 500, for a duplicate code or orderIndex', async () => {
    const payload = coursePayload();
    createdCourseIds.push(
      (await admin('post', '/admin/cms/courses').send(payload).expect(201)).body
        .data.id as number,
    );
    for (const duplicate of [
      { ...coursePayload(), code: payload.code },
      { ...coursePayload(), orderIndex: payload.orderIndex },
    ]) {
      const response = await admin('post', '/admin/cms/courses')
        .send(duplicate)
        .expect(409);
      expect(response.body.error.code).toBe('CONTENT_UNIQUE_CONFLICT');
    }
  });

  it('[K4] edits a course, refuses code/kind and stale or concurrent edits', async () => {
    const course = await createCourse({ kind: 'textbook' });
    for (const field of [{ code: 'NEW_CODE' }, { kind: 'topic' }]) {
      await admin('patch', `/admin/cms/courses/${course.id}`)
        .send({ expectedUpdatedAt: course.updatedAt, ...field })
        .expect(400);
    }
    await admin('patch', `/admin/cms/courses/${course.id}`)
      .send({ expectedUpdatedAt: course.updatedAt, orderIndex: 0 })
      .expect(400);

    const patches = await Promise.all(
      ['Title A', 'Title B'].map((title) =>
        admin('patch', `/admin/cms/courses/${course.id}`).send({
          expectedUpdatedAt: course.updatedAt,
          title,
        }),
      ),
    );
    expect(patches.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(patches.find((r) => r.status === 409)?.body.error.code).toBe(
      'CONTENT_CONCURRENT_UPDATE',
    );

    const stale = await admin('patch', `/admin/cms/courses/${course.id}`)
      .send({ expectedUpdatedAt: course.updatedAt, title: 'Title C' })
      .expect(409);
    expect(stale.body.error.code).toBe('CONTENT_CONCURRENT_UPDATE');
  });

  it('[K5] writes exactly one AuditLog per keyTextVisible change, none when unchanged', async () => {
    const course = await createCourse({ kind: 'textbook' });
    const visibilityAudits = () =>
      prisma.auditLog.findMany({
        where: { targetType: 'course', targetId: String(course.id) },
        select: { action: true, beforeSummary: true, afterSummary: true },
      });

    const hidden = await admin('patch', `/admin/cms/courses/${course.id}`)
      .send({ expectedUpdatedAt: course.updatedAt, keyTextVisible: false })
      .expect(200);
    expect(hidden.body.data.keyTextVisible).toBe(false);
    const afterChange = (await visibilityAudits()).filter(
      (row) => row.action === 'course.key_text_visibility_changed',
    );
    expect(afterChange).toEqual([
      {
        action: 'course.key_text_visibility_changed',
        beforeSummary: { keyTextVisible: true },
        afterSummary: { keyTextVisible: false },
      },
    ]);
    const actor = await prisma.auditLog.findFirst({
      where: {
        action: 'course.key_text_visibility_changed',
        targetId: String(course.id),
      },
      select: { actorId: true },
    });
    expect(actor?.actorId).toEqual(expect.any(Number));

    const before = (await visibilityAudits()).length;
    await admin('patch', `/admin/cms/courses/${course.id}`)
      .send({
        expectedUpdatedAt: hidden.body.data.updatedAt,
        keyTextVisible: false,
      })
      .expect(200);
    expect(await visibilityAudits()).toHaveLength(before);
  });

  it('[K6] lists with filters and shows a course with its units', async () => {
    const course = await createCourse({ kind: 'specialty' });
    const unit = await createUnit(course.id, { orderIndex: 1 });

    const listed = await admin(
      'get',
      '/admin/cms/courses?kind=specialty&status=draft&limit=100',
    ).expect(200);
    expect(listed.body.meta.pagination).toMatchObject({ page: 1, limit: 100 });
    for (const row of listed.body.data as Array<{
      kind: string;
      status: string;
    }>) {
      expect(row).toMatchObject({ kind: 'specialty', status: 'draft' });
    }
    await admin('get', '/admin/cms/courses?curriculumVersion=HSK_9_0').expect(
      400,
    );

    const detail = await admin('get', `/admin/cms/courses/${course.id}`).expect(
      200,
    );
    expect(detail.body.data.units).toEqual([
      expect.objectContaining({ id: unit.id, courseId: course.id }),
    ]);
    await admin('get', '/admin/cms/courses/2147483647').expect(404);

    const units = await admin(
      'get',
      `/admin/cms/course-units?courseId=${course.id}`,
    ).expect(200);
    expect(units.body.data.map((row: { id: number }) => row.id)).toEqual([
      unit.id,
    ]);
  });

  it('[K7] validates units: topic Level, grade, volume, order and duplicates', async () => {
    const topic = await createCourse({
      kind: 'topic',
      curriculumVersion: 'HSK_3_0',
    });
    const noLevel = await admin('post', '/admin/cms/course-units')
      .send(unitPayload(topic.id, { orderIndex: 1 }))
      .expect(400);
    expect(noLevel.body.error.code).toBe('COURSE_UNIT_LEVEL_REQUIRED');
    await createUnit(topic.id, { orderIndex: 1, levelId });

    const textbook = await createCourse({ kind: 'textbook' });
    for (const bad of [
      { gradeNumber: 0 },
      { gradeNumber: 10 },
      { orderIndex: 0 },
      { volume: 'middle', gradeNumber: 1 },
    ]) {
      await admin('post', '/admin/cms/course-units')
        .send(unitPayload(textbook.id, { orderIndex: 2, ...bad }))
        .expect(400);
    }
    const volume = await admin('post', '/admin/cms/course-units')
      .send(unitPayload(textbook.id, { orderIndex: 2, volume: 'upper' }))
      .expect(400);
    expect(volume.body.error.code).toBe('COURSE_UNIT_VOLUME_REQUIRES_GRADE');

    await createUnit(textbook.id, {
      orderIndex: 2,
      gradeNumber: 1,
      volume: 'upper',
    });
    const duplicate = await admin('post', '/admin/cms/course-units')
      .send(unitPayload(textbook.id, { orderIndex: 2 }))
      .expect(409);
    expect(duplicate.body.error.code).toBe('CONTENT_UNIQUE_CONFLICT');
    await admin('post', '/admin/cms/course-units')
      .send(unitPayload(2_147_483_647, { orderIndex: 1 }))
      .expect(404);
  });

  it('[K8] keeps the Level of a unit that has lessons', async () => {
    const course = await createCourse({ kind: 'textbook' });
    const empty = await createUnit(course.id, { orderIndex: 1 });
    const moved = await admin('patch', `/admin/cms/course-units/${empty.id}`)
      .send({ expectedUpdatedAt: empty.updatedAt, levelId })
      .expect(200);
    expect(moved.body.data.levelId).toBe(levelId);

    const used = await createUnit(course.id, { orderIndex: 2 });
    await createUnitLesson(used.id, 1);
    const refused = await admin('patch', `/admin/cms/course-units/${used.id}`)
      .send({ expectedUpdatedAt: used.updatedAt, levelId })
      .expect(409);
    expect(refused.body.error.code).toBe('COURSE_UNIT_HAS_LESSONS');

    const stale = await admin('patch', `/admin/cms/course-units/${used.id}`)
      .send({ expectedUpdatedAt: empty.updatedAt, title: 'x' })
      .expect(409);
    expect(stale.body.error.code).toBe('CONTENT_CONCURRENT_UPDATE');
  });

  it('[K9] creates a lesson in a unit; 404, 409 and 400 at the edges', async () => {
    const course = await createCourse({ kind: 'textbook' });
    const unit = await createUnit(course.id, { orderIndex: 1 });
    const lesson = await createUnitLesson(unit.id, 1);
    expect(lesson).toMatchObject({
      levelId: null,
      courseUnitId: unit.id,
      status: 'draft',
    });

    const withLevel = await createUnit(course.id, {
      orderIndex: 2,
      levelId,
    });
    expect(
      await createUnitLesson(
        withLevel.id,
        // Lesson (levelId, orderIndex) is unique per Level: keep clear of
        // the small HSK4 orders other suites seed.
        500_000 + Math.floor(Math.random() * 400_000),
      ),
    ).toMatchObject({
      levelId,
      courseUnitId: withLevel.id,
    });

    const duplicate = await admin(
      'post',
      `/admin/cms/course-units/${unit.id}/lessons`,
    )
      .send(lessonPayload(1))
      .expect(409);
    expect(duplicate.body.error.code).toBe('CONTENT_UNIQUE_CONFLICT');
    await admin('post', `/admin/cms/course-units/${unit.id}/lessons`)
      .send({ ...lessonPayload(3), levelId })
      .expect(400);
    await admin('post', '/admin/cms/course-units/2147483647/lessons')
      .send(lessonPayload(1))
      .expect(404);

    // No unit move: a revision does not accept courseUnitId.
    const revision = await admin(
      'post',
      `/admin/cms/lessons/${lesson.id}/revisions`,
    )
      .send({ ...lessonPayload(1), courseUnitId: withLevel.id })
      .expect(400);
    expect(revision.body.error.code).toBe('REQUEST_VALIDATION_FAILED');

    const lessons = await admin(
      'get',
      `/admin/cms/lessons?courseUnitId=${unit.id}&limit=100`,
    ).expect(200);
    expect(lessons.body.data.map((row: { id: number }) => row.id)).toEqual([
      lesson.id,
    ]);
    const byCourse = await admin(
      'get',
      `/admin/cms/lessons?courseId=${course.id}&limit=100`,
    ).expect(200);
    expect(byCourse.body.data).toHaveLength(2);

    await admin('post', `/admin/cms/courses/${course.id}/archive`).expect(201);
    const archived = await admin(
      'post',
      `/admin/cms/course-units/${unit.id}/lessons`,
    )
      .send(lessonPayload(5))
      .expect(409);
    expect(archived.body.error.code).toBe('COURSE_ARCHIVED');
  });

  it('[K10] publishes a lesson without a Level only under a public unit and course', async () => {
    const course = await createCourse({ kind: 'textbook' });
    const unit = await createUnit(course.id, { orderIndex: 1 });
    const created = await admin(
      'post',
      `/admin/cms/course-units/${unit.id}/lessons`,
    )
      .send(lessonPayload(1))
      .expect(201);
    const lessonId = created.body.data.lesson.id as number;
    const revisionId = created.body.data.revision.id as number;
    await prisma.topic.create({
      data: {
        lessonId,
        title: 'C3b-2 topic',
        content: [{ type: 'text', value: 'C3b-2' }],
        orderIndex: 1,
        status: 'published',
        publishedAt: new Date(),
      },
    });
    await admin(
      'post',
      `/admin/cms/lessons/${lessonId}/revisions/${revisionId}/reviews`,
    )
      .send({ decision: 'approved' })
      .expect(201);
    const publish = () =>
      admin(
        'post',
        `/admin/cms/lessons/${lessonId}/revisions/${revisionId}/publish`,
      );

    expect((await publish().expect(409)).body.error.code).toBe(
      'LESSON_UNIT_NOT_PUBLISHED',
    );
    await admin('post', `/admin/cms/course-units/${unit.id}/publish`).expect(
      201,
    );
    expect((await publish().expect(409)).body.error.code).toBe(
      'LESSON_COURSE_NOT_PUBLISHED',
    );
    const published = await admin(
      'post',
      `/admin/cms/courses/${course.id}/publish`,
    ).expect(201);
    expect(published.body.data.course.status).toBe('published');
    expect((await publish().expect(201)).body.data.lesson.status).toBe(
      'published',
    );

    const seen = await request(app.getHttpServer())
      .get(`/api/v1/learning/courses/${course.code}`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(200);
    expect(
      (seen.body.data.units as Array<{ lessons: Array<{ id: number }> }>)
        .flatMap((u) => u.lessons)
        .map((l) => l.id),
    ).toEqual([lessonId]);
    const path = await request(app.getHttpServer())
      .get('/api/v1/learning/path')
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(200);
    expect(JSON.stringify(path.body)).not.toMatch(
      new RegExp(`"(id|lessonId)":${lessonId}[,}]`),
    );
    await request(app.getHttpServer())
      .get(`/api/v1/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(404);
  });

  it('[K11] publishes and archives courses and units idempotently', async () => {
    const course = await createCourse({ kind: 'textbook' });
    const unit = await createUnit(course.id, { orderIndex: 1 });
    for (const path of [
      `/admin/cms/courses/${course.id}`,
      `/admin/cms/course-units/${unit.id}`,
    ]) {
      expect(
        (await admin('post', `${path}/publish`).expect(201)).body.data
          .idempotent,
      ).toBe(false);
      expect(
        (await admin('post', `${path}/publish`).expect(201)).body.data
          .idempotent,
      ).toBe(true);
    }
    await admin('post', `/admin/cms/course-units/${unit.id}/archive`).expect(
      201,
    );
    expect(
      (
        await admin(
          'post',
          `/admin/cms/course-units/${unit.id}/archive`,
        ).expect(201)
      ).body.data.idempotent,
    ).toBe(true);
    const republish = await admin(
      'post',
      `/admin/cms/course-units/${unit.id}/publish`,
    ).expect(409);
    expect(republish.body.error.code).toBe('CONTENT_ARCHIVED');
    await admin('post', '/admin/cms/courses/2147483647/publish').expect(404);
  });

  function coursePayload(overrides: Record<string, unknown> = {}) {
    return {
      code: nextCode(),
      kind: 'textbook',
      curriculumVersion: 'HSK_2_0',
      title: 'C3b-2 course',
      orderIndex: nextOrder(),
      ...overrides,
    };
  }

  async function createCourse(overrides: Record<string, unknown> = {}) {
    const response = await admin('post', '/admin/cms/courses')
      .send(coursePayload(overrides))
      .expect(201);
    createdCourseIds.push(response.body.data.id as number);
    return response.body.data as {
      id: number;
      code: string;
      updatedAt: string;
    };
  }

  function unitPayload(courseId: number, overrides: Record<string, unknown>) {
    return { courseId, title: 'C3b-2 unit', ...overrides };
  }

  async function createUnit(
    courseId: number,
    overrides: Record<string, unknown>,
  ) {
    const response = await admin('post', '/admin/cms/course-units')
      .send(unitPayload(courseId, overrides))
      .expect(201);
    return response.body.data as { id: number; updatedAt: string };
  }

  function lessonPayload(orderIndex: number) {
    return {
      title: `C3b-2 lesson ${orderIndex}`,
      orderIndex,
      slug: `c3b2-${suffix}-${++seq}`,
    };
  }

  async function createUnitLesson(unitId: number, orderIndex: number) {
    const response = await admin(
      'post',
      `/admin/cms/course-units/${unitId}/lessons`,
    )
      .send(lessonPayload(orderIndex))
      .expect(201);
    return response.body.data.lesson as {
      id: number;
      levelId: number | null;
      courseUnitId: number;
    };
  }

  function admin(method: 'get' | 'post' | 'patch', path: string) {
    return request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  function emailOf(label: string) {
    return `c3b2-${label}-${suffix}@example.com`;
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
