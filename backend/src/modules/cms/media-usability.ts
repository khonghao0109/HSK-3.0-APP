import { MediaProcessingStatus, MediaType, Prisma } from '@prisma/client';

/**
 * TL-81a media reference rules shared by question authoring (M4.1a) and test
 * structure authoring (M4.1b): saving only rejects references that can never
 * become usable, publishing additionally requires a fully ready file.
 */
export type CmsMediaRecord = {
  id: number;
  url: string;
  type: MediaType;
  mimeType: string | null;
  duration: number | null;
  processingStatus: MediaProcessingStatus;
  deletedAt: Date | null;
};

export const CMS_MEDIA_SELECT = {
  id: true,
  url: true,
  type: true,
  mimeType: true,
  duration: true,
  processingStatus: true,
  deletedAt: true,
} satisfies Prisma.MediaSelect;

export function unusableMediaReason(
  media: CmsMediaRecord | null,
  expectedType: MediaType,
): string | null {
  if (!media) return 'not_found';
  if (media.type !== expectedType) return 'wrong_type';
  if (media.processingStatus === MediaProcessingStatus.quarantined) {
    return 'quarantined';
  }
  if (media.deletedAt !== null) return 'archived';
  return null;
}

/** Publish gate: additionally requires the media to be fully ready. */
export function publishMediaBlocker(
  media: CmsMediaRecord | null,
  expectedType: MediaType,
): string | null {
  const unusable = unusableMediaReason(media, expectedType);
  if (unusable !== null) return unusable;
  if (media && media.processingStatus !== MediaProcessingStatus.ready) {
    return 'not_ready';
  }
  return null;
}
