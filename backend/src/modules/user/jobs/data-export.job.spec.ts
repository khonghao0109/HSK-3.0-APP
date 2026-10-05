import { Prisma } from '@prisma/client';
import { assertExportCoverageComplete, DataExportJob } from './data-export.job';
import {
  MAX_PRIVATE_MEDIA_OBJECT_BYTES,
  ObjectStorageError,
  type ObjectStoragePort,
} from '../../../infrastructure/storage/object-storage.port';

describe('DataExportJob', () => {
  describe('DMMF Coverage (P5)', () => {
    it('verifies that all models with userId or User relation are classified in EXPORT_COVERAGE', () => {
      expect(() => {
        assertExportCoverageComplete(Prisma.dmmf.datamodel.models);
      }).not.toThrow();
    });

    it('throws error when an unclassified model with userId is provided (P10b test)', () => {
      const baseModel = Prisma.dmmf.datamodel.models[0];
      const mockModels: Prisma.DMMF.Model[] = [
        ...Prisma.dmmf.datamodel.models,
        {
          ...baseModel,
          name: 'UnclassifiedTestModel',
          fields: [
            ...baseModel.fields,
            {
              ...baseModel.fields[0],
              name: 'userId',
              type: 'Int',
            },
          ],
        },
      ];

      expect(() => {
        assertExportCoverageComplete(mockModels);
      }).toThrow(
        'Unclassified models in export coverage: UnclassifiedTestModel',
      );
    });

    it('throws error when a child model of an included model (e.g. child of ExamAttempt without userId) is unclassified (Q2 test)', () => {
      const baseModel = Prisma.dmmf.datamodel.models[0];
      const mockModels: Prisma.DMMF.Model[] = [
        ...Prisma.dmmf.datamodel.models,
        {
          ...baseModel,
          name: 'MockExamChild',
          fields: [
            ...baseModel.fields,
            {
              ...baseModel.fields[0],
              name: 'attemptId',
              type: 'Int',
            },
            {
              ...baseModel.fields[0],
              name: 'attempt',
              kind: 'object',
              type: 'ExamAttempt',
              relationFromFields: ['attemptId'],
              relationToFields: ['id'],
            },
          ],
        },
      ];

      expect(() => {
        assertExportCoverageComplete(mockModels);
      }).toThrow('Unclassified models in export coverage: MockExamChild');
    });
  });

  describe('Handler execution', () => {
    let job: DataExportJob;
    let mockTx: {
      $queryRaw: jest.Mock;
      $executeRaw: jest.Mock;
    };
    let mockPrisma: {
      $transaction: jest.Mock;
      $executeRaw: jest.Mock;
    };
    let mockStorage: ObjectStoragePort;
    let mockPutPrivateObject: jest.Mock;

    beforeEach(() => {
      mockTx = {
        $queryRaw: jest.fn(),
        $executeRaw: jest.fn().mockResolvedValue(1),
      };

      mockPrisma = {
        $transaction: jest.fn((cb: (tx: typeof mockTx) => unknown) =>
          cb(mockTx),
        ),
        $executeRaw: jest.fn().mockResolvedValue(1),
      };

      mockPutPrivateObject = jest.fn().mockResolvedValue(undefined);

      mockStorage = {
        provider: 'mock-storage',
        putPrivateObject: mockPutPrivateObject,
        deletePrivateObject: jest.fn().mockResolvedValue(undefined),
        getPrivateObject: jest.fn(),
        privateObjectExists: jest.fn(),
      };

      job = new DataExportJob(null, mockPrisma as never, mockStorage);
    });

    it('returns false when exportId is not a number', async () => {
      const result = await job.process({ exportId: 'invalid' as never });
      expect(result).toBe(false);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns true when export job is not found', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([]); // Lock query returns empty

      const result = await job.process({ exportId: 99 });
      expect(result).toBe(true);
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('is idempotent when job status is already completed', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([
        { id: 1, userId: 10, status: 'completed' },
      ]);

      const result = await job.process({ exportId: 1 });
      expect(result).toBe(true);
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('P7: fails with EXPORT_TOO_LARGE without throwing when size exceeds limit', async () => {
      // 1. Lock row
      mockTx.$queryRaw.mockResolvedValueOnce([
        { id: 1, userId: 10, status: 'requested' },
      ]);

      // 2. User basic info
      mockTx.$queryRaw.mockResolvedValueOnce([
        {
          id: 10,
          email: 'big@example.com',
          name: 'Big User',
          createdAt: new Date(),
          emailVerifiedAt: null,
        },
      ]);

      // User profile through Audit logs (including child tables: LearningPlanItem, ReviewEvent batch, ExamAttemptEvent, ExamAnswer batch, ResultSkillScore)
      for (let i = 0; i < 24; i++) {
        mockTx.$queryRaw.mockResolvedValueOnce([]);
      }

      // Large batch of LearningEvents that exceeds 10MB
      const hugeString = 'X'.repeat(MAX_PRIVATE_MEDIA_OBJECT_BYTES + 1024);
      mockTx.$queryRaw.mockResolvedValueOnce([
        {
          id: 1,
          type: 'event',
          lessonId: 1,
          topicId: 1,
          exerciseId: 1,
          attemptId: 1,
          resourceType: 'exercise',
          resourceId: 1,
          metadata: { payload: hugeString },
          occurredAt: new Date(),
          createdAt: new Date(),
        },
      ]);

      const result = await job.process({ exportId: 1 });
      expect(result).toBe(true);
      expect(mockPutPrivateObject).not.toHaveBeenCalled();
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('throws error when storage putPrivateObject fails (to enable pg-boss retry)', async () => {
      // 1. Lock row
      mockTx.$queryRaw.mockResolvedValueOnce([
        { id: 1, userId: 10, status: 'requested' },
      ]);

      // 2. User basic info
      mockTx.$queryRaw.mockResolvedValueOnce([
        {
          id: 10,
          email: 'retry@example.com',
          name: 'Retry User',
          createdAt: new Date(),
          emailVerifiedAt: null,
        },
      ]);

      // Profile through Audit logs (24 queries)
      for (let i = 0; i < 24; i++) {
        mockTx.$queryRaw.mockResolvedValueOnce([]);
      }
      // LearningEvent batch 1 empty
      mockTx.$queryRaw.mockResolvedValueOnce([]);

      // Storage failure
      mockPutPrivateObject.mockRejectedValueOnce(
        new ObjectStorageError('unavailable'),
      );

      await expect(job.process({ exportId: 1 })).rejects.toThrow(
        'Private object storage is unavailable.',
      );
    });

    it('includes learningPurpose in exported user goals snapshot', async () => {
      // 1. Lock row
      mockTx.$queryRaw.mockResolvedValueOnce([
        { id: 1, userId: 10, status: 'requested' },
      ]);

      // 2. User basic info
      mockTx.$queryRaw.mockResolvedValueOnce([
        {
          id: 10,
          email: 'learner@example.com',
          name: 'Learner',
          createdAt: new Date(),
          emailVerifiedAt: null,
        },
      ]);

      // 3. UserProfile
      mockTx.$queryRaw.mockResolvedValueOnce([]);

      // 4. UserSession
      mockTx.$queryRaw.mockResolvedValueOnce([]);

      // 5. UserGoal
      mockTx.$queryRaw.mockResolvedValueOnce([
        {
          id: 1,
          targetLevelId: 1,
          targetBand: 1,
          dailyMinutes: 30,
          reminderEnabled: false,
          reminderTime: null,
          startDate: new Date('2026-08-11T00:00:00.000Z'),
          isActive: true,
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
          updatedAt: new Date('2026-08-10T00:00:00.000Z'),
          learningPurpose: 'hsk_exam',
        },
      ]);

      // Remaining queries before batches (21 queries: PlacementAttempt through AuditLog)
      for (let i = 0; i < 21; i++) {
        mockTx.$queryRaw.mockResolvedValueOnce([]);
      }
      // LearningEvent batch 1 empty
      mockTx.$queryRaw.mockResolvedValueOnce([]);

      const result = await job.process({ exportId: 1 });
      expect(result).toBe(true);
      expect(mockPutPrivateObject).toHaveBeenCalledTimes(1);

      const putCall = mockPutPrivateObject.mock.calls[0][0] as {
        body: Buffer;
      };
      const exportPayload = JSON.parse(putCall.body.toString('utf8'));
      expect(exportPayload.goals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            learningPurpose: 'hsk_exam',
          }),
        ]),
      );

      // Verify UserGoal raw query includes "learningPurpose" column in SELECT
      const userGoalQueryCall = mockTx.$queryRaw.mock.calls.find(
        (call: [{ strings?: string[] }]) =>
          call[0]?.strings?.some((chunk: string) =>
            chunk.includes('"UserGoal"'),
          ),
      );
      expect(userGoalQueryCall).toBeDefined();
      expect(userGoalQueryCall[0].strings.join('')).toContain(
        '"learningPurpose"',
      );
    });
  });
});
