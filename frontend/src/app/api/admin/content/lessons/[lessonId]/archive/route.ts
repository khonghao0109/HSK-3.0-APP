import { NextRequest } from 'next/server';

import { handleContentArchive } from '@/features/content/content-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  return handleContentArchive(request, 'lessons', (await params).lessonId);
}
