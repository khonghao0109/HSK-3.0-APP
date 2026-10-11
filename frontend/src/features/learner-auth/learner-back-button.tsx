'use client';

import { useRouter } from 'next/navigation';

export function LearnerBackButton({
  fallbackHref = '/',
  className = 'icon-btn',
  ariaLabel = 'Quay lại',
}: {
  fallbackHref?: string;
  className?: string;
  ariaLabel?: string;
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
        <use href="#i-arrow-left" />
      </svg>
    </a>
  );
}
