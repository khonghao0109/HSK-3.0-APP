/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Strict JSON boolean contract E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let levelId: number;
  let lessonId: number;
  let adminToken: string;
  let userToken: string;

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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
    prisma = app.get(PrismaService);

    const level = await prisma.level.create({
      data: {
        code: 'HSK6',
        name: 'HSK 6',
        orderIndex: 6,
        minBand: 6,
        maxBand: 6,
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    levelId = level.id;
    lessonId = (
      await prisma.lesson.create({
        data: {
          levelId,
          title: 'Strict Boolean Parent',
          orderIndex: 1,
          slug: `strict-boolean-${suffix}`,
        },
        select: { id: true },
      })
    ).id;

    const admin = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `strict-admin-${suffix}@example.com`,
        password,
      })
      .expect(201);
    await prisma.user.update({
      where: { id: admin.body.data.user.id as number },
      data: { role: 'admin' },
    });
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: `strict-admin-${suffix}@example.com`,
          password,
        })
        .expect(201)
    ).body.data.accessToken as string;

    userToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `strict-user-${suffix}@example.com`,
          password,
        })
        .expect(201)
    ).body.data.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['string false', 'false'],
    ['string true', 'true'],
    ['zero', 0],
    ['one', 1],
    ['null', null],
    ['object', { value: false }],
    ['array', [false]],
  ])('rejects CMS Topic isPremium as %s', async (_label, invalidValue) => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/topics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        lessonId,
        title: `Invalid premium ${String(_label)}`,
        subtitle: null,
        type: 'vocabulary',
        content: [{ type: 'text', value: 'Strict boolean.' }],
        orderIndex: 100 + argumentsIndex(_label),
        isPremium: invalidValue,
        isLocked: false,
      })
      .expect(400);
  });

  it.each([
    ['string false', 'false'],
    ['string true', 'true'],
    ['zero', 0],
    ['one', 1],
    ['null', null],
    ['object', { value: false }],
    ['array', [false]],
  ])('rejects CMS Topic isLocked as %s', async (_label, invalidValue) => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/topics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        lessonId,
        title: `Invalid locked ${String(_label)}`,
        subtitle: null,
        type: 'vocabulary',
        content: [{ type: 'text', value: 'Strict boolean.' }],
        orderIndex: 200 + argumentsIndex(_label),
        isPremium: false,
        isLocked: invalidValue,
      })
      .expect(400);
  });

  it.each([
    ['string false', 'false', '20:30'],
    ['string true', 'true', '20:30'],
    ['zero', 0, null],
    ['one', 1, '20:30'],
    ['null', null, null],
    ['object', { value: false }, '20:30'],
    ['array', [false], '20:30'],
  ])(
    'rejects onboarding reminderEnabled as %s',
    async (_label, invalidValue, reminderTime) => {
      await request(app.getHttpServer())
        .post('/api/v1/onboarding/goals')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          targetLevelId: levelId,
          dailyMinutes: 30,
          reminderEnabled: invalidValue,
          reminderTime,
          startDate: '2026-08-11',
        })
        .expect(400);
    },
  );

  it.each([false, true])(
    'accepts real JSON boolean %s while preserving numeric query conversion',
    async (booleanValue) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/cms/topics')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lessonId,
          title: `Valid boolean ${String(booleanValue)}`,
          subtitle: null,
          type: 'vocabulary',
          content: [{ type: 'text', value: 'Strict boolean.' }],
          orderIndex: booleanValue ? 302 : 301,
          isPremium: booleanValue,
          isLocked: booleanValue,
        })
        .expect(201);
      expect(response.body.data.topic).toMatchObject({
        isPremium: booleanValue,
        isLocked: booleanValue,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/cms/lessons')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ levelId: String(levelId), page: '1', limit: '20' })
        .expect(200);
    },
  );
});

function argumentsIndex(label: unknown): number {
  return [
    'string false',
    'string true',
    'zero',
    'one',
    'null',
    'object',
    'array',
  ].indexOf(String(label));
}
