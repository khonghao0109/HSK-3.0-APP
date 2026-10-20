import { NextRequest } from 'next/server';

import { handleExerciseArchive } from '@/features/exercises/exercise-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string }> },
) {
  return handleExerciseArchive(request, (await params).exerciseId);
}
