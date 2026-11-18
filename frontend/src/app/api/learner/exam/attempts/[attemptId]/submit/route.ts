import type { NextRequest } from 'next/server';

import { handleExamSubmit } from '@/features/learner-exam/exam-attempt-route-handler';
import { examDependencies } from '@/features/learner-exam/exam-dependencies';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/exam/attempts/[attemptId]/submit'>,
) {
  const { attemptId } = await ctx.params;
  return handleExamSubmit(request, attemptId, examDependencies());
}
