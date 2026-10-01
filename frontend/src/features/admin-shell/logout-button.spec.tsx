import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LogoutButton } from './logout-button';

const { replace, refresh } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
  refresh.mockReset();
});

describe('LogoutButton', () => {
  it('leaves for /login only after the BFF confirms the cookie was cleared', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/session/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['a rejected logout (403)', () => new Response(null, { status: 403 })],
    ['a server error (500)', () => new Response(null, { status: 500 })],
  ])('stays signed in and offers a retry after %s', async (_label, reply) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply()));
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /session is still active/i,
    );
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    const retry = screen.getByRole('button', { name: 'Retry log out' });
    expect(retry).toBeEnabled();
    expect(retry).toHaveFocus();
  });

  it('stays signed in when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('clears the failure once a retry succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await user.click(
      await screen.findByRole('button', { name: 'Retry log out' }),
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
