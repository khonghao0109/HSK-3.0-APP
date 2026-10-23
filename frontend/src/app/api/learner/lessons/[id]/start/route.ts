import type { NextRequest } from 'next/server';

import { lessonPlayerDependencies } from '@/features/learner-lesson/lesson-player-dependencies';
import { handleLessonStart } from '@/features/learner-lesson/lesson-player-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/lessons/[id]/start'>,
) {
  const { id } = await ctx.params;
  return handleLessonStart(request, id, lessonPlayerDependencies());
}
