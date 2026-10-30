import { NextRequest } from 'next/server';

import { handleTestUpdate } from '@/features/tests/test-route-handler';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ testId: string }> },
) {
  const { testId } = await params;
  return handleTestUpdate(request, testId);
}
