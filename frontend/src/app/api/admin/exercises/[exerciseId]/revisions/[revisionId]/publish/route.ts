import { NextRequest } from 'next/server';

import { handleExerciseRevisionAction } from '@/features/exercises/exercise-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string; revisionId: string }> },
) {
  const { exerciseId, revisionId } = await params;
  return handleExerciseRevisionAction(
    request,
    exerciseId,
    revisionId,
    'publish',
  );
}
