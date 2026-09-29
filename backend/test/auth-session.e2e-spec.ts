/// <reference types="jest" />

import { createHash } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Auth Session & Refresh Token E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

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
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  const getJwtSecretAndKid = () => {
    const secrets =
      configService.get<Record<string, string>>('jwt.secrets') ?? {};
    const activeKid = configService.get<string>('jwt.activeKid') ?? 'v1';
    const secret = secrets[activeKid];
    return { secret, activeKid };
  };

  // P7 & P11: DB raw token isolation, register/login token issuance & rotation
  it('login and register issue 43-char base64url refresh tokens stored as sha256 hash, and rotating works', async () => {
    const email = `session_p11_${Date.now()}@example.com`;

    // 1. Register issues both tokens
    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Session User' })
      .expect(201);

    expect(registerRes.body.data).toHaveProperty('accessToken');
    expect(registerRes.body.data).toHaveProperty('refreshToken');
    expect(registerRes.body.data).toHaveProperty('refreshTokenExpiresAt');

    const regRefreshToken = registerRes.body.data.refreshToken as string;
    expect(regRefreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      new Date(registerRes.body.data.refreshTokenExpiresAt).getTime(),
    ).toBeGreaterThan(Date.now());

    // P7: Verify DB isolation - DB contains only sha256 hex, never raw token
    const expectedRegHash = createHash('sha256')
      .update(regRefreshToken)
      .digest('hex');
    const regSession = await prisma.userSession.findUnique({
      where: { tokenHash: expectedRegHash },
    });
    expect(regSession).toBeDefined();
    expect(regSession?.tokenHash).toBe(expectedRegHash);
    const sessionJson = JSON.stringify(regSession);
    expect(sessionJson).not.toContain(regRefreshToken);

    // 2. Login issues new session tokens
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);

    const loginAccessToken = loginRes.body.data.accessToken as string;
    const loginRefreshToken = loginRes.body.data.refreshToken as string;
    expect(loginRefreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loginRefreshToken).not.toBe(regRefreshToken);

    // Verify /auth/me returns 200 with new access token
    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginAccessToken}`)
      .expect(200);
    expect(meRes.body.data.user.email).toBe(email);

    // 3. POST /auth/refresh rotates the token
    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRefreshToken })
      .expect(200);

    const newAccessToken = refreshRes.body.data.accessToken as string;
    const newRefreshToken = refreshRes.body.data.refreshToken as string;
    expect(newRefreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newRefreshToken).not.toBe(loginRefreshToken);

    // Access token from refresh works on /auth/me
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(200);

    // Old refresh token cannot be used again
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRefreshToken })
      .expect(401);
  });

  // P12: Session revocation, missing sid, and malformed sid validation
  it('access token with revoked session returns 401; missing sid returns 401; non-numeric sid returns 401 (not 500)', async () => {
    const email = `session_p12_${Date.now()}@example.com`;

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'P12 User' })
      .expect(201);

    const accessToken = loginRes.body.data.accessToken as string;
    const user = loginRes.body.data.user;

    // Verify token works
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    // Revoke all sessions of this user directly in DB
    await prisma.$executeRaw`
      UPDATE "UserSession"
      SET "revokedAt" = CURRENT_TIMESTAMP,
          "revocationReason" = 'admin_action'
      WHERE "userId" = ${user.id}
    `;

    // Access token is rejected immediately with 401
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    // Token signed properly but missing sid -> 401
    const { secret, activeKid } = getJwtSecretAndKid();
    const tokenWithoutSid = await jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { secret, header: { kid: activeKid, alg: 'HS256' } },
    );
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenWithoutSid}`)
      .expect(401);

    // Token with string sid -> 401 (not 500!)
    const tokenWithStringSid = await jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role, sid: 'not-a-number' },
      { secret, header: { kid: activeKid, alg: 'HS256' } },
    );
    const malformedRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenWithStringSid}`);
    expect(malformedRes.status).toBe(401);
  });

  // P13 & P9: Reuse detection revokes all sessions of user and rejects future requests
  it('reusing rotated token returns 401 and revokes ALL user sessions with refresh_reuse', async () => {
    const email = `session_p13_${Date.now()}@example.com`;

    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'P13 User' })
      .expect(201);

    const tokenR1 = registerRes.body.data.refreshToken as string;

    // First rotation succeeds
    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokenR1 })
      .expect(200);

    const tokenA2 = refreshRes.body.data.accessToken as string;

    // Reuse old token R1 -> triggers reuse detection
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokenR1 })
      .expect(401);

    // P9 & F6: Assert DB state after 401: session1 is rotated, session2 is refresh_reuse
    const hash1 = createHash('sha256').update(tokenR1).digest('hex');
    const tokenR2 = refreshRes.body.data.refreshToken as string;
    const hash2 = createHash('sha256').update(tokenR2).digest('hex');

    const session1 = await prisma.userSession.findUniqueOrThrow({
      where: { tokenHash: hash1 },
    });
    const session2 = await prisma.userSession.findUniqueOrThrow({
      where: { tokenHash: hash2 },
    });

    expect(session1.revokedAt).not.toBeNull();
    expect(session1.revocationReason).toBe('rotated');
    expect(session2.revokedAt).not.toBeNull();
    expect(session2.revocationReason).toBe('refresh_reuse');

    // Access token A2 from the rotated session is now rejected with 401
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenA2}`)
      .expect(401);
  });

  // P14: Concurrent refresh with identical token results in exactly one 200 and one 401, leaving no active session
  it('concurrent refresh: 2 parallel requests yield exactly one 200 and one 401, leaving 0 active sessions', async () => {
    const email = `session_p14_${Date.now()}@example.com`;

    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'P14 User' })
      .expect(201);

    const rawRefreshToken = registerRes.body.data.refreshToken as string;
    const userId = registerRes.body.data.user.id as number;

    // Run 2 parallel refresh requests with identical refresh token
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rawRefreshToken }),
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rawRefreshToken }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 401]);

    // Check DB: no active session remains (the loser detected rotation and revoked all active sessions)
    const activeSessions = await prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    expect(activeSessions.length).toBe(0);

    // The access token issued to the winning response is also dead
    const winningRes = resA.status === 200 ? resA : resB;
    const winningAccessToken = winningRes.body.data.accessToken as string;
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${winningAccessToken}`)
      .expect(401);
  });

  it('deterministic C1 race: forced lock interleaving proves reuse revokes winning session', async () => {
    const email = `session_f2_${Date.now()}@example.com`;

    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'F2 User' })
      .expect(201);

    const rawRefreshToken = registerRes.body.data.refreshToken as string;
    const userId = registerRes.body.data.user.id as number;

    // 1. Hold an ACCESS EXCLUSIVE lock on the "User" table in a dedicated test transaction
    let releaseLock!: () => void;
    const lockWaitPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    let lockAcquiredResolve!: () => void;
    const lockAcquiredPromise = new Promise<void>((resolve) => {
      lockAcquiredResolve = resolve;
    });

    const lockTxPromise = prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          'LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE',
        );
        lockAcquiredResolve();
        await lockWaitPromise;
      },
      { timeout: 30000, maxWait: 10000 },
    );

    await lockAcquiredPromise;

    // 2. Dispatch refresh A (do not await, but trigger execution via .then)
    const reqAPromise = request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rawRefreshToken })
      .then((res) => res);

    // Poll pg_stat_activity until backend A reaches wait_event_type = 'Lock'
    const startTime = Date.now();
    const deadline = startTime + 10000;
    let backendBlocked = false;

    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<
        Array<{
          pid: number;
          state: string;
          wait_event_type: string | null;
          wait_event: string | null;
          query: string;
        }>
      >`
          SELECT pid, state, wait_event_type, wait_event, query
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid != pg_backend_pid()
        `;

      const blocked = rows.filter((r) => r.wait_event_type === 'Lock');
      if (blocked.length > 0) {
        backendBlocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(backendBlocked).toBe(true);

    // 3. Dispatch refresh B with the same refresh token
    let bCompletedEarly = false;
    const reqBPromise = request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rawRefreshToken })
      .then((res) => {
        bCompletedEarly = true;
        return res;
      });

    const pollStart = Date.now();
    const pollDeadline = pollStart + 10000;
    let bReachedState = false;

    while (Date.now() < pollDeadline) {
      if (bCompletedEarly) {
        bReachedState = true;
        break;
      }
      const blockedBackends = await prisma.$queryRaw<
        Array<{ pid: number; wait_event_type: string | null }>
      >`
          SELECT pid, wait_event_type
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid != pg_backend_pid()
            AND wait_event_type = 'Lock'
        `;
      if (blockedBackends.length >= 2) {
        bReachedState = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(bReachedState).toBe(true);

    // Release table lock
    releaseLock();
    await lockTxPromise;

    const [resA, resB] = await Promise.all([reqAPromise, reqBPromise]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 401]);

    // 4. Assert: NO active session remains for this user
    const activeSessions = await prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    expect(activeSessions.length).toBe(0);

    const winningRes = resA.status === 200 ? resA : resB;
    const winningAccessToken = winningRes.body.data.accessToken as string;
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${winningAccessToken}`)
      .expect(401);
  }, 20000);

  // P15 & P9: Expired session returns 401; suspended user causes 401 and marks session account_inactive
  it('expired session returns 401; suspended user refresh returns 401 with account_inactive in DB', async () => {
    const email = `session_p15_${Date.now()}@example.com`;

    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'P15 User' })
      .expect(201);

    const accessToken = registerRes.body.data.accessToken as string;
    const refreshToken = registerRes.body.data.refreshToken as string;
    const userId = registerRes.body.data.user.id as number;

    // 1. Expire session in DB by shifting both createdAt and expiresAt (respecting CHECK constraint)
    await prisma.$executeRaw`
      UPDATE "UserSession"
      SET "createdAt" = CURRENT_TIMESTAMP - INTERVAL '40 days',
          "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '10 days'
      WHERE "userId" = ${userId}
    `;

    // Access token now rejected with 401
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    // Refresh token is expired -> 401
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    // 2. Suspended account
    const suspendedEmail = `session_p15_suspended_${Date.now()}@example.com`;
    const suspendedReg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: suspendedEmail, password, name: 'Suspended User' })
      .expect(201);

    const suspendedAccessToken = suspendedReg.body.data.accessToken as string;
    const suspendedRefreshToken = suspendedReg.body.data.refreshToken as string;
    const suspendedUserId = suspendedReg.body.data.user.id as number;

    // Suspend user in DB
    await prisma.user.update({
      where: { id: suspendedUserId },
      data: { status: 'suspended' },
    });

    // Refresh fails with 401
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: suspendedRefreshToken })
      .expect(401);

    // P9: Assert DB state after 401: session is revoked with account_inactive
    const suspendedHash = createHash('sha256')
      .update(suspendedRefreshToken)
      .digest('hex');
    const sessionInDb = await prisma.userSession.findUnique({
      where: { tokenHash: suspendedHash },
    });
    expect(sessionInDb?.revokedAt).not.toBeNull();
    expect(sessionInDb?.revocationReason).toBe('account_inactive');

    // Access token is rejected with 401
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${suspendedAccessToken}`)
      .expect(401);
  });
});
