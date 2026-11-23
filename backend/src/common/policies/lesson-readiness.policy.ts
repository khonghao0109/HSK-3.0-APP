import { Prisma } from '@prisma/client';

export const PUBLIC_CONTENT_WHERE = {
  status: 'published' as const,
  deletedAt: null,
};

/** Lesson words a learner sees: the word is published and not soft-deleted. */
export const PUBLIC_LESSON_WORD_WHERE = {
  word: { is: PUBLIC_CONTENT_WHERE },
} satisfies Prisma.LessonWordWhereInput;

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

/**
 * ADR-009 C3b-1: a lesson's parent is public when it has a public Level, or
 * when it has no Level and its unit and the unit's course are public. The
 * `Lesson_level_or_unit_check` constraint rules out a lesson with neither.
 */
const LESSON_PUBLIC_PARENT_WHERE = {
  OR: [
    { levelId: { not: null }, level: { is: PUBLIC_CONTENT_WHERE } },
    {
      levelId: null,
      courseUnit: {
        is: { ...PUBLIC_CONTENT_WHERE, course: { is: PUBLIC_CONTENT_WHERE } },
      },
    },
  ],
} satisfies Prisma.LessonWhereInput;

/**
 * Readiness for course routes: lessons with or without a Level. Routes that
 * predate courses keep `buildLessonReadyWhere`, which requires a public
 * Level and so never returns a lesson without one.
 */
export function buildAnyLessonReadyWhere(
  additional: Prisma.LessonWhereInput = {},
): {
  AND: [
    Prisma.LessonWhereInput,
    Prisma.LessonWhereInput,
    Prisma.LessonWhereInput,
  ];
} {
  return {
    AND: [
      additional,
      { ...PUBLIC_CONTENT_WHERE, ...LESSON_INSTRUCTIONAL_BLOCK_WHERE },
      LESSON_PUBLIC_PARENT_WHERE,
    ],
  };
}
