import { NextRequest } from 'next/server';

import { handleMediaUpload } from '@/features/media/media-upload-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleMediaUpload(request);
}
