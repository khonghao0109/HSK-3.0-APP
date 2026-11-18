import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEARNER_AUTH_ERROR_MESSAGES } from './learner-auth-messages';
import { LearnerRegisterForm } from './learner-register-form';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

async function fillAndSubmit(
  email = 'newbie@example.test',
  password = 'password123',
) {
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
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

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
    render(<LearnerRegisterForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'valid@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), '12345');
    await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.shortPassword);
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
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
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );

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
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );
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
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );
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
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows network error message when fetch rejects without aria-invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network failure'),
    );

    render(<LearnerRegisterForm />);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LEARNER_AUTH_ERROR_MESSAGES.network);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );
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
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute(
      'aria-invalid',
    );
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

  it('prevents double submit and disables fields during submission', async () => {
    let resolveFetch: (val: Response) => void;
    const pendingPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(pendingPromise);

    render(<LearnerRegisterForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'newbie@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');

    const form = screen
      .getByRole('button', { name: 'Tạo tài khoản' })
      .closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Mật khẩu')).toBeDisabled();

    resolveFetch!(
      Response.json(
        {
          success: true,
          user: { id: 3, email: 'newbie@example.test', role: 'user' },
        },
        { status: 201 },
      ),
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/learn');
    });
  });

  it('enforces password minLength attribute', () => {
    render(<LearnerRegisterForm />);
    const passwordInput = screen.getByLabelText('Mật khẩu');
    expect(passwordInput).toHaveAttribute('minLength', '6');
    expect(passwordInput).toHaveAttribute('required');
  });
});

// M2.10c (PO Q81): the web layout of sign-up dàn lại chính khối này bằng CSS,
// nên số control trong DOM phải bằng bản mobile — không sinh bản thứ hai.
describe('LearnerRegisterForm — một bản control cho bản web (M2.10c)', () => {
  it('renders exactly one email input, one password input and one submit button', () => {
    const { container } = render(<LearnerRegisterForm />);
    expect(container.querySelectorAll('input')).toHaveLength(2);
    expect(container.querySelectorAll('input[name="email"]')).toHaveLength(1);
    expect(container.querySelectorAll('input[name="password"]')).toHaveLength(
      1,
    );
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(
      container.querySelectorAll('button[aria-label="Hiện mật khẩu"]'),
    ).toHaveLength(1);
  });

  it('links the legal pages to /terms and /privacy (Q80)', () => {
    render(<LearnerRegisterForm />);
    const terms = screen.getByRole('link', { name: 'Điều khoản sử dụng' });
    const privacy = screen.getByRole('link', { name: 'Chính sách bảo mật' });
    expect(terms).toHaveAttribute('href', '/terms');
    expect(privacy).toHaveAttribute('href', '/privacy');
    expect(terms.closest('p')).toHaveClass('auth__terms');
    expect(privacy.closest('p')).toHaveClass('auth__terms');
  });
});
