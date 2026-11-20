import { z } from 'zod';

import { NEW_PASSWORD_MIN_LENGTH } from '@/features/learner-auth/password-policy';

/** Raw 43-character base64url token, as the backend DTOs accept it. */
export const recoveryTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
});

// Same rules as backend `ConfirmPasswordResetDto`: token format, password ≥ 6.
export const passwordResetConfirmSchema = z.object({
  token: recoveryTokenSchema,
  newPassword: z.string().min(NEW_PASSWORD_MIN_LENGTH),
});

export const emailVerificationConfirmSchema = z.object({
  token: recoveryTokenSchema,
});
