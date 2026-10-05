import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEARNER_AUTH_ERROR_MESSAGES } from './learner-auth-messages';
import { LearnerRegisterForm } from './learner-register-form';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

async function fillAndSubmit(email = 'newbie@example.test', password = 'password123') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Mật khẩu'), password);
  await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
}

describe('LearnerRegisterForm', () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    vi.restoreAllMocks();
  });

  it('validates empty or invalid email on client without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<LearnerRegisterForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.invalidEmail);
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.invalidEmail);
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates password length on client without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<LearnerRegisterForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'valid@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), '12345');
    await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.shortPassword);
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Mật khẩu')).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('registers successfully with 201 and navigates to /learn', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          success: true,
          user: { id: 3, email: 'newbie@example.test', role: 'user' },
        },
        { status: 201 },
      ),
    );

    render(<LearnerRegisterForm />);
    await fillAndSubmit();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/learn');
      expect(refresh).toHaveBeenCalled();
    });
  });

  it('shows error message for email_taken with sign-in link and aria-invalid on email', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'email_taken' } },
        { status: 409 },
      ),
    );

    render(<LearnerRegisterForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.emailTaken);
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute('aria-invalid');

    const link = screen.getByRole('link', { name: 'Đăng nhập' });
    expect(link).toHaveAttribute('href', '/sign-in');
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows error message for 400 weak_password without aria-invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'weak_password' } },
        { status: 400 },
      ),
    );

    render(<LearnerRegisterForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.weakPassword);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute('aria-invalid');
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows error message for 429 rate limit without aria-invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'rate_limit_exceeded' } },
        { status: 429 },
      ),
    );

    render(<LearnerRegisterForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.rateLimited);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute('aria-invalid');
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows generic error message for 500 server error without aria-invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'internal_error' } },
        { status: 500 },
      ),
    );

    render(<LearnerRegisterForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.generic);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute('aria-invalid');
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows network error message when fetch rejects without aria-invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    render(<LearnerRegisterForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.network);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute('aria-invalid');
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows generic error message for 400 with other kind without aria-invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'invalid_request' } },
        { status: 400 },
      ),
    );

    render(<LearnerRegisterForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.generic);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute('aria-invalid');
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders alternatives component with social buttons', () => {
    render(<LearnerRegisterForm />);
    expect(
      screen.getByRole('button', { name: 'Tiếp tục với Google' }),
    ).toBeInTheDocument();
  });

  it('renders password field component with toggle button', () => {
    render(<LearnerRegisterForm />);
    expect(
      screen.getByRole('button', { name: 'Hiện mật khẩu' }),
    ).toBeInTheDocument();
  });

  it('does not contain previous account link text', () => {
    render(<LearnerRegisterForm />);
    expect(screen.queryByText(/đã có tài khoản/i)).toBeNull();
  });

  it('enforces password minLength attribute', () => {
    render(<LearnerRegisterForm />);
    const passwordInput = screen.getByLabelText('Mật khẩu');
    expect(passwordInput).toHaveAttribute('minLength', '6');
    expect(passwordInput).toHaveAttribute('required');
  });
});
