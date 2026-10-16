import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import ResetPasswordPage from './page';

const TOKEN = 'page-spec-token-aaaaaaaaaaaaaaaaaaaaaaaaaaa';

function open(url: string) {
  window.history.replaceState(null, '', url);
  return render(<ResetPasswordPage />);
}

describe('reset-password page — khung công khai bản web (M2.10c, Q81)', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('renders the form only once when the link carries a token', async () => {
    const { container } = open(`/reset-password#token=${TOKEN}`);
    await screen.findByLabelText('Mật khẩu mới');
    expect(container.querySelectorAll('input')).toHaveLength(1);
    expect(container.querySelectorAll('input[name="password"]')).toHaveLength(
      1,
    );
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it('keeps the mobile invalid view (no form) when the link has no token', () => {
    const { container } = open('/reset-password');
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(0);
    expect(container).toHaveTextContent('Liên kết không còn hiệu lực');
  });

  it('wraps the mobile page in .w-public with the web nav, the back link and the wide art', () => {
    const { container } = open('/reset-password');
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
    const { container } = open('/reset-password');
    const back = container.querySelector('a.auth__back');
    expect(back).toHaveClass('m-only');
    expect(back?.getAttribute('href')).toBe('/sign-in');
  });
});
