import Link from 'next/link';

import { AdminIcon } from '@/features/admin-shell/admin-icon';
import { ADMIN_ACTION } from '@/features/admin-shell/admin-labels';

/** Phân trang media; `pageHref` dựng link giữ bộ lọc của từng trang. */
export function MediaPagination({
  query,
  total,
  totalPages,
  pageHref,
  label = 'Phân trang media',
}: {
  query: { page: number; limit: number };
  total: number;
  totalPages: number;
  pageHref: (page: number) => string;
  label?: string;
}) {
  const from = total === 0 ? 0 : (query.page - 1) * query.limit + 1;
  const to = Math.min(query.page * query.limit, total);
  // V1: an overflow page has no rows; the list's own message links back.
  if (from > total) return null;
  return (
    <nav className="adm-pagination" aria-label={label}>
      <p className="adm-pagination__info" aria-live="polite">
        Hiển thị {from} đến {to} của {total} kết quả
      </p>
      <div className="adm-pagination__pages">
        {query.page > 1 ? (
          <Link className="adm-page-btn" href={pageHref(query.page - 1)}>
            <AdminIcon name="chevron-left" className="adm-icon adm-icon--sm" />
            {ADMIN_ACTION.previous}
          </Link>
        ) : (
          <span
            className="adm-page-btn adm-page-btn--disabled"
            aria-disabled="true"
          >
            <AdminIcon name="chevron-left" className="adm-icon adm-icon--sm" />
            {ADMIN_ACTION.previous}
          </span>
        )}
        {query.page < totalPages ? (
          <Link className="adm-page-btn" href={pageHref(query.page + 1)}>
            {ADMIN_ACTION.next}
            <AdminIcon name="chevron-right" className="adm-icon adm-icon--sm" />
          </Link>
        ) : (
          <span
            className="adm-page-btn adm-page-btn--disabled"
            aria-disabled="true"
          >
            {ADMIN_ACTION.next}
            <AdminIcon name="chevron-right" className="adm-icon adm-icon--sm" />
          </span>
        )}
      </div>
    </nav>
  );
}
