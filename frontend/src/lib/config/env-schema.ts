import { z } from 'zod';

import { validateAppOrigin } from '@/features/auth/session-navigation';

export const serverEnvSchema = z.object({
  BACKEND_API_URL: z.string().url().default('http://127.0.0.1:3100'),
  APP_ORIGIN: z
    .string()
    .default('http://127.0.0.1:3200')
    .transform((value, context) => {
      try {
        return validateAppOrigin(value);
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'APP_ORIGIN must be an absolute HTTP(S) origin.',
        });
        return z.NEVER;
      }
    }),
  BFF_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(8_000),
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .default('hsk_admin_session'),
  LEARNER_SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .default('hsk_learner_session'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
}).superRefine((data, context) => {
  const adminCookie = data.SESSION_COOKIE_NAME;
  const adminRefresh = `${adminCookie}_refresh`;
  const learnerCookie = data.LEARNER_SESSION_COOKIE_NAME;
  const learnerRefresh = `${learnerCookie}_refresh`;

  if (
    learnerCookie === adminCookie ||
    learnerCookie === adminRefresh ||
    learnerRefresh === adminCookie
  ) {
    context.addIssue({
      code: 'custom',
      path: ['LEARNER_SESSION_COOKIE_NAME'],
      message:
        'LEARNER_SESSION_COOKIE_NAME must differ from SESSION_COOKIE_NAME and its refresh cookie name.',
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  env: Record<string, string | undefined> = process.env,
): ServerEnv {
  return serverEnvSchema.parse(env);
}
