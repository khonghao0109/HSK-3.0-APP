'use client';

import Link from 'next/link';
import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import type { AuthUser } from '@/features/auth/auth-contract';

import { AdminIcon } from './admin-icon';
import { AdminIconSprite } from './admin-icon-sprite';
import { ADMIN_ACTION } from './admin-labels';
import { AdminNavigation } from './admin-navigation';
import { LogoutButton } from './logout-button';

const SIDEBAR_ID = 'adm-sidebar';

/**
 * Khung admin "Hán Lộ Admin" (M5.0, Q4/Q88/Q92): sidebar 232px navy-850,
 * thanh trên 60px trắng, nút "Thu gọn" thu sidebar về 72px (không nhớ trạng
 * thái), ≤900px sidebar thành drawer (nút menu, backdrop, Esc đóng và trả
 * focus về nút menu). Không ô tìm kiếm/chuông/badge trên thanh trên (TL-7).
 */
export function AdminShell({
  user,
  children,
}: {
  user: AuthUser;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  function onShellKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || !drawerOpen) return;
    closeDrawer();
    // Trả focus về nút menu để người dùng bàn phím không mất ngữ cảnh.
    menuButtonRef.current?.focus();
  }

  const shellClass = `adm-shell${collapsed ? ' adm-shell--collapsed' : ''}${
    drawerOpen ? ' adm-shell--drawer-open' : ''
  }`;

  return (
    <div className={shellClass} onKeyDown={onShellKeyDown}>
      <AdminIconSprite />
      <a className="skip-link" href="#admin-content">
        Đến nội dung chính
      </a>
      <aside
        className="adm-sidebar"
        id={SIDEBAR_ID}
        aria-label="Điều hướng quản trị"
      >
        <Link className="adm-brand" href="/admin/exercises">
          <span className="adm-brand__mark">
            <AdminIcon name="leaf" className="adm-icon adm-icon--sm" />
          </span>
          <span className="adm-brand__label">Hán Lộ Admin</span>
        </Link>
        <AdminNavigation onNavigate={closeDrawer} />
        <div className="adm-sidebar__spacer" />
        <button
          className="adm-collapse"
          type="button"
          aria-expanded={!collapsed}
          aria-label="Thu gọn"
          onClick={() => setCollapsed((value) => !value)}
        >
          <AdminIcon name="plus" />
          <span className="adm-nav__label">Thu gọn</span>
        </button>
      </aside>
      <button
        className="adm-backdrop"
        type="button"
        tabIndex={-1}
        aria-label="Đóng menu điều hướng"
        onClick={closeDrawer}
      />
      <div className="adm-main-col">
        <header className="adm-topbar">
          <button
            className="adm-icon-btn adm-menu"
            type="button"
            ref={menuButtonRef}
            aria-label="Mở hoặc thu gọn menu"
            aria-expanded={drawerOpen}
            aria-controls={SIDEBAR_ID}
            onClick={() => setDrawerOpen((value) => !value)}
          >
            <AdminIcon name="menu" />
          </button>
          <div className="adm-topbar__end">
            <div className="adm-user">
              <span className="adm-avatar">
                <AdminIcon name="user" className="adm-icon adm-icon--sm" />
              </span>
              <span className="adm-user__text">
                <span className="adm-user__name">
                  {user.name ?? user.email}
                </span>
                <span className="adm-user__role">{ADMIN_ACTION.adminRole}</span>
              </span>
            </div>
            <LogoutButton />
          </div>
        </header>
        <main className="adm-main" id="admin-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
