import { beforeEach, describe, expect, it, vi } from 'vitest';

const { backendRequest } = vi.hoisted(() => ({ backendRequest: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));
vi.mock('@/lib/config/server-env', () => ({
  serverEnv: {
    APP_ORIGIN: 'http://127.0.0.1:3200',
    SESSION_COOKIE_NAME: 'hsk_admin_session',
    NODE_ENV: 'test',
  },
}));

import { sessionDependencies } from './session-dependencies';

const meta = {
  requestId: '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f',
  timestamp: '2026-09-14T05:00:00.000Z',
};
const user = { id: 7, email: 'admin@example.test', role: 'admin', name: 'Lan' };

describe('session backend dependencies', () => {
  beforeEach(() => {
    backendRequest.mockReset();
  });

  it('unwraps the login envelope into the session credentials', async () => {
    backendRequest.mockResolvedValueOnce({
      success: true,
      data: { user, accessToken: 'header.payload.sig' },
      meta,
    });

    await expect(
      sessionDependencies().login({
        email: 'admin@example.test',
        password: 'secret-pass',
      }),
    ).resolves.toEqual({ user, accessToken: 'header.payload.sig' });
    expect(backendRequest).toHaveBeenCalledWith('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@example.test', password: 'secret-pass' },
    });
  });

  it('unwraps the current-user envelope', async () => {
    backendRequest.mockResolvedValueOnce({
      success: true,
      data: { user },
      meta,
    });

    await expect(
      sessionDependencies().loadCurrentUser('token'),
    ).resolves.toEqual(user);
  });

  it('refuses a login body that is not the envelope', async () => {
    backendRequest.mockResolvedValueOnce({
      user,
      accessToken: 'header.payload.sig',
    });

    await expect(
      sessionDependencies().login({
        email: 'admin@example.test',
        password: 'secret-pass',
      }),
    ).rejects.toThrow();
  });
});
