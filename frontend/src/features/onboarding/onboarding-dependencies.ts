import 'server-only';

import { backend } from '@/lib/api/server-backend';
import { parseServerEnv } from '@/lib/config/env-schema';

import type { OnboardingHandlerDependencies } from './onboarding-route-handler';

export function onboardingDependencies(): OnboardingHandlerDependencies {
  const serverEnv = parseServerEnv();
  return {
    appOrigin: serverEnv.APP_ORIGIN,
    learnerCookieName: serverEnv.LEARNER_SESSION_COOKIE_NAME,
    production: serverEnv.NODE_ENV === 'production',
    requestBackend: (path, options) => backend.request(path, options),
  };
}
