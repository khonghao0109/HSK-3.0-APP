import { assertPgBossVersion } from './assert-pgboss-version';

describe('assertPgBossVersion', () => {
  it('throws "pg-boss schema version must be 43, but got X" when version is mismatched', async () => {
    const mockPrisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ version: 42 }]),
    };

    await expect(assertPgBossVersion(mockPrisma as never)).rejects.toThrow(
      'pg-boss schema version must be 43, but got 42',
    );
  });

  it('throws "schema not found" when pgboss schema or version table is missing', async () => {
    const mockPrisma = {
      $queryRawUnsafe: jest
        .fn()
        .mockRejectedValue(
          new Error('relation "pgboss.version" does not exist'),
        ),
    };

    await expect(assertPgBossVersion(mockPrisma as never)).rejects.toThrow(
      'schema not found',
    );
  });

  it('passes when schema version is 43', async () => {
    const mockPrisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ version: 43 }]),
    };

    await expect(
      assertPgBossVersion(mockPrisma as never),
    ).resolves.toBeUndefined();
  });
});
