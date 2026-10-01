/// <reference types="jest" />

import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import {
  JOB_NAMES,
  JobQueuePort,
} from '../src/infrastructure/jobs/job-queue.port';
import { InMemoryJobQueue } from '../src/infrastructure/jobs/in-memory-job-queue.adapter';
import { InMemoryMailerAdapter } from '../src/infrastructure/mail/in-memory-mailer.adapter';
import { SendEmailVerificationJob } from '../src/modules/auth/jobs/send-email-verification.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Email Verification E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inMemoryQueue: InMemoryJobQueue;
  let inMemoryMailer: InMemoryMailerAdapter;
  let workerHandler: SendEmailVerificationJob;

  const password = 'Password123!';

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
    const queuePort = app.get<JobQueuePort>(JobQueuePort);
    expect(queuePort).toBeInstanceOf(InMemoryJobQueue);
    inMemoryQueue = queuePort as InMemoryJobQueue;

    inMemoryMailer = new InMemoryMailerAdapter();
    workerHandler = new SendEmailVerificationJob(
      null,
      prisma,
      inMemoryMailer,
      app.get(ConfigService),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    inMemoryQueue.clear();
    inMemoryMailer.clear();
  });

  it('register enqueues exactly 1 job with payload { userId } only (P1 & P2)', async () => {
    const email = `reg_verify_${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Register Verify User' })
      .expect(201);

    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data.user.email).toBe(email);

    const jobs = inMemoryQueue.getJobsByName(JOB_NAMES.SEND_EMAIL_VERIFICATION);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toEqual({ userId: res.body.data.user.id });
    // Assert payload strictly has only userId (no raw token, no password, no email)
    expect(Object.keys(jobs[0].data)).toEqual(['userId']);
  });

  it('full verification lifecycle: handler generates token -> confirm 204 -> DB emailVerifiedAt set (P3)', async () => {
    const email = `full_verify_${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Full Verify' })
      .expect(201);

    const userId = regRes.body.data.user.id;

    // Run worker handler
    const processed = await workerHandler.process({ userId });
    expect(processed).toBe(true);

    expect(inMemoryMailer.sentMessages).toHaveLength(1);
    const sent = inMemoryMailer.sentMessages[0];
    expect(sent.to).toBe(email);

    // Extract raw token from fragment: #token=<raw>
    const match = sent.text.match(/#token=([A-Za-z0-9_-]{43})/);
    expect(match).not.toBeNull();
    const token = match![1];

    // Confirm email verification
    await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/confirm')
      .send({ token })
      .expect(HttpStatus.NO_CONTENT);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    expect(user?.emailVerifiedAt).not.toBeNull();

    // Confirming a second time with the same token returns 400 with same code (P3 & P4)
    const secondRes = await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/confirm')
      .send({ token })
      .expect(HttpStatus.BAD_REQUEST);

    expect(secondRes.body.success).toBe(false);
    expect(secondRes.body.error.code).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('rejects expired token with 400 (P4)', async () => {
    const email = `expired_verify_${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Expired Verify' })
      .expect(201);

    const userId = regRes.body.data.user.id;
    await workerHandler.process({ userId });

    const tokenMatch = inMemoryMailer.sentMessages[0].text.match(
      /#token=([A-Za-z0-9_-]{43})/,
    );
    const token = tokenMatch![1];
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Manually expire token using SQL while satisfying expiresAt > createdAt
    await prisma.$executeRawUnsafe(
      `UPDATE "EmailVerificationToken"
       SET "createdAt" = CURRENT_TIMESTAMP - INTERVAL '2 days',
           "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 day'
       WHERE "tokenHash" = $1`,
      tokenHash,
    );

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/confirm')
      .send({ token })
      .expect(HttpStatus.BAD_REQUEST);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('rejects wrong token with 400 (P4)', async () => {
    const wrongToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/confirm')
      .send({ token: wrongToken })
      .expect(HttpStatus.BAD_REQUEST);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('handles concurrent confirm requests safely: exactly one 204 and one 400 (P3)', async () => {
    const email = `race_verify_${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Race Verify' })
      .expect(201);

    const userId = regRes.body.data.user.id;
    await workerHandler.process({ userId });

    const tokenMatch = inMemoryMailer.sentMessages[0].text.match(
      /#token=([A-Za-z0-9_-]{43})/,
    );
    const token = tokenMatch![1];

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/email-verification/confirm')
        .send({ token }),
      request(app.getHttpServer())
        .post('/api/v1/auth/email-verification/confirm')
        .send({ token }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([204, 400]);

    const failed = resA.status === 400 ? resA : resB;
    expect(failed.body.error.code).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('request when already verified returns 204 without enqueuing new job', async () => {
    const email = `already_verified_${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Already Verified' })
      .expect(201);

    const accessToken = regRes.body.data.accessToken;
    const userId = regRes.body.data.user.id;

    // Verify user directly in DB
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });

    inMemoryQueue.clear();

    await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(HttpStatus.NO_CONTENT);

    expect(
      inMemoryQueue.getJobsByName(JOB_NAMES.SEND_EMAIL_VERIFICATION),
    ).toHaveLength(0);
  });

  it('throttles email verification request on the 4th attempt in 15 minutes (P8)', async () => {
    const email = `throttle_req_${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Throttle Req' })
      .expect(201);

    const accessToken = regRes.body.data.accessToken;

    // Requests 1, 2, 3 return 204
    await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(HttpStatus.NO_CONTENT);

    await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(HttpStatus.NO_CONTENT);

    await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(HttpStatus.NO_CONTENT);

    // Request 4 returns 429 Too Many Requests
    const throttledRes = await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/request')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(HttpStatus.TOO_MANY_REQUESTS);

    expect(throttledRes.body.success).toBe(false);
  });
});
