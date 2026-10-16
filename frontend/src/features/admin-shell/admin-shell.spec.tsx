import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AdminShell } from './admin-shell';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/exercises',
}));

const admin = {
  id: 1,
  email: 'admin.frontend@example.test',
  name: 'Content Administrator',
  role: 'admin' as const,
};

function renderShell() {
  return render(
    <AdminShell user={admin}>
      <h1>Bài tập</h1>
    </AdminShell>,
  );
}

describe('AdminShell (M5.0 — khung "Hán Lộ Admin")', () => {
  it('renders brand, sprite icon và khối người dùng tiếng Việt', () => {
    const { container } = renderShell();

    expect(screen.getByRole('link', { name: 'Hán Lộ Admin' })).toHaveAttribute(
      'href',
      '/admin/exercises',
    );
    // Sprite mount một lần trong shell; icon brand tham chiếu #i-leaf.
    expect(container.querySelector('symbol#i-leaf')).not.toBeNull();
    expect(
      container.querySelector('.adm-brand use')?.getAttribute('href'),
    ).toBe('#i-leaf');

    expect(screen.getByText('Content Administrator')).toBeInTheDocument();
    expect(screen.getByText('Quản trị viên')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Đăng xuất' }),
    ).toBeInTheDocument();
  });

  it('liệt kê đủ 11 mục sidebar theo thứ tự TL-6, mục đang chọn có aria-current', () => {
    renderShell();

    const sidebar = screen.getByRole('complementary', {
      name: 'Điều hướng quản trị',
    });
    const items = Array.from(sidebar.querySelectorAll('.adm-nav__item')).map(
      (item) => item.textContent,
    );
    expect(items).toEqual([
      'Tổng quan (Sắp có)',
      'Nội dung (Sắp có)',
      'Bài tập',
      'Thư viện media',
      'Ngân hàng câu hỏi (Sắp có)',
      'Nhập dữ liệu (Sắp có)',
      'Người dùng (Sắp có)',
      'Báo cáo (Sắp có)',
      'AI Ops (Sắp có)',
      'Phản hồi (Sắp có)',
      'Cài đặt hệ thống (Sắp có)',
    ]);

    expect(screen.getByRole('link', { name: 'Bài tập' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('link', { name: 'Thư viện media' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('mục chưa có trang: không link, không chip, aria-disabled, tên đọc có "Sắp có" (Q94)', () => {
    renderShell();

    const soonItems = Array.from(
      document.querySelectorAll('.adm-nav__item--soon'),
    );
    expect(soonItems).toHaveLength(9);
    // Q94: bỏ chip "Sắp có" khỏi sidebar.
    expect(document.querySelectorAll('.adm-nav__soon')).toHaveLength(0);

    const visibleLabels = [
      'Tổng quan',
      'Nội dung',
      'Ngân hàng câu hỏi',
      'Nhập dữ liệu',
      'Người dùng',
      'Báo cáo',
      'AI Ops',
      'Phản hồi',
      'Cài đặt hệ thống',
    ];
    soonItems.forEach((item, index) => {
      expect(item.tagName).not.toBe('A');
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(item).toHaveAttribute('title', 'Sắp có');
      // Tên đọc màn hình: "<Nhãn> (Sắp có)"; chữ hiện chỉ có nhãn.
      expect(item.textContent).toBe(`${visibleLabels[index]} (Sắp có)`);
      const label = item.querySelector('.adm-nav__label');
      expect(label?.firstChild?.textContent).toBe(visibleLabels[index]);
      expect(label?.querySelector('.sr-only')?.textContent).toContain('Sắp có');
    });
    expect(screen.queryByRole('link', { name: /Tổng quan/ })).toBeNull();
  });

  it('thanh trên không có ô tìm kiếm, chuông hay badge phản hồi (TL-7)', () => {
    renderShell();

    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByLabelText(/thông báo/i)).toBeNull();
    expect(screen.queryByText(/phản hồi mới/i)).toBeNull();
  });

  it('nút "Thu gọn" thu sidebar về trạng thái collapsed và lật aria-expanded', async () => {
    const { container } = renderShell();
    const user = userEvent.setup();

    const toggle = screen.getByRole('button', { name: 'Thu gọn' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.adm-shell--collapsed')).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.adm-shell--collapsed')).not.toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.adm-shell--collapsed')).toBeNull();
  });

  it('nút menu mở drawer, Esc đóng và trả focus về nút menu', async () => {
    const { container } = renderShell();
    const user = userEvent.setup();

    const menu = screen.getByRole('button', { name: 'Mở hoặc thu gọn menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveAttribute('aria-controls', 'adm-sidebar');

    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.adm-shell--drawer-open')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.adm-shell--drawer-open')).toBeNull();
    expect(menu).toHaveFocus();
  });

  it('backdrop đóng drawer khi bấm', async () => {
    const { container } = renderShell();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Mở hoặc thu gọn menu' }),
    );
    expect(container.querySelector('.adm-shell--drawer-open')).not.toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Đóng menu điều hướng' }),
    );
    expect(container.querySelector('.adm-shell--drawer-open')).toBeNull();
  });

  it('có skip link tới nội dung chính và không vẽ hành động chưa hỗ trợ', () => {
    renderShell();

    const skip = screen.getByRole('link', { name: 'Đến nội dung chính' });
    expect(skip).toHaveAttribute('href', '#admin-content');
    expect(document.getElementById('admin-content')).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: /tạo|xuất bản|nhập dữ liệu/i }),
    ).toBeNull();
  });

  it('hiện email khi tài khoản không có tên', () => {
    render(
      <AdminShell user={{ ...admin, name: null }}>
        <h1>Bài tập</h1>
      </AdminShell>,
    );
    expect(screen.getByText('admin.frontend@example.test')).toBeInTheDocument();
  });
});
