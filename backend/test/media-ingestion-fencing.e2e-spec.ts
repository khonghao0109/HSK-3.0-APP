/// <reference types="jest" />

import { createHash, randomUUID } from 'node:crypto';

import {
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';

import type {
  MediaMalwareScannerPort,
  MediaScanResult,
} from '../src/infrastructure/malware/media-malware-scanner.port';
import type {
  ObjectStoragePort,
  StoredObject,
} from '../src/infrastructure/storage/object-storage.port';
import { MediaFileProcessor } from '../src/modules/cms/media-ingestion/media-file.processor';
import { MediaIngestionService } from '../src/modules/cms/media-ingestion/media-ingestion.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Media ingestion stale-attempt fencing', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    assertDisposableTestDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('refuses an expired automatic takeover and preserves the winning object', async () => {
    const { actor, file, key, service, source, storage } =
      await createFixture();

    const attemptA = settle(
      service.ingest(actor, file, source.id, key, {
        correlationId: randomUUID(),
      }),
    );
    await storage.firstPutStored;
    const ingestion = await prisma.mediaIngestion.findFirstOrThrow({
      where: { actorId: actor.id },
      select: { id: true, processingToken: true },
    });
    await prisma.mediaIngestion.update({
      where: { id: ingestion.id },
      data: { processingStartedAt: new Date('2000-01-01T00:00:00.000Z') },
    });

    const attemptB = await settle(
      service.ingest(actor, file, source.id, key, {
        correlationId: randomUUID(),
      }),
    );
    storage.releaseFirstPut();
    const resultA = await attemptA;

    expect(resultA.status).toBe('fulfilled');
    expect(attemptB.status).toBe('rejected');
    if (attemptB.status === 'rejected') {
      expect(attemptB.reason).toBeInstanceOf(ConflictException);
      expect((attemptB.reason as ConflictException).message).toBe(
        'Media ingestion is already in progress.',
      );
    }
    const final = await prisma.mediaIngestion.findUniqueOrThrow({
      where: { id: ingestion.id },
      select: {
        attemptCount: true,
        checksum: true,
        mediaId: true,
        processingToken: true,
        size: true,
        status: true,
        storageKey: true,
        validatedMimeType: true,
      },
    });
    expect(final).toMatchObject({
      attemptCount: 1,
      processingToken: ingestion.processingToken,
      status: 'completed',
      validatedMimeType: 'image/png',
    });
    expect(final.mediaId).not.toBeNull();
    expect(final.storageKey).not.toBeNull();
    expect(storage.count()).toBe(1);
    const stored = await storage.getPrivateObject(final.storageKey!);
    expect(stored).toMatchObject({
      checksum: final.checksum,
      contentType: final.validatedMimeType,
      size: final.size,
    });
    expect(sha256(stored.body)).toBe(final.checksum);
    await expect(
      prisma.media.count({ where: { id: final.mediaId! } }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingested',
          targetId: String(final.mediaId),
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: {
            in: [
              'media.ingestion_failed',
              'media.ingestion_cleanup_failed',
              'media.ingestion_cleanup_completed',
            ],
          },
          targetId: String(ingestion.id),
        },
      }),
    ).resolves.toBe(0);
  });

  it('fences a stale owner after an explicit recovery state transition', async () => {
    const { actor, file, key, service, source, storage } =
      await createFixture();
    const attemptA = settle(
      service.ingest(actor, file, source.id, key, {
        correlationId: randomUUID(),
      }),
    );
    await storage.firstPutStored;
    const claimedByA = await prisma.mediaIngestion.findFirstOrThrow({
      where: { actorId: actor.id },
      select: { id: true, processingToken: true },
    });

    await prisma.mediaIngestion.update({
      where: { id: claimedByA.id },
      data: { status: 'failed', failureCode: 'OPERATOR_RECOVERY_TEST' },
    });
    const attemptB = await settle(
      service.ingest(actor, file, source.id, key, {
        correlationId: randomUUID(),
      }),
    );
    storage.releaseFirstPut();
    const resultA = await attemptA;

    expect(attemptB.status).toBe('fulfilled');
    expect(resultA.status).toBe('fulfilled');
    if (resultA.status === 'fulfilled') {
      expect(resultA.value.data.idempotent).toBe(true);
    }
    const final = await prisma.mediaIngestion.findUniqueOrThrow({
      where: { id: claimedByA.id },
      select: {
        attemptCount: true,
        checksum: true,
        mediaId: true,
        processingToken: true,
        size: true,
        status: true,
        storageKey: true,
        validatedMimeType: true,
      },
    });
    expect(final).toMatchObject({
      attemptCount: 2,
      status: 'completed',
      validatedMimeType: 'image/png',
    });
    expect(final.processingToken).not.toBe(claimedByA.processingToken);
    expect(final.mediaId).not.toBeNull();
    expect(final.storageKey).not.toBeNull();
    expect(storage.count()).toBe(1);
    const stored = await storage.getPrivateObject(final.storageKey!);
    expect(stored).toMatchObject({
      checksum: final.checksum,
      contentType: final.validatedMimeType,
      size: final.size,
    });
    expect(sha256(stored.body)).toBe(final.checksum);
    await expect(
      prisma.media.count({ where: { id: final.mediaId! } }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingested',
          targetId: String(final.mediaId),
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_failed',
          targetId: String(claimedByA.id),
        },
      }),
    ).resolves.toBe(0);
  });

  it('reconciles a committed finalize after a lost commit acknowledgement', async () => {
    const { actor, file, key, service, source, storage } =
      await createFixture();
    const originalTransaction = prisma.$transaction.bind(prisma) as unknown as <
      T,
    >(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>;
    let transactionCount = 0;
    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(
        async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
          const result = await originalTransaction(operation);
          transactionCount += 1;
          if (transactionCount === 2) {
            throw Object.assign(
              new Error('Synthetic commit acknowledgement loss.'),
              { code: 'P1001' },
            );
          }
          return result;
        },
      );

    let result: Awaited<ReturnType<MediaIngestionService['ingest']>>;
    try {
      const pending = service.ingest(actor, file, source.id, key, {
        correlationId: randomUUID(),
      });
      await storage.firstPutStored;
      storage.releaseFirstPut();
      result = await pending;
    } finally {
      transactionSpy.mockRestore();
    }

    expect(result.data.idempotent).toBe(true);
    const final = await prisma.mediaIngestion.findFirstOrThrow({
      where: { actorId: actor.id },
      select: {
        attemptCount: true,
        checksum: true,
        mediaId: true,
        size: true,
        status: true,
        storageKey: true,
        validatedMimeType: true,
      },
    });
    expect(final).toMatchObject({
      attemptCount: 1,
      status: 'completed',
      validatedMimeType: 'image/png',
    });
    expect(final.mediaId).not.toBeNull();
    expect(final.storageKey).not.toBeNull();
    expect(storage.count()).toBe(1);
    const stored = await storage.getPrivateObject(final.storageKey!);
    expect(stored).toMatchObject({
      checksum: final.checksum,
      contentType: final.validatedMimeType,
      size: final.size,
    });
    await expect(
      prisma.media.count({ where: { id: final.mediaId! } }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingested',
          targetId: String(final.mediaId),
        },
      }),
    ).resolves.toBe(1);
  });

  it('retains the committed object when finalize outcome cannot be reread', async () => {
    const { actor, file, key, service, source, storage } =
      await createFixture();
    const originalTransaction = prisma.$transaction.bind(prisma) as unknown as <
      T,
    >(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>;
    let transactionCount = 0;
    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(
        async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
          const result = await originalTransaction(operation);
          transactionCount += 1;
          if (transactionCount === 2) {
            throw Object.assign(
              new Error('Synthetic commit acknowledgement loss.'),
              { code: 'P1001' },
            );
          }
          return result;
        },
      );
    const readSpy = jest
      .spyOn(prisma.mediaIngestion, 'findUnique')
      .mockRejectedValueOnce(
        Object.assign(new Error('Synthetic authoritative read failure.'), {
          code: 'P1001',
        }),
      );

    let result: Settled<Awaited<ReturnType<MediaIngestionService['ingest']>>>;
    try {
      const pending = settle(
        service.ingest(actor, file, source.id, key, {
          correlationId: randomUUID(),
        }),
      );
      await storage.firstPutStored;
      storage.releaseFirstPut();
      result = await pending;
    } finally {
      readSpy.mockRestore();
      transactionSpy.mockRestore();
    }

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBeInstanceOf(ServiceUnavailableException);
      expect(
        (result.reason as ServiceUnavailableException).getResponse(),
      ).toEqual({
        code: 'MEDIA_FINALIZE_OUTCOME_UNKNOWN',
        message: 'Media ingestion outcome requires reconciliation.',
      });
    }
    const final = await prisma.mediaIngestion.findFirstOrThrow({
      where: { actorId: actor.id },
      select: { mediaId: true, status: true, storageKey: true },
    });
    expect(final.status).toBe('completed');
    expect(final.mediaId).not.toBeNull();
    expect(final.storageKey).not.toBeNull();
    expect(storage.count()).toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingested',
          targetId: String(final.mediaId),
        },
      }),
    ).resolves.toBe(1);
  });

  it('does not compensate while a finalize connection outcome is ambiguous', async () => {
    const { actor, file, key, service, source, storage } =
      await createFixture();
    const mediaBaseline = await prisma.media.count({
      where: { uploadedById: actor.id },
    });
    const auditBaseline = await prisma.auditLog.count({
      where: { actorId: actor.id, action: 'media.ingested' },
    });
    const originalTransaction = prisma.$transaction.bind(prisma) as unknown as <
      T,
    >(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>;
    let transactionCount = 0;
    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(
        async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
          transactionCount += 1;
          if (transactionCount === 2) {
            throw Object.assign(new Error('Synthetic connection ambiguity.'), {
              code: 'P1001',
            });
          }
          return originalTransaction(operation);
        },
      );

    let result: Settled<Awaited<ReturnType<MediaIngestionService['ingest']>>>;
    try {
      const pending = settle(
        service.ingest(actor, file, source.id, key, {
          correlationId: randomUUID(),
        }),
      );
      await storage.firstPutStored;
      storage.releaseFirstPut();
      result = await pending;
    } finally {
      transactionSpy.mockRestore();
    }

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBeInstanceOf(ServiceUnavailableException);
      expect(
        (result.reason as ServiceUnavailableException).getResponse(),
      ).toEqual({
        code: 'MEDIA_FINALIZE_OUTCOME_UNKNOWN',
        message: 'Media ingestion outcome requires reconciliation.',
      });
    }
    const final = await prisma.mediaIngestion.findFirstOrThrow({
      where: { actorId: actor.id },
      select: {
        id: true,
        mediaId: true,
        processingToken: true,
        status: true,
        storageKey: true,
      },
    });
    expect(final.status).toBe('processing');
    expect(final.mediaId).toBeNull();
    expect(final.storageKey).not.toBeNull();
    expect(storage.count()).toBe(1);
    await expect(
      prisma.media.count({ where: { uploadedById: actor.id } }),
    ).resolves.toBe(mediaBaseline);
    await expect(
      prisma.auditLog.count({
        where: { actorId: actor.id, action: 'media.ingested' },
      }),
    ).resolves.toBe(auditBaseline);

    await storage.deletePrivateObject(final.storageKey!);
    const reconciled = await prisma.mediaIngestion.updateMany({
      where: {
        id: final.id,
        status: 'processing',
        processingToken: final.processingToken,
      },
      data: {
        status: 'failed',
        failureCode: 'OPERATOR_RECONCILED_AFTER_UNKNOWN_FINALIZE',
      },
    });
    expect(reconciled.count).toBe(1);
    expect(storage.count()).toBe(0);
    await expect(
      prisma.mediaIngestion.findUniqueOrThrow({
        where: { id: final.id },
        select: { failureCode: true, mediaId: true, status: true },
      }),
    ).resolves.toEqual({
      failureCode: 'OPERATOR_RECONCILED_AFTER_UNKNOWN_FINALIZE',
      mediaId: null,
      status: 'failed',
    });
  });

  it('reconciles cleanup after a lost finalize commit acknowledgement', async () => {
    const { actor, service, storage, ingestion } = await createCleanupFixture();
    const originalTransaction = prisma.$transaction.bind(prisma) as unknown as <
      T,
    >(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>;
    let transactionCount = 0;
    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(
        async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
          const result = await originalTransaction(operation);
          transactionCount += 1;
          if (transactionCount === 2) {
            throw Object.assign(
              new Error('Synthetic cleanup commit acknowledgement loss.'),
              { code: 'P1001' },
            );
          }
          return result;
        },
      );

    let result: Awaited<ReturnType<MediaIngestionService['retryCleanup']>>;
    try {
      result = await service.retryCleanup(actor, ingestion.id, {
        correlationId: randomUUID(),
      });
    } finally {
      transactionSpy.mockRestore();
    }

    expect(result.data.cleanupCompleted).toBe(true);
    expect(storage.count()).toBe(0);
    await expect(
      prisma.mediaIngestion.findUniqueOrThrow({
        where: { id: ingestion.id },
        select: {
          cleanupAttempts: true,
          failureCode: true,
          mediaId: true,
          status: true,
        },
      }),
    ).resolves.toEqual({
      cleanupAttempts: 1,
      failureCode: 'OBJECT_CLEANED',
      mediaId: null,
      status: 'failed',
    });
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_cleanup_completed',
          targetId: String(ingestion.id),
        },
      }),
    ).resolves.toBe(1);
  });

  it('continues cleanup after a lost claim commit acknowledgement', async () => {
    const { actor, service, storage, ingestion } = await createCleanupFixture();
    const originalTransaction = prisma.$transaction.bind(prisma) as unknown as <
      T,
    >(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>;
    let transactionCount = 0;
    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(
        async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
          const result = await originalTransaction(operation);
          transactionCount += 1;
          if (transactionCount === 1) {
            throw Object.assign(
              new Error('Synthetic cleanup claim acknowledgement loss.'),
              { code: 'P1001' },
            );
          }
          return result;
        },
      );

    let result: Awaited<ReturnType<MediaIngestionService['retryCleanup']>>;
    try {
      result = await service.retryCleanup(actor, ingestion.id, {
        correlationId: randomUUID(),
      });
    } finally {
      transactionSpy.mockRestore();
    }

    expect(result.data.cleanupCompleted).toBe(true);
    expect(storage.count()).toBe(0);
    await expect(
      prisma.mediaIngestion.findUniqueOrThrow({
        where: { id: ingestion.id },
        select: { failureCode: true, mediaId: true, status: true },
      }),
    ).resolves.toEqual({
      failureCode: 'OBJECT_CLEANED',
      mediaId: null,
      status: 'failed',
    });
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_cleanup_completed',
          targetId: String(ingestion.id),
        },
      }),
    ).resolves.toBe(1);
  });

  it('continues ingestion after a lost claim commit acknowledgement', async () => {
    const { actor, file, key, service, source, storage } =
      await createFixture();
    const originalTransaction = prisma.$transaction.bind(prisma) as unknown as <
      T,
    >(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>;
    let transactionCount = 0;
    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(
        async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
          const result = await originalTransaction(operation);
          transactionCount += 1;
          if (transactionCount === 1) {
            throw Object.assign(
              new Error('Synthetic ingestion claim acknowledgement loss.'),
              { code: 'P1001' },
            );
          }
          return result;
        },
      );

    storage.releaseFirstPut();
    let result: Awaited<ReturnType<MediaIngestionService['ingest']>>;
    try {
      result = await service.ingest(actor, file, source.id, key, {
        correlationId: randomUUID(),
      });
    } finally {
      transactionSpy.mockRestore();
    }

    expect(result.data.idempotent).toBe(false);
    const final = await prisma.mediaIngestion.findFirstOrThrow({
      where: { actorId: actor.id },
      select: { mediaId: true, status: true, storageKey: true },
    });
    expect(final.status).toBe('completed');
    expect(final.mediaId).not.toBeNull();
    expect(final.storageKey).not.toBeNull();
    expect(storage.count()).toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingested',
          targetId: String(final.mediaId),
        },
      }),
    ).resolves.toBe(1);
  });

  it('reconciles a rejected upload after a lost commit acknowledgement', async () => {
    const { actor, file, key, service, source } = await createFixture();
    const originalTransaction = prisma.$transaction.bind(prisma) as unknown as <
      T,
    >(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>;
    let transactionCount = 0;
    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(
        async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
          const result = await originalTransaction(operation);
          transactionCount += 1;
          if (transactionCount === 2) {
            throw Object.assign(
              new Error('Synthetic rejection acknowledgement loss.'),
              { code: 'P1001' },
            );
          }
          return result;
        },
      );

    const invalidFile = {
      ...file,
      originalname: 'invalid.jpg',
    };
    let result: Settled<Awaited<ReturnType<MediaIngestionService['ingest']>>>;
    try {
      result = await settle(
        service.ingest(actor, invalidFile, source.id, key, {
          correlationId: randomUUID(),
        }),
      );
    } finally {
      transactionSpy.mockRestore();
    }

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBeInstanceOf(UnprocessableEntityException);
      expect(
        (result.reason as UnprocessableEntityException).getResponse(),
      ).toMatchObject({ code: 'FILENAME_EXTENSION_MISMATCH' });
    }
    const final = await prisma.mediaIngestion.findFirstOrThrow({
      where: { actorId: actor.id },
      select: { failureCode: true, id: true, mediaId: true, status: true },
    });
    expect(final).toMatchObject({
      failureCode: 'FILENAME_EXTENSION_MISMATCH',
      mediaId: null,
      status: 'rejected',
    });
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_rejected',
          targetId: String(final.id),
        },
      }),
    ).resolves.toBe(1);
  });

  it('compensates safely when source approval is revoked after object write', async () => {
    const { actor, file, key, service, source, storage } =
      await createFixture();
    const pending = settle(
      service.ingest(actor, file, source.id, key, {
        correlationId: randomUUID(),
      }),
    );
    await storage.firstPutStored;
    await prisma.dataSource.update({
      where: { id: source.id },
      data: { license: null },
    });
    storage.releaseFirstPut();
    const result = await pending;

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBeInstanceOf(UnprocessableEntityException);
      expect(
        (result.reason as UnprocessableEntityException).getResponse(),
      ).toMatchObject({ code: 'MEDIA_SOURCE_NOT_APPROVED' });
    }
    const final = await prisma.mediaIngestion.findFirstOrThrow({
      where: { actorId: actor.id },
      select: { failureCode: true, id: true, mediaId: true, status: true },
    });
    expect(final).toMatchObject({
      failureCode: 'MEDIA_SOURCE_NOT_APPROVED',
      mediaId: null,
      status: 'failed',
    });
    expect(storage.count()).toBe(0);
    await expect(
      prisma.media.count({ where: { uploadedById: actor.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_failed',
          targetId: String(final.id),
        },
      }),
    ).resolves.toBe(1);
  });

  async function createFixture() {
    const suffix = randomUUID();
    const actor = await prisma.user.create({
      data: {
        email: `media-fence-${suffix}@example.test`,
        password: 'synthetic-not-a-real-password',
        role: 'admin',
        status: 'active',
      },
      select: { id: true, role: true },
    });
    const source = await prisma.dataSource.create({
      data: {
        code: `MEDIA_FENCE_${suffix}`,
        name: `Synthetic fencing source ${suffix}`,
        version: '2026.08',
        license: 'Synthetic test fixture',
        createdById: actor.id,
      },
      select: { id: true },
    });
    const storage = new BarrierObjectStorage();
    const service = new MediaIngestionService(
      prisma,
      new MediaFileProcessor(),
      storage,
      new AlwaysCleanScanner(),
    );
    const buffer = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 12, g: 34, b: 56, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    return {
      actor,
      file: {
        originalname: 'fenced.png',
        mimetype: 'image/png',
        buffer,
        size: buffer.length,
      },
      key: `media-fencing-${randomUUID()}`,
      service,
      source,
      storage,
    };
  }

  async function createCleanupFixture() {
    const fixture = await createFixture();
    const checksum = sha256(fixture.file.buffer);
    const storageKey = `media/2026/08/${randomUUID()}.png`;
    fixture.storage.seed({
      key: storageKey,
      body: fixture.file.buffer,
      contentType: fixture.file.mimetype,
      checksum,
    });
    const ingestion = await prisma.mediaIngestion.create({
      data: {
        actorId: fixture.actor.id,
        dataSourceId: fixture.source.id,
        idempotencyKeyHash: sha256(Buffer.from(fixture.key)),
        requestFingerprint: sha256(Buffer.from(randomUUID())),
        status: 'cleanup_required',
        originalFilename: fixture.file.originalname,
        declaredMimeType: fixture.file.mimetype,
        validatedMimeType: fixture.file.mimetype,
        size: fixture.file.size,
        checksum,
        storageProvider: fixture.storage.provider,
        storageKey,
        failureCode: 'OBJECT_CLEANUP_REQUIRED',
        processingStartedAt: new Date(),
        processingToken: randomUUID(),
        attemptCount: 1,
      },
      select: { id: true },
    });
    return { ...fixture, ingestion };
  }
});

