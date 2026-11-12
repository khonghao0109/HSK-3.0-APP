import type { Prisma } from '@prisma/client';

import { PUBLIC_CONTENT_WHERE } from '../../../common/policies/lesson-readiness.policy';

/**
 * M3.2 Q252: a card is due for its owner when `dueAt <= now`, it is not
 * suspended, its word is still public and the owner still saves the word.
 */
export function dueCardWhere(
  userId: number,
  now: Date,
): Prisma.ReviewCardWhereInput {
  return {
    userId,
    dueAt: { lte: now },
    state: { not: 'suspended' },
    word: { ...PUBLIC_CONTENT_WHERE, userWords: { some: { userId } } },
  };
}

export const DUE_CARD_ORDER = [
  { dueAt: 'asc' },
  { id: 'asc' },
] as const satisfies Prisma.ReviewCardOrderByWithRelationInput[];
