import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PurgeExpiredSessionsJob } from './purge-expired-sessions.job';
import { PG_BOSS_INSTANCE } from '../../../infrastructure/jobs/jobs.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { JOB_NAMES } from '../../../infrastructure/jobs/job-queue.port';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };

describe('PurgeExpiredSessionsJob', () => {
  let jobHandler: PurgeExpiredSessionsJob;
  let mockBoss: Partial<PgBoss>;
  let mockPrisma: Partial<PrismaService>;

  beforeEach(async () => {
    mockBoss = {
      schedule: jest.fn(),
      work: jest.fn(),
    };
    mockPrisma = {
      $executeRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurgeExpiredSessionsJob,
        { provide: PG_BOSS_INSTANCE, useValue: mockBoss },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    jobHandler = module.get<PurgeExpiredSessionsJob>(PurgeExpiredSessionsJob);
    // Disable logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  it('should register schedule and handler', async () => {
    await jobHandler.onApplicationBootstrap();
    expect(mockBoss.schedule).toHaveBeenCalledWith(
      JOB_NAMES.PURGE_EXPIRED_SESSIONS,
      '17 3 * * *',
      null,
      { retryLimit: 3, retryBackoff: true },
    );
    expect(mockBoss.work).toHaveBeenCalledWith(
      JOB_NAMES.PURGE_EXPIRED_SESSIONS,
      expect.any(Function),
    );
  });

  it('should purge expired sessions in batches until less than 1000', async () => {
    (mockPrisma.$executeRaw as jest.Mock)
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(50); // 3 batches

    await jobHandler.onApplicationBootstrap();
    const workHandler = (mockBoss.work as jest.Mock).mock.calls[0][1];

    await workHandler([
      { name: JOB_NAMES.PURGE_EXPIRED_SESSIONS, id: 'job-id', retryCount: 0 },
    ]);

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(3);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining('DELETE FROM "UserSession"'),
      ]),
    );
    expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining(
          'WHERE "expiresAt" < CURRENT_TIMESTAMP - INTERVAL \'30 days\'',
        ),
      ]),
    );
  });
});
