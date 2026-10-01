import 'server-only';

import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import {
  backendLoginSchema,
  backendMeSchema,
  backendRefreshSchema,
  backendRegisterSchema,
  type AuthUser,
  type LoginInput,
  type LoginResponse,
  type RefreshResponse,
  type RegisterInput,
  type RegisterResponse,
} from './auth-contract';
import type { LearnerSessionHandlerDependencies } from './learner-session-route-handlers';

export function learnerSessionDependencies(): LearnerSessionHandlerDependencies {
  return {
    appOrigin: serverEnv.APP_ORIGIN,
    cookieName: serverEnv.LEARNER_SESSION_COOKIE_NAME,
    production: serverEnv.NODE_ENV === 'production',
    nowMs: Date.now,
    login: async (input: LoginInput): Promise<LoginResponse> =>
      backendLoginSchema.parse(
        await backend.request('/api/v1/auth/login', {
          method: 'POST',
          body: input,
        }),
      ).data,
    register: async (input: RegisterInput): Promise<RegisterResponse> =>
      backendRegisterSchema.parse(
        await backend.request('/api/v1/auth/register', {
          method: 'POST',
          body: input,
        }),
      ).data,
    loadCurrentUser: async (token: string): Promise<AuthUser> =>
      backendMeSchema.parse(await backend.request('/api/v1/auth/me', { token }))
        .data.user,
    logout: async (token: string): Promise<void> => {
      await backend.request('/api/v1/auth/logout', {
        method: 'POST',
        token,
      });
    },
    refresh: async (refreshToken: string): Promise<RefreshResponse> =>
      backendRefreshSchema.parse(
        await backend.request('/api/v1/auth/refresh', {
          method: 'POST',
          body: { refreshToken },
        }),
      ).data,
  };
}
