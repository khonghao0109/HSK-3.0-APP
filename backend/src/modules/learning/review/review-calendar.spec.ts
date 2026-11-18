import {
  addLocalDays,
  localDateOf,
  localMidnight,
  monthDates,
} from './review-calendar';

const HCM = 'Asia/Ho_Chi_Minh';

describe('review calendar (M3.3b, Q268)', () => {
  it('reads the local date at the start and end of a local day', () => {
    // 00:00 and 23:59:59.999 on 12/11 in Hồ Chí Minh (UTC+7).
    expect(localDateOf(new Date('2026-11-11T17:00:00.000Z'), HCM)).toBe(
      '2026-11-12',
    );
    expect(localDateOf(new Date('2026-11-12T16:59:59.999Z'), HCM)).toBe(
      '2026-11-12',
    );
    expect(localDateOf(new Date('2026-11-12T17:00:00.000Z'), HCM)).toBe(
      '2026-11-13',
    );
    expect(localDateOf(new Date('2026-11-11T16:59:59.999Z'), HCM)).toBe(
      '2026-11-11',
    );
  });

  it('converts local midnight to the UTC instant', () => {
    expect(localMidnight('2026-11-12', HCM).toISOString()).toBe(
      '2026-11-11T17:00:00.000Z',
    );
    expect(localMidnight('2026-11-12', 'UTC').toISOString()).toBe(
      '2026-11-12T00:00:00.000Z',
    );
  });

  it('keeps the real day length across a DST change', () => {
    // America/New_York leaves DST on 2026-11-01 at 02:00 local.
    const tz = 'America/New_York';
    expect(localMidnight('2026-11-01', tz).toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    );
    expect(localMidnight('2026-11-02', tz).toISOString()).toBe(
      '2026-11-02T05:00:00.000Z',
    );
  });

  it('adds days across a month and a year end', () => {
    expect(addLocalDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addLocalDays('2026-11-12', 14)).toBe('2026-11-26');
  });

  it('lists every date of the month of a local date', () => {
    const november = monthDates('2026-11-12');
    expect(november).toHaveLength(30);
    expect(november[0]).toBe('2026-11-01');
    expect(november[29]).toBe('2026-11-30');
    expect(monthDates('2028-02-03')).toHaveLength(29);
  });
});
