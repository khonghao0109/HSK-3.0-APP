import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';

import { JOB_NAMES } from '../../infrastructure/jobs/job-queue.port';
import { PostgresThrottlerStorage } from '../../infrastructure/rate-limit/postgres-throttler.storage';
import { PrismaService } from '../../prisma/prisma.service';

import { loginIpLimit, refreshIpLimit } from './auth.controller';
import { AuthService, LOGIN_EMAIL_FAILURE_LIMIT } from './auth.service';

type SqlCall = [{ sql: string; values: unknown[] }];

describe('AuthService login throttling and lockout', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const create = jest.fn();
  const queryRaw = jest.fn();
  const executeRaw = jest.fn();
  const queryRawUnsafe = jest.fn();
  const executeRawUnsafe = jest.fn();
  const userSessionFindUnique = jest.fn();
  const transaction = jest.fn();
  const prisma = {
    user: { findUnique, update, create },
    userSession: { findUnique: userSessionFindUnique },
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $queryRawUnsafe: queryRawUnsafe,
    $executeRawUnsafe: executeRawUnsafe,
    $transaction: transaction,
  } as unknown as PrismaService;
  const increment = jest.fn();
  const reset = jest.fn();
  const storage = { increment, reset } as unknown as PostgresThrottlerStorage;
  const jobQueue = {
    send: jest.fn().mockResolvedValue('job-id-1'),
  };
  const signAsync = jest.fn().mockResolvedValue('signed-token');
  const jwtService = {
    signAsync,
  } as unknown as JwtService;
  const configService = {
    get: jest.fn((key: string) =>
      key === 'jwt.secrets'
        ? { v1: 'unit-test-jwt-secret' }
        : key === 'jwt.activeKid'
          ? 'v1'
          : key === 'jwt.refreshTokenTtlDays'
            ? 30
            : undefined,
    ),
  } as unknown as ConfigService;

  const activeUser = {
    id: 7,
    email: 'learner@example.com',
    password: '$argon2id$v=19$m=65536,t=3,p=1$stored',
    role: 'user',
    name: null,
    status: 'active',
    deletedAt: null,
  };
  const emailKey = createHash('sha256')
    .update('login:email:learner@example.com')
    .digest('hex');

  let service: AuthService;
  let verifyPassword: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      prisma,
      jwtService,
      configService,
      storage,
      jobQueue,
    );
    verifyPassword = jest.spyOn(
      service as unknown as { verifyPassword: () => Promise<boolean> },
      'verifyPassword',
    );
    increment.mockResolvedValue({ isBlocked: false });
    findUnique.mockResolvedValue(activeUser);
    queryRaw.mockResolvedValue([
      {
        id: 7,
        userId: 7,
        tokenHash: 'default-token-hash',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
        revocationReason: null,
      },
    ]);
    update.mockResolvedValue({});
    executeRaw.mockResolvedValue(1);
    transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
  });

  const login = (email = '  Learner@Example.COM ', password = 'secret-pass') =>
    service.login({ email, password });

  it('throttles by the normalized email under a hashed key before any lookup', async () => {
    increment.mockResolvedValue({ isBlocked: true });

    await expect(login()).rejects.toBeInstanceOf(ThrottlerException);

    expect(increment).toHaveBeenCalledWith(
      emailKey,
      15 * 60_000,
      LOGIN_EMAIL_FAILURE_LIMIT,
      15 * 60_000,
    );
    expect(emailKey).not.toContain('learner');
    expect(findUnique).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('rejects a locked account without verifying the password', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(login()).rejects.toThrow(
      new ForbiddenException(
        'Account temporarily locked. Please try again later.',
      ),
    );

    expect(verifyPassword).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('claims the attempt atomically in one guarded UPDATE before verifying', async () => {
    verifyPassword.mockImplementation(() => {
      expect(queryRaw).toHaveBeenCalledTimes(1);
      return Promise.resolve(false);
    });

    await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);

    const [sql] = queryRaw.mock.calls[0] as SqlCall;
    expect(sql.sql).toMatch(/UPDATE "User"/u);
    expect(sql.sql).toContain('"failedLoginAttempts" + 1');
    expect(sql.sql).toContain(
      `"lockUntil" <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`,
    );
    expect(sql.values).toEqual(expect.arrayContaining([7, 5, 15]));
    expect(update).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  describe('unknown and inactive accounts', () => {
    const realHashPrefix = /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/u;

    it.each([
      ['an unknown email', null],
      ['a suspended account', { ...activeUser, status: 'suspended' }],
      [
        'a soft-deleted account',
        { ...activeUser, status: 'anonymized', deletedAt: new Date() },
      ],
    ])(
      'answers %s with the generic 401 after a full decoy verification',
      async (_label, found) => {
        findUnique.mockResolvedValue(found);
        verifyPassword.mockResolvedValue(false);

        await expect(login()).rejects.toThrow(
          new UnauthorizedException('Invalid credentials'),
        );

        expect(increment).toHaveBeenCalledTimes(1);
        expect(verifyPassword).toHaveBeenCalledTimes(1);
        const [password, decoy] = verifyPassword.mock.calls[0] as [
          string,
          string,
        ];
        expect(password).toBe('secret-pass');
        // Same algorithm and cost parameters as a stored password hash.
        expect(decoy).toMatch(realHashPrefix);
        expect(decoy).not.toBe(activeUser.password);
        expect(queryRaw).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      },
    );

    it('rejects even the correct password of an inactive account', async () => {
      findUnique.mockResolvedValue({ ...activeUser, status: 'suspended' });
      verifyPassword.mockResolvedValue(true);

      await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(update).not.toHaveBeenCalled();
    });

    it('hashes the decoy once at module init and reuses it', async () => {
      const hashPassword = jest.spyOn(
        service as unknown as { hashPassword: () => Promise<string> },
        'hashPassword',
      );
      findUnique.mockResolvedValue(null);
      verifyPassword.mockResolvedValue(false);

      await service.onModuleInit();
      await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);

      expect(hashPassword).toHaveBeenCalledTimes(1);
      const decoys = verifyPassword.mock.calls.map((call) => call[1] as string);
      expect(new Set(decoys).size).toBe(1);
    });
  });

  describe('register', () => {
    const input = {
      email: ' New@Example.com ',
      password: 'Unique-pass-42',
      name: 'New',
    };

    it('returns 409 for an email that already exists', async () => {
      findUnique.mockResolvedValue({ id: 3 });

      await expect(service.register(input)).rejects.toThrow(
        new ConflictException('Email already exists'),
      );
      expect(create).not.toHaveBeenCalled();
    });

    it('returns 409 when a concurrent registration wins the unique index', async () => {
      findUnique.mockResolvedValue(null);
      jest
        .spyOn(
          service as unknown as { hashPassword: () => Promise<string> },
          'hashPassword',
        )
        .mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=1$stub');
      create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: Prisma.prismaVersion.client,
        }),
      );

      await expect(service.register(input)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not turn other database errors into 409', async () => {
      findUnique.mockResolvedValue(null);
      jest
        .spyOn(
          service as unknown as { hashPassword: () => Promise<string> },
          'hashPassword',
        )
        .mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=1$stub');
      create.mockRejectedValue(new Error('connection lost'));

      await expect(service.register(input)).rejects.toThrow('connection lost');
      expect(jobQueue.send).not.toHaveBeenCalled();
    });

    it('enqueues email-verification job within the transaction with userId and singletonKey', async () => {
      findUnique.mockResolvedValue(null);
      create.mockResolvedValue({
        id: 42,
        email: 'new@example.com',
        role: 'user',
        name: 'New',
      });
      jest
        .spyOn(
          service as unknown as { hashPassword: () => Promise<string> },
          'hashPassword',
        )
        .mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=1$stub');
      jest
        .spyOn(
          service as unknown as {
            createSessionAndSignToken: () => Promise<{
              accessToken: string;
              refreshToken: string;
              refreshTokenExpiresAt: string;
            }>;
          },
          'createSessionAndSignToken',
        )
        .mockResolvedValue({
          accessToken: 'signed-access-token',
          refreshToken: 'refresh-token',
          refreshTokenExpiresAt: '2026-10-30T00:00:00Z',
        });

      await service.register(input);

      expect(jobQueue.send).toHaveBeenCalledTimes(1);
      expect(jobQueue.send).toHaveBeenCalledWith(
        JOB_NAMES.SEND_EMAIL_VERIFICATION,
        { userId: 42 },
        expect.objectContaining({
          singletonKey: 'email-verification:42',
          tx: prisma,
        }),
      );
    });
  });

  it('clears lockout and the email failure counter after a successful login', async () => {
    verifyPassword.mockResolvedValue(true);

    const result = await login();
    expect(result).toEqual({
      user: { id: 7, email: 'learner@example.com', role: 'user', name: null },
      accessToken: 'signed-token',
      refreshToken: expect.any(String),
      refreshTokenExpiresAt: expect.any(String),
    });
    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({
        failedLoginAttempts: 0,
        lockUntil: null,
      }) as unknown,
    });
    expect(reset).toHaveBeenCalledWith(emailKey);
  });

  it.each([
    ['production', 10],
    ['development', 10],
    ['test', 1_000],
  ])('limits login per IP under NODE_ENV=%s to %i', (nodeEnv, limit) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = nodeEnv;
    try {
      expect(loginIpLimit()).toBe(limit);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it.each([
    ['production', 30],
    ['development', 30],
    ['test', 1_000],
  ])('limits refresh per IP under NODE_ENV=%s to %i', (nodeEnv, limit) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = nodeEnv;
    try {
      expect(refreshIpLimit()).toBe(limit);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  describe('refresh', () => {
    const rawToken = 'placeholder-refresh-token-43-chars-base64_';
    const mockSession = {
      id: 101,
      userId: 7,
      tokenHash: 'sample-hash',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      lastSeenAt: new Date(),
      revokedAt: null,
      revocationReason: null,
    };

    it('rotates refresh token and returns new session when claim succeeds and user active', async () => {
      queryRaw.mockResolvedValueOnce([mockSession]); // claim succeeds
      findUnique.mockResolvedValueOnce(activeUser); // user active
      queryRaw.mockResolvedValueOnce([{ ...mockSession, id: 102 }]); // new session

      const result = await service.refresh(rawToken);

      expect(result).toEqual({
        user: { id: 7, email: 'learner@example.com', role: 'user', name: null },
        accessToken: 'signed-token',
        refreshToken: expect.any(String),
        refreshTokenExpiresAt: expect.any(String),
      });
      expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 7, sid: 102 }),
        expect.anything(),
      );
    });

    it('marks session account_inactive and rejects with 401 when user is not active', async () => {
      queryRaw.mockResolvedValueOnce([mockSession]); // claim succeeds
      findUnique.mockResolvedValueOnce({ ...activeUser, status: 'suspended' }); // user suspended

      await expect(service.refresh(rawToken)).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );

      expect(executeRaw).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('account_inactive')]),
        101,
      );
    });

    it('does not revoke active sessions when rotated token is reused within grace period', async () => {
      queryRaw.mockResolvedValueOnce([]); // claim 0 rows
      queryRaw.mockResolvedValueOnce([
        { id: 101, userId: 7, isWithinGrace: true },
      ]);

      await expect(service.refresh(rawToken)).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );

      expect(executeRaw).not.toHaveBeenCalled();
    });

    it('revokes all active sessions with refresh_reuse when rotated token is reused outside grace period', async () => {
      queryRaw.mockResolvedValueOnce([]); // claim 0 rows
      queryRaw.mockResolvedValueOnce([
        { id: 101, userId: 7, isWithinGrace: false },
      ]);

      await expect(service.refresh(rawToken)).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );

      expect(executeRaw).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('refresh_reuse')]),
        7,
      );
    });

    it('returns 401 without revoking user sessions when token is unknown or expired', async () => {
      queryRaw.mockResolvedValueOnce([]); // claim 0 rows
      queryRaw.mockResolvedValueOnce([]); // not found or not rotated

      await expect(service.refresh(rawToken)).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );

      expect(executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes session matching sid when revokedAt is null with reason logout', async () => {
      await service.logout(101);

      expect(executeRaw).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('logout'),
          expect.stringContaining('"revokedAt" IS NULL'),
        ]),
        101,
      );
    });
  });

  describe('stored password format', () => {
    const submitted = 'secret-pass';
    // Cheap parameters keep the test fast; verify reads them from the hash.
    const cheap = { memoryCost: 1024, timeCost: 1, parallelism: 1 };
    let argon2idHash: string;
    let argon2iHash: string;

    beforeAll(async () => {
      argon2idHash = await argon2.hash(submitted, {
        ...cheap,
        type: argon2.argon2id,
      });
      argon2iHash = await argon2.hash(submitted, {
        ...cheap,
        type: argon2.argon2i,
      });
    });

    it.each([
      ['the submitted plaintext itself', () => submitted],
      ['a valid Argon2i hash of the password', () => argon2iHash],
      [
        'a bcrypt hash',
        () => '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      ],
      ['an empty value', () => ''],
      [
        'an Argon2id hash with a non-canonical prefix',
        () => argon2idHash.replace('$argon2id$', '$ARGON2ID$'),
      ],
    ])(
      'rejects a stored password that is %s and never re-hashes it',
      async (_label, stored) => {
        findUnique.mockResolvedValue({ ...activeUser, password: stored() });

        await expect(login(undefined, submitted)).rejects.toThrow(
          new UnauthorizedException('Invalid credentials'),
        );

        expect(update).not.toHaveBeenCalled();
        expect(reset).not.toHaveBeenCalled();
      },
    );

    it('accepts a real Argon2id hash without rewriting the stored password', async () => {
      findUnique.mockResolvedValue({ ...activeUser, password: argon2idHash });

      await expect(login(undefined, submitted)).resolves.toMatchObject({
        accessToken: 'signed-token',
      });

      expect(update).toHaveBeenCalledTimes(1);
      const [[{ data }]] = update.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      expect(data).not.toHaveProperty('password');
    });
  });

  describe('requestPasswordReset', () => {
    it('does not enqueue and resolves when user does not exist', async () => {
      findUnique.mockResolvedValueOnce(null);

      await expect(
        service.requestPasswordReset('notfound@example.com'),
      ).resolves.toBeUndefined();

      expect(jobQueue.send).not.toHaveBeenCalled();
    });

    it('does not enqueue and resolves when user is soft-deleted or suspended', async () => {
      findUnique.mockResolvedValueOnce({
        id: 11,
        status: 'suspended',
        deletedAt: null,
      });

      await expect(
        service.requestPasswordReset('suspended@example.com'),
      ).resolves.toBeUndefined();

      expect(jobQueue.send).not.toHaveBeenCalled();
    });

    it('does not enqueue and resolves when email rate limit exceeded', async () => {
      increment.mockResolvedValueOnce({ isBlocked: true, totalHits: 4 });

      await expect(
        service.requestPasswordReset('learner@example.com'),
      ).resolves.toBeUndefined();

      expect(jobQueue.send).not.toHaveBeenCalled();
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('enqueues job with payload { userId } and singletonKey when user is active', async () => {
      findUnique.mockResolvedValueOnce({
        id: 7,
        status: 'active',
        deletedAt: null,
      });

      await expect(
        service.requestPasswordReset('Learner@Example.COM '),
      ).resolves.toBeUndefined();

      expect(jobQueue.send).toHaveBeenCalledWith(
        JOB_NAMES.SEND_PASSWORD_RESET,
        { userId: 7 },
        { singletonKey: 'password-reset:7' },
      );
    });
  });

  describe('confirmPasswordReset', () => {
    it('throws BadRequestException INVALID_RESET_TOKEN when token claim returns 0 rows', async () => {
      queryRawUnsafe.mockResolvedValueOnce([]);

      await expect(
        service.confirmPasswordReset(
          'dummy-token-dummy-token-dummy-token-dummy-t',
          'NewValidPass123!',
        ),
      ).rejects.toThrow(
        new BadRequestException({
          code: 'INVALID_RESET_TOKEN',
          message: 'Password reset token is invalid or expired.',
        }),
      );
    });

    it('throws BadRequestException INVALID_RESET_TOKEN when user update returns 0 rows', async () => {
      queryRawUnsafe
        .mockResolvedValueOnce([{ userId: 7 }])
        .mockResolvedValueOnce([]);

      await expect(
        service.confirmPasswordReset(
          'dummy-token-dummy-token-dummy-token-dummy-t',
          'NewValidPass123!',
        ),
      ).rejects.toThrow(
        new BadRequestException({
          code: 'INVALID_RESET_TOKEN',
          message: 'Password reset token is invalid or expired.',
        }),
      );
    });

    it('updates password, revokes sessions, and cleans unused tokens on success', async () => {
      queryRawUnsafe
        .mockResolvedValueOnce([{ userId: 7 }])
        .mockResolvedValueOnce([{ id: 7 }]);
      executeRawUnsafe.mockResolvedValue(1);

      await expect(
        service.confirmPasswordReset(
          'dummy-token-dummy-token-dummy-token-dummy-t',
          'NewValidPass123!',
        ),
      ).resolves.toBeUndefined();

      expect(executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "UserSession"'),
        7,
      );
      expect(executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "PasswordResetToken"'),
        7,
      );
    });
  });
});
