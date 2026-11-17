import { describe, expect, it } from 'vitest';

import { homeDateLabel } from './home-date';

describe('homeDateLabel', () => {
  it('formats weekday and dd/mm/yyyy in Vietnam time by default', () => {
    expect(homeDateLabel(new Date('2026-11-17T05:00:00Z'))).toBe(
      'Thứ Ba, 17/11/2026',
    );
  });

  it('uses the given timezone across a date boundary', () => {
    const instant = new Date('2026-11-16T20:00:00Z');
    expect(homeDateLabel(instant)).toBe('Thứ Ba, 17/11/2026');
    expect(homeDateLabel(instant, 'UTC')).toBe('Thứ Hai, 16/11/2026');
  });

  it('capitalises Sunday', () => {
    expect(homeDateLabel(new Date('2026-11-15T05:00:00Z'))).toBe(
      'Chủ Nhật, 15/11/2026',
    );
  });
});
