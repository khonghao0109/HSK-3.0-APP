import 'server-only';

import { backend } from '@/lib/api/server-backend';

import {
  backendLessonActivitySchema,
  type LessonActivity,
} from './lesson-activity-contract';
import {
  backendLessonPlayerActivitySchema,
  type LessonPlayerActivity,
} from './lesson-player-contract';
import {
  backendLessonTopicActivitySchema,
  backendLessonWordsSchema,
  backendUnitWordDetailSchema,
  type LessonTopicActivity,
  type LessonWords,
  type UnitWordDetail,
} from './lesson-topic-contract';

export async function getLessonActivity(
  token: string,
  lessonId: number,
): Promise<LessonActivity> {
  const response = await backend.request(
    `/api/v1/learning/lessons/${lessonId}/activity`,
    { token },
  );
  return backendLessonActivitySchema.parse(response).data;
}

/** Same endpoint as the lesson page, read for the player (M2.5b). */
export async function getLessonPlayerActivity(
  token: string,
  lessonId: number,
): Promise<LessonPlayerActivity> {
  const response = await backend.request(
    `/api/v1/learning/lessons/${lessonId}/activity`,
    { token },
  );
  return backendLessonPlayerActivitySchema.parse(response).data;
}

/** Same endpoint, read for the vocabulary and grammar pages (M2.5f). */
export async function getLessonTopicActivity(
  token: string,
  lessonId: number,
): Promise<LessonTopicActivity> {
  const response = await backend.request(
    `/api/v1/learning/lessons/${lessonId}/activity`,
    { token },
  );
  return backendLessonTopicActivitySchema.parse(response).data;
}

/** Published words of the lesson (`GET /learning/lessons/:id`). */
export async function getLessonWords(
  token: string,
  lessonId: number,
): Promise<LessonWords> {
  const response = await backend.request(
    `/api/v1/learning/lessons/${lessonId}`,
    { token },
  );
  return backendLessonWordsSchema.parse(response).data;
}

/** Pha C (N3): example and part of speech of one word of a Từ vựng unit. */
export async function getUnitWordDetail(
  token: string,
  wordId: number,
): Promise<UnitWordDetail> {
  const response = await backend.request(`/api/v1/dictionary/words/${wordId}`, {
    token,
  });
  return backendUnitWordDetailSchema.parse(response).data;
}
