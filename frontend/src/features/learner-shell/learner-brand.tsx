import Link from 'next/link';

/**
 * Brand mark of the learner web frames (`.w-brand` in
 * `docs/ui_reference/web/css/web.css`): the 汉 tile plus "Hán Lộ". It is the
 * same mark the sidebar has always rendered (`LearnerSidebar`), lifted out so
 * the public navigation (M2.10c) and the footer reuse one copy instead of
 * drifting apart. Below 1024px `.w-brand` has no rule of its own — the public
 * frame generates no box there.
 */
export function LearnerBrand({
  href,
  className,
}: {
  href: string;
  className?: string;
}) {
  return (
    <Link
      className={className ? `w-brand ${className}` : 'w-brand'}
      href={href}
    >
      <span className="w-brand__mark" aria-hidden="true">
        汉
      </span>
      <span className="w-brand__name">Hán Lộ</span>
    </Link>
  );
}
