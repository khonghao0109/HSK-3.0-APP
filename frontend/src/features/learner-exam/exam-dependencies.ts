import 'server-only';

import { backend } from '@/lib/api/server-backend';
import { parseServerEnv } from '@/lib/config/env-schema';

import type { ExamHandlerDependencies } from './exam-route-handler';

export function examDependencies(): ExamHandlerDependencies {
  const serverEnv = parseServerEnv();
  return {
    appOrigin: serverEnv.APP_ORIGIN,
    learnerCookieName: serverEnv.LEARNER_SESSION_COOKIE_NAME,
    production: serverEnv.NODE_ENV === 'production',
    requestBackend: (path, options) => backend.request(path, options),
  };
}
