import { NextRequest } from 'next/server';

import { handleQuestionArchive } from '@/features/questions/question-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ questionId: string }> },
) {
  return handleQuestionArchive(request, (await params).questionId);
}
