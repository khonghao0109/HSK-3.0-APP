import type { Metadata } from 'next';

import { LessonTopicsView } from '@/features/learner-lesson/lesson-topics-view';

export const metadata: Metadata = {
  title: 'Ngữ pháp',
};

/** M2.5f (Q175): the lesson's Ngữ pháp topics. */
export default async function LessonGrammarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return LessonTopicsView({ rawId: (await params).id, page: 'grammar' });
}
