import 'server-only';

import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import type { PrivacyHandlerDependencies } from './privacy-route-handler';

export function privacyDependencies(): PrivacyHandlerDependencies {
  return {
    appOrigin: serverEnv.APP_ORIGIN,
    learnerCookieName: serverEnv.LEARNER_SESSION_COOKIE_NAME,
    production: serverEnv.NODE_ENV === 'production',
    requestBackend: (path, options) => backend.request(path, options),
    rawBackend: (path, options) => backend.raw(path, options),
  };
}
