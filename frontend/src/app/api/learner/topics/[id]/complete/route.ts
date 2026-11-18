import type { NextRequest } from 'next/server';

import { lessonPlayerDependencies } from '@/features/learner-lesson/lesson-player-dependencies';
import { handleTopicComplete } from '@/features/learner-lesson/lesson-player-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/topics/[id]/complete'>,
) {
  const { id } = await ctx.params;
  return handleTopicComplete(request, id, lessonPlayerDependencies());
}
