import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePathname } from 'next/navigation';

import { LearnerSidebar } from './learner-sidebar';
import { LearnerToastProvider } from './learner-toast';
import { TOAST_COMING_SOON } from './learner-toast-messages';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

function renderAt(pathname: string) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  return render(
    <LearnerToastProvider>
      <LearnerSidebar />
    </LearnerToastProvider>,
  );
}

function mainNav() {
  return screen.getByRole('navigation', { name: 'Điều hướng chính' });
}

describe('LearnerSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the main items in order and marks Trang chủ on /learn', () => {
    renderAt('/learn');
    const nav = mainNav();
    expect(Array.from(nav.children).map((item) => item.textContent)).toEqual([
      'Trang chủ',
      'Lộ trình học',
      'Tra từ',
      'Ôn tập Sắp có',
    ]);
    const home = within(nav).getByRole('link', { name: 'Trang chủ' });
    expect(home).toHaveAttribute('href', '/learn');
    expect(home).toHaveAttribute('aria-current', 'page');
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it.each([
    ['/learn/path', 'Lộ trình học', '/learn/path'],
    ['/learn/dictionary', 'Tra từ', '/learn/dictionary'],
    ['/learn/dictionary/42', 'Tra từ', '/learn/dictionary'],
    // M2.10b: lesson screens keep the sidebar and belong to Lộ trình học.
    ['/learn/lessons/7', 'Lộ trình học', '/learn/path'],
  ])('marks the current item on %s', (pathname, name, href) => {
    renderAt(pathname);
    const nav = mainNav();
    const link = within(nav).getByRole('link', { name });
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('marks the profile cell, not a nav item, on /learn/profile', () => {
    renderAt('/learn/profile');
    expect(mainNav().querySelectorAll('[aria-current]')).toHaveLength(0);
    const cell = screen.getByRole('link', { name: 'Hồ sơ' });
    expect(cell).toHaveAttribute('href', '/learn/profile');
    expect(cell).toHaveAttribute('aria-current', 'page');
  });

  it('renders nothing only on the player screens (M2.10b)', () => {
    for (const pathname of [
      '/learn/lessons/7/practice',
      '/learn/lessons/7/complete',
    ]) {
      const { container, unmount } = renderAt(pathname);
      expect(container.querySelector('.w-side')).toBeNull();
      unmount();
    }
    // The lesson detail screens keep the frame (mẫu web/lesson.html).
    const { container } = renderAt('/learn/lessons/7');
    expect(container.querySelector('.w-side')).not.toBeNull();
  });

  it('toasts from every coming-soon item and from Hỗ trợ', () => {
    renderAt('/learn');
    const names = [
      'Ôn tập Sắp có',
      'Thi thử HSK Sắp có',
      'Phát âm Sắp có',
      'Đọc hiểu Sắp có',
      'Trợ lý AI Sắp có',
      'Hỗ trợ',
    ];
    for (const name of names) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(screen.getAllByText(TOAST_COMING_SOON)).toHaveLength(names.length);
    expect(
      within(
        screen.getByRole('navigation', { name: 'Luyện thêm' }),
      ).getAllByRole('button'),
    ).toHaveLength(4);
  });

  it('has no sign-out (Q82) and distinct navigation names', () => {
    renderAt('/learn');
    expect(screen.queryByRole('button', { name: /Đăng xuất/u })).toBeNull();
    expect(
      screen
        .getAllByRole('navigation')
        .map(
          (nav) =>
            nav.getAttribute('aria-label') ??
            nav.getAttribute('aria-labelledby'),
        ),
    ).toEqual(['Điều hướng chính', 'w-side-more', 'Khác']);
    expect(screen.getByRole('complementary')).toHaveClass('w-only');
  });
});
