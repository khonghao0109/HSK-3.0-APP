import { z } from 'zod';

import { backendEnvelope } from '@/lib/api/backend-envelope';
import {
  LOGIN_PASSWORD_MIN_LENGTH,
  NEW_PASSWORD_MIN_LENGTH,
} from '@/features/learner-auth/password-policy';

export const authUserSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
  name: z.string().nullable().optional(),
});

export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(LOGIN_PASSWORD_MIN_LENGTH),
});

export const loginResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  refreshTokenExpiresAt: z.string().min(1).optional(),
});

export const refreshResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: z.string().min(1),
});

export const meResponseSchema = z.object({ user: authUserSchema });

// Backend → BFF: the global envelope, resolved to `{ success: true, data }`.
export const backendLoginSchema = backendEnvelope(loginResponseSchema);
export const backendRefreshSchema = backendEnvelope(refreshResponseSchema);
export const backendMeSchema = backendEnvelope(meResponseSchema);

export type AuthUser = z.infer<typeof authUserSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const registerInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(NEW_PASSWORD_MIN_LENGTH),
  name: z.string().trim().min(1).optional(),
});

export type RegisterInput = z.infer<typeof registerInputSchema>;
export const backendRegisterSchema = backendLoginSchema;
export type RegisterResponse = LoginResponse;
