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
import { buildLessonReadyWhere } from '../../common/policies/lesson-readiness.policy';
import { PrismaService } from '../../prisma/prisma.service';
import { PUBLIC_LESSON_EXERCISE_WHERE } from '../learning/public-exercise.policy';
import { MediaObservabilityService } from '../../infrastructure/observability/media-observability.service';
import {
  canonicalMediaContentResource,
  createMediaAccessSignature,
  MEDIA_CONTENT_ACCESS_METHOD,
  verifyMediaAccessSignature,
} from './media-access-signature';

type AuthenticatedMediaActor = { id: number; role: string };

/**
 * A learner grant is a bearer capability URL, so it stays valid only long
 * enough to load and replay one clip; a copied link dies within five minutes
 * (B-07, Q46). Admins keep `media.accessTtlSeconds` for previews. A rotated
 * signing secret must stay in the previous slot for at least the larger of
 * the two TTLs.
 *
 * F5: every entry point that hands out or verifies a signed content URL
 * (`createAccess`, `readSignedObject`, exam media grants) calls
 * `isUsableMediaContent`, so "usable" means exactly one thing.
 */
export const LEARNER_MEDIA_ACCESS_TTL_SECONDS = 300;

@Injectable()
export class MediaAccessService {
  private readonly signingSecret: string;
  private readonly previousSigningSecret: string | undefined;
  private readonly adminAccessTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Optional() private readonly metrics?: MediaObservabilityService,
  ) {
    this.signingSecret = config.getOrThrow<string>('media.signingSecret');
    this.previousSigningSecret = config.get<string>(
      'media.signingSecretPrevious',
    );
    this.adminAccessTtlSeconds = config.getOrThrow<number>(
      'media.accessTtlSeconds',
    );
  }

  async createAccess(actor: AuthenticatedMediaActor, mediaId: number) {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        checksum: true,
        mimeType: true,
        size: true,
        storageProvider: true,
        storageKey: true,
        type: true,
        processingStatus: true,
        deletedAt: true,
        lessonExercises: {
          // Same predicate as the public attempt route (Q46).
          where: {
            AND: [
              PUBLIC_LESSON_EXERCISE_WHERE,
              { lesson: { is: buildLessonReadyWhere() } },
            ],
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!isUsableMediaContent(media, this.storage.provider)) {
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
    const ttlSeconds =
      actor.role === 'admin'
        ? this.adminAccessTtlSeconds
        : LEARNER_MEDIA_ACCESS_TTL_SECONDS;
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
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
    const observation = this.metrics?.beginSignedContentRequest();
    let metricOutcome:
      | 'success'
      | 'invalid_grant'
      | 'unavailable'
      | 'provider_mismatch'
      | 'integrity_error' = 'unavailable';
    try {
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
        !isUsableMediaContent(media, this.storage.provider) ||
        !verifyMediaAccessSignature({
          mediaId,
          expiresAt,
          checksum: media.checksum,
          signature,
          secret: this.signingSecret,
          previousSecret: this.previousSigningSecret,
          method: requestTarget.method,
          resource: requestTarget.path,
        })
      ) {
        metricOutcome =
          media?.storageProvider &&
          media.storageProvider !== this.storage.provider
            ? 'provider_mismatch'
            : 'invalid_grant';
        if (
          media?.storageProvider &&
          media.storageProvider !== this.storage.provider
        ) {
          this.metrics?.recordStorage('get', 'provider_mismatch', 0);
          this.metrics?.recordReconciliation('violation');
        }
        throw new ForbiddenException(
          'Media access grant is invalid or expired.',
        );
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
        this.metrics?.recordStorage(
          'get',
          'success',
          Date.now() - getStartedAt,
        );
        metricOutcome = 'success';
        return object;
      } catch (error: unknown) {
        const kind = storageFailureKind(error);
        const elapsed = Date.now() - getStartedAt;
        if (kind === 'unavailable') {
          this.metrics?.recordStorage('get', 'error', elapsed);
          metricOutcome = 'unavailable';
          throw new ServiceUnavailableException({
            code: 'MEDIA_STORAGE_UNAVAILABLE',
            message: 'Media content is temporarily unavailable.',
          });
        }
        if (kind === 'provider_mismatch') {
          this.metrics?.recordStorage('get', 'provider_mismatch', elapsed);
          metricOutcome = 'provider_mismatch';
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
        metricOutcome = 'integrity_error';
        this.metrics?.recordReconciliation('violation');
        throw new ServiceUnavailableException({
          code: 'MEDIA_STORAGE_INTEGRITY_ERROR',
          message: 'Media content failed integrity verification.',
        });
      }
    } finally {
      observation?.complete(metricOutcome);
      // Compatibility series for existing dashboards during the one-release
      // migration to explicit started/terminal signed-content metrics.
      this.metrics?.recordSignedAccess(metricOutcome);
    }
  }
}

function storageFailureKind(error: unknown): ObjectStorageErrorKind {
  return error instanceof ObjectStorageError ? error.kind : 'unavailable';
}

/**
 * F5: the single availability rule for a learner-facing signed content grant.
 * `/media/:id/access`, `readSignedObject` and the exam media grants all call it,
 * so the security invariant cannot drift between entry points. It is as strict
 * as the content route: every field the signed read later needs (checksum,
 * storage key, provider, MIME type and size) must be present and truthy.
 */
export type MediaContentRecord = {
  checksum: string | null;
  mimeType: string | null;
  storageProvider: string | null;
  storageKey: string | null;
  type: string;
  processingStatus: string;
  deletedAt: Date | null;
  size: number | null;
};

export function isUsableMediaContent(
  media: MediaContentRecord | null | undefined,
  provider: string,
): media is MediaContentRecord & {
  checksum: string;
  storageKey: string;
  storageProvider: string;
  mimeType: string;
  size: number;
} {
  return (
    media !== null &&
    media !== undefined &&
    media.processingStatus === 'ready' &&
    media.deletedAt === null &&
    Boolean(media.checksum) &&
    Boolean(media.storageKey) &&
    Boolean(media.storageProvider) &&
    Boolean(media.mimeType) &&
    Boolean(media.size) &&
    media.storageProvider === provider &&
    isSupportedPrivateMedia(media)
  );
}

export function isSupportedPrivateMedia(media: {
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
