/// <reference types="jest" />

import { createHash, randomUUID } from 'node:crypto';

import {
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import sharp from 'sharp';

import type {
  MediaMalwareScannerPort,
  MediaScanResult,
} from '../src/infrastructure/malware/media-malware-scanner.port';
import type {
  ObjectStoragePort,
  StoredObject,
} from '../src/infrastructure/storage/object-storage.port';
import { ObjectStorageWriteError } from '../src/infrastructure/storage/object-storage.port';
import { MediaObservabilityService } from '../src/infrastructure/observability/media-observability.service';
import { MediaFileProcessor } from '../src/modules/cms/media-ingestion/media-file.processor';
import { MediaIngestionService } from '../src/modules/cms/media-ingestion/media-ingestion.service';
import {
  CmsTransactionCheckpoint,
  CmsTransactionCoordinator,
} from '../src/modules/cms/cms-transaction-coordinator';
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

  it('refuses automatic takeover and preserves the winning object', async () => {
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

  it('requires cleanup instead of takeover after storage identity is reserved', async () => {
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

    await prisma.$transaction(async (tx) => {
      const cleanupTransition = await tx.mediaIngestion.update({
        where: { id: claimedByA.id },
        data: {
          status: 'cleanup_required',
          failureCode: 'OBJECT_CLEANUP_REQUIRED',
        },
        select: { cleanupRequiredAt: true },
      });
      if (cleanupTransition.cleanupRequiredAt === null) {
        throw new Error('Cleanup transition did not receive a DB timestamp.');
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'media.ingestion_failed',
          targetType: 'media_ingestion',
          targetId: String(claimedByA.id),
          correlationId: randomUUID(),
          createdAt: cleanupTransition.cleanupRequiredAt,
          afterSummary: {
            ingestionId: claimedByA.id,
            status: 'cleanup_required',
            failureCode: 'OBJECT_CLEANUP_REQUIRED',
          },
        },
      });
    });
    const attemptB = await settle(
      service.ingest(actor, file, source.id, key, {
        correlationId: randomUUID(),
      }),
    );
    storage.releaseFirstPut();
    const resultA = await attemptA;

    expect(attemptB.status).toBe('rejected');
    expect(resultA.status).toBe('rejected');
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
      attemptCount: 1,
      status: 'cleanup_required',
      validatedMimeType: 'image/png',
    });
    expect(final.processingToken).toBe(claimedByA.processingToken);
    expect(final.mediaId).toBeNull();
    expect(final.storageKey).not.toBeNull();
    expect(storage.count()).toBe(1);
    await expect(
      prisma.media.count({ where: { uploadedById: actor.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingested',
          targetId: String(final.mediaId),
        },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_failed',
          targetId: String(claimedByA.id),
        },
      }),
    ).resolves.toBe(1);
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

    expect(result.data.cleanupCompleted).toBe(false);
    await ageCleanupObservation(ingestion.id);
    await expect(
      service.retryCleanup(actor, ingestion.id, {
        correlationId: randomUUID(),
      }),
    ).resolves.toMatchObject({ data: { cleanupCompleted: true } });
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
      cleanupAttempts: 2,
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

    expect(result.data.cleanupCompleted).toBe(false);
    await ageCleanupObservation(ingestion.id);
    await expect(
      service.retryCleanup(actor, ingestion.id, {
        correlationId: randomUUID(),
      }),
    ).resolves.toMatchObject({ data: { cleanupCompleted: true } });
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

  it('returns a committed cleanup claim to a persisted retryable state when ownership verification fails', async () => {
    const { actor, service, storage, ingestion } = await createCleanupFixture();
    const ownershipRead = jest
      .spyOn(prisma.mediaIngestion, 'count')
      .mockRejectedValueOnce(
        Object.assign(new Error('Synthetic ownership verification failure.'), {
          code: 'P1001',
        }),
      );

    try {
      await expect(
        service.retryCleanup(actor, ingestion.id, {
          correlationId: randomUUID(),
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'MEDIA_CLEANUP_REQUIRED',
          message: 'Media cleanup is temporarily unavailable.',
        },
      });
    } finally {
      ownershipRead.mockRestore();
    }

    await expect(
      prisma.mediaIngestion.findUniqueOrThrow({
        where: { id: ingestion.id },
        select: { failureCode: true, status: true },
      }),
    ).resolves.toEqual({
      failureCode: 'OBJECT_CLEANUP_REQUIRED',
      status: 'cleanup_required',
    });
    expect(storage.count()).toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_cleanup_failed',
          targetId: String(ingestion.id),
        },
      }),
    ).resolves.toBe(1);

    await expect(
      service.retryCleanup(actor, ingestion.id, {
        correlationId: randomUUID(),
      }),
    ).resolves.toMatchObject({
      data: { cleanupCompleted: false, settling: true },
    });
    expect(storage.count()).toBe(0);
  });

  it('serializes cleanup claims on the real ingestion row lock before fenced object work', async () => {
    const { actor, ingestion, source, storage } = await createCleanupFixture();
    const coordinator = new CleanupLockCoordinator();
    const service = new MediaIngestionService(
      prisma,
      new MediaFileProcessor(),
      storage,
      new AlwaysCleanScanner(),
      undefined,
      undefined,
      coordinator,
    );
    const clientA = new PrismaClient();
    const locked = createDeferred<void>();
    const release = createDeferred<void>();
    try {
      const transactionA = settle(
        clientA.$transaction(async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "MediaIngestion" WHERE id = ${ingestion.id} FOR UPDATE`,
          );
          locked.resolve();
          await release.promise;
        }),
      );
      await locked.promise;
      const transactionB = settle(
        service.retryCleanup(actor, ingestion.id, {
          correlationId: randomUUID(),
        }),
      );
      const pid = await coordinator.pid.promise;

      await expect(waitForDatabaseLock(prisma, pid)).resolves.toBe(true);
      release.resolve();
      const [resultA, resultB] = await Promise.all([
        transactionA,
        transactionB,
      ]);

      expect(resultA.status).toBe('fulfilled');
      expect(resultB.status).toBe('fulfilled');
      if (resultB.status === 'fulfilled') {
        expect(resultB.value).toMatchObject({
          data: { cleanupCompleted: false, settling: true },
        });
      }
      expect(storage.count()).toBe(0);
      await expect(
        prisma.mediaIngestion.findUniqueOrThrow({
          where: { id: ingestion.id },
          select: { failureCode: true, status: true },
        }),
      ).resolves.toEqual({
        failureCode: 'OBJECT_CLEANUP_SETTLING',
        status: 'cleanup_required',
      });
      await expect(
        prisma.auditLog.count({
          where: {
            action: 'media.ingestion_cleanup_settling',
            targetId: String(ingestion.id),
          },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.dataSource.findUniqueOrThrow({ where: { id: source.id } }),
      ).resolves.toBeDefined();
    } finally {
      release.resolve();
      await clientA.$disconnect();
    }
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

  it('prevents provenance revocation after ingestion claim', async () => {
    const { actor, file, key, service, source, storage } =
      await createFixture();
    const pending = settle(
      service.ingest(actor, file, source.id, key, {
        correlationId: randomUUID(),
      }),
    );
    await storage.firstPutStored;
    await expect(
      prisma.dataSource.update({
        where: { id: source.id },
        data: { license: null },
      }),
    ).rejects.toThrow(
      'Referenced media provenance is immutable; create a new DataSource version.',
    );
    storage.releaseFirstPut();
    const result = await pending;

    expect(result.status).toBe('fulfilled');
    const final = await prisma.mediaIngestion.findFirstOrThrow({
      where: { actorId: actor.id },
      select: { failureCode: true, id: true, mediaId: true, status: true },
    });
    expect(final).toMatchObject({
      failureCode: null,
      status: 'completed',
    });
    expect(storage.count()).toBe(1);
    await expect(
      prisma.media.count({ where: { uploadedById: actor.id } }),
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

  it('serializes provenance mutation behind the claim lock and rejects the parent update', async () => {
    const { actor, file, key, service, source, storage } =
      await createFixture();
    storage.releaseFirstPut();
    await service.ingest(actor, file, source.id, key, {
      correlationId: randomUUID(),
    });
    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    const locked = createDeferred<void>();
    const release = createDeferred<void>();
    const pidReady = createDeferred<number>();
    try {
      const transactionA = settle(
        clientA.$transaction(async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "DataSource" WHERE id = ${source.id} FOR SHARE`,
          );
          locked.resolve();
          await release.promise;
        }),
      );
      await locked.promise;
      const transactionB = settle(
        clientB.$transaction(async (tx) => {
          const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>(
            Prisma.sql`SELECT pg_backend_pid()::int AS pid`,
          );
          pidReady.resolve(pid);
          await tx.dataSource.update({
            where: { id: source.id },
            data: { license: 'Concurrent changed license' },
          });
        }),
      );
      const pid = await pidReady.promise;
      await expect(waitForDatabaseLock(prisma, pid)).resolves.toBe(true);
      release.resolve();
      const [resultA, resultB] = await Promise.all([
        transactionA,
        transactionB,
      ]);
      expect(resultA.status).toBe('fulfilled');
      expect(resultB.status).toBe('rejected');
      if (resultB.status === 'rejected') {
        expect(String(resultB.reason)).toContain(
          'Referenced media provenance is immutable; create a new DataSource version.',
        );
        expect(String(resultB.reason)).not.toMatch(/55P03|57014|40P01|P2028/u);
      }
      await expect(
        prisma.dataSource.findUniqueOrThrow({
          where: { id: source.id },
          select: { license: true },
        }),
      ).resolves.toEqual({ license: source.license });
    } finally {
      release.resolve();
      await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);
    }
  });

  it('rejects completed replay before storage I/O when the adapter provider differs', async () => {
    const { actor, file, key, service, source, storage } =
      await createFixture();
    storage.releaseFirstPut();
    await service.ingest(actor, file, source.id, key, {
      correlationId: randomUUID(),
    });
    const mismatchedStorage = new ProviderMismatchStorage(storage);
    const replayService = new MediaIngestionService(
      prisma,
      new MediaFileProcessor(),
      mismatchedStorage,
      new AlwaysCleanScanner(),
    );

    await expect(
      replayService.ingest(actor, file, source.id, key, {
        correlationId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mismatchedStorage.readCount).toBe(0);
  });

  it('does not declare cleanup complete until an unknown PUT has settled absent', async () => {
    const fixture = await createFixture();
    const lateStorage = new LateCommitObjectStorage();
    const idempotencyKey = `late-put-${randomUUID()}`;
    const service = new MediaIngestionService(
      prisma,
      new MediaFileProcessor(),
      lateStorage,
      new AlwaysCleanScanner(),
    );
    const upload = await settle(
      service.ingest(
        fixture.actor,
        fixture.file,
        fixture.source.id,
        idempotencyKey,
        { correlationId: randomUUID() },
      ),
    );
    expect(upload.status).toBe('rejected');
    const ingestion = await prisma.mediaIngestion.findFirstOrThrow({
      where: {
        actorId: fixture.actor.id,
        storageProvider: lateStorage.provider,
      },
      orderBy: { id: 'desc' },
      select: { id: true, cleanupRequiredAt: true },
    });
    expect(ingestion.cleanupRequiredAt).toBeInstanceOf(Date);

    const firstCleanup = await service.retryCleanup(
      fixture.actor,
      ingestion.id,
      { correlationId: randomUUID() },
    );
    lateStorage.commitLatePut();

    expect(firstCleanup.data).toMatchObject({
      cleanupCompleted: false,
      settling: true,
    });
    expect(lateStorage.deleteCount).toBe(1);
    expect(lateStorage.count()).toBe(1);
    const states = await prisma.$queryRaw<
      Array<{
        cleanupAbsentObservedAt: Date | null;
        cleanupRequiredAt: Date | null;
        failureCode: string | null;
        status: string;
      }>
    >(Prisma.sql`
      SELECT "cleanupAbsentObservedAt", "cleanupRequiredAt", "failureCode", status::text
      FROM "MediaIngestion"
      WHERE id = ${ingestion.id}
    `);
    expect(states[0]).toMatchObject({
      cleanupAbsentObservedAt: expect.any(Date),
      cleanupRequiredAt: ingestion.cleanupRequiredAt,
      failureCode: 'OBJECT_CLEANUP_SETTLING',
      status: 'cleanup_required',
    });

    const secondCleanup = await service.retryCleanup(
      fixture.actor,
      ingestion.id,
      { correlationId: randomUUID() },
    );
    expect(secondCleanup.data).toMatchObject({
      cleanupCompleted: false,
      settling: true,
    });
    expect(lateStorage.deleteCount).toBe(2);
    expect(lateStorage.count()).toBe(0);
    await expect(
      prisma.mediaIngestion.findUniqueOrThrow({
        where: { id: ingestion.id },
        select: { cleanupRequiredAt: true },
      }),
    ).resolves.toEqual({ cleanupRequiredAt: ingestion.cleanupRequiredAt });
    await expect(
      new MediaObservabilityService(prisma).render(),
    ).resolves.toMatch(/hsk_media_cleanup_required [1-9]\d*/u);

    await ageCleanupObservation(ingestion.id);
    await expect(
      service.retryCleanup(fixture.actor, ingestion.id, {
        correlationId: randomUUID(),
      }),
    ).resolves.toMatchObject({ data: { cleanupCompleted: true } });
    expect(lateStorage.count()).toBe(0);
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
      service.ingest(
        fixture.actor,
        fixture.file,
        fixture.source.id,
        idempotencyKey,
        { correlationId: randomUUID() },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_cleanup_completed',
          targetId: String(ingestion.id),
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.media.count({ where: { uploadedById: fixture.actor.id } }),
    ).resolves.toBe(0);
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
      select: {
        id: true,
        code: true,
        version: true,
        license: true,
        attribution: true,
        referenceUrl: true,
        contentHash: true,
      },
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
    const ingestion = await prisma.$transaction(async (tx) => {
      const created = await tx.mediaIngestion.create({
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
          processingToken: randomUUID(),
          attemptCount: 1,
          sourceCodeSnapshot: fixture.source.code,
          sourceVersionSnapshot: fixture.source.version,
          sourceLicenseSnapshot: fixture.source.license!,
          sourceAttributionSnapshot: fixture.source.attribution,
          sourceReferenceUrlSnapshot: fixture.source.referenceUrl,
          sourceContentHashSnapshot: fixture.source.contentHash,
        },
        select: { id: true, cleanupRequiredAt: true },
      });
      if (created.cleanupRequiredAt === null) {
        throw new Error('Cleanup fixture did not receive a DB timestamp.');
      }
      await tx.auditLog.create({
        data: {
          actorId: fixture.actor.id,
          action: 'media.ingestion_failed',
          targetType: 'media_ingestion',
          targetId: String(created.id),
          correlationId: randomUUID(),
          createdAt: created.cleanupRequiredAt,
          afterSummary: {
            ingestionId: created.id,
            status: 'cleanup_required',
            failureCode: 'OBJECT_CLEANUP_REQUIRED',
          },
        },
      });
      return created;
    });
    return { ...fixture, ingestion };
  }

  async function ageCleanupObservation(ingestionId: number): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "MediaIngestion"
      SET "cleanupAbsentObservedAt" =
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '2 minutes'
      WHERE id = ${ingestionId}
    `);
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

class CleanupLockCoordinator extends CmsTransactionCoordinator {
  readonly pid = createDeferred<number>();

  override async checkpoint(
    checkpoint: CmsTransactionCheckpoint,
  ): Promise<void> {
    if (
      checkpoint.operation !== 'media_ingestion.cleanup' ||
      checkpoint.phase !== 'before_lock'
    ) {
      return;
    }
    const [{ pid }] = await checkpoint.transaction.$queryRaw<
      Array<{ pid: number }>
    >(Prisma.sql`SELECT pg_backend_pid()::int AS pid`);
    this.pid.resolve(pid);
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

  privateObjectExists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
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

class ProviderMismatchStorage implements ObjectStoragePort {
  readonly provider = 's3';
  readCount = 0;

  constructor(private readonly delegate: BarrierObjectStorage) {}

  putPrivateObject(): Promise<void> {
    return Promise.reject(new Error('Unexpected storage write.'));
  }

  getPrivateObject(key: string): Promise<StoredObject> {
    this.readCount += 1;
    return this.delegate.getPrivateObject(key);
  }

  privateObjectExists(): Promise<boolean> {
    return Promise.reject(new Error('Unexpected storage inspection.'));
  }

  deletePrivateObject(): Promise<void> {
    return Promise.reject(new Error('Unexpected storage delete.'));
  }
}

class LateCommitObjectStorage implements ObjectStoragePort {
  readonly provider = 'late-commit-test';
  deleteCount = 0;
  private pending: (StoredObject & { key: string }) | undefined;
  private readonly objects = new Map<string, StoredObject>();

  putPrivateObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    checksum: string;
  }): Promise<void> {
    this.pending = {
      key: input.key,
      body: Buffer.from(input.body),
      contentType: input.contentType,
      checksum: input.checksum,
      size: input.body.length,
    };
    return Promise.reject(new ObjectStorageWriteError('unknown'));
  }

  getPrivateObject(key: string): Promise<StoredObject> {
    const object = this.objects.get(key);
    if (!object) return Promise.reject(new Error('Object not found.'));
    return Promise.resolve({ ...object, body: Buffer.from(object.body) });
  }

  privateObjectExists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  deletePrivateObject(key: string): Promise<void> {
    this.deleteCount += 1;
    this.objects.delete(key);
    return Promise.resolve();
  }

  commitLatePut(): void {
    if (!this.pending) throw new Error('No pending PUT to commit.');
    const { key, ...object } = this.pending;
    this.objects.set(key, object);
    this.pending = undefined;
  }

  count(): number {
    return this.objects.size;
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitForDatabaseLock(
  prisma: PrismaService,
  pid: number,
): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<
      Array<{ waitEventType: string | null }>
    >(
      Prisma.sql`
        SELECT wait_event_type AS "waitEventType"
        FROM pg_stat_activity
        WHERE pid = ${pid}
      `,
    );
    if (rows[0]?.waitEventType === 'Lock') return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    'Provenance concurrency test did not observe transaction B waiting on Lock.',
  );
}
