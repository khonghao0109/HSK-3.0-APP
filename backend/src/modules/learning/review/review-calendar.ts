/**
 * M3.3b (Q268): calendar days in the learner's timezone, pure and Intl only.
 * A local date is `YYYY-MM-DD`; day arithmetic happens on the date, and only
 * `localMidnight` turns one into an instant, so a DST day keeps its length.
 */

function formatter(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

function wallClockMs(instant: Date, tz: string): number {
  const parts: Record<string, string> = {};
  for (const part of formatter(tz).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    instant.getUTCMilliseconds(),
  );
}

/** The local calendar date of `instant` in `tz`. */
export function localDateOf(instant: Date, tz: string): string {
  return new Date(wallClockMs(instant, tz)).toISOString().slice(0, 10);
}

/** The instant of 00:00 local time on `date` in `tz`. */
export function localMidnight(date: string, tz: string): Date {
  const wall = Date.parse(`${date}T00:00:00.000Z`);
  let guess = wall;
  // Two passes settle the offset, also when midnight sits next to a DST change.
  for (let pass = 0; pass < 2; pass += 1) {
    guess = wall - (wallClockMs(new Date(guess), tz) - guess);
  }
  return new Date(guess);
}

export function addLocalDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every date of the month that contains `date`, in order. */
export function monthDates(date: string): string[] {
  const dates: string[] = [];
  for (let day = `${date.slice(0, 7)}-01`; day.startsWith(date.slice(0, 7)); ) {
    dates.push(day);
    day = addLocalDays(day, 1);
  }
  return dates;
}
