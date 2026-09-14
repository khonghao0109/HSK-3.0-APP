import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

import { UserService } from './user.service';

const USER_ITEM_FIELDS = ['createdAt', 'email', 'id', 'name', 'role'];

describe('UserService', () => {
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const transaction = jest.fn((operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  const prisma = {
    user: { findFirst, findMany, count },
    $transaction: transaction,
  } as unknown as PrismaService;
  let service: UserService;

  const firstCall = (mock: jest.Mock) =>
    mock.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
      skip?: number;
      take?: number;
      orderBy?: unknown;
    };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserService(prisma);
  });

  describe('getAllUsers', () => {
    const items = [{ id: 41 }, { id: 42 }];

    beforeEach(() => {
      findMany.mockResolvedValue(items);
      count.mockResolvedValue(45);
    });

    it.each([
      [1, 20, 0],
      [2, 20, 20],
      [3, 20, 40],
      [5, 7, 28],
      [1, 100, 0],
    ])(
      'reads page %i with limit %i from offset %i in id order',
      async (page, limit, skip) => {
        await service.getAllUsers({ page, limit });

        expect(firstCall(findMany)).toMatchObject({
          skip,
          take: limit,
          orderBy: { id: 'asc' },
        });
      },
    );

    it('returns the page with total and page count from one transaction', async () => {
      await expect(
        service.getAllUsers({ page: 3, limit: 20 }),
      ).resolves.toEqual({
        success: true,
        data: items,
        meta: { page: 3, limit: 20, total: 45, totalPages: 3 },
      });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(count).toHaveBeenCalledTimes(1);
    });

    it.each([
      [0, 20, 0],
      [1, 20, 1],
      [20, 20, 1],
      [21, 20, 2],
      [40, 20, 2],
      [101, 100, 2],
    ])(
      'reports %i users with limit %i as %i pages',
      async (total, limit, totalPages) => {
        count.mockResolvedValue(total);

        await expect(
          service.getAllUsers({ page: 1, limit }),
        ).resolves.toMatchObject({ meta: { total, totalPages } });
      },
    );

    it('excludes soft-deleted users from both the page and the total', async () => {
      await service.getAllUsers({ page: 1, limit: 20 });

      expect(firstCall(findMany).where).toEqual({ deletedAt: null });
      expect(firstCall(count).where).toEqual({ deletedAt: null });
    });

    it('selects only public profile fields', async () => {
      await service.getAllUsers({ page: 1, limit: 20 });

      expect(Object.keys(firstCall(findMany).select ?? {}).sort()).toEqual(
        USER_ITEM_FIELDS,
      );
    });
  });

  describe('getProfile', () => {
    it('reads only an active, not soft-deleted account', async () => {
      findFirst.mockResolvedValue({ id: 7 });

      await expect(service.getProfile(7)).resolves.toEqual({ id: 7 });

      expect(firstCall(findFirst).where).toEqual({
        id: 7,
        status: 'active',
        deletedAt: null,
      });
      expect(Object.keys(firstCall(findFirst).select ?? {}).sort()).toEqual(
        USER_ITEM_FIELDS,
      );
    });

    it('answers 404 when the account is soft-deleted or inactive', async () => {
      findFirst.mockResolvedValue(null);

      await expect(service.getProfile(7)).rejects.toThrow(
        new NotFoundException('User not found.'),
      );
    });
  });
});
