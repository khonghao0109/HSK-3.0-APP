import { createHash } from 'node:crypto';

import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OBJECT_STORAGE } from '../../infrastructure/storage/object-storage.port';
import type {
  ObjectStoragePort,
  StoredObject,
} from '../../infrastructure/storage/object-storage.port';
import {
  ObjectStorageError,
  ObjectStorageErrorKind,
} from '../../infrastructure/storage/object-storage.port';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaObservabilityService } from '../../infrastructure/observability/media-observability.service';
import {
  canonicalMediaContentResource,
  createMediaAccessSignature,
  MEDIA_CONTENT_ACCESS_METHOD,
  verifyMediaAccessSignature,
} from './media-access-signature';

type AuthenticatedMediaActor = { id: number; role: string };

@Injectable()
export class MediaAccessService {
  private readonly signingSecret: string;
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Optional() private readonly metrics?: MediaObservabilityService,
  ) {
    this.signingSecret = config.getOrThrow<string>('media.signingSecret');
    this.accessTtlSeconds = config.getOrThrow<number>('media.accessTtlSeconds');
  }

  async createAccess(actor: AuthenticatedMediaActor, mediaId: number) {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        checksum: true,
        mimeType: true,
        storageProvider: true,
        storageKey: true,
        type: true,
        processingStatus: true,
        deletedAt: true,
        lessonExercises: {
          where: {
            status: 'published',
            deletedAt: null,
            lesson: { is: { status: 'published', deletedAt: null } },
            OR: [
              { topicId: null },
              { topic: { is: { status: 'published', deletedAt: null } } },
            ],
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (
      !media ||
      media.processingStatus !== 'ready' ||
      media.deletedAt !== null ||
      !media.checksum ||
      !isSupportedPrivateMedia(media) ||
      !media.storageKey ||
      !media.storageProvider ||
      media.storageProvider !== this.storage.provider
    ) {
      if (
        media?.storageProvider &&
        media.storageProvider !== this.storage.provider
      ) {
        this.metrics?.recordSignedAccess('provider_mismatch');
        this.metrics?.recordStorage('get', 'provider_mismatch', 0);
        this.metrics?.recordReconciliation('violation');
      }
      throw new NotFoundException('Media asset is not available.');
    }
    if (actor.role !== 'admin' && media.lessonExercises.length === 0) {
      throw new ForbiddenException('Media asset access is not allowed.');
    }
    const expiresAt = Math.floor(Date.now() / 1000) + this.accessTtlSeconds;
    const signature = createMediaAccessSignature({
      mediaId,
      expiresAt,
      checksum: media.checksum,
      secret: this.signingSecret,
      method: MEDIA_CONTENT_ACCESS_METHOD,
      resource: canonicalMediaContentResource(mediaId),
    });
    return {
      success: true as const,
      data: {
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        url: `/api/v1/media/${mediaId}/content?expires=${expiresAt}&signature=${signature}`,
      },
    };
  }

  async readSignedObject(
    mediaId: number,
    expiresAt: number,
    signature: string,
    requestTarget: { method: string; path: string },
  ): Promise<StoredObject> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: {
        checksum: true,
        mimeType: true,
        size: true,
        storageProvider: true,
        storageKey: true,
        type: true,
        processingStatus: true,
        deletedAt: true,
      },
    });
    if (
      !media ||
      !media.checksum ||
      !media.mimeType ||
      !media.size ||
      !media.storageKey ||
      !media.storageProvider ||
      media.storageProvider !== this.storage.provider ||
      !isSupportedPrivateMedia(media) ||
      media.processingStatus !== 'ready' ||
      media.deletedAt !== null ||
      !verifyMediaAccessSignature({
        mediaId,
        expiresAt,
        checksum: media.checksum,
        signature,
        secret: this.signingSecret,
        method: requestTarget.method,
        resource: requestTarget.path,
      })
    ) {
      this.metrics?.recordSignedAccess(
        media?.storageProvider &&
          media.storageProvider !== this.storage.provider
          ? 'provider_mismatch'
          : 'invalid_grant',
      );
      if (
        media?.storageProvider &&
        media.storageProvider !== this.storage.provider
      ) {
        this.metrics?.recordStorage('get', 'provider_mismatch', 0);
        this.metrics?.recordReconciliation('violation');
      }
      throw new ForbiddenException('Media access grant is invalid or expired.');
    }
    const getStartedAt = Date.now();
    try {
      const object = await this.storage.getPrivateObject(media.storageKey);
      if (
        object.checksum !== media.checksum ||
        object.body.length !== object.size ||
        object.size !== media.size ||
        object.contentType !== media.mimeType ||
        createHash('sha256').update(object.body).digest('hex') !==
          media.checksum
      ) {
        throw new ObjectStorageError('integrity_violation');
      }
      this.metrics?.recordStorage('get', 'success', Date.now() - getStartedAt);
      this.metrics?.recordSignedAccess('success');
      return object;
    } catch (error: unknown) {
      const kind = storageFailureKind(error);
      const elapsed = Date.now() - getStartedAt;
      if (kind === 'unavailable') {
        this.metrics?.recordStorage('get', 'error', elapsed);
        this.metrics?.recordSignedAccess('unavailable');
        throw new ServiceUnavailableException({
          code: 'MEDIA_STORAGE_UNAVAILABLE',
          message: 'Media content is temporarily unavailable.',
        });
      }
      if (kind === 'provider_mismatch') {
        this.metrics?.recordStorage('get', 'provider_mismatch', elapsed);
        this.metrics?.recordSignedAccess('provider_mismatch');
        this.metrics?.recordReconciliation('violation');
        throw new ServiceUnavailableException({
          code: 'MEDIA_STORAGE_PROVIDER_MISMATCH',
          message: 'Media content storage provider is unavailable.',
        });
      }
      this.metrics?.recordStorage(
        'get',
        kind === 'integrity_violation' ? 'integrity_error' : kind,
        elapsed,
      );
      this.metrics?.recordSignedAccess('integrity_error');
      this.metrics?.recordReconciliation('violation');
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_INTEGRITY_ERROR',
        message: 'Media content failed integrity verification.',
      });
    }
  }
}

function storageFailureKind(error: unknown): ObjectStorageErrorKind {
  return error instanceof ObjectStorageError ? error.kind : 'unavailable';
}

function isSupportedPrivateMedia(media: {
  type: string;
  mimeType: string | null;
}): boolean {
  return (
    (media.type === 'image' &&
      (media.mimeType === 'image/jpeg' || media.mimeType === 'image/png')) ||
    (media.type === 'audio' &&
      (media.mimeType === 'audio/mpeg' || media.mimeType === 'audio/wav'))
  );
}
