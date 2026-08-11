import 'server-only';

import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import { loginResponseSchema, meResponseSchema } from './auth-contract';
import type { SessionHandlerDependencies } from './session-route-handlers';

export function sessionDependencies(): SessionHandlerDependencies {
  return {
    appOrigin: serverEnv.APP_ORIGIN,
    cookieName: serverEnv.SESSION_COOKIE_NAME,
    production: serverEnv.NODE_ENV === 'production',
    nowMs: Date.now,
    login: async (input) =>
      loginResponseSchema.parse(
        await backend.request('/api/v1/auth/login', {
          method: 'POST',
          body: input,
        }),
      ),
    loadCurrentUser: async (token) =>
      meResponseSchema.parse(
        await backend.request('/api/v1/auth/me', { token }),
      ).user,
  };
}
