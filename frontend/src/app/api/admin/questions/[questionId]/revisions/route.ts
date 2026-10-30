import { NextRequest } from 'next/server';

import { handleQuestionRevisionCreate } from '@/features/questions/question-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ questionId: string }> },
) {
  return handleQuestionRevisionCreate(request, (await params).questionId);
}
