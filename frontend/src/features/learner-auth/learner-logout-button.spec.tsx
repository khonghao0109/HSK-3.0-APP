import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEARNER_AUTH_ERROR_MESSAGES } from './learner-auth-messages';
import { LearnerLogoutButton } from './learner-logout-button';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

describe('LearnerLogoutButton', () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    vi.restoreAllMocks();
  });

  it('logs out successfully with 204 and navigates to /', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    render(<LearnerLogoutButton />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Đăng xuất' }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/');
      expect(refresh).toHaveBeenCalled();
    });
  });

  it('shows error message on network failure during logout', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Network error'),
    );

    render(<LearnerLogoutButton />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Đăng xuất' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.network);
    expect(replace).not.toHaveBeenCalled();
  });
});
