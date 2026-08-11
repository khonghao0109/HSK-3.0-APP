import { NextRequest, NextResponse } from 'next/server';

import { handleLogout } from '@/features/auth/session-route-handlers';
import { sessionDependencies } from '@/features/auth/session-dependencies';
import { createClearedSessionCookie } from '@/lib/auth/session-cookie';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleLogout(request, sessionDependencies());
}

export async function GET(request: NextRequest) {
  const deps = sessionDependencies();
  const response = NextResponse.redirect(
    new URL('/login?reason=session', request.url),
    303,
  );
  const cookie = createClearedSessionCookie(deps.cookieName, deps.production);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
