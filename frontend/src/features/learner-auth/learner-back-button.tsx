'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

export function LearnerBackButton({
  fallbackHref = '/',
  className = 'icon-btn',
  ariaLabel = 'Quay lại',
  icon = 'arrow-left',
  children,
}: {
  fallbackHref?: string;
  className?: string;
  ariaLabel?: string;
  /** Sprite symbol without the `i-` prefix (module 03 bars draw a chevron). */
  icon?: string;
  /** M2.10b: web variants show a label next to the icon (mẫu word.html). */
  children?: ReactNode;
}) {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };

  return (
    <a
      className={className}
      href={fallbackHref}
      onClick={handleClick}
      aria-label={ariaLabel}
    >
      <svg className="icon" aria-hidden="true">
        <use href={`#i-${icon}`} />
      </svg>
      {children}
    </a>
  );
}
