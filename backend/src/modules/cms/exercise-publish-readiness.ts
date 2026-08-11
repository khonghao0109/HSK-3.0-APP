import { UnprocessableEntityException } from '@nestjs/common';
import { ExerciseType, MediaProcessingStatus, MediaType } from '@prisma/client';

export type ExerciseMediaRecord = {
  id: number;
  url: string;
  type: MediaType;
  mimeType: string | null;
  duration: number | null;
  processingStatus: MediaProcessingStatus;
  deletedAt: Date | null;
};

export type PublicExerciseMedia = {
  id: number;
  url: string;
  type: 'audio';
  mimeType: string | null;
  duration: number | null;
};

export function assertExerciseMediaPublishReady(
  type: ExerciseType,
  mediaId: number | null | undefined,
  media: ExerciseMediaRecord | null,
): PublicExerciseMedia | null {
  if (type !== ExerciseType.listening_choice) return null;
  if (
    mediaId === null ||
    mediaId === undefined ||
    media === null ||
    media.id !== mediaId ||
    media.url.length === 0 ||
    /\s/u.test(media.url) ||
    media.type !== MediaType.audio ||
    media.processingStatus !== MediaProcessingStatus.ready ||
    media.deletedAt !== null
  ) {
    throw new UnprocessableEntityException({
      code: 'listening_media_not_ready',
      path: 'mediaId',
      message: 'Listening audio media must be ready and live.',
    });
  }
  return {
    id: media.id,
    url: media.url,
    type: 'audio',
    mimeType: media.mimeType,
    duration: media.duration,
  };
}
