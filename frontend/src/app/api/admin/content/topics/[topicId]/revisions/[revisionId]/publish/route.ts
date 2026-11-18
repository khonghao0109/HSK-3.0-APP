import { NextRequest } from 'next/server';

import { handleContentRevisionAction } from '@/features/content/content-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ topicId: string; revisionId: string }> },
) {
  const { topicId, revisionId } = await params;
  return handleContentRevisionAction(
    request,
    'topics',
    topicId,
    revisionId,
    'publish',
  );
}
