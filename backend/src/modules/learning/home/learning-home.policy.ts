/** Most recent run of consecutive local learning days, days as `YYYY-MM-DD`. */
export type LearningDayRun = {
  lastDay: string;
  runLength: number;
};

function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * Q13 streak: the most recent run still counts while its last day is today
 * or yesterday (the learner has not studied yet today); otherwise it broke.
 */
export function countStreak(
  run: LearningDayRun | null,
  todayLocal: string,
): number {
  if (run === null) return 0;
  if (run.lastDay === todayLocal || run.lastDay === previousDay(todayLocal)) {
    return run.runLength;
  }
  return 0;
}
