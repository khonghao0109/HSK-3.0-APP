import type { NextRequest } from 'next/server';

import { handleExamMediaGrants } from '@/features/learner-exam/exam-attempt-route-handler';
import { examDependencies } from '@/features/learner-exam/exam-dependencies';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/exam/attempts/[attemptId]/media-grants'>,
) {
  const { attemptId } = await ctx.params;
  return handleExamMediaGrants(request, attemptId, examDependencies());
}
