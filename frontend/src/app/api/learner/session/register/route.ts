import type { NextRequest } from 'next/server';

import { learnerSessionDependencies } from '@/features/auth/learner-session-dependencies';
import { handleLearnerRegister } from '@/features/auth/learner-session-route-handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleLearnerRegister(request, learnerSessionDependencies());
}
