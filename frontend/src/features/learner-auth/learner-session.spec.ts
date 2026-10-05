import { describe, expect, it, vi } from 'vitest';

import { resolveLearnerSession } from './learner-session';

describe('resolveLearnerSession', () => {
  it('returns unauthenticated when token is missing', async () => {
    const loadCurrentUser = vi.fn();
    const result = await resolveLearnerSession(null, loadCurrentUser);

    expect(result).toEqual({ state: 'unauthenticated' });
    expect(loadCurrentUser).not.toHaveBeenCalled();
  });

  it('returns learner state for user role identity', async () => {
    const loadCurrentUser = vi.fn().mockResolvedValue({
      id: 2,
      email: 'learner@example.test',
      role: 'user',
      name: 'Learner',
    });

    const result = await resolveLearnerSession('valid-token', loadCurrentUser);

    expect(result).toEqual({
      state: 'learner',
      user: {
        id: 2,
        email: 'learner@example.test',
        role: 'user',
        name: 'Learner',
      },
    });
  });

  it('returns unauthenticated for admin role identity', async () => {
    const loadCurrentUser = vi.fn().mockResolvedValue({
      id: 1,
      email: 'admin@example.test',
      role: 'admin',
    });

    const result = await resolveLearnerSession('admin-token', loadCurrentUser);

    expect(result).toEqual({ state: 'unauthenticated' });
  });

  it('returns unauthenticated when backend reports 401', async () => {
    const loadCurrentUser = vi.fn().mockRejectedValue({ status: 401 });

    const result = await resolveLearnerSession(
      'expired-token',
      loadCurrentUser,
    );

    expect(result).toEqual({ state: 'unauthenticated' });
  });
});
