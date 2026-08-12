import { NextRequest } from 'next/server';

import { handleMediaDetail } from '@/features/media/media-route-handler';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  return handleMediaDetail(request, (await params).mediaId);
}
