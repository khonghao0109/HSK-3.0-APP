import { Prisma } from '@prisma/client';

/**
 * A word learners may see: published, not soft-deleted, a pure dictionary
 * entry, with at least one meaning. Search, detail and save all read it here.
 */
export const PUBLIC_WORD_WHERE = {
  status: 'published',
  deletedAt: null,
  isPure: true,
  meanings: { some: {} },
} as const satisfies Prisma.WordWhereInput;

/** Levels shown next to a public word. */
export const PUBLIC_WORD_LEVELS = {
  where: { level: { status: 'published', deletedAt: null } },
  include: { level: true },
  orderBy: { level: { orderIndex: 'asc' } },
} as const satisfies Prisma.Word$wordLevelsArgs;
