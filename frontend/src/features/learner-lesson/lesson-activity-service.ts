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
