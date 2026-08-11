import { NextRequest, NextResponse } from 'next/server';

import { exerciseListResponseSchema } from '@/features/exercises/exercise-contract';
import {
  parseExerciseQuery,
  serializeExerciseQuery,
} from '@/features/exercises/exercise-query';
import { normalizeApiFailure } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(serverEnv.SESSION_COOKIE_NAME)?.value;
  if (!token)
    return NextResponse.json(
      { success: false, error: normalizeApiFailure({ status: 401 }) },
      { status: 401 },
    );
  const query = parseExerciseQuery(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  try {
    const response = exerciseListResponseSchema.parse(
      await backend.request(
        `/api/v1/admin/cms/exercises?${serializeExerciseQuery(query).toString()}`,
        { token },
      ),
    );
    const result = NextResponse.json({
      ...response,
      data: response.data.map((exercise) => {
        const safeExercise = { ...exercise } as Partial<typeof exercise>;
        delete safeExercise.answer;
        return safeExercise;
      }),
    });
    result.headers.set('cache-control', 'no-store');
    return result;
  } catch (error) {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : 503;
    return NextResponse.json(
      { success: false, error: normalizeApiFailure({ status }) },
      { status },
    );
  }
}
