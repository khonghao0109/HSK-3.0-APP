import type { NextRequest } from 'next/server';

import { handleSessionMe } from '@/features/auth/session-route-handlers';
import { sessionDependencies } from '@/features/auth/session-dependencies';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleSessionMe(request, sessionDependencies());
}
