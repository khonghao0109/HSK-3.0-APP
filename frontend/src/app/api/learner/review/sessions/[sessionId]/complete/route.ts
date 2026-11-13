import type { NextRequest } from 'next/server';

import { reviewDependencies } from '@/features/learner-review/review-dependencies';
import { handleReviewComplete } from '@/features/learner-review/review-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/review/sessions/[sessionId]/complete'>,
) {
  const { sessionId } = await ctx.params;
  return handleReviewComplete(request, sessionId, reviewDependencies());
}
