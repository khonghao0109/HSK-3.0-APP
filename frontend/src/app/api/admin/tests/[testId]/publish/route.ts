import { NextRequest } from 'next/server';

import { handleTestPublish } from '@/features/tests/test-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ testId: string }> },
) {
  const { testId } = await params;
  return handleTestPublish(request, testId);
}
