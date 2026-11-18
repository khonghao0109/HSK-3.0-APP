'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';

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
        <Icon name={onHome ? 'home-fill' : 'home'} />
        Trang chủ
      </Link>
      <Link href="/learn/path" aria-current={onPath ? 'page' : undefined}>
        <Icon name={onPath ? 'book-open-fill' : 'book-open'} />
        Học
      </Link>
      <Link
        href="/learn/dictionary"
        aria-current={onDictionary ? 'page' : undefined}
      >
        <Icon name="search" />
        Tra từ
      </Link>
      <Link href="/learn/review" aria-current={onReview ? 'page' : undefined}>
        <Icon name="layers" />
        Ôn tập
      </Link>
      <Link href="/learn/profile" aria-current={onProfile ? 'page' : undefined}>
        <Icon name="user" />
        Hồ sơ
      </Link>
    </nav>
  );
}
