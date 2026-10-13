import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirect, session } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  session: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: session,
}));
vi.mock('@/features/learner-auth/learner-login-form', () => ({
  LearnerLoginForm: ({ nextPath }: { nextPath?: string }) => (
    <p data-testid="next">{nextPath ?? 'none'}</p>
  ),
}));

import LearnerSignInPage from './page';

const page = (next?: string | string[]) =>
  LearnerSignInPage({ searchParams: Promise.resolve({ next }) });

describe('sign-in page next parameter (Q73)', () => {
  beforeEach(() => {
    redirect.mockClear();
    session.mockReset();
  });

  it('passes /verify-email to the form only for next=verify-email', async () => {
    session.mockResolvedValue({ state: 'unauthenticated', token: null });
    render(await page('verify-email'));
    expect(screen.getByTestId('next')).toHaveTextContent('/verify-email');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/learn/profile',
    'verify-email/../admin',
    '/verify-email',
    'VERIFY-EMAIL',
    undefined,
  ])('ignores next=%s', async (next) => {
    session.mockResolvedValue({ state: 'unauthenticated', token: null });
    render(await page(next));
    expect(screen.getByTestId('next')).toHaveTextContent('none');
  });

  it('ignores a repeated next parameter', async () => {
    session.mockResolvedValue({ state: 'unauthenticated', token: null });
    render(await page(['verify-email', 'verify-email']));
    expect(screen.getByTestId('next')).toHaveTextContent('none');
  });

  it('sends a signed-in learner to /verify-email for next=verify-email', async () => {
    session.mockResolvedValue({
      state: 'learner',
      user: { id: 2, email: 'l@x.test', role: 'user' },
      token: 't',
    });
    await expect(page('verify-email')).rejects.toThrow(
      'redirect:/verify-email',
    );
  });

  it.each(['https://evil.example', '//evil.example', '/learn/profile'])(
    'sends a signed-in learner to /learn for next=%s',
    async (next) => {
      session.mockResolvedValue({
        state: 'learner',
        user: { id: 2, email: 'l@x.test', role: 'user' },
        token: 't',
      });
      await expect(page(next)).rejects.toThrow('redirect:/learn');
      expect(redirect).toHaveBeenCalledWith('/learn');
    },
  );
});
