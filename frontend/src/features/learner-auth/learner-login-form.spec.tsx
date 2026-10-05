import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEARNER_AUTH_ERROR_MESSAGES } from './learner-auth-messages';
import { LearnerLoginForm } from './learner-login-form';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

async function fillAndSubmit(
  email = 'learner@example.test',
  password = 'password123',
) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Mật khẩu'), password);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

describe('LearnerLoginForm', () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    vi.restoreAllMocks();
  });

  it('validates empty or invalid email on client without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<LearnerLoginForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.invalidEmail);
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.invalidEmail);
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates password length on client without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<LearnerLoginForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'valid@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), '12345');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.shortPassword);
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Mật khẩu')).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows error message for 401 invalid credentials with aria-invalid on password', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'invalid_credentials' } },
        { status: 401 },
      ),
    );

    render(<LearnerLoginForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      LEARNER_AUTH_ERROR_MESSAGES.invalidCredentials,
    );
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
  });

  it('shows error message for 403 account_locked without aria-invalid on fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'account_locked' } },
        { status: 403 },
      ),
    );

    render(<LearnerLoginForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.accountLocked);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('shows error message for 403 admin_account without aria-invalid on fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'admin_account' } },
        { status: 403 },
      ),
    );

    render(<LearnerLoginForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.adminAccount);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('shows error message for 429 rate limited without aria-invalid on fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'rate_limited' } },
        { status: 429 },
      ),
    );

    render(<LearnerLoginForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.rateLimited);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('shows error message for 5xx server error without aria-invalid on fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    render(<LearnerLoginForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.generic);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('shows error message for network error without aria-invalid on fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    );

    render(<LearnerLoginForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.network);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('renders alternatives component with social buttons', () => {
    render(<LearnerLoginForm />);
    expect(
      screen.getByRole('button', { name: 'Tiếp tục với Google' }),
    ).toBeInTheDocument();
  });

  it('does not contain previous account link text', () => {
    render(<LearnerLoginForm />);
    expect(screen.queryByText(/chưa có tài khoản/i)).toBeNull();
  });

  it('prevents double submit and calls fetch only once', async () => {
    let resolveFetch: (val: Response) => void;
    const pendingPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(pendingPromise);

    render(<LearnerLoginForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'learner@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');

    const form = screen
      .getByRole('button', { name: 'Đăng nhập' })
      .closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Mật khẩu')).toBeDisabled();

    resolveFetch!(
      Response.json({ success: true, user: { email: 'learner@example.test' } }),
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/learn');
    });
  });

  it('navigates to /learn and refreshes on successful login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        success: true,
        user: { id: 2, email: 'learner@example.test', role: 'user' },
      }),
    );

    render(<LearnerLoginForm />);
    await fillAndSubmit();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/learn');
      expect(refresh).toHaveBeenCalled();
    });
  });

  it('renders password field component with toggle button', () => {
    render(<LearnerLoginForm />);
    expect(
      screen.getByRole('button', { name: 'Hiện mật khẩu' }),
    ).toBeInTheDocument();
  });
});
