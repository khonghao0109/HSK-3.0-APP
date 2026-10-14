import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
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
// The real form is covered by learner-login-form.spec.tsx; this mock only
// needs to pass the new `switchLink` slot through (M2.10c).
vi.mock('@/features/learner-auth/learner-login-form', () => ({
  LearnerLoginForm: ({
    nextPath,
    switchLink,
  }: {
    nextPath?: string;
    switchLink?: ReactNode;
  }) => (
    <>
      <p data-testid="next">{nextPath ?? 'none'}</p>
      {switchLink}
    </>
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

describe('sign-in page — khung công khai bản web (M2.10c, Q81)', () => {
  beforeEach(() => {
    redirect.mockClear();
    session.mockReset();
    session.mockResolvedValue({ state: 'unauthenticated', token: null });
  });

  it('wraps the mobile page in .w-public with the web nav and the tall art', async () => {
    const { container } = render(await page());
    expect(container.querySelector('.w-public')).not.toBeNull();

    const nav = container.querySelector('header.w-pubnav.wa-nav.w-only');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('a.w-brand')?.getAttribute('href')).toBe('/');
    expect(nav?.querySelector('a.wa-home')?.getAttribute('href')).toBe('/');

    expect(
      container.querySelectorAll('.w-auth__art.wa-art--tall'),
    ).toHaveLength(1);
    expect(container.querySelectorAll('.wa-points li')).toHaveLength(3);
  });

  it('hides the mobile back link on the web with .m-only', async () => {
    const { container } = render(await page());
    const back = container.querySelector('a.auth__back');
    expect(back).toHaveClass('m-only');
    expect(back?.getAttribute('href')).toBe('/');
    expect(back).toHaveAttribute('aria-label', 'Quay lại');
  });

  it('adds the web-only switch link to sign-up (mẫu .wa-switch)', async () => {
    const { container } = render(await page());
    const switchLine = container.querySelector('p.wa-switch');
    expect(switchLine).toHaveClass('w-only');
    expect(switchLine).toHaveTextContent('Chưa có tài khoản?');
    expect(switchLine?.querySelector('a')?.getAttribute('href')).toBe(
      '/sign-up',
    );
  });
});
