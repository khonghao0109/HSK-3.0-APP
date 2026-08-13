import { createHash, randomUUID } from 'node:crypto';

import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MediaIngestion } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import { MEDIA_MALWARE_SCANNER } from '../../../infrastructure/malware/media-malware-scanner.port';
import type { MediaMalwareScannerPort } from '../../../infrastructure/malware/media-malware-scanner.port';
import { MediaScannerError } from '../../../infrastructure/malware/media-malware-scanner.port';
import { OBJECT_STORAGE } from '../../../infrastructure/storage/object-storage.port';
import type { ObjectStoragePort } from '../../../infrastructure/storage/object-storage.port';
import { ObjectStorageWriteError } from '../../../infrastructure/storage/object-storage.port';
import { ObjectStorageError } from '../../../infrastructure/storage/object-storage.port';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  assertMediaIngestionEnabled,
  MediaObservabilityService,
} from '../../../infrastructure/observability/media-observability.service';
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
export const MEDIA_CLEANUP_SETTLING_MS = 60_000;

export type UploadedMediaFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type MediaIngestionContext = { correlationId: string };

type MediaProvenanceSnapshot = {
  sourceCodeSnapshot: string;
  sourceVersionSnapshot: string;
  sourceLicenseSnapshot: string;
  sourceAttributionSnapshot: string | null;
  sourceReferenceUrlSnapshot: string | null;
  sourceContentHashSnapshot: string | null;
};

