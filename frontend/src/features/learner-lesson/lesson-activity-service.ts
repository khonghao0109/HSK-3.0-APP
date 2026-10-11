import 'server-only';

import { backend } from '@/lib/api/server-backend';

import {
  backendLessonActivitySchema,
  type LessonActivity,
} from './lesson-activity-contract';

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
