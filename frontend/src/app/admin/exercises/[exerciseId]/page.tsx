import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ExerciseDetail } from '@/features/exercises/exercise-detail';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { loadExercise } from '@/features/exercises/exercise-service';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../admin-exercises.css';

export const metadata: Metadata = { title: 'Chi tiết bài tập' };

export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ exerciseId: string }>;
}) {
  const rawId = (await params).exerciseId;
  if (!/^\d+$/.test(rawId)) notFound();
  const exerciseId = Number(rawId);
  let exercise;
  try {
    exercise = await loadExercise(exerciseId);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    // Layouts do not re-render on client navigation, so the admin layout's
    // role check can be stale; the backend's per-request 403 is authoritative.
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    if (error instanceof BackendRequestError && error.status === 404)
      notFound();
    throw error;
  }
  return (
    <div className="adm-page-stack">
      <nav className="adm-breadcrumb" aria-label="Đường dẫn">
        <Link href="/admin/exercises">Bài tập</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">EX-{exercise.id}</span>
      </nav>
      <ExerciseDetail exercise={exercise} canViewAnswer />
    </div>
  );
}
