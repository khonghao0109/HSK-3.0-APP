import { NextRequest } from 'next/server';

import { handleMediaCleanup } from '@/features/media/media-cleanup-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ingestionId: string }> },
) {
  return handleMediaCleanup(request, (await params).ingestionId);
}
