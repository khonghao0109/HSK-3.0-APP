import { NextRequest, NextResponse } from 'next/server';

import { exerciseDetailResponseSchema } from '@/features/exercises/exercise-contract';
import { normalizeApiFailure } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string }> },
) {
  const exerciseId = (await params).exerciseId;
  if (!/^\d+$/.test(exerciseId))
    return NextResponse.json(
      { success: false, error: normalizeApiFailure({ status: 400 }) },
      { status: 400 },
    );
  const token = request.cookies.get(serverEnv.SESSION_COOKIE_NAME)?.value;
  if (!token)
    return NextResponse.json(
      { success: false, error: normalizeApiFailure({ status: 401 }) },
      { status: 401 },
    );
  try {
    const response = exerciseDetailResponseSchema.parse(
      await backend.request(`/api/v1/admin/cms/exercises/${exerciseId}`, {
        token,
      }),
    );
    const result = NextResponse.json(response);
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
