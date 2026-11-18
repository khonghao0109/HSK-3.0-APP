import 'server-only';

import { cookies } from 'next/headers';

import { loadLevels } from '@/features/content/content-service';
import { backendMediaListSchema } from '@/features/media/media-contract';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import {
  questionCountsResponseSchema,
  questionDetailResponseSchema,
  questionListResponseSchema,
  questionTagListResponseSchema,
  type QuestionCounts,
  type QuestionDetail,
  type QuestionListResponse,
  type QuestionTagOption,
} from './question-contract';
import { serializeQuestionQuery, type QuestionQuery } from './question-query';
import type { QuestionTagSuggestion } from './question-values';

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

export async function loadQuestions(
  query: QuestionQuery,
): Promise<QuestionListResponse> {
  const token = await sessionToken();
  const params = serializeQuestionQuery({ ...query, selected: undefined });
  return questionListResponseSchema.parse(
    await backend.request(`/api/v1/admin/cms/questions?${params.toString()}`, {
      token,
    }),
  );
}

export async function loadQuestion(
  questionId: number,
): Promise<QuestionDetail> {
  const token = await sessionToken();
  return questionDetailResponseSchema.parse(
    await backend.request(`/api/v1/admin/cms/questions/${questionId}`, {
      token,
    }),
  ).data;
}

export async function loadQuestionCounts(): Promise<QuestionCounts> {
  const token = await sessionToken();
  return questionCountsResponseSchema.parse(
    await backend.request('/api/v1/admin/cms/questions/counts', { token }),
  ).data;
}

/** Gợi ý tag cho form (TL-93); giữ mọi tag kể cả tag chỉ còn câu lưu trữ. */
export async function loadQuestionTags(
  query?: string,
): Promise<QuestionTagOption[]> {
  const token = await sessionToken();
  const params = new URLSearchParams({ limit: '100' });
  if (query) params.set('q', query);
  return questionTagListResponseSchema.parse(
    await backend.request(`/api/v1/admin/cms/tags?${params.toString()}`, {
      token,
    }),
  ).data;
}

/** Chuyển tag backend → gợi ý form; giữ type thuần để client không kéo Zod. */
export function toTagSuggestions(
  tags: QuestionTagOption[],
): QuestionTagSuggestion[] {
  return tags.map((tag) => ({ slug: tag.slug, name: tag.name }));
}

export type QuestionMediaOption = {
  id: number;
  filename: string | null;
  processingStatus: string;
};

async function loadMediaOptions(
  type: 'audio' | 'image',
): Promise<QuestionMediaOption[]> {
  const token = await sessionToken();
  // Giống form bài tập: 100 media sẵn sàng đầu tiên đang dùng.
  const result = backendMediaListSchema.parse(
    await backend.request(
      `/api/v1/admin/cms/media?page=1&limit=100&type=${type}&processingStatus=ready&lifecycle=active`,
      { token },
    ),
  ).data;
  return result.map((media) => ({
    id: media.id,
    filename: media.filename,
    processingStatus: media.processingStatus,
  }));
}

export type QuestionFormOptions = {
  levels: Array<{ id: number; code: string }>;
  tags: QuestionTagSuggestion[];
  audio: QuestionMediaOption[];
  image: QuestionMediaOption[];
};

/** Toàn bộ option server-side cho form tạo/sửa câu hỏi (TL-91). */
export async function loadQuestionFormOptions(): Promise<QuestionFormOptions> {
  const [levels, tags, audio, image] = await Promise.all([
    loadLevels(),
    loadQuestionTags(),
    loadMediaOptions('audio'),
    loadMediaOptions('image'),
  ]);
  return {
    levels: levels.map((level) => ({ id: level.id, code: level.code })),
    tags: toTagSuggestions(tags),
    audio,
    image,
  };
}