@Injectable()
export class MediaIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileProcessor: MediaFileProcessor,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(MEDIA_MALWARE_SCANNER)
    private readonly scanner: MediaMalwareScannerPort,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly metrics?: MediaObservabilityService,
  ) {}

  async ingest(
    actor: CmsActor,
    file: UploadedMediaFile | undefined,
    dataSourceId: number,
    idempotencyHeader: string | undefined,
    context: MediaIngestionContext,
  ) {
    assertAdminActor(actor);
    assertMediaIngestionEnabled(
      this.config?.get<boolean>('media.ingestionEnabled') ?? true,
    );
    const startedAt = Date.now();
    this.metrics?.recordIngestion('request');
    try {
      const response = await this.ingestInternal(
        actor,
        file,
        dataSourceId,
        idempotencyHeader,
        context,
      );
      if (response.data.idempotent) {
        // A completed replay validates persisted state but performs no media
        // processing. Count its successful request without biasing processing
        // latency SLOs toward the much faster replay path.
        this.metrics?.recordIngestion('success');
      } else {
        this.metrics?.recordIngestion('success', Date.now() - startedAt);
      }
      return response;
    } catch (error: unknown) {
      this.metrics?.recordIngestion(
        ingestionMetricOutcome(error),
        Date.now() - startedAt,
      );
      throw error;
    }
  }

  private async ingestInternal(
    actor: CmsActor,
    file: UploadedMediaFile | undefined,
    dataSourceId: number,
    idempotencyHeader: string | undefined,
    context: MediaIngestionContext,
  ) {
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
    const scanStartedAt = Date.now();
    try {
      scanResult = await this.scanner.scan(processed.buffer);
    } catch (error: unknown) {
      const invalidResponse =
        error instanceof MediaScannerError && error.kind === 'invalid_response';
      this.metrics?.recordScanner(
        invalidResponse ? 'invalid_response' : 'unavailable',
        Date.now() - scanStartedAt,
      );
      await this.recordFailure(
        claim.id,
        claim.processingToken,
        invalidResponse ? 'SCANNER_INVALID_RESPONSE' : 'SCANNER_UNAVAILABLE',
        actor.id,
        context,
      ).catch(() => undefined);
      throw new ServiceUnavailableException({
        code: invalidResponse
          ? 'MEDIA_SCANNER_INVALID_RESPONSE'
          : 'MEDIA_SCANNER_UNAVAILABLE',
        message: invalidResponse
          ? 'Media scanner response failed validation.'
          : 'Media scanning is temporarily unavailable.',
      });
    }
    if (!scanResult.clean) {
      this.metrics?.recordScanner('malware', Date.now() - scanStartedAt);
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
    this.metrics?.recordScanner('success', Date.now() - scanStartedAt);

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

    const putStartedAt = Date.now();
    try {
      await this.storage.putPrivateObject({
        key: objectKey,
        body: processed.buffer,
        contentType: processed.mimeType,
        checksum: processed.checksum,
      });
      this.metrics?.recordStorage('put', 'success', Date.now() - putStartedAt);
    } catch (error: unknown) {
      this.metrics?.recordStorage('put', 'error', Date.now() - putStartedAt);
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
    let objectWasPresent: boolean;
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

    if (!(await this.ownsProcessingAttempt(claim.id, claim.processingToken))) {
      throw new ConflictException('Media ingestion cleanup ownership changed.');
    }

    try {
      objectWasPresent = await this.observeStorageOperation('head', () =>
        this.storage.privateObjectExists(claim.storageKey),
      );
      await this.observeStorageOperation('delete', () =>
        this.storage.deletePrivateObject(claim.storageKey),
      );
      await this.observeStorageOperation('verify', async () => {
        const remains = await this.storage.privateObjectExists(
          claim.storageKey,
        );
        if (remains) {
          this.metrics?.recordReconciliation('violation');
          throw new ObjectStorageError('integrity_violation');
        }
        return remains;
      });
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

    const priorAbsenceIsSettled =
      !objectWasPresent &&
      claim.cleanupAbsentObservedAt !== null &&
      Date.now() - claim.cleanupAbsentObservedAt.getTime() >=
        MEDIA_CLEANUP_SETTLING_MS;
    if (!priorAbsenceIsSettled) {
      await this.ensureCleanupDeferred(
        actor.id,
        ingestionId,
        claim,
        objectWasPresent,
        context,
      );
      return cleanupSettlingResponse(ingestionId);
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

  private async observeStorageOperation<T>(
    operation: 'head' | 'delete' | 'verify',
    invoke: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await invoke();
      this.metrics?.recordStorage(operation, 'success', Date.now() - startedAt);
      return result;
    } catch (error: unknown) {
      this.metrics?.recordStorage(
        operation,
        storageMetricOutcome(error),
        Date.now() - startedAt,
      );
      throw error;
    }
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
      if (ingestion.storageProvider !== this.storage.provider) {
        throw new ConflictException(
          'Media ingestion storage provider is unavailable.',
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
          cleanupAbsentObservedAt: null,
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

  private deferCleanupAfterAbsence(
    actorId: number,
    ingestionId: number,
    claim: MediaIngestion & { storageKey: string },
    resetAbsenceWindow: boolean,
    context: MediaIngestionContext,
  ): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const observedAt =
        resetAbsenceWindow || claim.cleanupAbsentObservedAt === null
          ? new Date()
          : claim.cleanupAbsentObservedAt;
      const result = await tx.mediaIngestion.updateMany({
        where: {
          id: ingestionId,
          status: 'processing',
          processingToken: claim.processingToken,
        },
        data: {
          status: 'cleanup_required',
          failureCode: 'OBJECT_CLEANUP_SETTLING',
          cleanupAttempts: { increment: 1 },
          cleanupLastAttemptAt: new Date(),
          cleanupAbsentObservedAt: observedAt,
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
          action: 'media.ingestion_cleanup_settling',
          targetType: 'media_ingestion',
          targetId: String(ingestionId),
          correlationId: context.correlationId,
          afterSummary: {
            ingestionId,
            status: 'cleanup_required',
            failureCode: 'OBJECT_CLEANUP_SETTLING',
          },
        },
      });
    });
  }

  private async ensureCleanupDeferred(
    actorId: number,
    ingestionId: number,
    claim: MediaIngestion & { storageKey: string },
    resetAbsenceWindow: boolean,
    context: MediaIngestionContext,
  ): Promise<void> {
    try {
      await this.deferCleanupAfterAbsence(
        actorId,
        ingestionId,
        claim,
        resetAbsenceWindow,
        context,
      );
    } catch (error: unknown) {
      const authoritativeState = await this.readIngestionState(ingestionId);
      if (
        authoritativeState?.status === 'cleanup_required' &&
        authoritativeState.processingToken === claim.processingToken &&
        authoritativeState.failureCode === 'OBJECT_CLEANUP_SETTLING' &&
        authoritativeState.cleanupAbsentObservedAt !== null
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
      const sources = await tx.$queryRaw<MediaProvenanceSnapshot[]>(
        Prisma.sql`SELECT
          code AS "sourceCodeSnapshot",
          version AS "sourceVersionSnapshot",
          license AS "sourceLicenseSnapshot",
          attribution AS "sourceAttributionSnapshot",
          "referenceUrl" AS "sourceReferenceUrlSnapshot",
          "contentHash" AS "sourceContentHashSnapshot"
        FROM "DataSource"
        WHERE id = ${input.dataSourceId}
          AND NULLIF(btrim(code), '') IS NOT NULL
          AND NULLIF(btrim(version), '') IS NOT NULL
          AND NULLIF(btrim(license), '') IS NOT NULL
          AND ("referenceUrl" IS NULL OR NULLIF(btrim("referenceUrl"), '') IS NOT NULL)
          AND (attribution IS NULL OR NULLIF(btrim(attribution), '') IS NOT NULL)
          AND ("contentHash" IS NULL OR NULLIF(btrim("contentHash"), '') IS NOT NULL)
        FOR SHARE`,
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
        if (existing.storageProvider !== this.storage.provider) {
          this.metrics?.recordStorage('put', 'provider_mismatch', 0);
          throw new ConflictException(
            'Media ingestion storage provider is unavailable.',
          );
        }
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
        if (existing.storageKey || existing.failureCode === 'OBJECT_CLEANED') {
          throw new ConflictException(
            'A new Idempotency-Key is required after storage reconciliation.',
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
          ...sources[0],
        },
      });
    });
  }

  private async completedReplay(ingestion: MediaIngestion) {
    if (!ingestion.mediaId || !ingestion.storageKey || !ingestion.checksum) {
      throw new ConflictException('Completed media ingestion is incoherent.');
    }
    if (ingestion.storageProvider !== this.storage.provider) {
      this.metrics?.recordStorage('get', 'provider_mismatch', 0);
      this.metrics?.recordReconciliation('violation');
      throw new ConflictException(
        'Completed media ingestion storage provider is unavailable.',
      );
    }
    const getStartedAt = Date.now();
    try {
      const object = await this.storage.getPrivateObject(ingestion.storageKey);
      if (
        object.checksum !== ingestion.checksum ||
        object.size !== ingestion.size ||
        object.contentType !== ingestion.validatedMimeType ||
        sha256(object.body) !== ingestion.checksum
      ) {
        throw new ObjectStorageError('integrity_violation');
      }
      this.metrics?.recordStorage('get', 'success', Date.now() - getStartedAt);
    } catch (error: unknown) {
      this.recordStorageReadFailure(error, Date.now() - getStartedAt);
      const storageFailure =
        error instanceof ObjectStorageError ? error.kind : 'unavailable';
      const integrityFailure = storageFailure !== 'unavailable';
      if (integrityFailure) this.metrics?.recordReconciliation('violation');
      const providerMismatch = storageFailure === 'provider_mismatch';
      throw new ServiceUnavailableException({
        code: providerMismatch
          ? 'MEDIA_STORAGE_PROVIDER_MISMATCH'
          : integrityFailure
            ? 'MEDIA_STORAGE_INTEGRITY_ERROR'
            : 'MEDIA_STORAGE_UNAVAILABLE',
        message: providerMismatch
          ? 'Stored media provider does not match the active adapter.'
          : integrityFailure
            ? 'Stored media integrity could not be verified.'
            : 'Stored media is temporarily unavailable.',
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
    ) {
      this.metrics?.recordReconciliation('violation');
      throw new ConflictException('Completed media ingestion is incoherent.');
    }
    this.metrics?.recordReconciliation('coherent');
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

  private recordStorageReadFailure(error: unknown, milliseconds: number): void {
    if (error instanceof ObjectStorageError) {
      this.metrics?.recordStorage(
        'get',
        error.kind === 'unavailable'
          ? 'error'
          : error.kind === 'integrity_violation'
            ? 'integrity_error'
            : error.kind === 'provider_mismatch'
              ? 'provider_mismatch'
              : error.kind,
        milliseconds,
      );
      return;
    }
    this.metrics?.recordStorage('get', 'error', milliseconds);
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
      const sources = await tx.$queryRaw<MediaProvenanceSnapshot[]>(
        Prisma.sql`SELECT
          code AS "sourceCodeSnapshot",
          version AS "sourceVersionSnapshot",
          license AS "sourceLicenseSnapshot",
          attribution AS "sourceAttributionSnapshot",
          "referenceUrl" AS "sourceReferenceUrlSnapshot",
          "contentHash" AS "sourceContentHashSnapshot"
        FROM "DataSource"
        WHERE id = ${dataSourceId}
          AND NULLIF(btrim(code), '') IS NOT NULL
          AND NULLIF(btrim(version), '') IS NOT NULL
          AND NULLIF(btrim(license), '') IS NOT NULL
          AND ("referenceUrl" IS NULL OR NULLIF(btrim("referenceUrl"), '') IS NOT NULL)
          AND (attribution IS NULL OR NULLIF(btrim(attribution), '') IS NOT NULL)
          AND ("contentHash" IS NULL OR NULLIF(btrim("contentHash"), '') IS NOT NULL)
        FOR SHARE`,
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
      const ingestion = await tx.mediaIngestion.findUniqueOrThrow({
        where: { id: ingestionId },
        select: {
          sourceCodeSnapshot: true,
          sourceVersionSnapshot: true,
          sourceLicenseSnapshot: true,
          sourceAttributionSnapshot: true,
          sourceReferenceUrlSnapshot: true,
          sourceContentHashSnapshot: true,
        },
      });
      if (!sameProvenance(sources[0], ingestion)) {
        throw new UnprocessableEntityException({
          code: 'MEDIA_SOURCE_NOT_APPROVED',
          message: 'Media source provenance changed during ingestion.',
        });
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
            provenance: sources[0],
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
      await this.observeStorageOperation('delete', () =>
        this.storage.deletePrivateObject(objectKey),
      );
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
        where: {
          id: ingestionId,
          status: 'processing',
          processingToken,
          storageProvider: this.storage.provider,
        },
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

function cleanupSettlingResponse(ingestionId: number) {
  return {
    success: true as const,
    data: { ingestionId, cleanupCompleted: false, settling: true },
  };
}

function sameProvenance(
  expected: MediaProvenanceSnapshot | undefined,
  actual: MediaProvenanceSnapshot,
): boolean {
  return (
    expected !== undefined &&
    expected.sourceCodeSnapshot === actual.sourceCodeSnapshot &&
    expected.sourceVersionSnapshot === actual.sourceVersionSnapshot &&
    expected.sourceLicenseSnapshot === actual.sourceLicenseSnapshot &&
    expected.sourceAttributionSnapshot === actual.sourceAttributionSnapshot &&
    expected.sourceReferenceUrlSnapshot === actual.sourceReferenceUrlSnapshot &&
    expected.sourceContentHashSnapshot === actual.sourceContentHashSnapshot
  );
}

function ingestionMetricOutcome(
  error: unknown,
): 'rejected' | 'failed' | 'cleanup_required' {
  if (error instanceof UnprocessableEntityException) return 'rejected';
  if (error instanceof ServiceUnavailableException) {
    const response = error.getResponse();
    if (
      response &&
      typeof response === 'object' &&
      'code' in response &&
      (response.code === 'MEDIA_CLEANUP_REQUIRED' ||
        response.code === 'MEDIA_CLEANUP_OUTCOME_UNKNOWN')
    ) {
      return 'cleanup_required';
    }
  }
  return 'failed';
}

function storageMetricOutcome(error: unknown) {
  if (!(error instanceof ObjectStorageError)) return 'error' as const;
  if (error.kind === 'integrity_violation') return 'integrity_error' as const;
  if (error.kind === 'unavailable') return 'error' as const;
  return error.kind;
}
