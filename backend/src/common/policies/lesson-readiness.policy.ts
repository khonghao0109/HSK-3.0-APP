import { Prisma } from '@prisma/client';

export const PUBLIC_CONTENT_WHERE = {
  status: 'published' as const,
  deletedAt: null,
};

export const LESSON_INSTRUCTIONAL_BLOCK_WHERE = {
  OR: [
    { topics: { some: PUBLIC_CONTENT_WHERE } },
    { stories: { some: PUBLIC_CONTENT_WHERE } },
  ],
} satisfies Prisma.LessonWhereInput;

export function buildLessonReadyWhere(
  additional: Prisma.LessonWhereInput = {},
): Prisma.LessonWhereInput {
  return {
    ...additional,
    ...PUBLIC_CONTENT_WHERE,
    level: { is: PUBLIC_CONTENT_WHERE },
    ...LESSON_INSTRUCTIONAL_BLOCK_WHERE,
  };
}

export type LessonReadinessState = {
  status: string;
  deletedAt: Date | null;
  levelStatus: string;
  levelDeletedAt: Date | null;
  publishedTopicCount: number;
  publishedStoryCount: number;
};

export function isLessonReady(state: LessonReadinessState): boolean {
  return (
    state.status === 'published' &&
    state.deletedAt === null &&
    state.levelStatus === 'published' &&
    state.levelDeletedAt === null &&
    state.publishedTopicCount + state.publishedStoryCount > 0
  );
}
