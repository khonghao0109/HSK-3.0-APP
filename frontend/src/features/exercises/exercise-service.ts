import 'server-only';

import { cookies } from 'next/headers';

import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import {
  backendExerciseDetailSchema,
  backendExerciseListSchema,
  type AdminExerciseDetail,
  type ExerciseListResponse,
} from './exercise-contract';
import { serializeExerciseQuery, type ExerciseQuery } from './exercise-query';

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

export async function loadExercises(
  query: ExerciseQuery,
): Promise<ExerciseListResponse> {
  const token = await sessionToken();
  const params = serializeExerciseQuery(query);
  return backendExerciseListSchema.parse(
    await backend.request(`/api/v1/admin/cms/exercises?${params.toString()}`, {
      token,
    }),
  );
}

export async function loadExercise(
  exerciseId: number,
): Promise<AdminExerciseDetail> {
  const token = await sessionToken();
  return backendExerciseDetailSchema.parse(
    await backend.request(`/api/v1/admin/cms/exercises/${exerciseId}`, {
      token,
    }),
  ).data;
}
