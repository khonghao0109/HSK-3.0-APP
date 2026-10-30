import Link from 'next/link';

import { AdminIcon } from '@/features/admin-shell/admin-icon';

import { withQuestionPage, type QuestionQuery } from './question-query';

/** Phân trang theo pattern `features/exercises/pagination.tsx` (TL-89). */
export function QuestionPagination({
  query,
  total,
  totalPages,
}: {
  query: QuestionQuery;
  total: number;
  totalPages: number;
}) {
  const from = total > 0 ? (query.page - 1) * query.limit + 1 : 0;
  const to = Math.min(total, query.page * query.limit);
  const hasPrevious = query.page > 1;
  const hasNext = query.page < totalPages;
  return (
    <nav className="adm-pagination" aria-label="Phân trang câu hỏi">
      <p className="adm-pagination__info" aria-live="polite">
        Hiển thị {from} đến {to} của {total} kết quả
      </p>
      <div className="adm-pagination__pages">
        {hasPrevious ? (
          <Link
            className="adm-page-btn"
            href={withQuestionPage(query, query.page - 1)}
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
            href={withQuestionPage(query, query.page + 1)}
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
