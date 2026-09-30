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
import { SendPasswordResetJob } from '../src/modules/auth/jobs/send-password-reset.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Password Reset E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inMemoryQueue: InMemoryJobQueue;
  let inMemoryMailer: InMemoryMailerAdapter;
  let workerHandler: SendPasswordResetJob;

  const initialPassword = 'InitialPassword123!';
  const updatedPassword = 'UpdatedPassword123!';

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
    workerHandler = new SendPasswordResetJob(
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

  it('P1: request response is identical for existing and non-existing email (anti-enumeration)', async () => {
    const existingEmail = `exist_pwd_${Date.now()}@example.com`;
    const nonExistingEmail = `nonexist_pwd_${Date.now()}@example.com`;

    // Register active user
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: existingEmail,
        password: initialPassword,
        name: 'Existing User',
      })
      .expect(HttpStatus.CREATED);

    inMemoryQueue.clear();

    const resExisting = await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/request')
      .send({ email: existingEmail });

    const resNonExisting = await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/request')
      .send({ email: nonExistingEmail });

    expect(resExisting.status).toBe(HttpStatus.NO_CONTENT);
    expect(resNonExisting.status).toBe(HttpStatus.NO_CONTENT);

    expect(resExisting.body).toEqual(resNonExisting.body);
    expect(resExisting.text).toEqual(resNonExisting.text);
  });

  it('P2: payload job has only userId', async () => {
    const email = `job_payload_${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: initialPassword, name: 'Payload User' })
      .expect(HttpStatus.CREATED);

    const userId = regRes.body.data.user.id;
    inMemoryQueue.clear();

    await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/request')
      .send({ email })
      .expect(HttpStatus.NO_CONTENT);

    const jobs = inMemoryQueue.getJobsByName(JOB_NAMES.SEND_PASSWORD_RESET);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toEqual({ userId });
    expect(Object.keys(jobs[0].data)).toEqual(['userId']);
  });

  it('P3: throttles after 3 requests per hour per email returning 204 without enqueuing job', async () => {
    const email = `throttle_email_${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: initialPassword, name: 'Throttle User' })
      .expect(HttpStatus.CREATED);

    // Requests 1, 2, 3 return 204 and enqueue
    for (let i = 1; i <= 3; i++) {
      inMemoryQueue.clear();
      await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/request')
        .send({ email })
        .expect(HttpStatus.NO_CONTENT);

      expect(
        inMemoryQueue.getJobsByName(JOB_NAMES.SEND_PASSWORD_RESET),
      ).toHaveLength(1);
    }

    // Request 4 for the same email still returns 204 (anti-enumeration) but does NOT enqueue a 4th job
    inMemoryQueue.clear();
    await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/request')
      .send({ email })
      .expect(HttpStatus.NO_CONTENT);

    expect(
      inMemoryQueue.getJobsByName(JOB_NAMES.SEND_PASSWORD_RESET),
    ).toHaveLength(0);
  });

  it('P4 & P5: confirm updates password, allows login with new password, revokes sessions', async () => {
    const email = `full_reset_${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: initialPassword, name: 'Full Reset User' })
      .expect(HttpStatus.CREATED);

    const initialAccessToken = regRes.body.data.accessToken;
    const initialRefreshToken = regRes.body.data.refreshToken;
    const userId = regRes.body.data.user.id;

    // Verify initial access token works
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${initialAccessToken}`)
      .expect(HttpStatus.OK);

    // Request password reset
    inMemoryQueue.clear();
    await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/request')
      .send({ email })
      .expect(HttpStatus.NO_CONTENT);

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

    // Confirm password reset
    await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, newPassword: updatedPassword })
      .expect(HttpStatus.NO_CONTENT);

    // P4: Login with new password succeeds (201), login with old password fails (401)
    const newLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: updatedPassword })
      .expect(HttpStatus.CREATED);
    expect(newLoginRes.body.data).toHaveProperty('accessToken');

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: initialPassword })
      .expect(HttpStatus.UNAUTHORIZED);

    // P5: Old access token is now revoked (401)
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${initialAccessToken}`)
      .expect(HttpStatus.UNAUTHORIZED);

    // P5: Old refresh token is also revoked (401)
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: initialRefreshToken })
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('P6: token is one-time use; concurrent confirms result in exactly [204, 400]', async () => {
    const email = `race_reset_${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: initialPassword, name: 'Race User' })
      .expect(HttpStatus.CREATED);

    const userId = regRes.body.data.user.id;
    await workerHandler.process({ userId });

    const tokenMatch = inMemoryMailer.sentMessages[0].text.match(
      /#token=([A-Za-z0-9_-]{43})/,
    );
    const token = tokenMatch![1];

    // Concurrent confirms
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token, newPassword: 'FirstPassword123!' }),
      request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token, newPassword: 'SecondPassword123!' }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([204, 400]);

    const failed = resA.status === 400 ? resA : resB;
    expect(failed.body.error.code).toBe('INVALID_RESET_TOKEN');

    // Confirming a second time after success also returns 400 INVALID_RESET_TOKEN
    const thirdRes = await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, newPassword: 'ThirdPassword123!' })
      .expect(HttpStatus.BAD_REQUEST);

    expect(thirdRes.body.error.code).toBe('INVALID_RESET_TOKEN');
  });

  it('P7: uniform error code for invalid/expired/used/suspended and rollback preserves usedAt IS NULL', async () => {
    // 1. Wrong token (valid format, unknown in DB)
    const wrongToken = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const wrongRes = await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token: wrongToken, newPassword: updatedPassword })
      .expect(HttpStatus.BAD_REQUEST);

    expect(wrongRes.body.error.code).toBe('INVALID_RESET_TOKEN');

    // 2. Expired token
    const emailExpired = `expired_pwd_${Date.now()}@example.com`;
    const regExpired = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: emailExpired, password: initialPassword })
      .expect(HttpStatus.CREATED);

    await workerHandler.process({ userId: regExpired.body.data.user.id });
    const expiredTokenMatch = inMemoryMailer.sentMessages[0].text.match(
      /#token=([A-Za-z0-9_-]{43})/,
    );
    const expiredToken = expiredTokenMatch![1];
    const expiredTokenHash = createHash('sha256')
      .update(expiredToken)
      .digest('hex');

    await prisma.$executeRawUnsafe(
      `UPDATE "PasswordResetToken"
       SET "createdAt" = CURRENT_TIMESTAMP - INTERVAL '2 days',
           "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 day'
       WHERE "tokenHash" = $1`,
      expiredTokenHash,
    );

    const expiredRes = await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token: expiredToken, newPassword: updatedPassword })
      .expect(HttpStatus.BAD_REQUEST);

    expect(expiredRes.body.error.code).toBe('INVALID_RESET_TOKEN');

    // 3. User suspended between request and confirm
    inMemoryMailer.clear();
    const emailSuspended = `suspended_pwd_${Date.now()}@example.com`;
    const regSuspended = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: emailSuspended, password: initialPassword })
      .expect(HttpStatus.CREATED);

    const suspendedUserId = regSuspended.body.data.user.id;
    await workerHandler.process({ userId: suspendedUserId });

    const suspendedTokenMatch = inMemoryMailer.sentMessages[0].text.match(
      /#token=([A-Za-z0-9_-]{43})/,
    );
    const suspendedToken = suspendedTokenMatch![1];
    const suspendedTokenHash = createHash('sha256')
      .update(suspendedToken)
      .digest('hex');

    // Suspend user
    await prisma.user.update({
      where: { id: suspendedUserId },
      data: { status: 'suspended' },
    });

    const suspendedRes = await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token: suspendedToken, newPassword: updatedPassword })
      .expect(HttpStatus.BAD_REQUEST);

    expect(suspendedRes.body.error.code).toBe('INVALID_RESET_TOKEN');

    // Check DB: because transaction rolled back, token.usedAt MUST STILL BE NULL!
    const tokenRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: suspendedTokenHash },
    });
    expect(tokenRecord?.usedAt).toBeNull();
  });

  it('P8: blacklisted password rejected with 400 and password is not echoed in response body', async () => {
    const blacklistedPassword = 'password';
    const email = `blacklist_pwd_${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: initialPassword })
      .expect(HttpStatus.CREATED);

    await workerHandler.process({ userId: regRes.body.data.user.id });
    const tokenMatch = inMemoryMailer.sentMessages[0].text.match(
      /#token=([A-Za-z0-9_-]{43})/,
    );
    const token = tokenMatch![1];

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, newPassword: blacklistedPassword })
      .expect(HttpStatus.BAD_REQUEST);

    // Verify password is not echoed in body
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(blacklistedPassword);
    expect(res.body.success).toBe(false);
  });
});
