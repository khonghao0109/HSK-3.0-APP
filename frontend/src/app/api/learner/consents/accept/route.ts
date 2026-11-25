import type { NextRequest } from 'next/server';

import { handleConsentAccept } from '@/features/legal/consent-route-handler';
import { backend } from '@/lib/api/server-backend';
import { parseServerEnv } from '@/lib/config/env-schema';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const serverEnv = parseServerEnv();
  return handleConsentAccept(request, {
    appOrigin: serverEnv.APP_ORIGIN,
    learnerCookieName: serverEnv.LEARNER_SESSION_COOKIE_NAME,
    production: serverEnv.NODE_ENV === 'production',
    requestBackend: (path, options) => backend.request(path, options),
  });
}
