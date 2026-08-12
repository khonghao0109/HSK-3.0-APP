import { NextRequest } from 'next/server';

import { handleSessionRecovery } from '@/features/auth/session-route-handlers';
import { sessionDependencies } from '@/features/auth/session-dependencies';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleSessionRecovery(request, sessionDependencies());
}
