import { NextRequest } from 'next/server';

import { handleQuestionCreate } from '@/features/questions/question-route-handler';
import { handleQuestionBankList } from '@/features/tests/question-bank-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleQuestionCreate(request);
}

/** GET /api/admin/questions — ngân hàng câu hỏi cho trình xây dựng đề (M4.1b). */
export async function GET(request: NextRequest) {
  return handleQuestionBankList(request);
}
