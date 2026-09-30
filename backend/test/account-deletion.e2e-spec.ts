/// <reference types="jest" />

import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import {
  JOB_NAMES,
  JobQueuePort,
} from '../src/infrastructure/jobs/job-queue.port';
import { InMemoryJobQueue } from '../src/infrastructure/jobs/in-memory-job-queue.adapter';
import { InMemoryMailerAdapter } from '../src/infrastructure/mail/in-memory-mailer.adapter';
import { AnonymizeAccountJob } from '../src/modules/user/jobs/anonymize-account.job';
import { SendAccountDeletionScheduledJob } from '../src/modules/user/jobs/send-account-deletion-scheduled.job';
import { UserService } from '../src/modules/user/user.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type EnvelopeResponse<T> = {
  success: boolean;
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
  };
};

type DeletionResponse = {
  requestId: number;
  scheduledAt: string;
};

describe('Account Deletion E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inMemoryQueue: InMemoryJobQueue;
  let inMemoryMailer: InMemoryMailerAdapter;
  let anonymizeHandler: AnonymizeAccountJob;
  let mailHandler: SendAccountDeletionScheduledJob;
  let userService: UserService;

  const prefix = `e2e_del_${Date.now()}`;
  const password = 'Password123!';
  const emailFor = (label: string) => `${prefix}_${label}@example.com`;
  const http = () => request(app.getHttpServer());

  const registerUser = async (
    label: string,
  ): Promise<{ token: string; userId: number; email: string }> => {
    const email = emailFor(label);
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, password, name: `User ${label}` })
      .expect(HttpStatus.CREATED);

    const envelope = res.body as EnvelopeResponse<{ accessToken: string }>;
    const token = envelope.data.accessToken;
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    return { token, userId: user.id, email };
  };

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

    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    userService = app.get(UserService);

    const queuePort = app.get<JobQueuePort>(JobQueuePort);
    expect(queuePort).toBeInstanceOf(InMemoryJobQueue);
    inMemoryQueue = queuePort as InMemoryJobQueue;

    inMemoryMailer = new InMemoryMailerAdapter();
    const config = app.get(ConfigService);
    anonymizeHandler = new AnonymizeAccountJob(null, prisma, config);
    mailHandler = new SendAccountDeletionScheduledJob(
      null,
      prisma,
      inMemoryMailer,
      config,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    inMemoryQueue.clear();
    inMemoryMailer.clear();
  });

  it('P1: wrong password returns 400 INVALID_PASSWORD and database remains unchanged', async () => {
    const { token, userId } = await registerUser('p1');

    const res = await http()
      .post('/api/v1/users/me/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'WrongPassword456!' })
      .expect(HttpStatus.BAD_REQUEST);

    expect(res.body.error.code).toBe('INVALID_PASSWORD');

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user.status).toBe('active');
    expect(user.deletedAt).toBeNull();

    const requestCount = await prisma.accountDeletionRequest.count({
      where: { userId },
    });
    expect(requestCount).toBe(0);
  });

  it('P2 & P3: correct password returns 202, revokes session, sets deletion_pending, and enqueues 2 jobs', async () => {
    const { token, userId } = await registerUser('p2');

    const res = await http()
      .post('/api/v1/users/me/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .send({ password, reason: 'Temporary break' })
      .expect(HttpStatus.ACCEPTED);

    const envelope = res.body as EnvelopeResponse<DeletionResponse>;
    expect(envelope.data.requestId).toBeGreaterThan(0);
    expect(envelope.data.scheduledAt).toBeDefined();

    const { requestId, scheduledAt } = envelope.data;

    // Previous access token is revoked immediately
    await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.UNAUTHORIZED);

    // Database reflects deletion_pending and deletedAt set
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user.status).toBe('deletion_pending');
    expect(user.deletedAt).not.toBeNull();

    // All active sessions are revoked
    const activeSessions = await prisma.userSession.count({
      where: { userId, revokedAt: null },
    });
    expect(activeSessions).toBe(0);

    // P3: exactly 2 jobs enqueued
    const anonJobs = inMemoryQueue.getJobsByName(JOB_NAMES.ANONYMIZE_ACCOUNT);
    expect(anonJobs.length).toBe(1);
    expect(anonJobs[0].data).toEqual({ requestId });
    expect(anonJobs[0].options?.singletonKey).toBe(`anonymize:${requestId}`);
    expect(anonJobs[0].options?.startAfter).toBeDefined();

    const scheduledDate = new Date(scheduledAt).getTime();
    const jobStartDate = anonJobs[0].options?.startAfter
      ? new Date(anonJobs[0].options.startAfter).getTime()
      : 0;
    expect(Math.abs(jobStartDate - scheduledDate)).toBeLessThanOrEqual(1000);

    const mailJobs = inMemoryQueue.getJobsByName(
      JOB_NAMES.SEND_ACCOUNT_DELETION_SCHEDULED,
    );
    expect(mailJobs.length).toBe(1);
    expect(mailJobs[0].data).toEqual({ requestId });
    expect(mailJobs[0].options?.singletonKey).toBe(
      `deletion-mail:${requestId}`,
    );

    const mailProcessed = await mailHandler.process({ requestId });
    expect(mailProcessed).toBe(true);
  });

  it('P4: idempotent when duplicate requests submitted in parallel', async () => {
    const { userId } = await registerUser('p4');

    const [res1, res2] = await Promise.all([
      userService.requestAccountDeletion(userId, { password }),
      userService.requestAccountDeletion(userId, { password }),
    ]);

    expect(res1.requestId).toBe(res2.requestId);

    const count = await prisma.accountDeletionRequest.count({
      where: { userId },
    });
    expect(count).toBe(1);
  });

  it('P5: login during grace period cancels deletion, reactivates account, and anonymize handler skips', async () => {
    const { token, userId, email } = await registerUser('p5');

    const delRes = await http()
      .post('/api/v1/users/me/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .send({ password })
      .expect(HttpStatus.ACCEPTED);

    const envelope = delRes.body as EnvelopeResponse<DeletionResponse>;
    const requestId = envelope.data.requestId;

    // Login with correct password during grace period
    const loginRes = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(HttpStatus.CREATED);

    const loginEnvelope = loginRes.body as EnvelopeResponse<{
      accessToken: string;
    }>;
    expect(loginEnvelope.data.accessToken).toBeDefined();

    // Verify account reactivated
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user.status).toBe('active');
    expect(user.deletedAt).toBeNull();

    // Verify request cancelled
    const requestRow = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(requestRow.status).toBe('cancelled');
    expect(requestRow.cancelledAt).not.toBeNull();

    // Running anonymize handler later does nothing
    const processResult = await anonymizeHandler.process({ requestId });
    expect(processResult).toBe(true);

    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(userAfter.status).toBe('active');
    expect(userAfter.email).toBe(email);
  });

  it('P6: H.7 decoy timing protection; wrong password or inactive account returns 401', async () => {
    // 1. Wrong password during grace period -> 401
    const { token, email } = await registerUser('p6_pending');
    const delRes = await http()
      .post('/api/v1/users/me/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .send({ password })
      .expect(HttpStatus.ACCEPTED);

    const reqId = (delRes.body as EnvelopeResponse<DeletionResponse>).data
      .requestId;

    await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword789!' })
      .expect(HttpStatus.UNAUTHORIZED);

    const reqStillPending =
      await prisma.accountDeletionRequest.findUniqueOrThrow({
        where: { id: reqId },
      });
    expect(reqStillPending.status).toBe('requested');

    // 2. Suspended account -> 401
    const { email: suspEmail, userId: suspUserId } =
      await registerUser('p6_susp');
    await prisma.user.update({
      where: { id: suspUserId },
      data: { status: 'suspended' },
    });

    await http()
      .post('/api/v1/auth/login')
      .send({ email: suspEmail, password })
      .expect(HttpStatus.UNAUTHORIZED);

    // 3. Anonymized account -> 401
    const { email: anonEmail, userId: anonUserId } =
      await registerUser('p6_anon');
    await prisma.user.update({
      where: { id: anonUserId },
      data: { status: 'anonymized' },
    });

    await http()
      .post('/api/v1/auth/login')
      .send({ email: anonEmail, password })
      .expect(HttpStatus.UNAUTHORIZED);

    // 4. Expired deletion_pending -> 401
    const { token: expToken, email: expEmail } = await registerUser('p6_exp');
    const expDelRes = await http()
      .post('/api/v1/users/me/deletion-request')
      .set('Authorization', `Bearer ${expToken}`)
      .send({ password })
      .expect(HttpStatus.ACCEPTED);

    const expReqId = (expDelRes.body as EnvelopeResponse<DeletionResponse>).data
      .requestId;

    // Shift scheduledAt to the past via raw SQL
    await prisma.$executeRawUnsafe(
      `UPDATE "AccountDeletionRequest" SET "scheduledAt" = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id = $1`,
      expReqId,
    );

    await http()
      .post('/api/v1/auth/login')
      .send({ email: expEmail, password })
      .expect(HttpStatus.UNAUTHORIZED);

    const expReqStillPending =
      await prisma.accountDeletionRequest.findUniqueOrThrow({
        where: { id: expReqId },
      });
    expect(expReqStillPending.status).toBe('requested');
  });

  it('P7, P8, P9, P10: full anonymization, idempotency, email release, and zero PII', async () => {
    const { token, userId, email } = await registerUser('p7_full');

    // Add profile and historical consent
    await prisma.userProfile.create({
      data: {
        userId,
        displayName: 'Learner One',
        locale: 'vi-VN',
        timezone: 'Asia/Ho_Chi_Minh',
      },
    });

    await prisma.consent.create({
      data: {
        userId,
        type: 'terms',
        consentVersion: '1.0',
        policyVersion: '1.0',
      },
    });

    const delRes = await http()
      .post('/api/v1/users/me/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .send({ password, reason: 'Confidential personal reason' })
      .expect(HttpStatus.ACCEPTED);

    const requestId = (delRes.body as EnvelopeResponse<DeletionResponse>).data
      .requestId;

    // Shift scheduledAt to past
    await prisma.$executeRawUnsafe(
      `UPDATE "AccountDeletionRequest" SET "scheduledAt" = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id = $1`,
      requestId,
    );

    // Run anonymization handler (P7)
    const processed = await anonymizeHandler.process({ requestId });
    expect(processed).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user.email).toBe(`deleted+${userId}@anonymized.invalid`);
    expect(user.name).toBeNull();
    expect(user.status).toBe('anonymized');

    const profile = await prisma.userProfile.findUniqueOrThrow({
      where: { userId },
    });
    expect(profile.displayName).toBeNull();
    expect(profile.avatarUrl).toBeNull();
    expect(profile.locale).toBe('vi-VN');
    expect(profile.timezone).toBe('Asia/Ho_Chi_Minh');

    const sessions = await prisma.userSession.count({ where: { userId } });
    expect(sessions).toBe(0);

    const resetTokens = await prisma.passwordResetToken.count({
      where: { userId },
    });
    expect(resetTokens).toBe(0);

    const verifTokens = await prisma.emailVerificationToken.count({
      where: { userId },
    });
    expect(verifTokens).toBe(0);

    const reqRow = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(reqRow.status).toBe('completed');
    expect(reqRow.reason).toBeNull();
    expect(reqRow.completedAt).not.toBeNull();

    // Historical consent record retained
    const consentCount = await prisma.consent.count({ where: { userId } });
    expect(consentCount).toBe(1);

    // P8: handler is idempotent on rerun
    const rerun = await anonymizeHandler.process({ requestId });
    expect(rerun).toBe(true);

    const userAfterRerun = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(userAfterRerun.email).toBe(`deleted+${userId}@anonymized.invalid`);

    // P9: original email is released and can register again with a new user ID
    const reRegRes = await http()
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Re-registered User' })
      .expect(HttpStatus.CREATED);

    const newUserId = (
      reRegRes.body as EnvelopeResponse<{ user: { id: number } }>
    ).data.user.id;
    expect(newUserId).not.toBe(userId);

    // P10: AuditLog contains zero PII (no email, no reason, no password)
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        actorId: userId,
        targetType: 'User',
      },
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(2);

    for (const log of auditLogs) {
      const beforeStr = JSON.stringify(log.beforeSummary);
      const afterStr = JSON.stringify(log.afterSummary);
      expect(beforeStr).not.toContain(email);
      expect(beforeStr).not.toContain('Confidential personal reason');
      expect(beforeStr).not.toContain(password);
      expect(afterStr).not.toContain(email);
      expect(afterStr).not.toContain('Confidential personal reason');
      expect(afterStr).not.toContain(password);
    }
  });
});
