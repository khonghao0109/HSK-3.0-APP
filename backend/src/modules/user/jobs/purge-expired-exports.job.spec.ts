import { PurgeExpiredExportsJob } from './purge-expired-exports.job';
import {
  ObjectStorageError,
  type ObjectStoragePort,
} from '../../../infrastructure/storage/object-storage.port';

describe('PurgeExpiredExportsJob', () => {
  let job: PurgeExpiredExportsJob;
  let mockPrisma: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let mockStorage: ObjectStoragePort;
  let mockDeletePrivateObject: jest.Mock;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };

    mockDeletePrivateObject = jest.fn().mockResolvedValue(undefined);

    mockStorage = {
      provider: 'mock-storage',
      deletePrivateObject: mockDeletePrivateObject,
      putPrivateObject: jest.fn(),
      getPrivateObject: jest.fn(),
      privateObjectExists: jest.fn(),
    };

    job = new PurgeExpiredExportsJob(null, mockPrisma as never, mockStorage);
  });

  it('purges expired export objects older than 7 days and sets outputStorageKey to NULL', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 101, outputStorageKey: 'privacy-exports/1/101-abc.json' },
      { id: 102, outputStorageKey: 'privacy-exports/2/102-def.json' },
    ]);

    const count = await job.purge();

    expect(count).toBe(2);
    expect(mockDeletePrivateObject).toHaveBeenCalledTimes(2);
    expect(mockDeletePrivateObject).toHaveBeenCalledWith(
      'privacy-exports/1/101-abc.json',
    );
    expect(mockDeletePrivateObject).toHaveBeenCalledWith(
      'privacy-exports/2/102-def.json',
    );
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('treats not_found as already deleted and continues successfully', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 201, outputStorageKey: 'privacy-exports/1/201-missing.json' },
    ]);

    mockDeletePrivateObject.mockRejectedValueOnce(
      new ObjectStorageError('not_found'),
    );

    const count = await job.purge();

    expect(count).toBe(1);
    expect(mockDeletePrivateObject).toHaveBeenCalledWith(
      'privacy-exports/1/201-missing.json',
    );
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('throws when storage fails with another error', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 301, outputStorageKey: 'privacy-exports/1/301-fail.json' },
    ]);

    mockDeletePrivateObject.mockRejectedValueOnce(
      new ObjectStorageError('unavailable'),
    );

    await expect(job.purge()).rejects.toThrow(
      'Private object storage is unavailable.',
    );
  });
});
