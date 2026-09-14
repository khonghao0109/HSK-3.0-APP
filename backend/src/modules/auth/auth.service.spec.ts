import {
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

import { PostgresThrottlerStorage } from '../../infrastructure/rate-limit/postgres-throttler.storage';
import { PrismaService } from '../../prisma/prisma.service';

import { loginIpLimit } from './auth.controller';
import { AuthService, LOGIN_EMAIL_FAILURE_LIMIT } from './auth.service';

type SqlCall = [{ sql: string; values: unknown[] }];

describe('AuthService login throttling and lockout', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const create = jest.fn();
  const queryRaw = jest.fn();
  const prisma = {
    user: { findUnique, update, create },
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
    });
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
});
