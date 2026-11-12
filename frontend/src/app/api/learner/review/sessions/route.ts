import type { NextRequest } from 'next/server';

import { reviewDependencies } from '@/features/learner-review/review-dependencies';
import { handleReviewCreateSession } from '@/features/learner-review/review-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleReviewCreateSession(request, reviewDependencies());
}
