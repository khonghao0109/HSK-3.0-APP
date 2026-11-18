import type { NextRequest } from 'next/server';

import { handleMediaAccess } from '@/features/learner-lesson/learner-media-route-handler';
import { adminMediaPreviewDependencies } from '@/features/media/media-preview-dependencies';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  return handleMediaAccess(
    request,
    (await params).mediaId,
    adminMediaPreviewDependencies(),
  );
}
