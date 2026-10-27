import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../infrastructure/storage/object-storage.port';
import { PrismaService } from '../../prisma/prisma.service';
import {
  canonicalMediaContentResource,
  createMediaAccessSignature,
  MEDIA_CONTENT_ACCESS_METHOD,
} from '../media/media-access-signature';
import {
  isUsableMediaContent,
  LEARNER_MEDIA_ACCESS_TTL_SECONDS,
} from '../media/media-access.service';
import type {
  ExamMediaGrantItemDto,
  ExamMediaGrantsDto,
} from './dto/exam-response.dto';

/**
 * TL-128: a learner taking an exam needs the same kind of signed, short-lived
 * capability URL as the lesson player, but the media belongs to a frozen
 * snapshot rather than to a lesson exercise — so `GET /media/:id/access`
 * (which requires lesson usage) is deliberately not widened for exams. The
 * grant TTL outlives the attempt clock by one minute but never exceeds the
 * existing learner signer cap; the URL shape is byte-for-byte the one the
 * content route already verifies, and the availability rule is shared with
 * `createAccess`/`readSignedObject` (F5) rather than copied.
 */
export const EXAM_MEDIA_GRANT_EXTRA_SECONDS = 60;

export type ExamMediaGrantInput = {
  mediaIds: number[];
  remainingSeconds: number;
};

@Injectable()
export class ExamMediaGrantsService {
  private readonly signingSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {
    this.signingSecret = config.getOrThrow<string>('media.signingSecret');
  }

  /**
   * `mediaIds` come from the frozen snapshot (group and question media). An id
   * whose media row is no longer usable is skipped and reported in
   * `unavailable`; the caller never learns why it is gone.
   */
  async createGrants(input: ExamMediaGrantInput): Promise<ExamMediaGrantsDto> {
    const ids = [...new Set(input.mediaIds)].sort(
      (left, right) => left - right,
    );
    if (ids.length === 0) return { grants: [], unavailable: [] };

    const media = await this.prisma.media.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        type: true,
        mimeType: true,
        checksum: true,
        size: true,
        storageProvider: true,
        storageKey: true,
        processingStatus: true,
        deletedAt: true,
      },
    });
    const mediaById = new Map(media.map((item) => [item.id, item]));

    const ttlSeconds = Math.max(
      1,
      Math.min(
        input.remainingSeconds + EXAM_MEDIA_GRANT_EXTRA_SECONDS,
        LEARNER_MEDIA_ACCESS_TTL_SECONDS,
      ),
    );
    const expiresAt = Math.floor(Date.now() / 1_000) + ttlSeconds;

    const grants: ExamMediaGrantItemDto[] = [];
    const unavailable: number[] = [];
    for (const mediaId of ids) {
      const item = mediaById.get(mediaId);
      if (!isUsableMediaContent(item, this.storage.provider)) {
        unavailable.push(mediaId);
        continue;
      }
      grants.push({
        mediaId,
        kind: item.type,
        url: this.signedContentUrl(mediaId, item.checksum, expiresAt),
        expiresAt: new Date(expiresAt * 1_000).toISOString(),
      });
    }
    return { grants, unavailable };
  }

  private signedContentUrl(
    mediaId: number,
    checksum: string,
    expiresAt: number,
  ): string {
    const signature = createMediaAccessSignature({
      mediaId,
      expiresAt,
      checksum,
      secret: this.signingSecret,
      method: MEDIA_CONTENT_ACCESS_METHOD,
      resource: canonicalMediaContentResource(mediaId),
    });
    return `/api/v1/media/${String(mediaId)}/content?expires=${String(
      expiresAt,
    )}&signature=${signature}`;
  }
}
