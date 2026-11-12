import type { Prisma } from '@prisma/client';

import { PUBLIC_WORD_WHERE } from '../../dictionary/public-word.policy';

/**
 * A card its owner can still review: not suspended, its word passes
 * `PUBLIC_WORD_WHERE` (Q255: the same rule as save and word detail) and the
 * owner still saves the word.
 */
export function activeCardWhere(userId: number): Prisma.ReviewCardWhereInput {
  return {
    userId,
    state: { not: 'suspended' },
    word: { ...PUBLIC_WORD_WHERE, userWords: { some: { userId } } },
  };
}

/** M3.2 Q252: an active card is due for its owner when `dueAt <= now`. */
export function dueCardWhere(
  userId: number,
  now: Date,
): Prisma.ReviewCardWhereInput {
  return { ...activeCardWhere(userId), dueAt: { lte: now } };
}

export const DUE_CARD_ORDER = [
  { dueAt: 'asc' },
  { id: 'asc' },
] as const satisfies Prisma.ReviewCardOrderByWithRelationInput[];
