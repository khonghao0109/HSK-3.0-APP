import 'server-only';

import { cookies } from 'next/headers';

import { loadLevels } from '@/features/content/content-service';
import { loadQuestionFormOptions } from '@/features/questions/question-service';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import {
  testDetailResponseSchema,
  testListResponseSchema,
  type AdminTestDetailPayload,
  type TestListPayload,
} from './test-contract';
import type { TestFormOptions, TestListQuery } from './test-values';

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

export function serializeTestListQuery(query: TestListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.levelId !== undefined) params.set('levelId', String(query.levelId));
  if (query.status !== undefined) params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  return params;
}

export async function loadTests(
  query: TestListQuery,
): Promise<TestListPayload> {
  const token = await sessionToken();
  const params = serializeTestListQuery(query);
  return testListResponseSchema.parse(
    await backend.request(`/api/v1/admin/cms/tests?${params.toString()}`, {
      token,
    }),
  );
}

export async function loadTest(
  testId: number,
): Promise<AdminTestDetailPayload> {
  const token = await sessionToken();
  return testDetailResponseSchema.parse(
    await backend.request(`/api/v1/admin/cms/tests/${testId}`, { token }),
  ).data;
}

export async function loadTestLevels(): Promise<
  Array<{ id: number; code: string }>
> {
  const levels = await loadLevels();
  return levels.map((level) => ({ id: level.id, code: level.code }));
}

/** Option cho dialog sửa meta và select Audio/Ảnh của nhóm (TL-108). */
export async function loadTestFormOptions(): Promise<TestFormOptions> {
  const options = await loadQuestionFormOptions();
  return {
    levels: options.levels,
    audio: options.audio.map((media) => ({
      id: media.id,
      filename: media.filename,
      processingStatus: media.processingStatus,
    })),
    image: options.image.map((media) => ({
      id: media.id,
      filename: media.filename,
      processingStatus: media.processingStatus,
    })),
  };
}
