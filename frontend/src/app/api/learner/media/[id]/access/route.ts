import type { NextRequest } from 'next/server';

import { handleMediaAccess } from '@/features/learner-lesson/learner-media-route-handler';
import { learnerMediaDependencies } from '@/features/learner-lesson/lesson-player-dependencies';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/media/[id]/access'>,
) {
  const { id } = await ctx.params;
  return handleMediaAccess(request, id, learnerMediaDependencies());
}
