/// <reference types="jest" />

import { createHash, randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import {
  AuthService,
  LOGIN_EMAIL_FAILURE_LIMIT,
} from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

const CONCURRENT_ATTEMPTS = 20;
const MAX_ATTEMPTS = 5;
const PASSWORD = 'Correct-horse-9';
const WRONG_PASSWORD = 'Wrong-password-9';

describe('Login lockout and email throttle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifyPassword: jest.SpyInstance;
  const suffix = randomUUID();

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

  beforeEach(() => {
    // Calls through; counts Argon2 verifications on the shared service instance.
    verifyPassword = jest.spyOn(AuthService.prototype as any, 'verifyPassword');
  });

  afterEach(() => {
    verifyPassword.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });

  async function registerUser(
    label: string,
  ): Promise<{ id: number; email: string }> {
    const email = `lockout-${label}-${suffix}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);
    return { id: response.body.user.id as number, email };
  }

  function statusCounts(statuses: number[]): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }

  const emailCounterKey = (email: string) =>
    createHash('sha256').update(`login:email:${email}`).digest('hex');

  it('admits only the email budget when an unknown email is attacked concurrently', async () => {
    const email = `ghost-${suffix}@example.com`;

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_ATTEMPTS }, () =>
        login(email, WRONG_PASSWORD),
      ),
    );

    expect(statusCounts(responses.map((response) => response.status))).toEqual({
      401: LOGIN_EMAIL_FAILURE_LIMIT,
      429: CONCURRENT_ATTEMPTS - LOGIN_EMAIL_FAILURE_LIMIT,
    });
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('claims lockout attempts atomically under concurrent wrong passwords', async () => {
    const user = await registerUser('concurrent');
    // Three earlier failures whose email window has already expired.
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 3 },
    });
    const before = Date.now();

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_ATTEMPTS }, (_, index) =>
        // Case variants must share one email budget (IsEmail already rejects
        // surrounding whitespace; the service trims as well).
        login(
          index % 2 ? user.email.toUpperCase() : user.email,
          WRONG_PASSWORD,
        ),
      ),
    );

    expect(statusCounts(responses.map((response) => response.status))).toEqual({
      401: 2,
      403: LOGIN_EMAIL_FAILURE_LIMIT - 2,
      429: CONCURRENT_ATTEMPTS - LOGIN_EMAIL_FAILURE_LIMIT,
    });
    expect(verifyPassword).toHaveBeenCalledTimes(2);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { failedLoginAttempts: true, lockUntil: true },
    });
    expect(row.failedLoginAttempts).toBe(5);
    // Read back through Prisma as UTC: must be ~15 minutes ahead of this clock.
    expect(row.lockUntil?.getTime()).toBeGreaterThanOrEqual(
      before + 14 * 60_000,
    );
    expect(row.lockUntil?.getTime()).toBeLessThanOrEqual(
      Date.now() + 16 * 60_000,
    );
  });

  it('rejects a locked account without hashing, then accepts it once the lock expires', async () => {
    const user = await registerUser('locked');
    await prisma.user.update({
      where: { id: user.id },
      data: { lockUntil: new Date(Date.now() + 10 * 60_000) },
    });

    await login(user.email, PASSWORD).expect(403);
    expect(verifyPassword).not.toHaveBeenCalled();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 5,
        lockUntil: new Date(Date.now() - 60_000),
      },
    });
    await login(user.email, PASSWORD).expect(201);
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { failedLoginAttempts: true, lockUntil: true },
      }),
    ).resolves.toEqual({ failedLoginAttempts: 0, lockUntil: null });
  });

  it('locks at the threshold sequentially and resets the email budget on success', async () => {
    const user = await registerUser('sequential');

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      await login(user.email, WRONG_PASSWORD).expect(401);
    }
    await login(user.email, PASSWORD).expect(201);
    await expect(
      prisma.rateLimitCounter.findUnique({
        where: { key: emailCounterKey(user.email) },
      }),
    ).resolves.toBeNull();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await login(user.email, WRONG_PASSWORD).expect(401);
    }
    await login(user.email, PASSWORD).expect(429);

    // Once the email window is gone, the account lock still holds.
    await prisma.rateLimitCounter.delete({
      where: { key: emailCounterKey(user.email) },
    });
    await login(user.email, PASSWORD).expect(403);
  });
});
