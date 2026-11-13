import { NextRequest } from 'next/server';

import { handleExerciseCreate } from '@/features/exercises/exercise-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleExerciseCreate(request);
}
