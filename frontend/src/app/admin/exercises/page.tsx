import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ExerciseFilters } from '@/features/exercises/exercise-filters';
import { parseExerciseQuery } from '@/features/exercises/exercise-query';
import { loadExercises } from '@/features/exercises/exercise-service';
import { ExerciseTable } from '@/features/exercises/exercise-table';
import { Pagination } from '@/features/exercises/pagination';
import { BackendRequestError } from '@/lib/api/api-error';

export const metadata: Metadata = { title: 'Exercises' };

export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseExerciseQuery(await searchParams);
  let result;
  try {
    result = await loadExercises(query);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirect('/api/session/logout');
    throw error;
  }
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">CONTENT REPOSITORY</p>
          <h1>Exercises</h1>
          <p>
            Inspect canonical lesson activities, publication state and source
            lineage.
          </p>
        </div>
        <div className="read-only-chip">
          <span aria-hidden="true">◇</span>
          <span>
            <strong>Read-only V1</strong>
            <small>Protected admin data</small>
          </span>
        </div>
      </header>
      <ExerciseFilters query={query} />
      <section
        className="content-panel"
        aria-labelledby="exercise-results-heading"
      >
        <div className="content-panel__header">
          <div>
            <p className="eyebrow">CURRENT VIEW</p>
            <h2 id="exercise-results-heading">Exercise inventory</h2>
          </div>
          <p className="record-count mono">
            {result.meta.total.toLocaleString('en')} TOTAL
          </p>
        </div>
        <ExerciseTable exercises={result.data} />
        <Pagination
          query={query}
          total={result.meta.total}
          totalPages={result.meta.totalPages}
        />
      </section>
    </div>
  );
}
