import { createHash, randomUUID } from 'node:crypto';

import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MediaIngestion } from '@prisma/client';

import { MEDIA_MALWARE_SCANNER } from '../../../infrastructure/malware/media-malware-scanner.port';
import type { MediaMalwareScannerPort } from '../../../infrastructure/malware/media-malware-scanner.port';
import { OBJECT_STORAGE } from '../../../infrastructure/storage/object-storage.port';
import type { ObjectStoragePort } from '../../../infrastructure/storage/object-storage.port';
import { ObjectStorageWriteError } from '../../../infrastructure/storage/object-storage.port';
import { PrismaService } from '../../../prisma/prisma.service';
import { lockActiveCmsActor } from '../cms-actor-lock';
import {
  assertAdminActor,
  classifyCmsPersistenceError,
  CmsActor,
} from '../cms-workflow';
import {
  MediaFileProcessingError,
  MediaFileProcessor,
  ProcessedMediaFile,
} from './media-file.processor';
import {
  buildMediaObjectKey,
  normalizeUploadFilename,
  validateMediaIdempotencyKey,
} from './media-ingestion.policy';

export const MEDIA_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export type UploadedMediaFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type MediaIngestionContext = { correlationId: string };

@Injectable()
export class MediaIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileProcessor: MediaFileProcessor,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(MEDIA_MALWARE_SCANNER)
    private readonly scanner: MediaMalwareScannerPort,
  ) {}

  async ingest(
    actor: CmsActor,
    file: UploadedMediaFile | undefined,
    dataSourceId: number,
    idempotencyHeader: string | undefined,
    context: MediaIngestionContext,
  ) {
    assertAdminActor(actor);
    if (!file) {
      throw new UnprocessableEntityException({
        code: 'FILE_REQUIRED',
        message: 'Exactly one media file is required.',
      });
    }
    if (
      file.size < 1 ||
      file.size !== file.buffer.length ||
      file.size > MEDIA_UPLOAD_MAX_BYTES
    ) {
      throw new UnprocessableEntityException({
        code: 'FILE_SIZE_INVALID',
        message: 'Upload file size is invalid.',
      });
    }

    const idempotencyKey = validateMediaIdempotencyKey(idempotencyHeader);
    const filename = normalizeUploadFilename(file.originalname);
    const rawChecksum = sha256(file.buffer);
    const idempotencyKeyHash = sha256(Buffer.from(idempotencyKey));
    const requestFingerprint = sha256(
      Buffer.from(
        JSON.stringify({
          actorId: actor.id,
          dataSourceId,
          filename,
          declaredMimeType: file.mimetype,
          size: file.size,
          rawChecksum,
        }),
      ),
    );

    const initialProcessingToken = randomUUID();
    const claim = await this.claimIngestion({
      actor,
      dataSourceId,
      idempotencyKeyHash,
      requestFingerprint,
      filename,
      declaredMimeType: file.mimetype,
      size: file.size,
      initialProcessingToken,
    });
    if (claim.status === 'completed') {
      return this.completedReplay(claim);
    }

    let processed: ProcessedMediaFile;
    try {
      processed = await this.fileProcessor.process({
        buffer: file.buffer,
        declaredMimeType: file.mimetype,
        filename,
      });
      if (processed.buffer.length > MEDIA_UPLOAD_MAX_BYTES) {
        throw new MediaFileProcessingError(
          'FILE_MALFORMED',
          'Processed media exceeds the upload limit.',
        );
      }
    } catch (error: unknown) {
      if (error instanceof MediaFileProcessingError) {
        await this.ensureRejected(
          claim.id,
          claim.processingToken,
          error.code,
          actor.id,
          context,
        );
        throw new UnprocessableEntityException({
          code: error.code,
          message: error.message,
        });
      }
      await this.recordFailure(
        claim.id,
        claim.processingToken,
        'PROCESSING_FAILED',
        actor.id,
        context,
      ).catch(() => undefined);
      throw new ServiceUnavailableException({
        code: 'MEDIA_PROCESSING_UNAVAILABLE',
        message: 'Media processing is temporarily unavailable.',
      });
    }

    let scanResult: { clean: boolean };
    try {
      scanResult = await this.scanner.scan(processed.buffer);
    } catch {
      await this.recordFailure(
        claim.id,
        claim.processingToken,
        'SCANNER_UNAVAILABLE',
        actor.id,
        context,
      ).catch(() => undefined);
      throw new ServiceUnavailableException({
        code: 'MEDIA_SCANNER_UNAVAILABLE',
        message: 'Media scanning is temporarily unavailable.',
      });
    }
    if (!scanResult.clean) {
      await this.ensureRejected(
        claim.id,
        claim.processingToken,
        'MALWARE_DETECTED',
        actor.id,
        context,
      );
      throw new UnprocessableEntityException({
        code: 'MALWARE_DETECTED',
        message: 'Media file was rejected by security scanning.',
      });
    }

    const objectKey =
      claim.storageKey ??
      buildMediaObjectKey(
        processed.mediaType,
        processed.extension,
        claim.startedAt,
        randomUUID(),
      );
    try {
      await this.reserveValidatedObject(
        claim.id,
        claim.processingToken,
        objectKey,
        processed,
      );
    } catch {
      await this.recordFailure(
        claim.id,
        claim.processingToken,
        'DATABASE_WRITE_FAILED',
        actor.id,
        context,
      ).catch(() => undefined);
      throw new ServiceUnavailableException({
        code: 'MEDIA_DATABASE_UNAVAILABLE',
        message: 'Media ingestion is temporarily unavailable.',
      });
    }

    try {
      await this.storage.putPrivateObject({
        key: objectKey,
        body: processed.buffer,
        contentType: processed.mimeType,
        checksum: processed.checksum,
      });
    } catch (error: unknown) {
      const writeOutcome =
        error instanceof ObjectStorageWriteError ? error.outcome : 'unknown';
      const requiresReconciliation = writeOutcome === 'unknown';
      await this.recordFailure(
        claim.id,
        claim.processingToken,
        requiresReconciliation
          ? 'OBJECT_WRITE_OUTCOME_UNKNOWN'
          : 'STORAGE_WRITE_FAILED',
        actor.id,
        context,
        requiresReconciliation ? 'cleanup_required' : 'failed',
      ).catch(() => undefined);
      throw new ServiceUnavailableException({
        code: requiresReconciliation
          ? 'MEDIA_CLEANUP_REQUIRED'
          : 'MEDIA_STORAGE_UNAVAILABLE',
        message: 'Media ingestion did not complete; retry later.',
      });
    }

    try {
      return await this.finalizeMedia(
        actor,
        claim.id,
        claim.processingToken,
        claim.dataSourceId,
        objectKey,
        filename,
        processed,
        context,
      );
    } catch (error: unknown) {
      const authoritativeState = await this.readIngestionState(claim.id);
      if (authoritativeState === undefined) {
        throw new ServiceUnavailableException({
          code: 'MEDIA_FINALIZE_OUTCOME_UNKNOWN',
          message: 'Media ingestion outcome requires reconciliation.',
        });
      }
      if (authoritativeState?.status === 'completed') {
        return this.completedReplay(authoritativeState);
      }
      if (
        !authoritativeState ||
        authoritativeState.status !== 'processing' ||
        authoritativeState.processingToken !== claim.processingToken
      ) {
        throw error instanceof HttpException
          ? error
          : new ConflictException('Media ingestion state changed.');
      }
      const finalizeErrorKind = classifyCmsPersistenceError(error);
      if (
        finalizeErrorKind === 'connection' ||
        finalizeErrorKind === 'timeout'
      ) {
        throw new ServiceUnavailableException({
          code: 'MEDIA_FINALIZE_OUTCOME_UNKNOWN',
          message: 'Media ingestion outcome requires reconciliation.',
        });
      }
      const cleanupSucceeded = await this.compensateObject(
        claim.id,
        claim.processingToken,
        objectKey,
      );
      const domainFailureCode =
        error instanceof UnprocessableEntityException
          ? 'MEDIA_SOURCE_NOT_APPROVED'
          : 'DATABASE_WRITE_FAILED';
      await this.ensureFinalizeFailureRecorded(
        claim.id,
        claim.processingToken,
        cleanupSucceeded ? domainFailureCode : 'OBJECT_CLEANUP_REQUIRED',
        cleanupSucceeded,
        actor.id,
        context,
      );
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        code: cleanupSucceeded
          ? 'MEDIA_DATABASE_UNAVAILABLE'
          : 'MEDIA_CLEANUP_REQUIRED',
        message: 'Media ingestion did not complete; retry later.',
      });
    }
  }

  async retryCleanup(
    actor: CmsActor,
    ingestionId: number,
    context: MediaIngestionContext,
  ) {
    assertAdminActor(actor);
    const cleanupToken = randomUUID();
    let claim: MediaIngestion & { storageKey: string };
    try {
      claim = await this.claimCleanup(actor.id, ingestionId, cleanupToken);
    } catch (error: unknown) {
      const classification = classifyCmsPersistenceError(error);
      if (classification !== 'connection' && classification !== 'timeout') {
        throw error;
      }
      const authoritativeState = await this.readIngestionState(ingestionId);
      if (
        authoritativeState?.status === 'processing' &&
        authoritativeState.processingToken === cleanupToken &&
        authoritativeState.failureCode === 'OBJECT_CLEANUP_IN_PROGRESS' &&
        authoritativeState.storageKey
      ) {
        claim = {
          ...authoritativeState,
          storageKey: authoritativeState.storageKey,
        };
      } else {
        throw new ServiceUnavailableException({
          code: 'MEDIA_CLEANUP_OUTCOME_UNKNOWN',
          message: 'Media cleanup outcome requires reconciliation.',
        });
      }
    }

    try {
      if (
        !(await this.ownsProcessingAttempt(claim.id, claim.processingToken))
      ) {
        throw new ConflictException(
          'Media ingestion cleanup ownership changed.',
        );
      }
      await this.storage.deletePrivateObject(claim.storageKey);
    } catch {
      await this.ensureCleanupFailureRecorded(
        actor.id,
        ingestionId,
        claim,
        context,
      );
      throw new ServiceUnavailableException({
        code: 'MEDIA_CLEANUP_REQUIRED',
        message: 'Media cleanup is temporarily unavailable.',
      });
    }

    try {
      await this.completeCleanup(actor.id, ingestionId, claim, context);
    } catch (error: unknown) {
      const authoritativeState = await this.readIngestionState(ingestionId);
      if (
        authoritativeState?.status === 'failed' &&
        authoritativeState.processingToken === claim.processingToken &&
        authoritativeState.failureCode === 'OBJECT_CLEANED'
      ) {
        return cleanupCompletedResponse(ingestionId);
      }
      if (authoritativeState === undefined) {
        throw new ServiceUnavailableException({
          code: 'MEDIA_CLEANUP_OUTCOME_UNKNOWN',
          message: 'Media cleanup outcome requires reconciliation.',
        });
      }
      throw error instanceof HttpException
        ? error
        : new ServiceUnavailableException({
            code: 'MEDIA_CLEANUP_OUTCOME_UNKNOWN',
            message: 'Media cleanup outcome requires reconciliation.',
          });
    }
    return cleanupCompletedResponse(ingestionId);
  }

  private claimCleanup(
    actorId: number,
    ingestionId: number,
    cleanupToken: string,
  ): Promise<MediaIngestion & { storageKey: string }> {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveCmsActor(tx, actorId);
      const rows = await tx.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM "MediaIngestion" WHERE id = ${ingestionId} FOR UPDATE`,
      );
      if (rows.length !== 1) {
        throw new ConflictException(
          'Media ingestion cleanup is not available.',
        );
      }
      const ingestion = await tx.mediaIngestion.findUniqueOrThrow({
        where: { id: ingestionId },
      });
      if (ingestion.status !== 'cleanup_required' || !ingestion.storageKey) {
        throw new ConflictException(
          'Media ingestion cleanup is not available.',
        );
      }
      const claimed = await tx.mediaIngestion.update({
        where: { id: ingestionId },
        data: {
          status: 'processing',
          processingToken: cleanupToken,
          failureCode: 'OBJECT_CLEANUP_IN_PROGRESS',
          processingStartedAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      return { ...claimed, storageKey: ingestion.storageKey };
    });
  }

  private recordCleanupFailure(
    actorId: number,
    ingestionId: number,
    claim: MediaIngestion & { storageKey: string },
    context: MediaIngestionContext,
  ): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.mediaIngestion.updateMany({
        where: {
          id: ingestionId,
          status: 'processing',
          processingToken: claim.processingToken,
        },
        data: {
          status: 'cleanup_required',
          failureCode: 'OBJECT_CLEANUP_REQUIRED',
          cleanupAttempts: { increment: 1 },
          cleanupLastAttemptAt: new Date(),
        },
      });
      if (result.count !== 1) {
        throw new ConflictException(
          'Media ingestion cleanup ownership changed.',
        );
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'media.ingestion_cleanup_failed',
          targetType: 'media_ingestion',
          targetId: String(ingestionId),
          correlationId: context.correlationId,
          afterSummary: {
            ingestionId,
            status: 'cleanup_required',
            failureCode: 'OBJECT_CLEANUP_REQUIRED',
          },
        },
      });
    });
  }

  private async ensureCleanupFailureRecorded(
    actorId: number,
    ingestionId: number,
    claim: MediaIngestion & { storageKey: string },
    context: MediaIngestionContext,
  ): Promise<void> {
    try {
      await this.recordCleanupFailure(actorId, ingestionId, claim, context);
    } catch (error: unknown) {
      const authoritativeState = await this.readIngestionState(ingestionId);
      if (
        authoritativeState?.status === 'cleanup_required' &&
        authoritativeState.processingToken === claim.processingToken &&
        authoritativeState.failureCode === 'OBJECT_CLEANUP_REQUIRED'
      ) {
        return;
      }
      throw error instanceof HttpException
        ? error
        : new ServiceUnavailableException({
            code: 'MEDIA_CLEANUP_OUTCOME_UNKNOWN',
            message: 'Media cleanup outcome requires reconciliation.',
          });
    }
  }

  private completeCleanup(
    actorId: number,
    ingestionId: number,
    claim: MediaIngestion & { storageKey: string },
    context: MediaIngestionContext,
  ): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.mediaIngestion.updateMany({
        where: {
          id: ingestionId,
          status: 'processing',
          processingToken: claim.processingToken,
        },
        data: {
          status: 'failed',
          failureCode: 'OBJECT_CLEANED',
          cleanupAttempts: { increment: 1 },
          cleanupLastAttemptAt: new Date(),
        },
      });
      if (result.count !== 1) {
        throw new ConflictException(
          'Media ingestion cleanup ownership changed.',
        );
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'media.ingestion_cleanup_completed',
          targetType: 'media_ingestion',
          targetId: String(ingestionId),
          correlationId: context.correlationId,
          afterSummary: {
            ingestionId,
            status: 'failed',
            failureCode: 'OBJECT_CLEANED',
          },
        },
      });
    });
  }

  private async claimIngestion(input: {
    actor: CmsActor;
    dataSourceId: number;
    idempotencyKeyHash: string;
    requestFingerprint: string;
    filename: string;
    declaredMimeType: string;
    size: number;
    initialProcessingToken: string;
  }): Promise<MediaIngestion> {
    try {
      return await this.claimIngestionTransaction(input);
    } catch (error: unknown) {
      const classification = classifyCmsPersistenceError(error);
      if (classification === 'unique_conflict') {
        return this.claimIngestionTransaction(input);
      }
      if (classification === 'connection' || classification === 'timeout') {
        const authoritativeState = await this.findClaimedIngestion(input);
        if (
          authoritativeState?.status === 'processing' &&
          authoritativeState.processingToken === input.initialProcessingToken &&
          authoritativeState.requestFingerprint === input.requestFingerprint
        ) {
          return authoritativeState;
        }
      }
      throw this.mapPersistenceError(error);
    }
  }

  private async findClaimedIngestion(input: {
    actor: CmsActor;
    idempotencyKeyHash: string;
    requestFingerprint: string;
  }): Promise<MediaIngestion | null | undefined> {
    try {
      return await this.prisma.mediaIngestion.findUnique({
        where: {
          actorId_idempotencyKeyHash: {
            actorId: input.actor.id,
            idempotencyKeyHash: input.idempotencyKeyHash,
          },
        },
      });
    } catch {
      return undefined;
    }
  }

  private claimIngestionTransaction(input: {
    actor: CmsActor;
    dataSourceId: number;
    idempotencyKeyHash: string;
    requestFingerprint: string;
    filename: string;
    declaredMimeType: string;
    size: number;
    initialProcessingToken: string;
  }): Promise<MediaIngestion> {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveCmsActor(tx, input.actor.id);
      const sources = await tx.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM "DataSource" WHERE id = ${input.dataSourceId} AND NULLIF(btrim(license), '') IS NOT NULL FOR SHARE`,
      );
      if (sources.length !== 1) {
        throw new UnprocessableEntityException({
          code: 'MEDIA_SOURCE_NOT_APPROVED',
          message: 'Media source and license must be approved.',
        });
      }
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "MediaIngestion" WHERE "actorId" = ${input.actor.id} AND "idempotencyKeyHash" = ${input.idempotencyKeyHash} FOR UPDATE`,
      );
      const existing = await tx.mediaIngestion.findUnique({
        where: {
          actorId_idempotencyKeyHash: {
            actorId: input.actor.id,
            idempotencyKeyHash: input.idempotencyKeyHash,
          },
        },
      });
      if (existing) {
        if (existing.requestFingerprint !== input.requestFingerprint) {
          throw new ConflictException('Idempotency-Key is already in use.');
        }
        if (existing.status === 'completed') return existing;
        if (existing.status === 'rejected') {
          throw new UnprocessableEntityException({
            code: existing.failureCode ?? 'MEDIA_REJECTED',
            message: 'Media upload was rejected.',
          });
        }
        if (existing.status === 'cleanup_required') {
          throw new ServiceUnavailableException({
            code: 'MEDIA_CLEANUP_REQUIRED',
            message: 'Media cleanup is required before retry.',
          });
        }
        if (existing.status === 'processing') {
          throw new ConflictException(
            'Media ingestion is already in progress.',
          );
        }
        return tx.mediaIngestion.update({
          where: { id: existing.id },
          data: {
            status: 'processing',
            processingToken: input.initialProcessingToken,
            failureCode: null,
            processingStartedAt: new Date(),
            attemptCount: { increment: 1 },
          },
        });
      }
      return tx.mediaIngestion.create({
        data: {
          actorId: input.actor.id,
          dataSourceId: input.dataSourceId,
          idempotencyKeyHash: input.idempotencyKeyHash,
          requestFingerprint: input.requestFingerprint,
          status: 'processing',
          originalFilename: input.filename,
          declaredMimeType: input.declaredMimeType,
          size: input.size,
          storageProvider: this.storage.provider,
          processingStartedAt: new Date(),
          processingToken: input.initialProcessingToken,
          attemptCount: 1,
        },
      });
    });
  }

  private async completedReplay(ingestion: MediaIngestion) {
    if (!ingestion.mediaId || !ingestion.storageKey || !ingestion.checksum) {
      throw new ConflictException('Completed media ingestion is incoherent.');
    }
    try {
      const object = await this.storage.getPrivateObject(ingestion.storageKey);
      if (
        object.checksum !== ingestion.checksum ||
        object.size !== ingestion.size ||
        object.contentType !== ingestion.validatedMimeType ||
        sha256(object.body) !== ingestion.checksum
      ) {
        throw new Error('stored object integrity mismatch');
      }
    } catch {
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_INTEGRITY_ERROR',
        message: 'Stored media integrity could not be verified.',
      });
    }
    const media = await this.prisma.media.findUnique({
      where: { id: ingestion.mediaId },
      select: {
        id: true,
        type: true,
        mimeType: true,
        size: true,
        checksum: true,
        storageProvider: true,
        storageKey: true,
        dataSourceId: true,
        deletedAt: true,
        processingStatus: true,
      },
    });
    if (
      !media ||
      media.checksum !== ingestion.checksum ||
      media.storageProvider !== ingestion.storageProvider ||
      media.storageKey !== ingestion.storageKey ||
      media.dataSourceId !== ingestion.dataSourceId ||
      media.size !== ingestion.size ||
      media.processingStatus !== 'ready' ||
      media.deletedAt !== null
    )
      throw new ConflictException('Completed media ingestion is incoherent.');
    return {
      success: true as const,
      data: {
        idempotent: true,
        media: {
          id: media.id,
          type: media.type,
          mimeType: media.mimeType,
          size: media.size,
          processingStatus: media.processingStatus,
        },
      },
    };
  }

  private reserveValidatedObject(
    ingestionId: number,
    processingToken: string,
    storageKey: string,
    processed: ProcessedMediaFile,
  ) {
    return this.prisma.mediaIngestion
      .updateMany({
        where: { id: ingestionId, status: 'processing', processingToken },
        data: {
          storageKey,
          checksum: processed.checksum,
          validatedMimeType: processed.mimeType,
          size: processed.buffer.length,
        },
      })
      .then((result) => {
        if (result.count !== 1) {
          throw new ConflictException('Media ingestion ownership changed.');
        }
      });
  }

  private finalizeMedia(
    actor: CmsActor,
    ingestionId: number,
    processingToken: string,
    dataSourceId: number,
    storageKey: string,
    filename: string,
    processed: ProcessedMediaFile,
    context: MediaIngestionContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveCmsActor(tx, actor.id);
      const sources = await tx.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM "DataSource" WHERE id = ${dataSourceId} AND NULLIF(btrim(license), '') IS NOT NULL FOR SHARE`,
      );
      if (sources.length !== 1) {
        throw new UnprocessableEntityException({
          code: 'MEDIA_SOURCE_NOT_APPROVED',
          message: 'Media source and license must be approved.',
        });
      }
      const rows = await tx.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM "MediaIngestion" WHERE id = ${ingestionId} AND status = 'processing' AND "processingToken" = ${processingToken} FOR UPDATE`,
      );
      if (rows.length !== 1) {
        throw new ConflictException('Media ingestion state changed.');
      }
      const temporaryUrl = `urn:hsk:media:${randomUUID()}`;
      const media = await tx.media.create({
        data: {
          url: temporaryUrl,
          type: processed.mediaType,
          mimeType: processed.mimeType,
          size: processed.buffer.length,
          duration: processed.duration,
          storageProvider: this.storage.provider,
          storageKey,
          originalFilename: filename,
          checksum: processed.checksum,
          processingStatus: 'ready',
          dataSourceId,
          metadata: {
            ingestionVersion: 'secure-media-ingestion-v1',
            ...processed.metadata,
          },
          uploadedById: actor.id,
          updatedById: actor.id,
        },
        select: {
          id: true,
          type: true,
          mimeType: true,
          size: true,
          processingStatus: true,
        },
      });
      await tx.media.update({
        where: { id: media.id },
        data: { url: `/api/v1/media/${media.id}/access` },
        select: { id: true },
      });
      await tx.mediaIngestion.update({
        where: { id: ingestionId },
        data: {
          status: 'completed',
          mediaId: media.id,
          failureCode: null,
          completedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'media.ingested',
          targetType: 'media',
          targetId: String(media.id),
          correlationId: context.correlationId,
          afterSummary: {
            entityType: 'media',
            entityId: media.id,
            ingestionId,
            type: processed.mediaType,
            mimeType: processed.mimeType,
            size: processed.buffer.length,
            processingStatus: 'ready',
          },
        },
      });
      return { success: true as const, data: { idempotent: false, media } };
    });
  }

  private async markRejected(
    ingestionId: number,
    processingToken: string,
    failureCode: string,
    actorId: number,
    context: MediaIngestionContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.mediaIngestion.updateMany({
        where: { id: ingestionId, status: 'processing', processingToken },
        data: { status: 'rejected', failureCode },
      });
      if (result.count !== 1) {
        throw new ConflictException('Media ingestion ownership changed.');
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'media.ingestion_rejected',
          targetType: 'media_ingestion',
          targetId: String(ingestionId),
          correlationId: context.correlationId,
          afterSummary: { ingestionId, status: 'rejected', failureCode },
        },
      });
    });
  }

  private async ensureRejected(
    ingestionId: number,
    processingToken: string,
    failureCode: string,
    actorId: number,
    context: MediaIngestionContext,
  ): Promise<void> {
    try {
      await this.markRejected(
        ingestionId,
        processingToken,
        failureCode,
        actorId,
        context,
      );
    } catch (error: unknown) {
      const authoritativeState = await this.readIngestionState(ingestionId);
      if (
        authoritativeState?.status === 'rejected' &&
        authoritativeState.processingToken === processingToken &&
        authoritativeState.failureCode === failureCode
      ) {
        return;
      }
      if (authoritativeState === undefined) {
        throw new ServiceUnavailableException({
          code: 'MEDIA_REJECTION_OUTCOME_UNKNOWN',
          message: 'Media rejection outcome requires reconciliation.',
        });
      }
      throw error;
    }
  }

  private recordFailure(
    ingestionId: number,
    processingToken: string,
    failureCode: string,
    actorId: number,
    context: MediaIngestionContext,
    status: 'cleanup_required' | 'failed' = 'failed',
    recordCleanupAttempt = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.mediaIngestion.updateMany({
        where: { id: ingestionId, status: 'processing', processingToken },
        data: {
          status,
          failureCode,
          ...(recordCleanupAttempt
            ? {
                cleanupAttempts: { increment: 1 },
                cleanupLastAttemptAt: new Date(),
              }
            : {}),
        },
      });
      if (result.count !== 1) return;
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'media.ingestion_failed',
          targetType: 'media_ingestion',
          targetId: String(ingestionId),
          correlationId: context.correlationId,
          afterSummary: { ingestionId, status, failureCode },
        },
      });
    });
  }

  private async compensateObject(
    ingestionId: number,
    processingToken: string,
    objectKey: string,
  ): Promise<boolean> {
    try {
      if (!(await this.ownsProcessingAttempt(ingestionId, processingToken))) {
        return false;
      }
      await this.storage.deletePrivateObject(objectKey);
      return true;
    } catch {
      return false;
    }
  }

  private async markFinalizeFailure(
    ingestionId: number,
    processingToken: string,
    failureCode: string,
    cleanupSucceeded: boolean,
    actorId: number,
    context: MediaIngestionContext,
  ) {
    await this.recordFailure(
      ingestionId,
      processingToken,
      failureCode,
      actorId,
      context,
      cleanupSucceeded ? 'failed' : 'cleanup_required',
      true,
    );
  }

  private async ensureFinalizeFailureRecorded(
    ingestionId: number,
    processingToken: string,
    failureCode: string,
    cleanupSucceeded: boolean,
    actorId: number,
    context: MediaIngestionContext,
  ): Promise<void> {
    try {
      await this.markFinalizeFailure(
        ingestionId,
        processingToken,
        failureCode,
        cleanupSucceeded,
        actorId,
        context,
      );
    } catch {
      const authoritativeState = await this.readIngestionState(ingestionId);
      const expectedStatus = cleanupSucceeded ? 'failed' : 'cleanup_required';
      if (
        authoritativeState?.status === expectedStatus &&
        authoritativeState.processingToken === processingToken &&
        authoritativeState.failureCode === failureCode
      ) {
        return;
      }
      throw new ServiceUnavailableException({
        code: 'MEDIA_FINALIZE_OUTCOME_UNKNOWN',
        message: 'Media ingestion outcome requires reconciliation.',
      });
    }
  }

  private async ownsProcessingAttempt(
    ingestionId: number,
    processingToken: string,
  ): Promise<boolean> {
    return (
      (await this.prisma.mediaIngestion.count({
        where: { id: ingestionId, status: 'processing', processingToken },
      })) === 1
    );
  }

  private async readIngestionState(
    ingestionId: number,
  ): Promise<MediaIngestion | null | undefined> {
    try {
      return await this.prisma.mediaIngestion.findUnique({
        where: { id: ingestionId },
      });
    } catch {
      return undefined;
    }
  }

  private mapPersistenceError(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    const classification = classifyCmsPersistenceError(error);
    if (
      classification === 'timeout' ||
      classification === 'connection' ||
      classification === 'concurrent_retry'
    ) {
      return new ServiceUnavailableException({
        code: 'MEDIA_INGESTION_UNAVAILABLE',
        message: 'Media ingestion is temporarily unavailable.',
      });
    }
    if (
      classification === 'unique_conflict' ||
      classification === 'constraint_conflict'
    ) {
      return new ConflictException('Media ingestion conflict.');
    }
    return new InternalServerErrorException('Media ingestion failed.');
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function cleanupCompletedResponse(ingestionId: number) {
  return {
    success: true as const,
    data: { ingestionId, cleanupCompleted: true },
  };
}
