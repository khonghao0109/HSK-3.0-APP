import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirect, session } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  session: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: session,
}));

import LearnerSignUpPage from './page';

async function renderPage() {
  session.mockResolvedValue({ state: 'unauthenticated', token: null });
  return render(await LearnerSignUpPage());
}

describe('sign-up page — khung công khai bản web (M2.10c, Q81)', () => {
  beforeEach(() => {
    redirect.mockClear();
    session.mockReset();
  });

  it('renders the form only once: 2 inputs (email, password) and 1 submit button', async () => {
    const { container } = await renderPage();
    expect(container.querySelectorAll('input')).toHaveLength(2);
    expect(container.querySelectorAll('input[name="email"]')).toHaveLength(1);
    expect(container.querySelectorAll('input[name="password"]')).toHaveLength(
      1,
    );
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it('wraps the mobile page in .w-public with the web nav and the tall art', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('.w-public')).not.toBeNull();

    const nav = container.querySelector('header.w-pubnav.wa-nav.w-only');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('a.w-brand')?.getAttribute('href')).toBe('/');
    expect(nav?.querySelector('a.wa-home')?.getAttribute('href')).toBe('/');

    expect(
      container.querySelectorAll('.w-auth__art.wa-art--tall'),
    ).toHaveLength(1);
    expect(
      container.querySelector('figure img')?.getAttribute('src'),
    ).toContain('welcome-illustration.png');
    expect(container.querySelectorAll('.wa-points li')).toHaveLength(3);
  });

  it('hides the mobile back link on the web with .m-only', async () => {
    const { container } = await renderPage();
    const back = container.querySelector('a.auth__back');
    expect(back).toHaveClass('m-only');
    expect(back?.getAttribute('href')).toBe('/');
    expect(back).toHaveAttribute('aria-label', 'Quay lại');
  });

  it('adds the web-only switch link to sign-in in DOM order before the legal links (mẫu .wa-switch)', async () => {
    const { container } = await renderPage();
    const switchLine = container.querySelector('p.wa-switch');
    expect(switchLine).toHaveClass('w-only');
    expect(switchLine).toHaveTextContent('Đã có tài khoản?');
    expect(switchLine?.querySelector('a')?.getAttribute('href')).toBe(
      '/sign-in',
    );

    const social = container.querySelector('.auth__social')!;
    const terms = container.querySelector('.auth__terms')!;
    const children = [
      ...container.querySelector('main')!.querySelectorAll('*'),
    ];
    expect(children.indexOf(social)).toBeLessThan(
      children.indexOf(switchLine as Element),
    );
    expect(children.indexOf(switchLine as Element)).toBeLessThan(
      children.indexOf(terms),
    );
  });
});
