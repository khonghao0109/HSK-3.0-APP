import type { NextRequest } from 'next/server';

import { reviewDependencies } from '@/features/learner-review/review-dependencies';
import {
  handleReviewPreferences,
  handleReviewSavePreferences,
} from '@/features/learner-review/review-route-handler';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleReviewPreferences(request, reviewDependencies());
}

export async function PUT(request: NextRequest) {
  return handleReviewSavePreferences(request, reviewDependencies());
}
