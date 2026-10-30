import 'server-only';

import { backend } from '@/lib/api/server-backend';
import { parseServerEnv } from '@/lib/config/env-schema';

import type { LearnerMediaHandlerDependencies } from './learner-media-route-handler';
import type { LessonPlayerHandlerDependencies } from './lesson-player-route-handler';

export function lessonPlayerDependencies(): LessonPlayerHandlerDependencies {
  const serverEnv = parseServerEnv();
  return {
    appOrigin: serverEnv.APP_ORIGIN,
    learnerCookieName: serverEnv.LEARNER_SESSION_COOKIE_NAME,
    production: serverEnv.NODE_ENV === 'production',
    requestBackend: (path, options) => backend.request(path, options),
  };
}

export function learnerMediaDependencies(): LearnerMediaHandlerDependencies {
  const serverEnv = parseServerEnv();
  return {
    sessionCookieName: serverEnv.LEARNER_SESSION_COOKIE_NAME,
    requestBackend: (path, options) => backend.request(path, options),
    requestBackendRaw: (path, options) => backend.raw(path, options),
  };
}
