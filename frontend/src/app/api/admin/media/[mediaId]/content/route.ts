import type { NextRequest } from 'next/server';

import { handleMediaContent } from '@/features/learner-lesson/learner-media-route-handler';
import { adminMediaPreviewDependencies } from '@/features/media/media-preview-dependencies';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  return handleMediaContent(
    request,
    (await params).mediaId,
    adminMediaPreviewDependencies(),
  );
}
