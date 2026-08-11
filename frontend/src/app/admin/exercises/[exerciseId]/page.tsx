import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ExerciseDetail } from '@/features/exercises/exercise-detail';
import { loadExercise } from '@/features/exercises/exercise-service';
import { BackendRequestError } from '@/lib/api/api-error';

export const metadata: Metadata = { title: 'Exercise detail' };

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
      redirect('/api/session/logout');
    if (error instanceof BackendRequestError && error.status === 404)
      notFound();
    throw error;
  }
  return (
    <div className="page-stack">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/admin/exercises">Exercises</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">EX-{exercise.id}</span>
      </nav>
      <ExerciseDetail exercise={exercise} canViewAnswer />
    </div>
  );
}
