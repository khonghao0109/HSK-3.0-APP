import 'server-only';

import { backendEnvelope } from '@/lib/api/backend-envelope';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import { loginResponseSchema, meResponseSchema } from './auth-contract';
import type { SessionHandlerDependencies } from './session-route-handlers';

const backendLoginSchema = backendEnvelope(loginResponseSchema);
const backendMeSchema = backendEnvelope(meResponseSchema);

export function sessionDependencies(): SessionHandlerDependencies {
  return {
    appOrigin: serverEnv.APP_ORIGIN,
    cookieName: serverEnv.SESSION_COOKIE_NAME,
    production: serverEnv.NODE_ENV === 'production',
    nowMs: Date.now,
    login: async (input) =>
      backendLoginSchema.parse(
        await backend.request('/api/v1/auth/login', {
          method: 'POST',
          body: input,
        }),
      ).data,
    loadCurrentUser: async (token) =>
      backendMeSchema.parse(await backend.request('/api/v1/auth/me', { token }))
        .data.user,
  };
}
