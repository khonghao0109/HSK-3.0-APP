import { Prisma } from '@prisma/client';

import { PUBLIC_WORD_SQL } from './public-word.policy';

/** "Từ liên quan" of the word detail (M3.4b, Q307): mockup shows four rows. */
export const RELATED_WORDS_LIMIT = 4;

export interface RelatedWordCandidate {
  id: number;
  hanzi: string;
  /** Lowest `orderIndex` of a public Level, `null` without one. */
  levelOrder: number | null;
}

/**
 * Ranks candidates by shared characters (desc), level distance to the target,
 * then hanzi length, then id. Drops the target and words sharing nothing.
 */
export function rankRelatedWords(
  target: RelatedWordCandidate,
  candidates: RelatedWordCandidate[],
  limit = RELATED_WORDS_LIMIT,
): number[] {
  const chars = new Set(Array.from(target.hanzi));
  const distance = (order: number | null) =>
    order === null || target.levelOrder === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(order - target.levelOrder);
  return candidates
    .filter((c) => c.id !== target.id)
    .map((c) => ({
      ...c,
      shared: new Set(Array.from(c.hanzi).filter((ch) => chars.has(ch))).size,
      distance: distance(c.levelOrder),
      length: Array.from(c.hanzi).length,
    }))
    .filter((c) => c.shared > 0)
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        (a.distance === b.distance ? 0 : a.distance < b.distance ? -1 : 1) ||
        a.length - b.length ||
        a.id - b.id,
    )
    .slice(0, limit)
    .map((c) => c.id);
}

/**
 * Candidates for `rankRelatedWords`: public words other than `wordId` with a
 * public Level (HSK words only) and at least one character of `hanzi`.
 */
export function relatedCandidatesSql(
  wordId: number,
  hanzi: string,
): Prisma.Sql {
  const chars = [...new Set(Array.from(hanzi))];
  return Prisma.sql`
    SELECT w."id", w."hanzi", min(l."orderIndex")::int AS "levelOrder"
    FROM "WordLevel" wl
    JOIN "Level" l ON l."id" = wl."levelId" AND l."status" = 'published' AND l."deletedAt" IS NULL
    JOIN "Word" w ON w."id" = wl."wordId"
    WHERE ${PUBLIC_WORD_SQL} AND w."id" <> ${wordId}
      AND EXISTS (SELECT 1 FROM unnest(${chars}::text[]) AS c(ch) WHERE strpos(w."hanzi", c.ch) > 0)
    GROUP BY w."id", w."hanzi"`;
}
