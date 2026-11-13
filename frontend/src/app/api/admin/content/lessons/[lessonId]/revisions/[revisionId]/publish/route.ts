import { NextRequest } from 'next/server';

import { handleContentRevisionAction } from '@/features/content/content-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lessonId: string; revisionId: string }> },
) {
  const { lessonId, revisionId } = await params;
  return handleContentRevisionAction(
    request,
    'lessons',
    lessonId,
    revisionId,
    'publish',
  );
}
