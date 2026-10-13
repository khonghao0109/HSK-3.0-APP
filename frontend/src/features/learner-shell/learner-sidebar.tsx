'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ToastButton } from './learner-toast';
import { TOAST_COMING_SOON } from './learner-toast-messages';

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

function SoonButton({ icon, label }: { icon: string; label: string }) {
  return (
    <ToastButton message={TOAST_COMING_SOON}>
      <Icon name={icon} />
      {label} <span className="w-tag w-tag--soon">Sắp có</span>
    </ToastButton>
  );
}

/** Lesson screens get the `.w-focus` layout in M2.10b; they keep theirs. */
export function isLessonRoute(pathname: string): boolean {
  return pathname.startsWith('/learn/lessons/');
}

/**
 * Web sidebar of the `.w-app` frame from 1024px (Q81, mẫu `web/home.html`).
 * Hidden below 1024px, where the tab bar stays. No sign-out here (Q82). The
 * profile cell shows "Hồ sơ": `/auth/me` returns no name and the layout makes
 * no backend call of its own, and there is no avatar API yet.
 */
export function LearnerSidebar() {
  const pathname = usePathname();
  if (isLessonRoute(pathname)) return null;

  const onHome = pathname === '/learn';
  const onPath = pathname === '/learn/path';
  const onDictionary =
    pathname === '/learn/dictionary' ||
    pathname.startsWith('/learn/dictionary/');
  const onProfile = pathname === '/learn/profile';

  return (
    <aside className="w-side w-only" aria-label="Thanh bên">
      <Link className="w-brand" href="/learn">
        <span className="w-brand__mark" aria-hidden="true">
          汉
        </span>
        <span className="w-brand__name">Hán Lộ</span>
      </Link>
      <nav className="w-nav" aria-label="Điều hướng chính">
        <Link href="/learn" aria-current={onHome ? 'page' : undefined}>
          <Icon name="home" />
          Trang chủ
        </Link>
        <Link href="/learn/path" aria-current={onPath ? 'page' : undefined}>
          <Icon name="book-open" />
          Lộ trình học
        </Link>
        <Link
          href="/learn/dictionary"
          aria-current={onDictionary ? 'page' : undefined}
        >
          <Icon name="search" />
          Tra từ
        </Link>
        <SoonButton icon="layers" label="Ôn tập" />
      </nav>
      <p className="w-side__group" id="w-side-more">
        Luyện thêm
      </p>
      <nav className="w-nav" aria-labelledby="w-side-more">
        <SoonButton icon="trophy" label="Thi thử HSK" />
        <SoonButton icon="mic" label="Phát âm" />
        <SoonButton icon="book-marked" label="Đọc hiểu" />
        <SoonButton icon="sparkles" label="Trợ lý AI" />
      </nav>
      <div className="w-side__spacer" />
      <nav className="w-nav" aria-label="Khác">
        <ToastButton message={TOAST_COMING_SOON}>
          <Icon name="help-circle" />
          Hỗ trợ
        </ToastButton>
      </nav>
      <Link
        className="w-side__me"
        href="/learn/profile"
        aria-current={onProfile ? 'page' : undefined}
      >
        <span className="w-side__avatar" aria-hidden="true">
          <Icon name="user" />
        </span>
        <span className="w-side__who">Hồ sơ</span>
      </Link>
    </aside>
  );
}
