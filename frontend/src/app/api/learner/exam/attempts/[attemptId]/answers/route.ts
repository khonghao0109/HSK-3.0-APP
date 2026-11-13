import type { NextRequest } from 'next/server';

import { handleExamSaveAnswers } from '@/features/learner-exam/exam-attempt-route-handler';
import { examDependencies } from '@/features/learner-exam/exam-dependencies';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/exam/attempts/[attemptId]/answers'>,
) {
  const { attemptId } = await ctx.params;
  return handleExamSaveAnswers(request, attemptId, examDependencies());
}
