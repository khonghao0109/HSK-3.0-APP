/**
 * TL-187: one shared parser for the learner exam URL ids. Route handlers and
 * server pages must agree on what a valid id is, so the attempt/review pages no
 * longer borrow the lesson parser for an exam attempt.
 */
const POSITIVE_SAFE_INTEGER = /^[1-9]\d*$/u;
const POSTGRES_INT_MAX = 2_147_483_647;

/** `3` → 3; `0`, `03`, `3x`, `999999999999` → null. */
export function parseAttemptId(raw: string): number | null {
  if (!POSITIVE_SAFE_INTEGER.test(raw)) return null;
  const id = Number(raw);
  return id <= POSTGRES_INT_MAX ? id : null;
}
