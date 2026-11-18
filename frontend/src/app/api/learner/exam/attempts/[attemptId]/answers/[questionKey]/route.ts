import type { NextRequest } from 'next/server';

import { handleExamSaveAnswer } from '@/features/learner-exam/exam-attempt-route-handler';
import { examDependencies } from '@/features/learner-exam/exam-dependencies';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/exam/attempts/[attemptId]/answers/[questionKey]'>,
) {
  const { attemptId, questionKey } = await ctx.params;
  return handleExamSaveAnswer(
    request,
    attemptId,
    questionKey,
    examDependencies(),
  );
}
