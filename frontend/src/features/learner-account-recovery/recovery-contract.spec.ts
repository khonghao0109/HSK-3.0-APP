import { describe, expect, it } from 'vitest';

import {
  emailVerificationConfirmSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from './recovery-contract';

const TOKEN = 'fake-recovery-token-aaaaaaaaaaaaaaaaaaaaaaa';

describe('account recovery contract', () => {
  it('canonicalizes the reset email with trim and lower case', () => {
    expect(
      passwordResetRequestSchema.parse({ email: '  A.B@Example.TEST ' }),
    ).toEqual({ email: 'a.b@example.test' });
  });

  it.each(['', 'nope', 'a@', `${'a'.repeat(249)}@b.com`])(
    'rejects the email %s',
    (email) => {
      expect(passwordResetRequestSchema.safeParse({ email }).success).toBe(
        false,
      );
    },
  );

  it('accepts a 254-character email', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    expect(email).toHaveLength(254);
    expect(passwordResetRequestSchema.safeParse({ email }).success).toBe(true);
  });

  it('accepts exactly a 43-character base64url token', () => {
    expect(emailVerificationConfirmSchema.parse({ token: TOKEN })).toEqual({
      token: TOKEN,
    });
    for (const token of [
      TOKEN.slice(1),
      `${TOKEN}A`,
      `${TOKEN.slice(1)}=`,
      `${TOKEN.slice(1)}+`,
      ` ${TOKEN.slice(1)}`,
    ]) {
      expect(emailVerificationConfirmSchema.safeParse({ token }).success).toBe(
        false,
      );
    }
  });

  it('requires a new password of at least 6 characters, like the backend DTO', () => {
    expect(
      passwordResetConfirmSchema.safeParse({
        token: TOKEN,
        newPassword: '123456',
      }).success,
    ).toBe(true);
    expect(
      passwordResetConfirmSchema.safeParse({
        token: TOKEN,
        newPassword: '12345',
      }).success,
    ).toBe(false);
  });
});
