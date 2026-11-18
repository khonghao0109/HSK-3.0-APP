import type { NextRequest } from 'next/server';

import { reviewDependencies } from '@/features/learner-review/review-dependencies';
import { handleReviewOverview } from '@/features/learner-review/review-route-handler';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleReviewOverview(request, reviewDependencies());
}
