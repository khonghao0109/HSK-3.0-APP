import { NextRequest } from 'next/server';

import { handleTestStructureReplace } from '@/features/tests/test-route-handler';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ testId: string }> },
) {
  const { testId } = await params;
  return handleTestStructureReplace(request, testId);
}
