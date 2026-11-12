// Zod-free view model of /learn/review (M3.3b, Q270); the BFF shape is
// `reviewOverviewEnvelopeSchema` in review-contract.ts (server only).

export type ReviewOverview = {
  dueToday: number;
  upcoming: { days3: number; days7: number; days14: number };
  retention7d: number | null;
  calendar: { date: string; reviewed: number }[];
  recentSessions: {
    sessionId: number;
    completedAt: string;
    reviewedCount: number;
    retentionPercent: number | null;
  }[];
};

export type CalendarCell =
  | { day: number; out: true }
  | { day: number; out: false; date: string; reviewed: number; level: number };

/** Mockup legend: 1–10, 11–20, 21–30, 31–40, trên 40 thẻ. */
const LEVEL_LABELS = ['', '1–10', '11–20', '21–30', '31–40', 'trên 40'];

export function calendarLevel(reviewed: number): number {
  return reviewed <= 0 ? 0 : Math.min(5, Math.ceil(reviewed / 10));
}

const dayOf = (date: string) => Number(date.slice(8, 10));

/** Monday-first weeks of the month, padded with the neighbour months' days. */
export function calendarWeeks(
  calendar: ReviewOverview['calendar'],
): CalendarCell[][] {
  const first = calendar[0]?.date;
  if (!first) return [];
  const year = Number(first.slice(0, 4));
  const month = Number(first.slice(5, 7));
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const prevDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  for (let i = lead; i > 0; i -= 1) {
    cells.push({ day: prevDays - i + 1, out: true });
  }
  for (const entry of calendar) {
    cells.push({
      day: dayOf(entry.date),
      out: false,
      date: entry.date,
      reviewed: entry.reviewed,
      level: calendarLevel(entry.reviewed),
    });
  }
  for (let next = 1; cells.length % 7 !== 0; next += 1) {
    cells.push({ day: next, out: true });
  }
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function monthLabel(date: string): string {
  return `Tháng ${String(Number(date.slice(5, 7)))}, ${date.slice(0, 4)}`;
}

export function dayLabel(day: number, month: number, reviewed: number): string {
  const level = calendarLevel(reviewed);
  return `${String(day)} tháng ${String(month)}: ${
    level === 0 ? 'không ôn' : `ôn ${LEVEL_LABELS[level] ?? ''} thẻ`
  }`;
}

/** `dd/mm/yyyy` of an instant; `timeZone` defaults to the browser's. */
export function sessionDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}
