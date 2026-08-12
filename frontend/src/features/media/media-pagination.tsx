import Link from 'next/link';

import { withMediaPage, type MediaQuery } from './media-query';

export function MediaPagination({
  query,
  total,
  totalPages,
}: {
  query: MediaQuery;
  total: number;
  totalPages: number;
}) {
  if (totalPages <= 1)
    return (
      <p className="pagination-summary mono">
        {total} asset{total === 1 ? '' : 's'}
      </p>
    );
  return (
    <nav className="pagination" aria-label="Media pages">
      <p className="pagination-summary mono">
        Page {query.page} of {totalPages} · {total} assets
      </p>
      <div>
        {query.page > 1 ? (
          <Link
            className="page-link"
            href={withMediaPage(query, query.page - 1)}
          >
            ← Previous
          </Link>
        ) : (
          <span className="page-link page-link--disabled">← Previous</span>
        )}
        {query.page < totalPages ? (
          <Link
            className="page-link"
            href={withMediaPage(query, query.page + 1)}
          >
            Next →
          </Link>
        ) : (
          <span className="page-link page-link--disabled">Next →</span>
        )}
      </div>
    </nav>
  );
}
