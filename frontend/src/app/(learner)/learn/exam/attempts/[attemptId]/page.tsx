import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { getExamAttempt } from '@/features/learner-exam/exam-attempt-service';
import { ExamTake } from '@/features/learner-exam/exam-take';
import { parseLessonId } from '@/features/learner-lesson/lesson-sections';
import { BackendRequestError, isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Làm bài thi',
};

/** TL-144: server page for the exam-taking screen. */
export default async function LearnerExamTakePage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const attemptId = parseLessonId((await params).attemptId);
  if (attemptId === null) notFound();

  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) redirect('/sign-in');

  let attempt;
  try {
    attempt = await getExamAttempt(attemptId, session.token);
  } catch (error: unknown) {
    if (isAuthFailure(error)) redirect('/sign-in');
    if (
      error instanceof BackendRequestError &&
      (error.status === 400 || error.status === 404)
    ) {
      notFound();
    }
    throw error;
  }
  return <ExamTake attempt={attempt} />;
}
