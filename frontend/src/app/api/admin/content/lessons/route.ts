import { NextRequest } from 'next/server';

import { handleContentCreate } from '@/features/content/content-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleContentCreate(request, 'lessons');
}
