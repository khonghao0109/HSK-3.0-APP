import Link from 'next/link';
import type { ReactNode } from 'react';

import type { AuthUser } from '@/features/auth/auth-contract';

import { AdminIcon } from './admin-icon';
import { AdminMobileNavigation, AdminNavigation } from './admin-navigation';
import { LogoutButton } from './logout-button';

export function AdminShell({
  user,
  children,
}: {
  user: AuthUser;
  children: ReactNode;
}) {
  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();
  return (
    <div className="admin-frame">
      <a className="skip-link" href="#admin-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link
          className="brand"
          href="/admin/exercises"
          aria-label="HSK Content Workbench home"
        >
          <span className="brand__mark">汉</span>
          <span>
            <strong>HSK 3.0</strong>
            <small>Content Workbench</small>
          </span>
        </Link>
        <AdminNavigation />
        <div className="sidebar__scope">
          <span className="scope-dot" aria-hidden="true" />
          <div>
            <strong>Protected operations</strong>
            <small>Media safety actions are audited.</small>
          </div>
        </div>
      </aside>
      <div className="admin-workspace">
        <header
          className="admin-toolbar mobile-header"
          aria-label="Admin workspace toolbar"
        >
          <Link
            className="mobile-brand"
            href="/admin/exercises"
            aria-label="HSK Content Workbench home"
          >
            <span>汉</span> HSK Admin
          </Link>
          <AdminMobileNavigation />
          <div className="admin-toolbar__context">
            <AdminIcon name="book" />
            <span>
              <small>Content operations</small>
              <strong>Content repository</strong>
            </span>
          </div>
          <div className="admin-toolbar__account">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="profile-copy">
              <strong>{user.name ?? 'Administrator'}</strong>
              <small>Administrator</small>
            </span>
            <LogoutButton />
          </div>
        </header>
        <main
          className="admin-main"
          id="admin-content"
          aria-label="Admin content"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
