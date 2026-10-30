import type { NextRequest } from 'next/server';

import { handleExamAttemptRead } from '@/features/learner-exam/exam-attempt-route-handler';
import { examDependencies } from '@/features/learner-exam/exam-dependencies';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/exam/attempts/[attemptId]'>,
) {
  const { attemptId } = await ctx.params;
  return handleExamAttemptRead(request, attemptId, examDependencies());
}
