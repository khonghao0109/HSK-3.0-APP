'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { AdminIconName } from './admin-icon';
import { AdminIcon } from './admin-icon';
import { ADMIN_ACTION } from './admin-labels';

/**
 * Một mảng items duy nhất cho sidebar desktop và drawer ≤900px (TL-6).
 * Mục chưa có trang (Q94): không link, không chip, `aria-disabled`, chữ nhạt
 * đạt AA trên navy-850, "Sắp có" nằm trong tên đọc màn hình và `title`.
 */
export type AdminNavItem = {
  key: string;
  label: string;
  icon: AdminIconName;
  href?: `/admin/${string}`;
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { key: 'dashboard', label: 'Tổng quan', icon: 'layout-dashboard' },
  {
    key: 'content',
    label: 'Nội dung',
    icon: 'file-stack',
    href: '/admin/content',
  },
  {
    key: 'exercises',
    label: 'Bài tập',
    icon: 'clipboard-check',
    href: '/admin/exercises',
  },
  {
    key: 'media',
    label: 'Thư viện media',
    icon: 'image',
    href: '/admin/media',
  },
  { key: 'question-bank', label: 'Ngân hàng câu hỏi', icon: 'file-question' },
  {
    key: 'import',
    label: 'Nhập dữ liệu',
    icon: 'upload',
    href: '/admin/import',
  },
  { key: 'users', label: 'Người dùng', icon: 'users', href: '/admin/users' },
  { key: 'reports', label: 'Báo cáo', icon: 'bar-chart' },
  { key: 'ai-ops', label: 'AI Ops', icon: 'cpu' },
  { key: 'feedback', label: 'Phản hồi', icon: 'message-circle' },
  { key: 'settings', label: 'Cài đặt hệ thống', icon: 'settings' },
];

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNavigation({
  onNavigate,
}: {
  /** Drawer ≤900px đóng khi bấm một mục có trang (desktop: no-op vô hại). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="adm-nav">
      {ADMIN_NAV_ITEMS.map((item) => {
        if (!item.href) {
          return (
            <span
              className="adm-nav__item adm-nav__item--soon"
              aria-disabled="true"
              title={ADMIN_ACTION.comingSoon}
              key={item.key}
            >
              <AdminIcon name={item.icon} />
              <span className="adm-nav__label">
                {item.label}
                <span className="sr-only">{` (${ADMIN_ACTION.comingSoon})`}</span>
              </span>
            </span>
          );
        }
        const current = isCurrent(pathname, item.href);
        return (
          <Link
            className="adm-nav__item"
            href={item.href}
            aria-current={current ? 'page' : undefined}
            onClick={onNavigate}
            key={item.key}
          >
            <AdminIcon name={item.icon} />
            <span className="adm-nav__label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
