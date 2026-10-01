import type { NextRequest } from 'next/server';

import { learnerSessionDependencies } from '@/features/auth/learner-session-dependencies';
import { handleLearnerLogin } from '@/features/auth/learner-session-route-handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleLearnerLogin(request, learnerSessionDependencies());
}
