import { NextRequest } from 'next/server';

import { handleTestCreate } from '@/features/tests/test-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleTestCreate(request);
}
