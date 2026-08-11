import { describe, expect, it } from 'vitest';

import {
  authUserSchema,
  loginInputSchema,
  loginResponseSchema,
  meResponseSchema,
} from './auth-contract';

describe('auth contracts', () => {
  it('normalizes a valid login without weakening the backend password rule', () => {
    expect(
      loginInputSchema.parse({
        email: '  ADMIN@Example.Test ',
        password: 'secret1',
      }),
    ).toEqual({ email: 'admin@example.test', password: 'secret1' });
  });

  it.each([
    [{ email: 'not-an-email', password: 'secret1' }, 'email'],
    [{ email: 'admin@example.test', password: '12345' }, 'password'],
    [{ email: 'admin@example.test', password: 123456 }, 'password'],
  ])('rejects invalid login input %#', (value, path) => {
    const result = loginInputSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toContain(path);
  });

  it('validates backend login and me responses at runtime', () => {
    const user = {
      id: 7,
      email: 'admin@example.test',
      role: 'admin',
      name: 'Lan',
    };
    expect(
      loginResponseSchema.parse({ user, accessToken: 'header.payload.sig' }),
    ).toEqual({
      user,
      accessToken: 'header.payload.sig',
    });
    expect(
      meResponseSchema.parse({ user: { ...user, name: undefined } }).user.role,
    ).toBe('admin');
  });

  it('rejects unknown roles and malformed identities', () => {
    expect(
      authUserSchema.safeParse({
        id: 0,
        email: 'admin@example.test',
        role: 'owner',
      }).success,
    ).toBe(false);
  });
});
