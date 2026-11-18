import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { session } = vi.hoisted(() => ({ session: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: session,
}));

import VerifyEmailPage from './page';

async function renderPage() {
  session.mockResolvedValue({ state: 'unauthenticated', token: null });
  return render(await VerifyEmailPage());
}

describe('verify-email page — khung công khai bản web (M2.10c, Q81)', () => {
  beforeEach(() => {
    session.mockReset();
  });

  it('has no form control: the page only ever shows the state actions', async () => {
    const { container } = await renderPage();
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(0);
  });

  it('wraps the mobile page in .w-public with the web nav, the back link and the tall art', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('.w-public')).not.toBeNull();

    const nav = container.querySelector('header.w-pubnav.wa-nav.w-only');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('a.w-brand')?.getAttribute('href')).toBe('/');
    expect(nav?.querySelector('a.wa-home')?.getAttribute('href')).toBe('/');

    const back = container.querySelector('a.wa-back.w-only');
    expect(back?.getAttribute('href')).toBe('/sign-in');
    expect(back).toHaveTextContent('Quay lại đăng nhập');

    expect(
      container.querySelectorAll('.w-auth__art.wa-art--tall'),
    ).toHaveLength(1);
    expect(
      container.querySelector('figure img')?.getAttribute('src'),
    ).toContain('welcome-illustration.png');
  });

  it('hides the mobile back link on the web with .m-only', async () => {
    const { container } = await renderPage();
    const back = container.querySelector('a.auth__back');
    expect(back).toHaveClass('m-only');
    expect(back?.getAttribute('href')).toBe('/');
  });
});
