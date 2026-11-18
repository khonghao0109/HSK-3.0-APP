import { NextRequest } from 'next/server';

import { handleTestDuplicate } from '@/features/tests/test-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ testId: string }> },
) {
  const { testId } = await params;
  return handleTestDuplicate(request, testId);
}
