import { describe, expect, it, vi } from 'vitest';

import { resolveAdminSession } from './admin-session';

describe('admin session resolution', () => {
  it('accepts only a current admin identity returned by /auth/me', async () => {
    const loadCurrentUser = vi.fn().mockResolvedValue({
      id: 1,
      email: 'admin@example.test',
      role: 'admin',
    });
    await expect(
      resolveAdminSession('token', loadCurrentUser),
    ).resolves.toMatchObject({
      state: 'admin',
      user: { role: 'admin' },
    });
  });

  it('returns forbidden for a current non-admin without exposing admin data', async () => {
    await expect(
      resolveAdminSession('token', async () => ({
        id: 2,
        email: 'user@example.test',
        role: 'user',
      })),
    ).resolves.toEqual({ state: 'forbidden' });
  });

  it('treats missing, invalid, and expired sessions as unauthenticated', async () => {
    await expect(resolveAdminSession(null, vi.fn())).resolves.toEqual({
      state: 'unauthenticated',
    });
    await expect(
      resolveAdminSession('expired', async () => {
        throw { status: 401 };
      }),
    ).resolves.toEqual({ state: 'unauthenticated' });
  });
});
