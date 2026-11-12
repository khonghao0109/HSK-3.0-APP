'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function TabIcon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** Learner tab bar (Q1). Ôn tập links to /learn/review since M3.3b (Q271). */
export function LearnerTabBar() {
  const pathname = usePathname();
  const onHome = pathname === '/learn';
  const onPath =
    pathname === '/learn/path' || pathname.startsWith('/learn/lessons/');
  const onDictionary =
    pathname === '/learn/dictionary' ||
    pathname.startsWith('/learn/dictionary/');
  const onProfile = pathname === '/learn/profile';
  // M3.3b (Q271): the review page and its session.
  const onReview =
    pathname === '/learn/review' || pathname.startsWith('/learn/review/');

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
      <Link
        href="/learn/dictionary"
        aria-current={onDictionary ? 'page' : undefined}
      >
        <TabIcon name="search" />
        Tra từ
      </Link>
      <Link href="/learn/review" aria-current={onReview ? 'page' : undefined}>
        <TabIcon name="layers" />
        Ôn tập
      </Link>
      <Link href="/learn/profile" aria-current={onProfile ? 'page' : undefined}>
        <TabIcon name="user" />
        Hồ sơ
      </Link>
    </nav>
  );
}
