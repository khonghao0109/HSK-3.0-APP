import 'server-only';

import { cookies } from 'next/headers';

import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';
import { backendMeSchema } from '@/features/auth/auth-contract';

import {
  backendLessonDetailSchema,
  backendLessonListSchema,
  backendLevelListSchema,
  backendTopicDetailSchema,
  type LessonDetail,
  type LessonListResponse,
  type LevelItem,
  type TopicDetail,
} from './content-contract';

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

export async function loadLessons(
  params: URLSearchParams,
): Promise<LessonListResponse> {
  const token = await sessionToken();
  return backendLessonListSchema.parse(
    await backend.request(`/api/v1/admin/cms/lessons?${params.toString()}`, {
      token,
    }),
  );
}

export async function loadLesson(lessonId: number): Promise<LessonDetail> {
  const token = await sessionToken();
  return backendLessonDetailSchema.parse(
    await backend.request(`/api/v1/admin/cms/lessons/${lessonId}`, { token }),
  ).data;
}

export async function loadTopic(topicId: number): Promise<TopicDetail> {
  const token = await sessionToken();
  return backendTopicDetailSchema.parse(
    await backend.request(`/api/v1/admin/cms/topics/${topicId}`, { token }),
  ).data;
}

/** Level published (TL-12): nguồn duy nhất cho bộ lọc cấp độ và form tạo. */
export async function loadLevels(): Promise<LevelItem[]> {
  const token = await sessionToken();
  return backendLevelListSchema.parse(
    await backend.request('/api/v1/levels', { token }),
  ).data;
}

/**
 * Id của admin đang đăng nhập — cho TL-13 ("Bạn") và cảnh báo tự duyệt Q89.
 */
export async function loadSessionAdminId(): Promise<number> {
  const token = await sessionToken();
  const me = backendMeSchema.parse(
    await backend.request('/api/v1/auth/me', { token }),
  ).data.user;
  return me.id;
}
