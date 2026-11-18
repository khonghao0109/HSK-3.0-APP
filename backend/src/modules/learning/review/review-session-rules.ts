import type { SrsGrade } from '../srs';

/** Q253: an `in_progress` session idles out 24 hours after its last activity. */
export const REVIEW_SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000;

/** `lastActivityAt` = the session's last grade, or its start without one. */
export function sessionExpiresAt(lastActivityAt: Date): Date {
  return new Date(lastActivityAt.getTime() + REVIEW_SESSION_IDLE_TTL_MS);
}

export function isSessionExpired(lastActivityAt: Date, now: Date): boolean {
  return now.getTime() >= sessionExpiresAt(lastActivityAt).getTime();
}

export interface ReviewSessionSummary {
  again: number;
  hard: number;
  good: number;
  easy: number;
  remembered: number;
  forgot: number;
  retentionPercent: number | null;
  totalDurationMs: number;
}

/** Q254: the `complete` summary, counted from the session's events. */
export function buildSessionSummary(
  events: ReadonlyArray<{ grade: SrsGrade; durationMs: number | null }>,
): ReviewSessionSummary {
  const counts: Record<SrsGrade, number> = {
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  };
  let totalDurationMs = 0;
  for (const event of events) {
    counts[event.grade] += 1;
    totalDurationMs += event.durationMs ?? 0;
  }
  const forgot = counts.again;
  const remembered = events.length - forgot;
  return {
    ...counts,
    remembered,
    forgot,
    retentionPercent:
      events.length === 0
        ? null
        : Math.round((remembered / events.length) * 100),
    totalDurationMs,
  };
}
