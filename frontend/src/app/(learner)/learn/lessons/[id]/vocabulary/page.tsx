import type { Metadata } from 'next';

import { LessonTopicsView } from '@/features/learner-lesson/lesson-topics-view';
import { VocabularyUnitView } from '@/features/learner-lesson/vocabulary-unit-view';

export const metadata: Metadata = {
  title: 'Từ vựng',
};

/**
 * M2.5f (Q175): the lesson's Từ vựng topics. N3 (PO 20/11/2026): with
 * `?unit=<topicId>` it is that unit's step flow instead.
 */
export default async function LessonVocabularyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ unit?: string | string[] }>;
}) {
  const { id } = await params;
  const unit = (await searchParams)?.unit;
  if (typeof unit === 'string') {
    return VocabularyUnitView({ rawId: id, rawUnit: unit });
  }
  return LessonTopicsView({ rawId: id, page: 'vocabulary' });
}
