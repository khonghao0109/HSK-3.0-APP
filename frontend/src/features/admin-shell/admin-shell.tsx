import Link from 'next/link';
import type { ReactNode } from 'react';

import type { AuthUser } from '@/features/auth/auth-contract';

import { LogoutButton } from './logout-button';

function Icon({ name }: { name: 'grid' | 'book' | 'media' | 'review' }) {
  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22.5z" />
        <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5a2.5 2.5 0 0 1 2.5 2.5z" />
      </>
    ),
    media: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m8 15 3-3 2.5 2.5L16 12l3 3" />
        <circle cx="8" cy="9" r="1" />
      </>
    ),
    review: (
      <>
        <path d="M12 3 4.5 6v5c0 4.6 3.2 8.6 7.5 10 4.3-1.4 7.5-5.4 7.5-10V6z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

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
        <nav className="side-nav" aria-label="Admin navigation">
          <p className="side-nav__label">OPERATIONS</p>
          <span className="side-nav__item side-nav__item--disabled">
            <Icon name="grid" />
            <span>Overview</span>
            <small>Soon</small>
          </span>
          <Link
            className="side-nav__item side-nav__item--active"
            href="/admin/exercises"
            aria-current="page"
          >
            <Icon name="book" />
            <span>Exercises</span>
          </Link>
          <span className="side-nav__item side-nav__item--disabled">
            <Icon name="media" />
            <span>Media library</span>
            <small>Next</small>
          </span>
          <span className="side-nav__item side-nav__item--disabled">
            <Icon name="review" />
            <span>Review queue</span>
            <small>Soon</small>
          </span>
        </nav>
        <div className="sidebar__scope">
          <span className="scope-dot" aria-hidden="true" />
          <div>
            <strong>Read console V1</strong>
            <small>Mutation tools are intentionally unavailable.</small>
          </div>
        </div>
        <div className="sidebar__profile">
          <span className="avatar" aria-hidden="true">
            {initials}
          </span>
          <span className="profile-copy">
            <strong>{user.name ?? 'Administrator'}</strong>
            <small>{user.email}</small>
          </span>
          <LogoutButton />
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="mobile-header">
          <Link className="mobile-brand" href="/admin/exercises">
            <span>汉</span> HSK Workbench
          </Link>
          <LogoutButton />
        </header>
        <main className="admin-main" id="admin-content">
          {children}
        </main>
      </div>
    </div>
  );
}
