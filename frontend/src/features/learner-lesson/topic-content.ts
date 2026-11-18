/**
 * M2.5f (Q175): blocks of `Topic.content` the learner pages render. Pure and
 * Zod-free so client components may import it. Unknown or malformed blocks are
 * skipped, never rendered raw.
 */

export type TopicBlock =
  { kind: 'text'; value: string } | { kind: 'vocabulary_list' };

export type LessonTopicKind = 'vocabulary' | 'grammar';

/** Topic types each page shows: key_text reads with the grammar page. */
export const TOPIC_TYPES_BY_PAGE: Record<LessonTopicKind, readonly string[]> = {
  vocabulary: ['vocabulary'],
  grammar: ['grammar', 'key_text'],
};

export function topicBlocks(content: unknown): TopicBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: TopicBlock[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const { type, value } = block as { type?: unknown; value?: unknown };
    if (type === 'text' && typeof value === 'string' && value.trim() !== '') {
      blocks.push({ kind: 'text', value: value.trim() });
    } else if (type === 'vocabulary_list' && value === 'lesson_words') {
      blocks.push({ kind: 'vocabulary_list' });
    }
  }
  return blocks;
}

/** Topics of one page, in lesson order. */
export function topicsForPage<T extends { type: string; orderIndex: number }>(
  topics: readonly T[],
  page: LessonTopicKind,
): T[] {
  return topics
    .filter((topic) => TOPIC_TYPES_BY_PAGE[page].includes(topic.type))
    .sort((a, b) => a.orderIndex - b.orderIndex);
}
