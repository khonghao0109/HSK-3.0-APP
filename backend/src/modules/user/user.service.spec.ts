import { BadRequestException, NotFoundException } from '@nestjs/common';

import { JOB_NAMES } from '../../infrastructure/jobs/job-queue.port';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPasswordWithPepper } from '../auth/utils/password-hasher';

import { UserService } from './user.service';

const USER_ITEM_FIELDS = ['createdAt', 'email', 'id', 'name', 'role'];

describe('UserService', () => {
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const findUniqueProfile = jest.fn();
  const queryRaw = jest.fn();
  const executeRaw = jest.fn();
  const auditLogCreate = jest.fn();
  const txPrisma = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    auditLog: { create: auditLogCreate },
  };
  const transaction = jest.fn((cbOrArray: unknown) =>
    typeof cbOrArray === 'function'
      ? (cbOrArray as (tx: unknown) => unknown)(txPrisma)
      : Promise.all(cbOrArray as Promise<unknown>[]),
  );
  const prisma = {
    user: { findFirst, findMany, count },
    userProfile: { findUnique: findUniqueProfile },
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $transaction: transaction,
  } as unknown as PrismaService;
  const config = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'AUTH_PASSWORD_PEPPER') return 'test-pepper';
      return null;
    }),
  } as never;
  const jobQueue = {
    send: jest.fn().mockResolvedValue('job-1'),
  };
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
    service = new UserService(prisma, config, jobQueue as never);
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

  describe('getUserProfile', () => {
    it('answers 404 when user is not found or inactive', async () => {
      findFirst.mockResolvedValue(null);

      await expect(service.getUserProfile(7)).rejects.toThrow(
        new NotFoundException('User not found.'),
      );
    });

    it('returns default profile when no UserProfile row exists without creating one', async () => {
      findFirst.mockResolvedValue({ id: 7 });
      findUniqueProfile.mockResolvedValue(null);

      const result = await service.getUserProfile(7);
      expect(result).toEqual({
        displayName: null,
        locale: 'vi-VN',
        timezone: 'Asia/Ho_Chi_Minh',
      });
      expect(findUniqueProfile).toHaveBeenCalledWith({
        where: { userId: 7 },
        select: {
          displayName: true,
          locale: true,
          timezone: true,
        },
      });
    });

    it('returns stored profile when UserProfile row exists', async () => {
      findFirst.mockResolvedValue({ id: 7 });
      findUniqueProfile.mockResolvedValue({
        displayName: 'Nguyễn Văn A',
        locale: 'vi-VN',
        timezone: 'Asia/Ho_Chi_Minh',
      });

      const result = await service.getUserProfile(7);
      expect(result).toEqual({
        displayName: 'Nguyễn Văn A',
        locale: 'vi-VN',
        timezone: 'Asia/Ho_Chi_Minh',
      });
    });
  });

  describe('updateUserProfile', () => {
    it('answers 404 when user is not found or inactive', async () => {
      findFirst.mockResolvedValue(null);

      await expect(
        service.updateUserProfile(7, { displayName: 'New Name' }),
      ).rejects.toThrow(new NotFoundException('User not found.'));
    });

    it('executes parameterized upsert and returns updated profile', async () => {
      findFirst.mockResolvedValue({ id: 7 });
      queryRaw.mockResolvedValue([
        {
          displayName: 'New Name',
          locale: 'vi-VN',
          timezone: 'UTC',
        },
      ]);

      const result = await service.updateUserProfile(7, {
        displayName: '  New Name  ',
        timezone: 'UTC',
      });

      expect(result).toEqual({
        displayName: 'New Name',
        locale: 'vi-VN',
        timezone: 'UTC',
      });
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when raw query returns no rows', async () => {
      findFirst.mockResolvedValue({ id: 7 });
      queryRaw.mockResolvedValue([]);

      await expect(
        service.updateUserProfile(7, { displayName: 'New Name' }),
      ).rejects.toThrow(
        new NotFoundException('User profile could not be updated.'),
      );
    });
  });

  describe('requestAccountDeletion', () => {
    let validHash: string;

    beforeAll(async () => {
      validHash = await hashPasswordWithPepper(
        'CorrectPass123!',
        'test-pepper',
      );
    });

    it('answers 404 when user is not found or inactive', async () => {
      findFirst.mockResolvedValue(null);

      await expect(
        service.requestAccountDeletion(7, { password: 'any' }),
      ).rejects.toThrow(new NotFoundException('User not found.'));
    });

    it('throws BadRequestException INVALID_PASSWORD when password is wrong and does not modify DB', async () => {
      findFirst.mockResolvedValue({
        id: 7,
        password: validHash,
        status: 'active',
        deletedAt: null,
      });

      await expect(
        service.requestAccountDeletion(7, { password: 'WrongPassword' }),
      ).rejects.toThrow(
        new BadRequestException({
          code: 'INVALID_PASSWORD',
          message: 'Invalid password.',
        }),
      );

      expect(transaction).not.toHaveBeenCalled();
    });

    it('returns existing request if a requested request already exists (idempotent)', async () => {
      const scheduledAt = new Date('2026-10-07T00:00:00Z');
      findFirst.mockResolvedValue({
        id: 7,
        password: validHash,
        status: 'active',
        deletedAt: null,
      });
      queryRaw
        .mockResolvedValueOnce([{ id: 7, status: 'active', deletedAt: null }])
        .mockResolvedValueOnce([{ id: 99, scheduledAt }]);

      const result = await service.requestAccountDeletion(7, {
        password: 'CorrectPass123!',
      });

      expect(result).toEqual({ requestId: 99, scheduledAt });
      expect(executeRaw).not.toHaveBeenCalled();
    });

    it('creates AccountDeletionRequest, updates user, enqueues jobs in tx, and writes AuditLog', async () => {
      const scheduledAt = new Date('2026-10-07T00:00:00Z');
      findFirst.mockResolvedValue({
        id: 7,
        password: validHash,
        status: 'active',
        deletedAt: null,
      });
      queryRaw
        .mockResolvedValueOnce([{ id: 7, status: 'active', deletedAt: null }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 101, scheduledAt }]);

      const result = await service.requestAccountDeletion(7, {
        password: 'CorrectPass123!',
        reason: 'No longer needed',
      });

      expect(result).toEqual({ requestId: 101, scheduledAt });
      expect(executeRaw).toHaveBeenCalled();
      expect(jobQueue.send).toHaveBeenCalledTimes(2);
      expect(jobQueue.send).toHaveBeenCalledWith(
        JOB_NAMES.ANONYMIZE_ACCOUNT,
        { requestId: 101 },
        expect.objectContaining({
          startAfter: scheduledAt,
          singletonKey: 'anonymize:101',
        }),
      );
      expect(jobQueue.send).toHaveBeenCalledWith(
        JOB_NAMES.SEND_ACCOUNT_DELETION_SCHEDULED,
        { requestId: 101 },
        expect.objectContaining({
          singletonKey: 'deletion-mail:101',
        }),
      );
      expect(auditLogCreate).toHaveBeenCalledWith({
        data: {
          actorId: 7,
          action: 'account.deletion_requested',
          targetType: 'User',
          targetId: '7',
          afterSummary: {
            requestId: 101,
            scheduledAt: scheduledAt.toISOString(),
          },
        },
      });
    });
  });
});
