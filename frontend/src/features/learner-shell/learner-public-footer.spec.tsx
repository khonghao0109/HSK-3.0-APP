import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  LearnerPublicFooter,
  PUBLIC_FOOTER_BASE,
  PUBLIC_FOOTER_GROUPS,
  PUBLIC_FOOTER_TAGLINE,
} from './learner-public-footer';

/**
 * Chân trang dùng chung của khung công khai `.w-public` (M2.10c): đúng 3 nhóm
 * link của mẫu (`docs/ui_reference/web/index.html`), cột brand và dòng bản
 * quyền. Chuỗi chép từ mẫu nên test khoá cứng để không trôi.
 */
describe('LearnerPublicFooter', () => {
  it('renders exactly the three sample groups, in order, with their labels', () => {
    render(<LearnerPublicFooter />);
    const navs = screen.getAllByRole('navigation');
    expect(navs).toHaveLength(3);
    expect(navs.map((nav) => nav.textContent)).toEqual([
      'Giới thiệuLộ trình HSKTính năngCâu hỏi thường gặp',
      'Tài khoảnĐăng nhậpĐăng ký',
      'Pháp lýĐiều khoản sử dụngChính sách bảo mật',
    ]);
    for (const nav of navs) {
      expect(nav).toHaveAccessibleName();
    }
    expect(
      screen.getByRole('navigation', { name: 'Giới thiệu' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Tài khoản' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Pháp lý' }),
    ).toBeInTheDocument();
  });

  it('points every group link at the right destination', () => {
    render(<LearnerPublicFooter />);
    const expected: Array<[string, string]> = [
      ['Giới thiệu', '/#levels'],
      ['Giới thiệu', '/#features'],
      ['Giới thiệu', '/#faq'],
      ['Tài khoản', '/sign-in'],
      ['Tài khoản', '/sign-up'],
      ['Pháp lý', '/terms'],
      ['Pháp lý', '/privacy'],
    ];
    for (const [group, href] of expected) {
      const nav = screen.getByRole('navigation', { name: group });
      const link = within(nav).getAllByRole('link');
      expect(link.map((item) => item.getAttribute('href'))).toContain(href);
    }
    const legal = screen.getByRole('navigation', { name: 'Pháp lý' });
    expect(
      within(legal).getByRole('link', { name: 'Điều khoản sử dụng' }),
    ).toHaveAttribute('href', '/terms');
    expect(
      within(legal).getByRole('link', { name: 'Chính sách bảo mật' }),
    ).toHaveAttribute('href', '/privacy');
  });

  it('matches the exported group model', () => {
    render(<LearnerPublicFooter />);
    for (const group of PUBLIC_FOOTER_GROUPS) {
      const nav = screen.getByRole('navigation', { name: group.title });
      for (const link of group.links) {
        expect(
          within(nav).getByRole('link', { name: link.label }),
        ).toHaveAttribute('href', link.href);
      }
      expect(nav.querySelector('h2')?.textContent).toBe(group.title);
      expect(nav.querySelector('h2')?.id).toBe(group.id);
    }
  });

  it('shows the brand column and the copyright line', () => {
    const { container } = render(<LearnerPublicFooter />);
    expect(screen.getByRole('link', { name: 'Hán Lộ' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByText(PUBLIC_FOOTER_TAGLINE)).toBeInTheDocument();
    expect(screen.getByText(PUBLIC_FOOTER_BASE)).toBeInTheDocument();
    // Web-only: `.w-only` (learner.css) ẩn dưới 1024px, learner-web-*.css
    // hiện lại từ 1024px.
    expect(container.querySelector('footer')).toHaveClass('w-footer', 'w-only');
  });
});
