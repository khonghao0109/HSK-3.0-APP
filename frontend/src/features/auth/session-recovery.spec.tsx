import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginForm } from './login-form';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'admin@example.test');
  await user.type(screen.getByLabelText('Password'), 'secret1');
  await user.click(screen.getByRole('button', { name: /session|sign in/i }));
  return user;
}

describe('session recovery and login ordering', () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
  });

  it('does not recover when the page has no session-ended reason', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(<LoginForm />);
    await fillAndSubmit();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/session/login',
      expect.any(Object),
    );
  });

  it('queues login behind pending recovery without losing credentials', async () => {
    const recovery = deferred<Response>();
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/session/recover') return recovery.promise;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    render(<LoginForm sessionEnded />);
    await waitFor(() => expect(calls).toEqual(['/api/session/recover']));
    await fillAndSubmit();

    expect(calls).toEqual(['/api/session/recover']);
    expect(screen.getByLabelText('Email')).toHaveValue('admin@example.test');
    expect(screen.getByLabelText('Password')).toHaveValue('secret1');

    await act(() => {
      recovery.resolve(
        new Response(null, {
          status: 204,
          headers: { 'x-session-recovery': 'ready' },
        }),
      );
      return recovery.promise;
    });
    await waitFor(() =>
      expect(calls).toEqual(['/api/session/recover', '/api/session/login']),
    );
  });

  it('clears an invalid cookie before it starts login', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      calls.push(url);
      return Promise.resolve(
        new Response(null, {
          status: url.endsWith('/recover') ? 204 : 200,
          headers: url.endsWith('/recover')
            ? { 'x-session-recovery': 'invalid' }
            : undefined,
        }),
      );
    });

    render(<LoginForm sessionEnded />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(calls).toEqual([
        '/api/session/recover',
        '/api/session/logout',
        '/api/session/login',
      ]),
    );
  });

  it.each([
    [
      'server failure',
      () =>
        Promise.resolve(
          new Response(null, {
            status: 204,
            headers: { 'x-session-recovery': 'unavailable' },
          }),
        ),
    ],
    [
      'network failure',
      () => Promise.reject(new TypeError('network unavailable')),
    ],
  ])('fails closed on recovery %s and supports retry', async (_label, fail) => {
    let recoveryAttempt = 0;
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/session/recover' && recoveryAttempt++ === 0) {
        return fail();
      }
      return Promise.resolve(
        new Response(null, {
          status: 204,
          headers: { 'x-session-recovery': 'ready' },
        }),
      );
    });

    render(<LoginForm sessionEnded />);
    await screen.findByRole('button', { name: 'Retry session check' });
    expect(calls).toEqual(['/api/session/recover']);

    await userEvent.click(
      screen.getByRole('button', { name: 'Retry session check' }),
    );
    await waitFor(() =>
      expect(calls).toEqual(['/api/session/recover', '/api/session/recover']),
    );
    await fillAndSubmit();
    await waitFor(() =>
      expect(calls).toEqual([
        '/api/session/recover',
        '/api/session/recover',
        '/api/session/login',
      ]),
    );
  });

  it('fails closed when recovery omits or changes its bounded state header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    render(<LoginForm sessionEnded />);

    expect(
      await screen.findByRole('button', { name: 'Retry session check' }),
    ).toBeVisible();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('deduplicates double submit into one login request', async () => {
    const login = deferred<Response>();
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/session/login') return login.promise;
      return Promise.resolve(
        new Response(null, {
          status: 204,
          headers: { 'x-session-recovery': 'ready' },
        }),
      );
    });

    render(<LoginForm />);
    const user = await fillAndSubmit();
    await user.click(screen.getByRole('button', { name: 'Signing in…' }));

    expect(calls).toEqual(['/api/session/login']);
    await act(() => {
      login.resolve(new Response(null, { status: 401 }));
      return login.promise;
    });
  });

  it('aborts an owned recovery on unmount without starting login', async () => {
    let recoverySignal: AbortSignal | undefined;
    const recovery = deferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_input, init) => {
        recoverySignal = init?.signal ?? undefined;
        return recovery.promise;
      });
    const view = render(<LoginForm sessionEnded />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    view.unmount();

    expect(recoverySignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
