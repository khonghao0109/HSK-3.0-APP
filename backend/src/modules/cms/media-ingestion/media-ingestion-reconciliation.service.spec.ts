import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CmsActor } from '../cms-workflow';

import { MediaIngestionReconciliationService } from './media-ingestion-reconciliation.service';
import { MEDIA_INGESTION_STUCK_PROCESSING_SQL } from './media-ingestion.policy';

/**
 * TL-46/TL-47: GET /admin/cms/media/ingestions. Unit test kiểm câu SQL gửi
 * xuống (cột tường minh, không cột nhạy cảm, điều kiện kẹt dùng chung,
 * provider là tham số) và phép chiếu ra item; hành vi HTTP phủ ở e2e.
 */

const ADMIN: CmsActor = { id: 7, role: 'admin' };

const FORBIDDEN_COLUMNS = [
  'storageKey',
  'processingToken',
  'idempotencyKeyHash',
  'requestFingerprint',
  'checksum',
  'storageProvider',
  'sourceCodeSnapshot',
  'sourceVersionSnapshot',
  'sourceLicenseSnapshot',
  'sourceAttributionSnapshot',
  'sourceReferenceUrlSnapshot',
  'sourceContentHashSnapshot',
  'cleanupAbsentObservedAt',
  'actorId',
  'mediaId',
  'declaredMimeType',
  'validatedMimeType',
];

const row = {
  id: 41,
  status: 'cleanup_required',
  failureCode: 'OBJECT_WRITE_OUTCOME_UNKNOWN',
  originalFilename: 'C:\\fakepath\\a\u202Eb.png',
  size: 1234,
  dataSourceId: 3,
  dataSourceCode: 'FRONTEND_CONSOLE_V1',
  dataSourceName: 'Console',
  dataSourceVersion: 'v1',
  startedAt: new Date('2026-10-21T01:00:00Z'),
  processingStartedAt: null,
  cleanupRequiredAt: new Date('2026-10-21T01:00:01Z'),
  cleanupAttempts: 0,
  cleanupLastAttemptAt: null,
  cleanupAvailable: true,
};

function setup(rows: unknown[], total: number) {
  const queryRaw = jest
    .fn()
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce([{ total }]);
  const transaction = jest.fn((operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  const service = new MediaIngestionReconciliationService(
    { $queryRaw: queryRaw, $transaction: transaction } as never,
    { provider: 'memory-test' } as never,
  );
  return { service, queryRaw, transaction };
}

describe('MediaIngestionReconciliationService (TL-46/TL-47)', () => {
  it('rejects non-admin actors before querying', async () => {
    const { service, queryRaw } = setup([], 0);
    await expect(
      service.listIngestions({ id: 2, role: 'editor' }, { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('pages and counts in one transaction with bound LIMIT/OFFSET and provider', async () => {
    const { service, queryRaw, transaction } = setup([row], 41);
    const result = await service.listIngestions(ADMIN, { page: 3, limit: 20 });
    expect(transaction).toHaveBeenCalledTimes(1);
    const list = queryRaw.mock.calls[0][0] as Prisma.Sql;
    const count = queryRaw.mock.calls[1][0] as Prisma.Sql;
    expect(list.values).toEqual(['memory-test', 20, 40]);
    expect(list.sql).toMatch(/ORDER BY i\."startedAt" DESC, i\.id DESC/u);
    expect(count.sql).toMatch(/count\(\*\)::int AS total/u);
    for (const sql of [list.sql, count.sql]) {
      expect(sql).toContain(MEDIA_INGESTION_STUCK_PROCESSING_SQL.sql);
      expect(sql).toContain("i.status = 'cleanup_required'");
      expect(sql).not.toMatch(/'(failed|rejected|completed)'/u);
    }
    expect(result.meta).toEqual({
      page: 3,
      limit: 20,
      total: 41,
      totalPages: 3,
    });
  });

  it('selects no sensitive column and returns no sensitive key', async () => {
    const { service, queryRaw } = setup([row], 1);
    const result = await service.listIngestions(ADMIN, { page: 1, limit: 20 });
    const select = (queryRaw.mock.calls[0][0] as Prisma.Sql).sql
      .split(/\bFROM\b/u)[0]
      .replace(/i\."storageProvider" = \?/u, '');
    for (const column of FORBIDDEN_COLUMNS) {
      expect(select).not.toContain(column);
      expect(Object.keys(result.data[0])).not.toContain(column);
    }
    expect(select).not.toMatch(/\*/u);
    expect(result.data[0]).toEqual({
      id: 41,
      status: 'cleanup_required',
      failureCode: 'OBJECT_WRITE_OUTCOME_UNKNOWN',
      filename: 'ab.png',
      size: 1234,
      dataSource: {
        id: 3,
        code: 'FRONTEND_CONSOLE_V1',
        name: 'Console',
        version: 'v1',
      },
      startedAt: row.startedAt,
      processingStartedAt: null,
      cleanupRequiredAt: row.cleanupRequiredAt,
      cleanupAttempts: 0,
      cleanupLastAttemptAt: null,
      cleanupAvailable: true,
    });
  });
});
