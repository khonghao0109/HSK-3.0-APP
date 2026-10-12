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

/**
 * `PUBLIC_WORD_WHERE` for raw SQL over `"Word" w`: the same four conditions.
 * Keep both in step (public-word.policy.spec.ts checks them together).
 */
export const PUBLIC_WORD_SQL = Prisma.sql`w."status" = 'published' AND w."deletedAt" IS NULL AND w."isPure" = true AND EXISTS (SELECT 1 FROM "WordMeaning" pm WHERE pm."wordId" = w."id")`;

/**
 * Lowest `orderIndex` of a public Level of `"Word" w` (NULL without one): the
 * same filter as `PUBLIC_WORD_LEVELS` and the `orderIndex asc` it picks `level` by.
 */
export const MIN_PUBLIC_LEVEL_ORDER_SQL = Prisma.sql`(SELECT min(l."orderIndex") FROM "WordLevel" wl JOIN "Level" l ON l."id" = wl."levelId" WHERE wl."wordId" = w."id" AND l."status" = 'published' AND l."deletedAt" IS NULL)`;

/** Levels shown next to a public word. */
export const PUBLIC_WORD_LEVELS = {
  where: { level: { status: 'published', deletedAt: null } },
  include: { level: true },
  orderBy: { level: { orderIndex: 'asc' } },
} as const satisfies Prisma.Word$wordLevelsArgs;
