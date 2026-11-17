import type { Metadata } from 'next';

import { LessonTopicsView } from '@/features/learner-lesson/lesson-topics-view';

export const metadata: Metadata = {
  title: 'Từ vựng',
};

/** M2.5f (Q175): the lesson's Từ vựng topics. */
export default async function LessonVocabularyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return LessonTopicsView({ rawId: (await params).id, page: 'vocabulary' });
}
