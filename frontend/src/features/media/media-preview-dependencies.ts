import 'server-only';

import type { LearnerMediaHandlerDependencies } from '@/features/learner-lesson/learner-media-route-handler';
import { backend } from '@/lib/api/server-backend';
import { parseServerEnv } from '@/lib/config/env-schema';

/** TL-54: admin preview reuses the learner media BFF with the admin cookie. */
export function adminMediaPreviewDependencies(): LearnerMediaHandlerDependencies {
  const serverEnv = parseServerEnv();
  return {
    sessionCookieName: serverEnv.SESSION_COOKIE_NAME,
    contentRoutePrefix: '/api/admin/media',
    requestBackend: (path, options) => backend.request(path, options),
    requestBackendRaw: (path, options) => backend.raw(path, options),
  };
}
