/** M3.3b (Q268): due windows counted from tomorrow, cumulative. */
export class ReviewUpcomingDto {
  days3!: number;
  days7!: number;
  days14!: number;
}

export class ReviewCalendarDayDto {
  /** Local date `YYYY-MM-DD` in the learner's timezone. */
  date!: string;
  /** Review events of the caller on that local day. */
  reviewed!: number;
}

export class ReviewRecentSessionDto {
  sessionId!: number;
  completedAt!: Date;
  reviewedCount!: number;
  /** The session summary's retention; null when it had no reviews. */
  retentionPercent!: number | null;
}

export class ReviewOverviewResponseDto {
  /** Active cards due up to the end of today, overdue included. */
  dueToday!: number;
  upcoming!: ReviewUpcomingDto;
  /** round(non-`again` events / events × 100) over 7 × 24 h; null without events. */
  retention7d!: number | null;
  /** Every day of the current local month, in order. */
  calendar!: ReviewCalendarDayDto[];
  /** Up to 5 completed sessions of the last 30 days, newest first. */
  recentSessions!: ReviewRecentSessionDto[];
}
