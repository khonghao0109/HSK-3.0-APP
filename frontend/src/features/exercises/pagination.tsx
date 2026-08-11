import Link from 'next/link';

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
  if (totalPages <= 1)
    return (
      <p className="pagination-summary mono">
        {total} record{total === 1 ? '' : 's'}
      </p>
    );
  return (
    <nav className="pagination" aria-label="Exercise pages">
      <p className="pagination-summary mono">
        Page {query.page} of {totalPages} · {total} records
      </p>
      <div>
        {query.page > 1 ? (
          <Link
            className="page-link"
            href={withExercisePage(query, query.page - 1)}
          >
            ← Previous
          </Link>
        ) : (
          <span className="page-link page-link--disabled">← Previous</span>
        )}
        {query.page < totalPages ? (
          <Link
            className="page-link"
            href={withExercisePage(query, query.page + 1)}
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
