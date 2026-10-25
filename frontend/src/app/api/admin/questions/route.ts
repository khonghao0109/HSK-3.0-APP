import { NextRequest } from 'next/server';

import { handleQuestionCreate } from '@/features/questions/question-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleQuestionCreate(request);
}
