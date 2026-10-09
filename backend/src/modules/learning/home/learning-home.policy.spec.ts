import { countStreak } from './learning-home.policy';

describe('countStreak', () => {
  const today = '2026-10-07';

  it('[H1] returns 0 without a learning day', () => {
    expect(countStreak(null, today)).toBe(0);
  });

  it('[H2] keeps a run that ends today', () => {
    expect(countStreak({ lastDay: '2026-10-07', runLength: 3 }, today)).toBe(3);
  });

  it('[H3] keeps a run that ended yesterday', () => {
    expect(countStreak({ lastDay: '2026-10-06', runLength: 2 }, today)).toBe(2);
  });

  it('[H4] drops a run that ended the day before yesterday', () => {
    expect(countStreak({ lastDay: '2026-10-05', runLength: 5 }, today)).toBe(0);
  });

  it('[H5] treats the last day of February as yesterday on 1 March', () => {
    expect(
      countStreak({ lastDay: '2026-02-28', runLength: 4 }, '2026-03-01'),
    ).toBe(4);
  });

  it('[H6] treats 31 December as yesterday on 1 January', () => {
    expect(
      countStreak({ lastDay: '2025-12-31', runLength: 6 }, '2026-01-01'),
    ).toBe(6);
  });
});
