/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Auth E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userEmail = `e2e_user_${Date.now()}@example.com`;
  const adminEmail = `e2e_admin_${Date.now()}@example.com`;
  const password = 'Test123!';

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
    await app.listen(0, '127.0.0.1');

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('register -> login -> me should work', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: userEmail, password, name: 'E2E User' })
      .expect(201);

    expect(registerRes.body).toHaveProperty('accessToken');

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userEmail, password })
      .expect(201);

    expect(loginRes.body).toHaveProperty('accessToken');
    const token = loginRes.body.accessToken as string;

    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(meRes.body.user.email).toBe(userEmail);
  });

  it('GET /users with user role should return 403', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userEmail, password })
      .expect(201);

    const userToken = loginRes.body.accessToken as string;

    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('GET /users with admin role should return 200', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password, name: 'E2E Admin' })
      .expect(201);

    await prisma.user.update({
      where: { email: adminEmail },
      data: { role: 'admin' },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password })
      .expect(201);

    const adminToken = loginRes.body.accessToken as string;

    const usersRes = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(usersRes.body).toMatchObject({ page: 1, limit: 20 });
    expect(Array.isArray(usersRes.body.items)).toBe(true);
  });

  it('returns 409 for a duplicate registration, including concurrent ones', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: userEmail.toUpperCase(), password })
      .expect(409);

    const racedEmail = `e2e_race_${Date.now()}@example.com`;
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ email: racedEmail, password }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409, 409, 409, 409,
    ]);
    expect(
      responses.find((response) => response.status === 409)?.body,
    ).toMatchObject({ statusCode: 409, message: 'Email already exists' });
  });

  it('answers unknown and suspended accounts with the generic 401 after an Argon2 verification', async () => {
    const verifyPassword = jest.spyOn(
      AuthService.prototype as any,
      'verifyPassword',
    );
    try {
      const suspendedEmail = `e2e_suspended_${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: suspendedEmail, password })
        .expect(201);
      await prisma.user.update({
        where: { email: suspendedEmail },
        data: { status: 'suspended' },
      });

      for (const email of [
        `e2e_unknown_${Date.now()}@example.com`,
        suspendedEmail,
      ]) {
        verifyPassword.mockClear();
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password })
          .expect(401);
        expect(response.body).toMatchObject({ message: 'Invalid credentials' });
        expect(verifyPassword).toHaveBeenCalledTimes(1);
        expect(verifyPassword.mock.calls[0]?.[1]).toMatch(/^\$argon2id\$/u);
      }
    } finally {
      verifyPassword.mockRestore();
    }
  });

  it('rejects stored passwords that are not Argon2id and leaves them untouched', async () => {
    const plaintext = 'Legacy-plaintext-1';
    const pepper = app.get(ConfigService).get<string>('AUTH_PASSWORD_PEPPER');
    const argon2iHash = await argon2.hash(`${plaintext}${pepper ?? ''}`, {
      type: argon2.argon2i,
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    });

    for (const [label, stored] of [
      ['plaintext', plaintext],
      ['argon2i', argon2iHash],
    ]) {
      const email = `e2e_legacy_${label}_${Date.now()}@example.com`;
      await prisma.user.create({ data: { email, password: stored } });

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: plaintext })
        .expect(401);

      await expect(
        prisma.user.findUniqueOrThrow({
          where: { email },
          select: { password: true, lastLoginAt: true },
        }),
      ).resolves.toEqual({ password: stored, lastLoginAt: null });
    }
  });
});
