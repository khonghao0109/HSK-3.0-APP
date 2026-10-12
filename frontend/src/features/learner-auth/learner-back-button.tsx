'use client';

import { useRouter } from 'next/navigation';

export function LearnerBackButton({
  fallbackHref = '/',
  className = 'icon-btn',
  ariaLabel = 'Quay lại',
  icon = 'arrow-left',
}: {
  fallbackHref?: string;
  className?: string;
  ariaLabel?: string;
  /** Sprite symbol without the `i-` prefix (module 03 bars draw a chevron). */
  icon?: string;
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
    </a>
  );
}
