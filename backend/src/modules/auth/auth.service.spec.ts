import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerException } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

import { PostgresThrottlerStorage } from '../../infrastructure/rate-limit/postgres-throttler.storage';
import { PrismaService } from '../../prisma/prisma.service';

import { loginIpLimit } from './auth.controller';
import { AuthService, LOGIN_EMAIL_FAILURE_LIMIT } from './auth.service';

type SqlCall = [{ sql: string; values: unknown[] }];

describe('AuthService login throttling and lockout', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const queryRaw = jest.fn();
  const prisma = {
    user: { findUnique, update },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  const increment = jest.fn();
  const reset = jest.fn();
  const storage = { increment, reset } as unknown as PostgresThrottlerStorage;
  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('signed-token'),
  } as unknown as JwtService;
  const configService = {
    get: jest.fn((key: string) =>
      key === 'jwt.secrets'
        ? { v1: 'unit-test-jwt-secret' }
        : key === 'jwt.activeKid'
          ? 'v1'
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
    service = new AuthService(prisma, jwtService, configService, storage);
    verifyPassword = jest.spyOn(
      service as unknown as { verifyPassword: () => Promise<boolean> },
      'verifyPassword',
    );
    increment.mockResolvedValue({ isBlocked: false });
    findUnique.mockResolvedValue(activeUser);
    queryRaw.mockResolvedValue([{ id: 7 }]);
    update.mockResolvedValue({});
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

  it('keeps unknown emails on the email budget without touching lockout', async () => {
    findUnique.mockResolvedValue(null);

    await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);

    expect(increment).toHaveBeenCalledTimes(1);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('does not claim an attempt for an inactive account', async () => {
    findUnique.mockResolvedValue({ ...activeUser, status: 'suspended' });

    await expect(login()).rejects.toBeInstanceOf(ForbiddenException);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('clears lockout and the email failure counter after a successful login', async () => {
    verifyPassword.mockResolvedValue(true);

    await expect(login()).resolves.toEqual({
      user: { id: 7, email: 'learner@example.com', role: 'user', name: null },
      accessToken: 'signed-token',
    });

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
});
