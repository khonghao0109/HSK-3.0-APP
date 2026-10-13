import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LEARNER_AUTH_ERROR_MESSAGES } from '@/features/learner-auth/learner-auth-messages';

import { ResetPasswordFlow } from './reset-password-flow';

const TOKEN = 'fake-recovery-token-aaaaaaaaaaaaaaaaaaaaaaa';

function open(url: string) {
  window.history.replaceState(null, '', url);
  const replaceState = vi.spyOn(window.history, 'replaceState');
  render(<ResetPasswordFlow />);
  return replaceState;
}

function respond(status: number, body?: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      body === undefined
        ? new Response(null, { status })
        : Response.json(body, { status }),
    );
}

async function submit(password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Mật khẩu mới'), password);
  await user.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
}

describe('ResetPasswordFlow (M2.1d)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('reads a valid token, removes it from the URL and shows the form', async () => {
    const replaceState = open(`/reset-password?x=1#token=${TOKEN}`);
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Đặt mật khẩu mới',
    });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/reset-password?x=1');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(heading).not.toHaveFocus();
    const input = screen.getByLabelText('Mật khẩu mới');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveAttribute('placeholder', 'Nhập mật khẩu mới');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it.each([
    ['no fragment', '/reset-password', false],
    ['a short token', '/reset-password#token=abc', true],
    ['a bad character', `/reset-password#token=${TOKEN.slice(1)}!`, true],
    ['another key', `/reset-password#x=${TOKEN}`, true],
  ])('shows the invalid view for %s', async (_l, url, hasHash) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const replaceState = open(url);
    await screen.findByRole('heading', {
      level: 1,
      name: 'Liên kết không còn hiệu lực',
    });
    expect(
      screen.getByRole('link', { name: 'Gửi liên kết mới' }),
    ).toHaveAttribute('href', '/forgot-password');
    expect(replaceState).toHaveBeenCalledTimes(hasHash ? 1 : 0);
    expect(window.location.hash).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('checks the length on the client', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    open(`/reset-password#token=${TOKEN}`);
    await screen.findByLabelText('Mật khẩu mới');
    await submit('12345');
    expect(screen.getByRole('alert')).toHaveTextContent(
      LEARNER_AUTH_ERROR_MESSAGES.shortPassword,
    );
    expect(screen.getByLabelText('Mật khẩu mới')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Mật khẩu mới')).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends token and password, then shows done with focus on its h1', async () => {
    const fetchSpy = respond(204);
    open(`/reset-password#token=${TOKEN}`);
    await screen.findByLabelText('Mật khẩu mới');
    await submit('MatKhauMoi#2026');
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Đã đặt lại mật khẩu',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/learner/password-reset/confirm');
    expect(JSON.parse(String(init?.body))).toEqual({
      token: TOKEN,
      newPassword: 'MatKhauMoi#2026',
    });
  });

  it('shows the weak password message for WEAK_PASSWORD', async () => {
    respond(400, { success: false, error: { code: 'WEAK_PASSWORD' } });
    open(`/reset-password#token=${TOKEN}`);
    await screen.findByLabelText('Mật khẩu mới');
    await submit('123456');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        LEARNER_AUTH_ERROR_MESSAGES.weakPassword,
      ),
    );
    expect(screen.getByLabelText('Mật khẩu mới')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('moves to the invalid view, focused, for INVALID_RESET_TOKEN', async () => {
    respond(400, { success: false, error: { code: 'INVALID_RESET_TOKEN' } });
    open(`/reset-password#token=${TOKEN}`);
    await screen.findByLabelText('Mật khẩu mới');
    await submit('MatKhauMoi#2026');
    const heading = await screen.findByRole('heading', {
      name: 'Liên kết không còn hiệu lực',
    });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it.each([
    [429, undefined, LEARNER_AUTH_ERROR_MESSAGES.rateLimited],
    [
      400,
      { success: false, error: { code: 'INVALID_REQUEST' } },
      LEARNER_AUTH_ERROR_MESSAGES.generic,
    ],
    [503, undefined, LEARNER_AUTH_ERROR_MESSAGES.generic],
  ])('maps BFF %i to its message', async (status, body, message) => {
    respond(status, body);
    open(`/reset-password#token=${TOKEN}`);
    await screen.findByLabelText('Mật khẩu mới');
    await submit('MatKhauMoi#2026');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(message),
    );
    expect(screen.getByLabelText('Mật khẩu mới')).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('shows the network message when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    open(`/reset-password#token=${TOKEN}`);
    await screen.findByLabelText('Mật khẩu mới');
    await submit('MatKhauMoi#2026');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        LEARNER_AUTH_ERROR_MESSAGES.network,
      ),
    );
  });

  it('ignores a second submit while pending, without disabling', async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    open(`/reset-password#token=${TOKEN}`);
    await userEvent
      .setup()
      .type(await screen.findByLabelText('Mật khẩu mới'), 'MatKhauMoi#2026');
    const button = screen.getByRole('button', { name: 'Đặt lại mật khẩu' });
    fireEvent.submit(button.closest('form')!);
    fireEvent.submit(button.closest('form')!);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(button).toBeEnabled();
    await act(async () => resolve(new Response(null, { status: 204 })));
    await screen.findByRole('heading', { name: 'Đã đặt lại mật khẩu' });
  });

  it('starts over on a new link opened in the same tab after done', async () => {
    respond(204);
    open(`/reset-password#token=${TOKEN}`);
    await screen.findByLabelText('Mật khẩu mới');
    await submit('MatKhauMoi#2026');
    await screen.findByRole('heading', { name: 'Đã đặt lại mật khẩu' });

    const next = `${TOKEN.slice(0, 42)}Z`;
    act(() => {
      window.location.hash = `#token=${next}`;
    });
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Đặt mật khẩu mới',
    });
    expect(heading).not.toHaveFocus();
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(screen.getByRole('alert', { hidden: true })).not.toBeVisible();
  });
});
