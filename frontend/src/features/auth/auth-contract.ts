import { z } from 'zod';

import { backendEnvelope } from '@/lib/api/backend-envelope';

export const authUserSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
  name: z.string().nullable().optional(),
});

export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6),
});

export const loginResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string().min(1),
});

export const meResponseSchema = z.object({ user: authUserSchema });

// Backend → BFF: the global envelope, resolved to `{ success: true, data }`.
export const backendLoginSchema = backendEnvelope(loginResponseSchema);
export const backendMeSchema = backendEnvelope(meResponseSchema);

export type AuthUser = z.infer<typeof authUserSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
