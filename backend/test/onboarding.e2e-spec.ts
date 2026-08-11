/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type GoalResponse = {
  success: true;
  data: {
    id: number;
    targetLevelId: number;
    targetBand: number;
    dailyMinutes: number;
    startDate: string;
    targetLevel: {
      id: number;
      code: string;
      name: string;
      minBand: number;
      maxBand: number;
    };
  };
};

type PlanResponse = {
  success: true;
  data: {
    id: number;
    targetLevelId: number;
    targetBand: number;
    startDate: string;
    endDate: string;
    items: Array<{
      id: number;
      orderIndex: number;
      scheduledDate: string;
      lesson: { id: number; title: string; orderIndex: number; slug: string };
    }>;
  };
};

describe('Onboarding Goal & Learning Plan V1 E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let levelId: number;
  let userId: number;
  let token: string;
  let currentGoalId: number;
  let currentPlanId: number;
  let firstLessonId: number;
  let secondLessonId: number;

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `onboarding-a-${suffix}@example.com`;
  const userBEmail = `onboarding-b-${suffix}@example.com`;
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
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const level = await prisma.level.upsert({
      where: { code: 'HSK4' },
      update: {
        name: 'HSK 4',
        orderIndex: 4,
        minBand: 4,
        maxBand: 4,
        status: 'published',
        publishedAt: new Date(),
        deletedAt: null,
      },
      create: {
        code: 'HSK4',
        name: 'HSK 4',
        orderIndex: 4,
        minBand: 4,
        maxBand: 4,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    levelId = level.id;

    await prisma.lesson.createMany({
      data: [
        {
          levelId,
          title: 'Second public lesson',
          orderIndex: 2,
          slug: `onboarding-second-${suffix}`,
          status: 'published',
        },
        {
          levelId,
          title: 'First public lesson',
          orderIndex: 1,
          slug: `onboarding-first-${suffix}`,
          status: 'published',
        },
        {
          levelId,
          title: 'Hidden draft lesson',
          orderIndex: 3,
          slug: `onboarding-draft-${suffix}`,
          status: 'draft',
        },
        {
          levelId,
          title: 'Hidden deleted lesson',
          orderIndex: 4,
          slug: `onboarding-deleted-${suffix}`,
          status: 'published',
          deletedAt: new Date(),
        },
      ],
    });

    const publicLessons = await prisma.lesson.findMany({
      where: {
        levelId,
        slug: {
          in: [`onboarding-first-${suffix}`, `onboarding-second-${suffix}`],
        },
      },
      select: { id: true, slug: true },
    });
    firstLessonId = publicLessons.find(
      (lesson) => lesson.slug === `onboarding-first-${suffix}`,
    )!.id;
    secondLessonId = publicLessons.find(
      (lesson) => lesson.slug === `onboarding-second-${suffix}`,
    )!.id;
    await prisma.topic.createMany({
      data: publicLessons.map((lesson, index) => ({
        lessonId: lesson.id,
        title: `Ready topic ${index + 1}`,
        content: [{ type: 'text', value: 'Ready for onboarding plan.' }],
        orderIndex: 1,
        status: 'published',
      })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. registers and logs in an active user', async () => {
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Onboarding User A' })
      .expect(201);
    expect(registerResponse.body.accessToken).toEqual(expect.any(String));

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);

    token = loginResponse.body.accessToken as string;
    userId = loginResponse.body.user.id as number;
  });

  it('2. starts at set_goal', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/onboarding/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        hasActiveGoal: false,
        hasActiveLearningPlan: false,
        hasUsableLearningPlan: false,
        hasCompletedPlacement: false,
        nextStep: 'set_goal',
      },
    });
  });

  it('3. creates a goal and resolves the single level band', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/onboarding/goals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        targetLevelId: levelId,
        dailyMinutes: 30,
        reminderEnabled: false,
        reminderTime: null,
        startDate: '2026-08-11',
      })
      .expect(201);
    const body = response.body as GoalResponse;

    currentGoalId = body.data.id;
    expect(body.data).toMatchObject({
      targetLevelId: levelId,
      targetBand: 4,
      dailyMinutes: 30,
      startDate: '2026-08-11',
    });
  });

  it('4. returns only the current user goal and minimum level fields', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/onboarding/goals/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = response.body as GoalResponse;

    expect(body.data.id).toBe(currentGoalId);
    expect(body.data.targetLevel).toEqual({
      id: levelId,
      code: 'HSK4',
      name: 'HSK 4',
      minBand: 4,
      maxBand: 4,
    });
  });

  it('5. advances status to generate_plan', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/onboarding/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      hasActiveGoal: true,
      hasActiveLearningPlan: false,
      hasUsableLearningPlan: false,
      nextStep: 'generate_plan',
    });
  });

  it('6. generates a plan transactionally from public lessons', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/learning-plans')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const body = response.body as PlanResponse;

    currentPlanId = body.data.id;
    expect(body.data.items).toHaveLength(2);
  });

  it('7. returns current plan items in stable order and date-only schedule', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/learning-plans/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = response.body as PlanResponse;

    expect(body.data.id).toBe(currentPlanId);
    expect(body.data.endDate).toBe('2026-08-12');
    expect(
      body.data.items.map((item) => ({
        title: item.lesson.title,
        orderIndex: item.orderIndex,
        scheduledDate: item.scheduledDate,
      })),
    ).toEqual([
      {
        title: 'First public lesson',
        orderIndex: 1,
        scheduledDate: '2026-08-11',
      },
      {
        title: 'Second public lesson',
        orderIndex: 2,
        scheduledDate: '2026-08-12',
      },
    ]);
  });

  it('8. advances status to ready', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/onboarding/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      hasActiveGoal: true,
      hasActiveLearningPlan: true,
      hasUsableLearningPlan: true,
      nextStep: 'ready',
    });
  });

  it('9. reports generate_plan and hides an archived item while another Lesson remains ready', async () => {
    const previousPlanId = currentPlanId;
    await prisma.lesson.update({
      where: { id: firstLessonId },
      data: { status: 'archived', deletedAt: new Date() },
    });

    const status = await request(app.getHttpServer())
      .get('/api/v1/onboarding/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.data).toMatchObject({
      hasActiveGoal: true,
      hasActiveLearningPlan: true,
      hasUsableLearningPlan: false,
      nextStep: 'generate_plan',
    });

    const current = await request(app.getHttpServer())
      .get('/api/v1/learning-plans/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(current.body.data.id).toBe(previousPlanId);
    expect(
      current.body.data.items.map(
        (item: { lesson: { id: number } }) => item.lesson.id,
      ),
    ).toEqual([secondLessonId]);
  });

  it('10. regenerates the ready snapshot and cancels the prior plan atomically', async () => {
    const previousPlanId = currentPlanId;
    const regenerated = await request(app.getHttpServer())
      .post('/api/v1/learning-plans')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    currentPlanId = regenerated.body.data.id as number;

    expect(currentPlanId).not.toBe(previousPlanId);
    expect(regenerated.body.data.items).toEqual([
      expect.objectContaining({
        lesson: expect.objectContaining({ id: secondLessonId }),
      }),
    ]);
    await expect(
      prisma.learningPlan.findUniqueOrThrow({
        where: { id: previousPlanId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'cancelled' });
  });

  it('11. reports content_unavailable without cancelling the active historical row', async () => {
    await prisma.lesson.update({
      where: { id: secondLessonId },
      data: { status: 'archived', deletedAt: new Date() },
    });

    const status = await request(app.getHttpServer())
      .get('/api/v1/onboarding/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.data).toMatchObject({
      hasActiveGoal: true,
      hasActiveLearningPlan: true,
      hasUsableLearningPlan: false,
      nextStep: 'content_unavailable',
    });

    const current = await request(app.getHttpServer())
      .get('/api/v1/learning-plans/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(current.body.data.id).toBe(currentPlanId);
    expect(current.body.data.items).toEqual([]);
    await expect(
      prisma.learningPlan.findUniqueOrThrow({
        where: { id: currentPlanId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'active' });
  });

  it('12. moves to generate_plan when ready content is published again', async () => {
    const recoveredLessons = await Promise.all(
      [10, 11].map((orderIndex) =>
        prisma.lesson.create({
          data: {
            levelId,
            title: `Recovered Lesson ${orderIndex}`,
            orderIndex,
            slug: `onboarding-recovered-${orderIndex}-${suffix}`,
            status: 'published',
            publishedAt: new Date(),
          },
          select: { id: true },
        }),
      ),
    );
    await prisma.topic.createMany({
      data: recoveredLessons.map((lesson, index) => ({
        lessonId: lesson.id,
        title: `Recovered Topic ${index + 1}`,
        content: [{ type: 'text', value: 'Content is available again.' }],
        orderIndex: 1,
        status: 'published',
        publishedAt: new Date(),
      })),
    });

    const status = await request(app.getHttpServer())
      .get('/api/v1/onboarding/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.data).toMatchObject({
      hasActiveLearningPlan: true,
      hasUsableLearningPlan: false,
      nextStep: 'generate_plan',
    });
  });

  it('13. serializes concurrent changed-goal requests to one active goal', async () => {
    const goalRequest = (dailyMinutes: number, startDate: string) =>
      request(app.getHttpServer())
        .post('/api/v1/onboarding/goals')
        .set('Authorization', `Bearer ${token}`)
        .send({
          targetLevelId: levelId,
          targetBand: 4,
          dailyMinutes,
          reminderEnabled: false,
          reminderTime: null,
          startDate,
        });

    const [first, second] = await Promise.all([
      goalRequest(40, '2026-08-12'),
      goalRequest(50, '2026-08-13'),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(
      await prisma.userGoal.count({ where: { userId, isActive: true } }),
    ).toBe(1);

    const currentGoal = await prisma.userGoal.findFirstOrThrow({
      where: { userId, isActive: true },
      select: { id: true },
    });
    currentGoalId = currentGoal.id;
  });

  it('14. serializes concurrent plan generation to one active plan', async () => {
    const planRequest = () =>
      request(app.getHttpServer())
        .post('/api/v1/learning-plans')
        .set('Authorization', `Bearer ${token}`);

    const [first, second] = await Promise.all([planRequest(), planRequest()]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.id).toBe(second.body.data.id);
    expect(
      await prisma.learningPlan.count({
        where: { userId, status: 'active' },
      }),
    ).toBe(1);
    expect(
      await prisma.learningPlanItem.count({
        where: { learningPlanId: first.body.data.id as number },
      }),
    ).toBe(2);
    currentPlanId = first.body.data.id as number;
  });

  it('15. prevents User B from reading or targeting User A onboarding state', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: userBEmail, password, name: 'Onboarding User B' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userBEmail, password })
      .expect(201);
    const userBToken = login.body.accessToken as string;

    const current = await request(app.getHttpServer())
      .get('/api/v1/onboarding/goals/current')
      .set('Authorization', `Bearer ${userBToken}`)
      .expect(200);
    expect(current.body).toEqual({ success: true, data: null });

    await request(app.getHttpServer())
      .post('/api/v1/onboarding/goals')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        userId,
        targetLevelId: levelId,
        dailyMinutes: 20,
        reminderEnabled: false,
        reminderTime: null,
        startDate: '2026-08-20',
      })
      .expect(400);

    const userAGoal = await prisma.userGoal.findFirstOrThrow({
      where: { userId, isActive: true },
      select: { id: true },
    });
    const userAPlan = await prisma.learningPlan.findFirstOrThrow({
      where: { userId, status: 'active' },
      select: { id: true },
    });
    expect(userAGoal.id).toBe(currentGoalId);
    expect(userAPlan.id).toBe(currentPlanId);
  });

  it('16. rejects a previously valid JWT after the account is suspended', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'suspended' },
    });

    await request(app.getHttpServer())
      .get('/api/v1/onboarding/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('also rejects a previously valid JWT after the account is anonymized', async () => {
    const anonymizedEmail = `onboarding-anonymized-${suffix}@example.com`;
    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ anonymizedEmail, email: anonymizedEmail, password })
      .expect(400);

    expect(register.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('property anonymizedEmail'),
      ]),
    );

    const validRegister = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: anonymizedEmail, password })
      .expect(201);
    const anonymizedToken = validRegister.body.accessToken as string;

    await prisma.user.update({
      where: { email: anonymizedEmail },
      data: {
        email: `anonymized-${suffix}@invalid.local`,
        name: null,
        status: 'anonymized',
        deletedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .get('/api/v1/onboarding/status')
      .set('Authorization', `Bearer ${anonymizedToken}`)
      .expect(401);
  });
});
