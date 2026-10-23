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

import { VerifyEmailFlow } from './verify-email-flow';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const TOKEN = 'fake-recovery-token-aaaaaaaaaaaaaaaaaaaaaaa';

function open(url: string, signedIn = false) {
  window.history.replaceState(null, '', url);
  const replaceState = vi.spyOn(window.history, 'replaceState');
  render(<VerifyEmailFlow signedIn={signedIn} />);
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

const click = (name: string) =>
  userEvent.setup().click(screen.getByRole('button', { name }));

describe('VerifyEmailFlow (M2.1c, Q72, Q73)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    replace.mockReset();
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('removes the token from the URL and does not call the API before the click (Q72)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const replaceState = open(`/verify-email#token=${TOKEN}`);
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Xác thực email',
    });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/verify-email');
    expect(window.location.href).not.toContain(TOKEN);
    expect(heading).not.toHaveFocus();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('confirms on click and shows done, focused', async () => {
    const fetchSpy = respond(204);
    open(`/verify-email#token=${TOKEN}`);
    await screen.findByRole('heading', { name: 'Xác thực email' });
    await click('Xác thực email');
    const heading = await screen.findByRole('heading', {
      name: 'Email đã được xác thực',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole('link', { name: 'Vào học' })).toHaveAttribute(
      'href',
      '/learn',
    );
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/learner/email-verification/confirm');
    expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN });
  });

  it('moves to invalid, focused, when the BFF answers 400', async () => {
    respond(400, {
      success: false,
      error: { code: 'INVALID_VERIFICATION_TOKEN' },
    });
    open(`/verify-email#token=${TOKEN}`, false);
    await screen.findByRole('heading', { name: 'Xác thực email' });
    await click('Xác thực email');
    const heading = await screen.findByRole('heading', {
      name: 'Liên kết không còn hiệu lực',
    });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it.each([
    [429, LEARNER_AUTH_ERROR_MESSAGES.rateLimited],
    [503, LEARNER_AUTH_ERROR_MESSAGES.generic],
  ])('maps confirm %i to its message', async (status, message) => {
    respond(status);
    open(`/verify-email#token=${TOKEN}`);
    await screen.findByRole('heading', { name: 'Xác thực email' });
    await click('Xác thực email');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(message),
    );
    expect(
      screen.getByRole('heading', { name: 'Xác thực email' }),
    ).toBeInTheDocument();
  });

  it('shows the network message when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    open(`/verify-email#token=${TOKEN}`);
    await screen.findByRole('heading', { name: 'Xác thực email' });
    await click('Xác thực email');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        LEARNER_AUTH_ERROR_MESSAGES.network,
      ),
    );
  });

  it('ignores a second click while pending, without disabling', async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    open(`/verify-email#token=${TOKEN}`);
    const button = await screen.findByRole('button', {
      name: 'Xác thực email',
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(button).toBeEnabled();
    await act(async () => resolve(new Response(null, { status: 204 })));
    await screen.findByRole('heading', { name: 'Email đã được xác thực' });
  });

  it.each([
    ['no fragment', '/verify-email'],
    ['a malformed token', '/verify-email#token=abc'],
  ])(
    'anonymous learner with %s gets "Đăng nhập để gửi lại" (Q73)',
    async (_l, url) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      open(url, false);
      await screen.findByRole('heading', {
        level: 1,
        name: 'Liên kết không còn hiệu lực',
      });
      expect(
        screen.getByRole('link', { name: 'Đăng nhập để gửi lại' }),
      ).toHaveAttribute('href', '/sign-in?next=verify-email');
      expect(
        screen.queryByRole('button', { name: 'Gửi lại email xác thực' }),
      ).toBeNull();
      expect(window.location.hash).toBe('');
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('signed-in learner resends and sees the sent view, focused (Q73)', async () => {
    const fetchSpy = respond(204);
    open('/verify-email', true);
    await screen.findByRole('heading', { name: 'Liên kết không còn hiệu lực' });
    expect(
      screen.queryByRole('link', { name: 'Đăng nhập để gửi lại' }),
    ).toBeNull();
    await click('Gửi lại email xác thực');
    const heading = await screen.findByRole('heading', {
      name: 'Đã gửi lại email',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/learner/email-verification/request',
    );
  });

  it('sends the learner to sign in when resend answers 401', async () => {
    respond(401);
    open('/verify-email', true);
    await screen.findByRole('heading', { name: 'Liên kết không còn hiệu lực' });
    await click('Gửi lại email xác thực');
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/sign-in?next=verify-email'),
    );
  });

  it.each([
    [429, LEARNER_AUTH_ERROR_MESSAGES.rateLimited],
    [503, LEARNER_AUTH_ERROR_MESSAGES.generic],
  ])('maps resend %i to its message', async (status, message) => {
    respond(status);
    open('/verify-email', true);
    await screen.findByRole('heading', { name: 'Liên kết không còn hiệu lực' });
    await click('Gửi lại email xác thực');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(message),
    );
  });

  it('reads a new link opened in the same tab (fragment-only navigation)', async () => {
    respond(204);
    open('/verify-email', false);
    await screen.findByRole('heading', { name: 'Liên kết không còn hiệu lực' });

    act(() => {
      window.location.hash = `#token=${TOKEN}`;
    });
    await screen.findByRole('heading', { level: 1, name: 'Xác thực email' });
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.href).not.toContain(TOKEN);
    await click('Xác thực email');
    await screen.findByRole('heading', { name: 'Email đã được xác thực' });
  });
});

