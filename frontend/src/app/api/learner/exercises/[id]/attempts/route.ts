import type { NextRequest } from 'next/server';

import { lessonPlayerDependencies } from '@/features/learner-lesson/lesson-player-dependencies';
import { handleExerciseAttempt } from '@/features/learner-lesson/lesson-player-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/exercises/[id]/attempts'>,
) {
  const { id } = await ctx.params;
  return handleExerciseAttempt(request, id, lessonPlayerDependencies());
}
