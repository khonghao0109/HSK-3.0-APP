import { UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { lockActiveCmsActor } from './cms-actor-lock';

describe('lockActiveCmsActor', () => {
  it('locks only an active, non-deleted admin with a shared row lock', async () => {
    const queryRaw = jest.fn((query: Prisma.Sql) => {
      const sql = query.strings.join('?');
      expect(sql).toContain("role = 'admin'");
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain('"deletedAt" IS NULL');
      expect(sql).toContain('FOR SHARE');
      return Promise.resolve([{ id: 7 }]);
    });
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await expect(lockActiveCmsActor(tx, 7)).resolves.toBeUndefined();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing, suspended, deleted, or downgraded actor safely', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as Prisma.TransactionClient;

    await expect(lockActiveCmsActor(tx, 9)).rejects.toEqual(
      new UnauthorizedException('Account is not available.'),
    );
  });
});