// M2.10c (PO Q81): bản web dàn lại chính khối này bằng CSS, nên số control
// trong DOM phải bằng bản mobile — không sinh bản thứ hai.
describe('VerifyEmailFlow — một bản control cho bản web (M2.10c)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    replace.mockReset();
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('never renders a form control (the page only has state actions)', async () => {
    open('/verify-email', false);
    await screen.findByRole('heading', {
      name: 'Liên kết không còn hiệu lực',
    });
    expect(document.querySelectorAll('input')).toHaveLength(0);
    expect(document.querySelectorAll('form')).toHaveLength(0);
    expect(document.querySelectorAll('button[type="submit"]')).toHaveLength(0);
  });

  it('renders the invalid state with the single sign-in action when no token is present (Q73)', async () => {
    open('/verify-email', false);
    await screen.findByRole('heading', {
      name: 'Liên kết không còn hiệu lực',
    });
    expect(document.querySelectorAll('a.btn')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'Đăng nhập để gửi lại' }),
    ).toHaveAttribute('href', '/sign-in?next=verify-email');
    expect(
      screen.queryByRole('button', { name: 'Gửi lại email xác thực' }),
    ).toBeNull();
  });

  it('renders the confirm state with exactly one action button (Q72)', async () => {
    open(`/verify-email#token=${TOKEN}`, false);
    await screen.findByRole('heading', { name: 'Xác thực email' });
    expect(document.querySelectorAll('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Xác thực email' }),
    ).toBeInTheDocument();
  });

  it('gives a signed-in learner one resend button in the invalid state (Q73)', async () => {
    open('/verify-email', true);
    await screen.findByRole('heading', {
      name: 'Liên kết không còn hiệu lực',
    });
    expect(document.querySelectorAll('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Gửi lại email xác thực' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Đăng nhập để gửi lại' }),
    ).toBeNull();
  });

  it('renders the done state with a single "Vào học" action', async () => {
    respond(204);
    open(`/verify-email#token=${TOKEN}`, false);
    await click('Xác thực email');
    await screen.findByRole('heading', { name: 'Email đã được xác thực' });

    expect(document.querySelectorAll('input')).toHaveLength(0);
    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Vào học' })).toHaveAttribute(
      'href',
      '/learn',
    );
  });

  it('renders the sent state with a single "Vào học" action', async () => {
    respond(204);
    open('/verify-email', true);
    await screen.findByRole('heading', { name: 'Liên kết không còn hiệu lực' });
    await click('Gửi lại email xác thực');
    await screen.findByRole('heading', { name: 'Đã gửi lại email' });

    expect(screen.getByRole('link', { name: 'Vào học' })).toHaveAttribute(
      'href',
      '/learn',
    );
  });
});
