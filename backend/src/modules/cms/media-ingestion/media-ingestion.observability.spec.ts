import { ObjectStorageError } from '../../../infrastructure/storage/object-storage.port';
import { MediaIngestionService } from './media-ingestion.service';

describe('MediaIngestionService storage-stage telemetry', () => {
  it.each([
    ['completed replay', true, false],
    ['new ingestion', false, true],
  ] as const)(
    'counts a successful %s but records processing duration only for real processing',
    async (_case, idempotent, expectsDuration) => {
      const metrics = {
        recordIngestion: jest.fn(),
      };
      const service = new MediaIngestionService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        metrics as never,
      );
      (
        service as unknown as {
          ingestInternal: () => Promise<{
            success: true;
            data: { idempotent: boolean };
          }>;
        }
      ).ingestInternal = jest.fn().mockResolvedValue({
        success: true,
        data: { idempotent },
      });

      await expect(
        service.ingest(
          { id: 7, role: 'admin' },
          {
            originalname: 'synthetic.png',
            mimetype: 'image/png',
            size: 1,
            buffer: Buffer.from([1]),
          },
          3,
          'idempotency-key',
          { correlationId: 'correlation-id' },
        ),
      ).resolves.toMatchObject({ data: { idempotent } });

      expect(metrics.recordIngestion).toHaveBeenNthCalledWith(1, 'request');
      if (expectsDuration) {
        expect(metrics.recordIngestion).toHaveBeenNthCalledWith(
          2,
          'success',
          expect.any(Number),
        );
      } else {
        expect(metrics.recordIngestion).toHaveBeenNthCalledWith(2, 'success');
      }
      expect(metrics.recordIngestion).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['head', new ObjectStorageError('unavailable'), 'error'],
    ['head', new ObjectStorageError('not_found'), 'not_found'],
    [
      'head',
      new ObjectStorageError('malformed_response'),
      'malformed_response',
    ],
    ['head', new ObjectStorageError('integrity_violation'), 'integrity_error'],
    ['delete', new ObjectStorageError('unavailable'), 'error'],
    [
      'verify',
      new ObjectStorageError('integrity_violation'),
      'integrity_error',
    ],
  ] as const)(
    'records %s failure with the exact domain outcome once',
    async (operation, error, outcome) => {
      const metrics = { recordStorage: jest.fn() };
      const service = new MediaIngestionService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        metrics as never,
      );
      const observed = service as unknown as {
        observeStorageOperation<T>(
          stage: 'head' | 'delete' | 'verify',
          invoke: () => Promise<T>,
        ): Promise<T>;
      };

      await expect(
        observed.observeStorageOperation(operation, () =>
          Promise.reject(error),
        ),
      ).rejects.toBe(error);

      expect(metrics.recordStorage).toHaveBeenCalledTimes(1);
      expect(metrics.recordStorage).toHaveBeenCalledWith(
        operation,
        outcome,
        expect.any(Number),
      );
      expect(metrics.recordStorage).not.toHaveBeenCalledWith(
        operation,
        'success',
        expect.any(Number),
      );
    },
  );

  it('records one success and no error for a successful stage', async () => {
    const metrics = { recordStorage: jest.fn() };
    const service = new MediaIngestionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      metrics as never,
    );
    const observed = service as unknown as {
      observeStorageOperation<T>(
        stage: 'head' | 'delete' | 'verify',
        invoke: () => Promise<T>,
      ): Promise<T>;
    };

    await expect(
      observed.observeStorageOperation('head', () => Promise.resolve(false)),
    ).resolves.toBe(false);

    expect(metrics.recordStorage).toHaveBeenCalledTimes(1);
    expect(metrics.recordStorage).toHaveBeenCalledWith(
      'head',
      'success',
      expect.any(Number),
    );
  });

  it.each([
    ['success', undefined, 'success', true],
    ['unavailable', new ObjectStorageError('unavailable'), 'error', false],
  ] as const)(
    'records a finalize-compensation delete %s exactly once',
    async (_case, deleteError, outcome, expectedResult) => {
      const metrics = { recordStorage: jest.fn() };
      const storage = {
        provider: 's3',
        deletePrivateObject: jest.fn(() =>
          deleteError ? Promise.reject(deleteError) : Promise.resolve(),
        ),
      };
      const prisma = {
        mediaIngestion: { count: jest.fn().mockResolvedValue(1) },
      };
      const service = new MediaIngestionService(
        prisma as never,
        {} as never,
        storage as never,
        {} as never,
        undefined,
        metrics as never,
      );
      const observed = service as unknown as {
        compensateObject(
          ingestionId: number,
          processingToken: string,
          objectKey: string,
        ): Promise<boolean>;
      };

      await expect(
        observed.compensateObject(41, 'processing-token', 'private/key'),
      ).resolves.toBe(expectedResult);

      expect(storage.deletePrivateObject).toHaveBeenCalledTimes(1);
      expect(metrics.recordStorage).toHaveBeenCalledTimes(1);
      expect(metrics.recordStorage).toHaveBeenCalledWith(
        'delete',
        outcome,
        expect.any(Number),
      );
    },
  );

  it('does not emit a delete metric when finalize compensation no longer owns the attempt', async () => {
    const metrics = { recordStorage: jest.fn() };
    const storage = {
      provider: 's3',
      deletePrivateObject: jest.fn(),
    };
    const prisma = {
      mediaIngestion: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new MediaIngestionService(
      prisma as never,
      {} as never,
      storage as never,
      {} as never,
      undefined,
      metrics as never,
    );
    const observed = service as unknown as {
      compensateObject(
        ingestionId: number,
        processingToken: string,
        objectKey: string,
      ): Promise<boolean>;
    };

    await expect(
      observed.compensateObject(41, 'stale-token', 'private/key'),
    ).resolves.toBe(false);

    expect(storage.deletePrivateObject).not.toHaveBeenCalled();
    expect(metrics.recordStorage).not.toHaveBeenCalled();
  });
});
