import type { Prisma } from '@prisma/client';

import { PUBLIC_WORD_WHERE } from '../../dictionary/public-word.policy';
import { levelCardWhere } from './review-preferences';

/**
 * A card its owner can still review: not suspended, its word passes
 * `PUBLIC_WORD_WHERE` (Q255: the same rule as save and word detail) and the
 * owner still saves the word. `levelCodes` (Q281) narrows it to cards of
 * those public levels; empty keeps every level.
 */
export function activeCardWhere(
  userId: number,
  levelCodes: readonly string[] = [],
): Prisma.ReviewCardWhereInput {
  const where: Prisma.ReviewCardWhereInput = {
    userId,
    state: { not: 'suspended' },
    word: { ...PUBLIC_WORD_WHERE, userWords: { some: { userId } } },
  };
  return levelCodes.length === 0
    ? where
    : { ...where, AND: [levelCardWhere(levelCodes)] };
}

/** M3.2 Q252: an active card is due for its owner when `dueAt <= now`. */
export function dueCardWhere(
  userId: number,
  now: Date,
  levelCodes: readonly string[] = [],
): Prisma.ReviewCardWhereInput {
  return { ...activeCardWhere(userId, levelCodes), dueAt: { lte: now } };
}

export const DUE_CARD_ORDER = [
  { dueAt: 'asc' },
  { id: 'asc' },
] as const satisfies Prisma.ReviewCardOrderByWithRelationInput[];
