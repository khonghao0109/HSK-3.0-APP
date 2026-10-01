import type { NextRequest } from 'next/server';

import { learnerSessionDependencies } from '@/features/auth/learner-session-dependencies';
import { handleLearnerSessionMe } from '@/features/auth/learner-session-route-handlers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleLearnerSessionMe(request, learnerSessionDependencies());
}
