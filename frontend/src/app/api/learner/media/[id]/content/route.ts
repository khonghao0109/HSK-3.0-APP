import type { NextRequest } from 'next/server';

import { handleMediaContent } from '@/features/learner-lesson/learner-media-route-handler';
import { learnerMediaDependencies } from '@/features/learner-lesson/lesson-player-dependencies';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/media/[id]/content'>,
) {
  const { id } = await ctx.params;
  return handleMediaContent(request, id, learnerMediaDependencies());
}
