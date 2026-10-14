import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEARNER_AUTH_ERROR_MESSAGES } from '@/features/learner-auth/learner-auth-messages';

import { ForgotPasswordForm } from './forgot-password-form';

async function submitEmail(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: 'Gửi liên kết' }));
}

describe('ForgotPasswordForm (Q71)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the form with one h1 and no alert', () => {
    render(<ForgotPasswordForm />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Quên mật khẩu' }),
    ).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('alert', { hidden: true })).not.toBeVisible();
  });

  it.each(['', 'not-an-email', 'a@b'])(
    'rejects the email "%s" on the client without calling the BFF',
    async (email) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      render(<ForgotPasswordForm />);
      if (email) await submitEmail(email);
      else
        await userEvent
          .setup()
          .click(screen.getByRole('button', { name: 'Gửi liên kết' }));
      expect(screen.getByRole('alert')).toHaveTextContent(
        LEARNER_AUTH_ERROR_MESSAGES.invalidEmail,
      );
      expect(screen.getByLabelText('Email')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(screen.getByLabelText('Email')).toHaveFocus();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('sends the email and shows the same sent view with the canonical email', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    render(<ForgotPasswordForm />);
    await submitEmail('  Ban@HanLo.VN ');

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Kiểm tra email của bạn',
    });
    expect(heading).toHaveFocus();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(heading.nextElementSibling).toHaveTextContent(
      'Nếu ban@hanlo.vn có tài khoản Hán Lộ, chúng tôi đã gửi liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong 30 phút.',
    );
    expect(screen.getByText('ban@hanlo.vn').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'Về đăng nhập' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/learner/password-reset/request');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'Ban@HanLo.VN',
    });
  });

  it.each([
    [429, LEARNER_AUTH_ERROR_MESSAGES.rateLimited],
    [400, LEARNER_AUTH_ERROR_MESSAGES.generic],
    [503, LEARNER_AUTH_ERROR_MESSAGES.generic],
  ])(
    'maps BFF %i to its message and stays on the form',
    async (status, message) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status }),
      );
      render(<ForgotPasswordForm />);
      await submitEmail('ban@hanlo.vn');
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(message),
      );
      expect(
        screen.getByRole('heading', { level: 1, name: 'Quên mật khẩu' }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).not.toHaveAttribute(
        'aria-invalid',
      );
    },
  );

  it('shows the network message when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    render(<ForgotPasswordForm />);
    await submitEmail('ban@hanlo.vn');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        LEARNER_AUTH_ERROR_MESSAGES.network,
      ),
    );
  });

  it('ignores a second submit while the request is pending, without disabling', async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    render(<ForgotPasswordForm />);
    await userEvent.setup().type(screen.getByLabelText('Email'), 'a@b.vn');
    const button = screen.getByRole('button', { name: 'Gửi liên kết' });
    fireEvent.submit(button.closest('form')!);
    fireEvent.submit(button.closest('form')!);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(button).toBeEnabled();
    expect(screen.getByLabelText('Email')).toBeEnabled();
    resolve(new Response(null, { status: 204 }));
    await screen.findByRole('heading', { name: 'Kiểm tra email của bạn' });
  });
});

// M2.10c (PO Q81): bản web dàn lại chính khối này bằng CSS, nên số control
// trong DOM phải bằng bản mobile — không sinh bản thứ hai.
describe('ForgotPasswordForm — một bản control cho bản web (M2.10c)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders exactly one email input and one submit button', () => {
    const { container } = render(<ForgotPasswordForm />);
    expect(container.querySelectorAll('input')).toHaveLength(1);
    expect(container.querySelectorAll('input[name="email"]')).toHaveLength(1);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it('keeps the sent state on a single control set and adds the web-only hint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const { container } = render(<ForgotPasswordForm />);
    await submitEmail('ban@hanlo.vn');

    await screen.findByRole('heading', { name: 'Kiểm tra email của bạn' });
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Về đăng nhập' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    const note = container.querySelector('p.wa-note');
    expect(note).toHaveClass('w-only');
    expect(note).toHaveTextContent('Không thấy email? Hãy xem cả mục Spam.');
  });
});
