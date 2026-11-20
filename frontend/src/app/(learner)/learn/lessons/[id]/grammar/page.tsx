import type { Metadata } from 'next';

import { LessonTopicsView } from '@/features/learner-lesson/lesson-topics-view';
import { TopicUnitView } from '@/features/learner-lesson/topic-unit-view';

export const metadata: Metadata = {
  title: 'Ngữ pháp',
};

/**
 * M2.5f (Q175): the lesson's Ngữ pháp topics. Pha D: with `?unit=<topicId>`
 * it is that Ngữ pháp or Bài khoá unit's own screen instead.
 */
export default async function LessonGrammarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ unit?: string | string[] }>;
}) {
  const { id } = await params;
  const unit = (await searchParams)?.unit;
  if (typeof unit === 'string') {
    return TopicUnitView({ rawId: id, rawUnit: unit });
  }
  return LessonTopicsView({ rawId: id, page: 'grammar' });
}
