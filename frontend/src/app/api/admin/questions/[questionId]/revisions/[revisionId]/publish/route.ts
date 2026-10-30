import { NextRequest } from 'next/server';

import { handleQuestionRevisionAction } from '@/features/questions/question-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ questionId: string; revisionId: string }> },
) {
  const { questionId, revisionId } = await params;
  return handleQuestionRevisionAction(
    request,
    questionId,
    revisionId,
    'publish',
  );
}
