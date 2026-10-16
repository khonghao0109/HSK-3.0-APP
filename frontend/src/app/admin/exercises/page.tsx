import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ExerciseFilters } from '@/features/exercises/exercise-filters';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { parseExerciseQuery } from '@/features/exercises/exercise-query';
import { loadExercises } from '@/features/exercises/exercise-service';
import { ExerciseTable } from '@/features/exercises/exercise-table';
import { Pagination } from '@/features/exercises/pagination';
import { BackendRequestError } from '@/lib/api/api-error';

import '../admin-exercises.css';

export const metadata: Metadata = { title: 'Bài tập' };

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
      redirectToSessionLogin();
    // Layouts do not re-render on client navigation, so the admin layout's
    // role check can be stale; the backend's per-request 403 is authoritative.
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    throw error;
  }
  return (
    <div className="adm-page-stack">
      <header className="adm-page-head">
        <div>
          <h1>Bài tập</h1>
          <p>Xem kho bài tập, trạng thái xuất bản và nguồn gốc nội dung.</p>
        </div>
      </header>
      <ExerciseFilters query={query} />
      <div className="adm-card adm-card--clip">
        <ExerciseTable exercises={result.data} />
        <Pagination
          query={query}
          total={result.meta.total}
          totalPages={result.meta.totalPages}
        />
      </div>
    </div>
  );
}
