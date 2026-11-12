import type { NextRequest } from 'next/server';

import { reviewDependencies } from '@/features/learner-review/review-dependencies';
import { handleReviewGrade } from '@/features/learner-review/review-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/review/sessions/[sessionId]/reviews'>,
) {
  const { sessionId } = await ctx.params;
  return handleReviewGrade(request, sessionId, reviewDependencies());
}