type Settled<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

class AlwaysCleanScanner implements MediaMalwareScannerPort {
  scan(): Promise<MediaScanResult> {
    return Promise.resolve({ clean: true });
  }
}

class BarrierObjectStorage implements ObjectStoragePort {
  readonly provider = 'memory-fencing-test';
  private readonly objects = new Map<string, StoredObject>();
  private putCount = 0;
  private readonly firstStored = createDeferred<void>();
  private readonly firstRelease = createDeferred<void>();

  get firstPutStored(): Promise<void> {
    return this.firstStored.promise;
  }

  releaseFirstPut(): void {
    this.firstRelease.resolve();
  }

  async putPrivateObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    checksum: string;
  }): Promise<void> {
    this.putCount += 1;
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      checksum: input.checksum,
      size: input.body.length,
    });
    if (this.putCount === 1) {
      this.firstStored.resolve();
      await this.firstRelease.promise;
    }
  }

  getPrivateObject(key: string): Promise<StoredObject> {
    const object = this.objects.get(key);
    if (!object) return Promise.reject(new Error('Object not found.'));
    return Promise.resolve({ ...object, body: Buffer.from(object.body) });
  }

  deletePrivateObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  count(): number {
    return this.objects.size;
  }

  seed(input: {
    key: string;
    body: Buffer;
    contentType: string;
    checksum: string;
  }): void {
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      checksum: input.checksum,
      size: input.body.length,
    });
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
