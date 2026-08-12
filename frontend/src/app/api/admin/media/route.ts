import { NextRequest } from 'next/server';

import { handleMediaList } from '@/features/media/media-route-handler';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  return handleMediaList(request);
}
