import type { NextRequest } from 'next/server';

import { lessonPlayerDependencies } from '@/features/learner-lesson/lesson-player-dependencies';
import { handleLessonComplete } from '@/features/learner-lesson/lesson-player-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/lessons/[id]/complete'>,
) {
  const { id } = await ctx.params;
  return handleLessonComplete(request, id, lessonPlayerDependencies());
}
