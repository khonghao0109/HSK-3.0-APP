import { NextRequest } from 'next/server';

import { handleMediaMutation } from '@/features/media/media-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  return handleMediaMutation(request, (await params).mediaId, 'archive');
}
