import 'server-only';

import { cookies } from 'next/headers';

import {
  backendLessonDetailSchema,
  backendLessonListSchema,
  backendLevelListSchema,
  type TopicListItem,
} from '@/features/content/content-contract';
import { backendMediaListSchema } from '@/features/media/media-contract';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import type {
  ExerciseLessonOption,
  ExerciseMediaOption,
  ExerciseTopicOption,
} from './exercise-form-values';

/**
 * Loader server-only cho hai trang soạn bài tập (M5.1b1, TL-18).
 *
 * Dùng lại schema Zod đã có của content/media thay vì khai báo lại contract
 * (`backendLessonListSchema`, `backendLessonDetailSchema`,
 * `backendLevelListSchema`, `backendMediaListSchema`).
 */

async function sessionToken(): Promise<string> {
  const token = (await cookies()).get(serverEnv.SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new BackendRequestError({
      status: 401,
      kind: 'session_expired',
      message: 'Your session has expired.',
      retryable: false,
    });
  }
  return token;
}

/** Chủ đề chưa lưu trữ: status != archived và chưa soft-delete (TL-18). */
function selectableTopics(topics: TopicListItem[]): ExerciseTopicOption[] {
  return topics
    .filter((topic) => topic.status !== 'archived' && topic.deletedAt === null)
    .map((topic) => ({ id: topic.id, title: topic.title }));
}

/**
 * Bài học cho ô chọn khi tạo bài tập: `GET lessons` limit 100, kèm mã cấp độ
 * để hiện nhãn "HSK n" và sắp theo cấp độ/thứ tự.
 */
export async function loadExerciseLessonOptions(): Promise<
  ExerciseLessonOption[]
> {
  const token = await sessionToken();
  // shortcut: 100 bài đầu, khi > 100 bài thì chuyển sang ô tìm kiếm
  const [lessonBody, levelBody] = await Promise.all([
    backend.request('/api/v1/admin/cms/lessons?page=1&limit=100', { token }),
    backend.request('/api/v1/levels', { token }),
  ]);
  const lessons = backendLessonListSchema.parse(lessonBody).data;
  const levels = backendLevelListSchema.parse(levelBody).data;
  const levelById = new Map(
    levels.map((level) => [
      level.id,
      { code: level.code, order: level.orderIndex },
    ]),
  );
  // Backend `listLessons` đã orderBy levelId/orderIndex/id, nhưng thứ tự cấp
  // độ là orderIndex của Level; sắp ổn định lại theo đúng cấp độ/thứ tự.
  // X6: bài đã lưu trữ không xuất hiện trong ô chọn bài học.
  return lessons
    .filter((lesson) => lesson.status !== 'archived')
    .sort((a, b) => {
      const levelA = levelById.get(a.levelId)?.order ?? Number.MAX_SAFE_INTEGER;
      const levelB = levelById.get(b.levelId)?.order ?? Number.MAX_SAFE_INTEGER;
      return levelA - levelB || a.orderIndex - b.orderIndex || a.id - b.id;
    })
    .map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      levelCode: levelById.get(lesson.levelId)?.code ?? '—',
    }));
}

export type ExerciseLessonContext = {
  lesson: { id: number; title: string; status: string };
  topics: ExerciseTopicOption[];
};

/**
 * Bài học đã chọn qua `?lessonId=`: chi tiết + chủ đề chưa lưu trữ.
 * Backend 404 được page chuyển thành `notFound()`.
 */
export async function loadExerciseLessonContext(
  lessonId: number,
): Promise<ExerciseLessonContext> {
  const token = await sessionToken();
  const detail = backendLessonDetailSchema.parse(
    await backend.request(`/api/v1/admin/cms/lessons/${lessonId}`, { token }),
  ).data;
  return {
    lesson: {
      id: detail.lesson.id,
      title: detail.lesson.title,
      status: detail.lesson.status,
    },
    topics: selectableTopics(detail.topics),
  };
}

/** Audio sẵn sàng và đang dùng cho câu nghe chọn (TL-19). */
export async function loadExerciseAudioOptions(): Promise<
  ExerciseMediaOption[]
> {
  const token = await sessionToken();
  // shortcut: 100 media đầu, khi > 100 thì chuyển sang ô tìm kiếm
  const result = backendMediaListSchema.parse(
    await backend.request(
      '/api/v1/admin/cms/media?page=1&limit=100&type=audio&processingStatus=ready&lifecycle=active',
      { token },
    ),
  ).data;
  return result.map((media) => ({ id: media.id, filename: media.filename }));
}
