/** Whole percent in 0..100; anything non-finite reads as 0. */
export function wholePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Static class setting `--value` (`.pct-0` … `.pct-100` in learner.css):
 * inline styles would be blocked by the CSP.
 */
export function percentClass(value: number): string {
  return `pct-${wholePercent(value)}`;
}
