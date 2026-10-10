'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ToastButton } from './learner-toast';
import { TOAST_COMING_SOON } from './learner-toast-messages';

function TabIcon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** Learner tab bar (Q1). Tra từ and Ôn tập only toast until shipped (Q16). */
export function LearnerTabBar() {
  const pathname = usePathname();
  const onHome = pathname === '/learn';
  const onPath = pathname === '/learn/path';
  const onProfile = pathname === '/learn/profile';

  return (
    <nav className="tabbar" aria-label="Điều hướng chính">
      <Link href="/learn" aria-current={onHome ? 'page' : undefined}>
        <TabIcon name={onHome ? 'home-fill' : 'home'} />
        Trang chủ
      </Link>
      <Link href="/learn/path" aria-current={onPath ? 'page' : undefined}>
        <TabIcon name={onPath ? 'book-open-fill' : 'book-open'} />
        Học
      </Link>
      <ToastButton message={TOAST_COMING_SOON}>
        <TabIcon name="search" />
        Tra từ
      </ToastButton>
      <ToastButton message={TOAST_COMING_SOON}>
        <TabIcon name="layers" />
        Ôn tập
      </ToastButton>
      <Link href="/learn/profile" aria-current={onProfile ? 'page' : undefined}>
        <TabIcon name="user" />
        Hồ sơ
      </Link>
    </nav>
  );
}
