import {
  ExerciseType,
  MediaProcessingStatus,
  MediaType,
  Prisma,
} from '@prisma/client';

import { PUBLIC_CONTENT_WHERE } from '../../common/policies/lesson-readiness.policy';
import { isLessonExerciseTypePublishable } from '../../common/validation/lesson-exercise-authoring.validator';

export const PUBLIC_LESSON_EXERCISE_TYPES = Object.values(ExerciseType).filter(
  isLessonExerciseTypePublishable,
);

export const PUBLIC_EXERCISE_MEDIA_SELECT = {
  id: true,
  url: true,
  type: true,
  mimeType: true,
  duration: true,
} satisfies Prisma.MediaSelect;

export const PUBLIC_LESSON_EXERCISE_WHERE = {
  AND: [
    PUBLIC_CONTENT_WHERE,
    { type: { in: PUBLIC_LESSON_EXERCISE_TYPES } },
    {
      OR: [
        { type: { not: ExerciseType.listening_choice } },
        {
          type: ExerciseType.listening_choice,
          media: {
            is: {
              type: MediaType.audio,
              processingStatus: MediaProcessingStatus.ready,
              deletedAt: null,
              url: { not: '' },
            },
          },
        },
      ],
    },
    {
      OR: [{ topicId: null }, { topic: { is: PUBLIC_CONTENT_WHERE } }],
    },
  ],
} satisfies Prisma.LessonExerciseWhereInput;

export type PublicExerciseMedia = {
  id: number;
  url: string;
  type: 'audio';
  mimeType: string | null;
  duration: number | null;
};

export function projectPublicExerciseMedia(
  exerciseType: string,
  media: unknown,
): PublicExerciseMedia | null {
  if (
    exerciseType !== ExerciseType.listening_choice ||
    media === null ||
    typeof media !== 'object' ||
    Array.isArray(media)
  ) {
    return null;
  }

  const value = media as Record<string, unknown>;
  if (
    !Number.isSafeInteger(value.id) ||
    (value.id as number) <= 0 ||
    typeof value.url !== 'string' ||
    value.url.length === 0 ||
    /\s/u.test(value.url) ||
    value.type !== MediaType.audio ||
    (value.mimeType !== null && typeof value.mimeType !== 'string') ||
    (value.duration !== null &&
      (!Number.isSafeInteger(value.duration) || (value.duration as number) < 0))
  ) {
    return null;
  }

  return {
    id: value.id as number,
    url: value.url,
    type: 'audio',
    mimeType: value.mimeType,
    duration: value.duration as number | null,
  };
}
