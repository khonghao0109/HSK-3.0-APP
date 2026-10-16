import Link from 'next/link';

import { AdminIcon } from '@/features/admin-shell/admin-icon';

import { withExercisePage, type ExerciseQuery } from './exercise-query';

export function Pagination({
  query,
  total,
  totalPages,
}: {
  query: ExerciseQuery;
  total: number;
  totalPages: number;
}) {
  const from = total > 0 ? (query.page - 1) * query.limit + 1 : 0;
  const to = Math.min(total, query.page * query.limit);
  const hasPrevious = query.page > 1;
  const hasNext = query.page < totalPages;
  return (
    <nav className="adm-pagination" aria-label="Phân trang bài tập">
      <p className="adm-pagination__info" aria-live="polite">
        Hiển thị {from} đến {to} của {total} kết quả
      </p>
      <div className="adm-pagination__pages">
        {hasPrevious ? (
          <Link
            className="adm-page-btn"
            href={withExercisePage(query, query.page - 1)}
          >
            <AdminIcon name="chevron-left" className="adm-icon adm-icon--sm" />
            Trước
          </Link>
        ) : (
          <span
            className="adm-page-btn adm-page-btn--disabled"
            aria-disabled="true"
          >
            <AdminIcon name="chevron-left" className="adm-icon adm-icon--sm" />
            Trước
          </span>
        )}
        {hasNext ? (
          <Link
            className="adm-page-btn"
            href={withExercisePage(query, query.page + 1)}
          >
            Sau
            <AdminIcon name="chevron-right" className="adm-icon adm-icon--sm" />
          </Link>
        ) : (
          <span
            className="adm-page-btn adm-page-btn--disabled"
            aria-disabled="true"
          >
            Sau
            <AdminIcon name="chevron-right" className="adm-icon adm-icon--sm" />
          </span>
        )}
      </div>
    </nav>
  );
}
