import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../../prisma/prisma.service';

import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const findUnique = jest.fn();
  const prisma = {
    user: { findUnique },
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
    findUnique.mockResolvedValue({
      id: 7,
      email: 'current@example.com',
      role: 'admin',
      status: 'active',
      deletedAt: null,
    });

    await expect(
      strategy.validate({
        sub: 7,
        email: 'stale@example.com',
        role: 'user',
      }),
    ).resolves.toEqual({
      id: 7,
      email: 'current@example.com',
      role: 'admin',
    });
  });

  it.each(['suspended', 'deletion_pending', 'anonymized'] as const)(
    'rejects a token after the account becomes %s',
    async (status) => {
      findUnique.mockResolvedValue({
        id: 7,
        email: 'user@example.com',
        role: 'user',
        status,
        deletedAt: status === 'anonymized' ? new Date() : null,
      });

      await expect(
        strategy.validate({ sub: 7, email: 'user@example.com', role: 'user' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('rejects a deleted or missing account without exposing which state occurred', async () => {
    findUnique.mockResolvedValueOnce({
      id: 7,
      email: 'user@example.com',
      role: 'user',
      status: 'active',
      deletedAt: new Date(),
    });

    const validation = strategy.validate({
      sub: 7,
      email: 'user@example.com',
      role: 'user',
    });
    await expect(validation).rejects.toMatchObject({
      message: 'Account is not available.',
    });

    findUnique.mockResolvedValueOnce(null);
    await expect(
      strategy.validate({ sub: 8, email: 'missing@example.com', role: 'user' }),
    ).rejects.toMatchObject({ message: 'Account is not available.' });
  });
});
