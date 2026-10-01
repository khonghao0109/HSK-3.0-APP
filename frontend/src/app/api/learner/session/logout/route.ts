import type { NextRequest } from 'next/server';

import { learnerSessionDependencies } from '@/features/auth/learner-session-dependencies';
import { handleLearnerLogout } from '@/features/auth/learner-session-route-handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleLearnerLogout(request, learnerSessionDependencies());
}
