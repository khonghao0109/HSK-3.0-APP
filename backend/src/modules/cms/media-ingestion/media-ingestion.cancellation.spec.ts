import { BadRequestException } from '@nestjs/common';
import { ObjectStorageWriteError } from '../../../infrastructure/storage/object-storage.port';
import {
  MediaIngestionService,
  UploadedMediaFile,
} from './media-ingestion.service';

describe('MediaIngestionService cancellation and abort handling', () => {
  const actor = { id: 7, role: 'admin' as const };
  const sampleFile: UploadedMediaFile = {
    originalname: 'test.png',
    mimetype: 'image/png',
    size: 10,
    buffer: Buffer.from('0123456789'),
  };

  it('rejects immediately before claim when signal is already aborted', async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    controller.abort();

    await expect(
      fixture.service.ingest(
        actor,
        sampleFile,
        1,
        'idem-123456789012345678901234567890',
        {
          correlationId: 'corr-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.claimIngestion).not.toHaveBeenCalled();
    expect(fixture.fileProcessor.process).not.toHaveBeenCalled();
  });

  it('translates timeout reason to 408 MEDIA_UPLOAD_TIMEOUT', async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    controller.abort(new Error('MEDIA_UPLOAD_TIMEOUT'));

    await expect(
      fixture.service.ingest(
        actor,
        sampleFile,
        1,
        'idem-123456789012345678901234567890',
        {
          correlationId: 'corr-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({
      status: 408,
      response: {
        code: 'MEDIA_UPLOAD_TIMEOUT',
      },
    });
  });

  it('aborts after claim before file processing: marks failed with UPLOAD_ABORTED', async () => {
    const fixture = createFixture();
    const controller = new AbortController();

    fixture.claimIngestion.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(claimed());
    });

    await expect(
      fixture.service.ingest(
        actor,
        sampleFile,
        1,
        'idem-123456789012345678901234567890',
        {
          correlationId: 'corr-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.recordFailure).toHaveBeenCalledWith(
      41,
      'claim-token',
      'UPLOAD_ABORTED',
      actor.id,
      expect.anything(),
    );
    expect(fixture.fileProcessor.process).not.toHaveBeenCalled();
  });

  it('aborts before scan: marks failed with UPLOAD_ABORTED and skips scanner', async () => {
    const fixture = createFixture();
    const controller = new AbortController();

    fixture.fileProcessor.process.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({
        buffer: Buffer.from('processed'),
        mimeType: 'image/png',
        mediaType: 'image',
        extension: 'png',
        checksum: 'abc',
        width: 100,
        height: 100,
      });
    });

    await expect(
      fixture.service.ingest(
        actor,
        sampleFile,
        1,
        'idem-123456789012345678901234567890',
        {
          correlationId: 'corr-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.recordFailure).toHaveBeenCalledWith(
      41,
      'claim-token',
      'UPLOAD_ABORTED',
      actor.id,
      expect.anything(),
    );
    expect(fixture.scanner.scan).not.toHaveBeenCalled();
  });

  it('aborts during scan: propagates abort and marks failed with UPLOAD_ABORTED', async () => {
    const fixture = createFixture();
    const controller = new AbortController();

    fixture.scanner.scan.mockImplementation(
      (_buf: Buffer, options?: { signal?: AbortSignal }) => {
        controller.abort();
        if (options?.signal?.aborted) {
          return Promise.reject(new Error('Scanner aborted'));
        }
        return Promise.resolve({ clean: true });
      },
    );

    await expect(
      fixture.service.ingest(
        actor,
        sampleFile,
        1,
        'idem-123456789012345678901234567890',
        {
          correlationId: 'corr-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.recordFailure).toHaveBeenCalledWith(
      41,
      'claim-token',
      'UPLOAD_ABORTED',
      actor.id,
      expect.anything(),
    );
    expect(fixture.reserveValidatedObject).not.toHaveBeenCalled();
  });

  it('aborts before reserveValidatedObject: marks failed with UPLOAD_ABORTED', async () => {
    const fixture = createFixture();
    const controller = new AbortController();

    fixture.scanner.scan.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ clean: true });
    });

    await expect(
      fixture.service.ingest(
        actor,
        sampleFile,
        1,
        'idem-123456789012345678901234567890',
        {
          correlationId: 'corr-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.recordFailure).toHaveBeenCalledWith(
      41,
      'claim-token',
      'UPLOAD_ABORTED',
      actor.id,
      expect.anything(),
    );
    expect(fixture.reserveValidatedObject).not.toHaveBeenCalled();
  });

  it('aborts before putPrivateObject: marks failed with UPLOAD_ABORTED and does not write to storage', async () => {
    const fixture = createFixture();
    const controller = new AbortController();

    fixture.reserveValidatedObject.mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });

    await expect(
      fixture.service.ingest(
        actor,
        sampleFile,
        1,
        'idem-123456789012345678901234567890',
        {
          correlationId: 'corr-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.recordFailure).toHaveBeenCalledWith(
      41,
      'claim-token',
      'UPLOAD_ABORTED',
      actor.id,
      expect.anything(),
    );
    expect(fixture.storage.putPrivateObject).not.toHaveBeenCalled();
  });

  it('aborts during putPrivateObject: routes to cleanup_required with OBJECT_WRITE_OUTCOME_UNKNOWN', async () => {
    const fixture = createFixture();
    const controller = new AbortController();

    fixture.storage.putPrivateObject.mockImplementation(
      (
        _input: {
          key: string;
          body: Buffer;
          contentType: string;
          checksum: string;
        },
        options?: { signal?: AbortSignal },
      ) => {
        controller.abort();
        if (options?.signal?.aborted) {
          return Promise.reject(new ObjectStorageWriteError('unknown'));
        }
        return Promise.resolve();
      },
    );

    await expect(
      fixture.service.ingest(
        actor,
        sampleFile,
        1,
        'idem-123456789012345678901234567890',
        {
          correlationId: 'corr-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'MEDIA_CLEANUP_REQUIRED',
      },
    });

    expect(fixture.recordFailure).toHaveBeenCalledWith(
      41,
      'claim-token',
      'OBJECT_WRITE_OUTCOME_UNKNOWN',
      actor.id,
      expect.anything(),
      'cleanup_required',
    );
  });

  it('aborts after putPrivateObject: compensates object and marks failed with UPLOAD_ABORTED if cleanup succeeds', async () => {
    const fixture = createFixture();
    const controller = new AbortController();

    fixture.storage.putPrivateObject.mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });
    fixture.compensateObject.mockResolvedValue(true);

    await expect(
      fixture.service.ingest(
        actor,
        sampleFile,
        1,
        'idem-123456789012345678901234567890',
        {
          correlationId: 'corr-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.compensateObject).toHaveBeenCalledWith(
      41,
      'claim-token',
      expect.any(String),
    );
    expect(fixture.ensureFinalizeFailureRecorded).toHaveBeenCalledWith(
      41,
      'claim-token',
      'UPLOAD_ABORTED',
      true,
      actor.id,
      expect.anything(),
    );
    expect(fixture.finalizeMedia).not.toHaveBeenCalled();
  });

  it('aborts after putPrivateObject: marks cleanup_required with OBJECT_CLEANUP_REQUIRED if compensate fails', async () => {
    const fixture = createFixture();
    const controller = new AbortController();

    fixture.storage.putPrivateObject.mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });
    fixture.compensateObject.mockResolvedValue(false);

    await expect(
      fixture.service.ingest(
        actor,
        sampleFile,
        1,
        'idem-123456789012345678901234567890',
        {
          correlationId: 'corr-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'MEDIA_CLEANUP_REQUIRED',
      },
    });

    expect(fixture.compensateObject).toHaveBeenCalledTimes(1);
    expect(fixture.ensureFinalizeFailureRecorded).toHaveBeenCalledWith(
      41,
      'claim-token',
      'OBJECT_CLEANUP_REQUIRED',
      false,
      actor.id,
      expect.anything(),
    );
  });
});

