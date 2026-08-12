'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AdminIcon } from './admin-icon';

function active(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function AdminNavigation() {
  const pathname = usePathname();
  const items = [
    { href: '/admin/exercises', label: 'Exercises', icon: 'book' as const },
    { href: '/admin/media', label: 'Media', icon: 'media' as const },
  ];
  return (
    <nav className="side-nav" aria-label="Admin navigation">
      <p className="side-nav__label">CONTENT OPERATIONS</p>
      <span className="side-nav__item side-nav__item--disabled">
        <AdminIcon name="grid" />
        <span>Overview</span>
        <small>Soon</small>
      </span>
      {items.map((item) => {
        const current = active(pathname, item.href);
        return (
          <Link
            className={`side-nav__item${current ? ' side-nav__item--active' : ''}`}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            key={item.href}
          >
            <AdminIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <span className="side-nav__item side-nav__item--disabled">
        <AdminIcon name="review" />
        <span>Review queue</span>
        <small>Soon</small>
      </span>
    </nav>
  );
}

export function AdminMobileNavigation() {
  const pathname = usePathname();
  const items = [
    { href: '/admin/exercises', label: 'Exercises', icon: 'book' as const },
    { href: '/admin/media', label: 'Media', icon: 'media' as const },
  ];
  return (
    <nav className="mobile-module-nav" aria-label="Admin module navigation">
      {items.map((item) => {
        const current = active(pathname, item.href);
        return (
          <Link
            className={current ? 'mobile-module-nav__item--active' : undefined}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            key={item.href}
          >
            <AdminIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
