import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import ForgotPasswordPage from './page';

describe('forgot-password page — khung công khai bản web (M2.10c, Q81)', () => {
  it('renders the form only once: 1 email input and 1 submit button', () => {
    const { container } = render(<ForgotPasswordPage />);
    expect(container.querySelectorAll('input')).toHaveLength(1);
    expect(container.querySelectorAll('input[name="email"]')).toHaveLength(1);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it('wraps the mobile page in .w-public with the web nav, the back link and the wide art', () => {
    const { container } = render(<ForgotPasswordPage />);
    expect(container.querySelector('.w-public')).not.toBeNull();

    const nav = container.querySelector('header.w-pubnav.wa-nav.w-only');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('a.w-brand')?.getAttribute('href')).toBe('/');
    expect(nav?.querySelector('a.wa-home')?.getAttribute('href')).toBe('/');

    const back = container.querySelector('a.wa-back.w-only');
    expect(back?.getAttribute('href')).toBe('/sign-in');
    expect(back).toHaveTextContent('Quay lại đăng nhập');

    expect(
      container.querySelectorAll('.w-auth__art.wa-art--wide'),
    ).toHaveLength(1);
    expect(
      container.querySelector('figure img')?.getAttribute('src'),
    ).toContain('placement-hero.png');
  });

  it('hides the mobile back link on the web with .m-only', () => {
    const { container } = render(<ForgotPasswordPage />);
    const back = container.querySelector('a.auth__back');
    expect(back).toHaveClass('m-only');
    expect(back?.getAttribute('href')).toBe('/sign-in');
  });
});
