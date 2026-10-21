import { ForbiddenException } from '@nestjs/common';

import { CmsActor } from './cms-workflow';
import { DataSourcesService } from './data-sources.service';

/**
 * TL-26: GET /admin/cms/data-sources trả danh sách nguồn dữ liệu cho admin
 * console. Unit test kiểm đúng args gửi xuống Prisma (select 4 field, orderBy,
 * skip/take) và meta phân trang; hành vi HTTP (401/403/200/400/413) phủ ở e2e.
 */

const ADMIN: CmsActor = { id: 7, role: 'admin' };

function prismaWith(rows: unknown[], total: number) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(total);
  const transaction = jest.fn((operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  return {
    prisma: {
      $transaction: transaction,
      dataSource: { findMany, count },
    },
    findMany,
    count,
    transaction,
  };
}

const rows = [
  { id: 3, code: 'HSK_VOCAB', name: 'HSK vocabulary', version: 'v2' },
  { id: 1, code: 'HSK_VOCAB', name: 'HSK vocabulary', version: 'v1' },
  { id: 2, code: 'HSK_GRAMMAR', name: 'HSK grammar', version: 'v1' },
];

describe('DataSourcesService (TL-26)', () => {
  it('selects exactly id/code/name/version and orders by name asc, version desc, id asc', async () => {
    const { prisma, findMany } = prismaWith(rows, 3);
    const service = new DataSourcesService(prisma as never);

    await service.listDataSources(ADMIN, { page: 2, limit: 20 });

    expect(findMany.mock.calls[0]?.[0]).toEqual({
      orderBy: [{ name: 'asc' }, { version: 'desc' }, { id: 'asc' }],
      skip: 20,
      take: 20,
      select: { id: true, code: true, name: true, version: true },
    });
  });

  it('counts with the same unfiltered scope so every data source is eligible', async () => {
    const { prisma, findMany, count, transaction } = prismaWith(rows, 3);
    const service = new DataSourcesService(prisma as never);

    await service.listDataSources(ADMIN, { page: 1, limit: 20 });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith();
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty('where');
  });

  it('returns the requested page with the exact 4-field rows and pagination meta', async () => {
    const { prisma } = prismaWith(rows, 41);
    const service = new DataSourcesService(prisma as never);

    await expect(
      service.listDataSources(ADMIN, { page: 2, limit: 20 }),
    ).resolves.toEqual({
      success: true,
      data: rows,
      meta: { page: 2, limit: 20, total: 41, totalPages: 3 },
    });
  });

  it('computes skip/take from the requested page', async () => {
    const { prisma, findMany } = prismaWith([], 0);
    const service = new DataSourcesService(prisma as never);

    await service.listDataSources(ADMIN, { page: 3, limit: 15 });

    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      skip: 30,
      take: 15,
    });
  });

  it('rejects a non-admin actor before reading any data source', async () => {
    const { prisma, findMany, count } = prismaWith(rows, 3);
    const service = new DataSourcesService(prisma as never);

    await expect(
      service.listDataSources({ id: 8, role: 'user' }, { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
});
