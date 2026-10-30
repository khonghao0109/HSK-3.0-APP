import type { NextRequest } from 'next/server';

import { examDependencies } from '@/features/learner-exam/exam-dependencies';
import { handleExamStart } from '@/features/learner-exam/exam-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/exam/tests/[testId]/attempts'>,
) {
  const { testId } = await ctx.params;
  return handleExamStart(request, testId, examDependencies());
}
