import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOGIN_ERROR_MESSAGES, LoginForm } from './login-form';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

async function submitWith(response: Response) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
  render(<LoginForm />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'admin@example.test');
  await user.type(screen.getByLabelText('Password'), 'secret1');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

const failure = (status: number, kind?: string) =>
  kind
    ? Response.json({ success: false, error: { kind } }, { status })
    : new Response('not json', { status });

describe('LoginForm failure messages', () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
  });

  it.each([
    [401, 'session_expired', LOGIN_ERROR_MESSAGES.invalidCredentials],
    [403, 'account_locked', LOGIN_ERROR_MESSAGES.accountLocked],
    [429, 'rate_limited', LOGIN_ERROR_MESSAGES.rateLimited],
  ])(
    'explains HTTP %i (%s) in place without navigating',
    async (status, kind, message) => {
      await submitWith(failure(status, kind));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a non-admin identity', failure(403, 'forbidden')],
    ['an unreadable body', failure(403)],
  ])('routes a 403 for %s to the forbidden page', async (_label, response) => {
    await submitWith(response);

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/forbidden'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the three messages distinct', () => {
    expect(new Set(Object.values(LOGIN_ERROR_MESSAGES)).size).toBe(3);
  });
});
