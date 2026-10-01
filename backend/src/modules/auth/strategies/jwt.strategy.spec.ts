import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../../prisma/prisma.service';

import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const findFirst = jest.fn();
  const prisma = {
    userSession: { findFirst },
  } as unknown as PrismaService;
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'jwt.secrets') {
        return { v1: 'unit-test-jwt-secret' };
      }

      if (key === 'jwt.activeKid') {
        return 'v1';
      }

      return undefined;
    }),
  } as unknown as ConfigService;

  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(configService, prisma);
  });

  it('accepts an active account and uses current database identity fields', async () => {
    findFirst.mockResolvedValue({
      user: {
        id: 7,
        email: 'current@example.com',
        role: 'admin',
      },
    });

    await expect(
      strategy.validate({
        sub: 7,
        email: 'stale@example.com',
        role: 'user',
        sid: 101,
      }),
    ).resolves.toEqual({
      id: 7,
      email: 'current@example.com',
      role: 'admin',
      sid: 101,
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 101,
        userId: 7,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) as unknown },
        user: {
          id: 7,
          status: 'active',
          deletedAt: null,
        },
      },
      select: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });
  });

  it.each(['suspended', 'deletion_pending', 'anonymized'] as const)(
    'rejects a token after the account becomes %s',
    async () => {
      findFirst.mockResolvedValue(null);

      await expect(
        strategy.validate({
          sub: 7,
          email: 'user@example.com',
          role: 'user',
          sid: 101,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('rejects a deleted or missing account without exposing which state occurred', async () => {
    findFirst.mockResolvedValueOnce(null);

    const validation = strategy.validate({
      sub: 7,
      email: 'user@example.com',
      role: 'user',
      sid: 101,
    });
    await expect(validation).rejects.toMatchObject({
      message: 'Account is not available.',
    });

    findFirst.mockResolvedValueOnce(null);
    await expect(
      strategy.validate({
        sub: 8,
        email: 'missing@example.com',
        role: 'user',
        sid: 102,
      }),
    ).rejects.toMatchObject({ message: 'Account is not available.' });
  });

  it('rejects a token missing sid', async () => {
    await expect(
      strategy.validate({
        sub: 7,
        email: 'user@example.com',
        role: 'user',
      }),
    ).rejects.toThrow(new UnauthorizedException('Account is not available.'));

    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each(['101', 0, -1, 1.5, NaN, Infinity, null, undefined, 2147483648])(
    'rejects non-safe-integer positive sid: %s',
    async (sid) => {
      await expect(
        strategy.validate({
          sub: 7,
          email: 'user@example.com',
          role: 'user',
          sid,
        }),
      ).rejects.toThrow(new UnauthorizedException('Account is not available.'));

      expect(findFirst).not.toHaveBeenCalled();
    },
  );
});
