import { handleLogin } from '@/features/auth/session-route-handlers';
import { sessionDependencies } from '@/features/auth/session-dependencies';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleLogin(request, sessionDependencies());
}
