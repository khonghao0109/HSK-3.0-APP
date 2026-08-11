import 'server-only';

import { z } from 'zod';

const serverEnvSchema = z.object({
  BACKEND_API_URL: z.string().url().default('http://127.0.0.1:3100'),
  APP_ORIGIN: z.string().url().default('http://127.0.0.1:3200'),
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
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

export const serverEnv = serverEnvSchema.parse(process.env);