function createFixture() {
  const fileProcessor = {
    process: jest.fn(() =>
      Promise.resolve({
        buffer: Buffer.from('processed'),
        mimeType: 'image/png',
        mediaType: 'image',
        extension: 'png',
        checksum: 'abc',
        width: 100,
        height: 100,
      }),
    ),
  };
  const storage = {
    provider: 's3',
    putPrivateObject: jest.fn(() => Promise.resolve()),
    deletePrivateObject: jest.fn(() => Promise.resolve()),
  };
  const scanner = {
    scan: jest.fn(() => Promise.resolve({ clean: true })),
  };
  const service = new MediaIngestionService(
    {} as never,
    fileProcessor as never,
    storage as never,
    scanner,
  );

  const privateService = service as unknown as {
    claimIngestion: jest.Mock;
    recordFailure: jest.Mock;
    ensureRejected: jest.Mock;
    reserveValidatedObject: jest.Mock;
    compensateObject: jest.Mock;
    ensureFinalizeFailureRecorded: jest.Mock;
    finalizeMedia: jest.Mock;
  };

  privateService.claimIngestion = jest.fn(() => Promise.resolve(claimed()));
  privateService.recordFailure = jest.fn(() => Promise.resolve());
  privateService.ensureRejected = jest.fn(() => Promise.resolve());
  privateService.reserveValidatedObject = jest.fn(() => Promise.resolve());
  privateService.compensateObject = jest.fn(() => Promise.resolve(true));
  privateService.ensureFinalizeFailureRecorded = jest.fn(() =>
    Promise.resolve(),
  );
  privateService.finalizeMedia = jest.fn(() =>
    Promise.resolve({ success: true, data: {} }),
  );

  return {
    service,
    fileProcessor,
    storage,
    scanner,
    ...privateService,
  };
}

function claimed(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    status: 'processing',
    processingToken: 'claim-token',
    startedAt: new Date('2026-09-28T00:00:00Z'),
    dataSourceId: 1,
    storageKey: null,
    ...overrides,
  } as never;
}
