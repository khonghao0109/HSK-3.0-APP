import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getLessonPlayerActivity } from '@/features/learner-lesson/lesson-activity-service';
import { loadLearnerLesson } from '@/features/learner-lesson/lesson-page-loader';
import { LessonPlayer } from '@/features/learner-lesson/lesson-player';
import {
  firstPendingIndex,
  orderPlayerExercises,
} from '@/features/learner-lesson/lesson-player-model';

export const metadata: Metadata = {
  title: 'Luyện tập',
};

/**
 * Activity player (M2.5b, Q45–Q50). A locked lesson never opens it: the
 * learner goes back to the lesson page, which shows why (Q40, Q44).
 */
export default async function LessonPracticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { lessonId, data } = await loadLearnerLesson(
    (await params).id,
    getLessonPlayerActivity,
  );
  if (data.state === 'locked') redirect(`/learn/lessons/${lessonId}`);

  const exercises = orderPlayerExercises(data.topics, data.standaloneExercises);
  return (
    <LessonPlayer
      lessonId={lessonId}
      exercises={exercises}
      startIndex={firstPendingIndex(exercises)}
      needsStart={data.progress.status === 'not_started'}
    />
  );
}
