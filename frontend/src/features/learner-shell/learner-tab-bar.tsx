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

/** Learner tab bar (Q1). Học, Tra từ, Ôn tập only toast until shipped (Q16, Q22). */
export function LearnerTabBar() {
  const pathname = usePathname();
  const onHome = pathname === '/learn';
  const onProfile = pathname === '/learn/profile';

  return (
    <nav className="tabbar" aria-label="Điều hướng chính">
      <Link href="/learn" aria-current={onHome ? 'page' : undefined}>
        <TabIcon name={onHome ? 'home-fill' : 'home'} />
        Trang chủ
      </Link>
      <ToastButton message={TOAST_COMING_SOON}>
        <TabIcon name="book-open" />
        Học
      </ToastButton>
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
