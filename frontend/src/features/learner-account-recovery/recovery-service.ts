import 'server-only';

import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import type { RecoveryHandlerDependencies } from './recovery-route-handler';

export function recoveryDependencies(): RecoveryHandlerDependencies {
  return {
    appOrigin: serverEnv.APP_ORIGIN,
    learnerCookieName: serverEnv.LEARNER_SESSION_COOKIE_NAME,
    production: serverEnv.NODE_ENV === 'production',
    // `backend` forwards the browser's X-Forwarded-For, so the backend's
    // per-IP limits count the learner, not this server.
    requestBackend: (path, options) => backend.request(path, options),
  };
}
