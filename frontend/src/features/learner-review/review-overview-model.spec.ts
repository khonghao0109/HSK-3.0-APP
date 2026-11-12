import { describe, expect, it } from 'vitest';

import {
  calendarLevel,
  calendarWeeks,
  dayLabel,
  monthLabel,
  sessionDate,
} from './review-overview-model';

const days = (month: string, count: number, reviewed: (d: number) => number) =>
  Array.from({ length: count }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, '0')}`,
    reviewed: reviewed(i + 1),
  }));

describe('review overview model (M3.3b, Q270)', () => {
  it('buckets a day count like the mockup legend', () => {
    expect(
      [0, 1, 10, 11, 20, 21, 30, 31, 40, 41, 300].map(calendarLevel),
    ).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('lays out a month in Monday-first weeks with neighbour days', () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const weeks = calendarWeeks(
      days('2026-11', 30, (d) => (d === 12 ? 15 : 0)),
    );
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]?.slice(0, 7).map((cell) => [cell.day, cell.out])).toEqual([
      [26, true],
      [27, true],
      [28, true],
      [29, true],
      [30, true],
      [31, true],
      [1, false],
    ]);
    expect(weeks[5]?.map((cell) => cell.day)).toEqual([30, 1, 2, 3, 4, 5, 6]);
    expect(weeks[5]?.[0]?.out).toBe(false);
    expect(weeks[5]?.[1]?.out).toBe(true);
    const twelfth = weeks.flat().find((cell) => !cell.out && cell.day === 12);
    expect(twelfth).toMatchObject({ level: 2, reviewed: 15 });
  });

  it('starts on Monday without leading days when the 1st is a Monday', () => {
    // June 2026 starts on a Monday.
    const weeks = calendarWeeks(days('2026-06', 30, () => 0));
    expect(weeks[0]?.[0]).toMatchObject({ day: 1, out: false });
    expect(weeks).toHaveLength(5);
  });

  it('names the month, a day and a session date in Vietnamese', () => {
    expect(monthLabel('2026-11-01')).toBe('Tháng 11, 2026');
    expect(dayLabel(12, 11, 0)).toBe('12 tháng 11: không ôn');
    expect(dayLabel(12, 11, 15)).toBe('12 tháng 11: ôn 11–20 thẻ');
    expect(dayLabel(3, 11, 99)).toBe('3 tháng 11: ôn trên 40 thẻ');
    expect(sessionDate('2026-11-12T08:12:00.000Z', 'Asia/Ho_Chi_Minh')).toBe(
      '12/11/2026',
    );
    expect(sessionDate('2026-11-12T20:00:00.000Z', 'Asia/Ho_Chi_Minh')).toBe(
      '13/11/2026',
    );
  });
});
