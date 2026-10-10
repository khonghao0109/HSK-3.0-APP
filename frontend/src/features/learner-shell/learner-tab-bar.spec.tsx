import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePathname } from 'next/navigation';

import { LearnerTabBar } from './learner-tab-bar';
import { LearnerToastProvider } from './learner-toast';
import { TOAST_COMING_SOON } from './learner-toast-messages';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

function renderAt(pathname: string) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  render(
    <LearnerToastProvider>
      <LearnerTabBar />
    </LearnerToastProvider>,
  );
  return screen.getByRole('navigation', { name: 'Điều hướng chính' });
}

function iconHref(element: HTMLElement): string | null {
  return element.querySelector('use')?.getAttribute('href') ?? null;
}

describe('LearnerTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists five tabs in order and marks Trang chủ current on /learn', () => {
    const nav = renderAt('/learn');
    const items = Array.from(nav.children);
    expect(items.map((item) => item.textContent)).toEqual([
      'Trang chủ',
      'Học',
      'Tra từ',
      'Ôn tập',
      'Hồ sơ',
    ]);
    const home = within(nav).getByRole('link', { name: 'Trang chủ' });
    expect(home).toHaveAttribute('href', '/learn');
    expect(home).toHaveAttribute('aria-current', 'page');
    expect(iconHref(home)).toBe('#i-home-fill');
    const profile = within(nav).getByRole('link', { name: 'Hồ sơ' });
    expect(profile).toHaveAttribute('href', '/learn/profile');
    expect(profile).not.toHaveAttribute('aria-current');
  });

  it('marks Hồ sơ current on /learn/profile', () => {
    const nav = renderAt('/learn/profile');
    const profile = within(nav).getByRole('link', { name: 'Hồ sơ' });
    expect(profile).toHaveAttribute('aria-current', 'page');
    const home = within(nav).getByRole('link', { name: 'Trang chủ' });
    expect(home).not.toHaveAttribute('aria-current');
    expect(iconHref(home)).toBe('#i-home');
  });

  it('links Học to /learn/path and marks it current there', () => {
    const nav = renderAt('/learn/path');
    const learn = within(nav).getByRole('link', { name: 'Học' });
    expect(learn).toHaveAttribute('href', '/learn/path');
    expect(learn).toHaveAttribute('aria-current', 'page');
    expect(iconHref(learn)).toBe('#i-book-open-fill');
    expect(
      within(nav).getByRole('link', { name: 'Trang chủ' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('shows Học without aria-current and with the outline icon elsewhere', () => {
    const nav = renderAt('/learn');
    const learn = within(nav).getByRole('link', { name: 'Học' });
    expect(learn).not.toHaveAttribute('aria-current');
    expect(iconHref(learn)).toBe('#i-book-open');
  });

  it.each(['Tra từ', 'Ôn tập'])(
    '%s is a button that shows the coming-soon toast',
    (label) => {
      const nav = renderAt('/learn');
      const button = within(nav).getByRole('button', { name: label });
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(screen.queryByText(TOAST_COMING_SOON)).not.toBeInTheDocument();
      fireEvent.click(button);
      expect(screen.getByText('Tính năng sắp ra mắt.')).toHaveClass('toast');
    },
  );
});
