import { buildReviewPreview } from './review-preview';

const NOW = new Date('2026-01-15T00:00:00.000Z');
const MIN = 60_000;
const DAY = 86_400_000;

describe('buildReviewPreview', () => {
  it('previews every grade of a new card from the sm2-v1 vectors', () => {
    const preview = buildReviewPreview(
      {
        state: 'new',
        dueAt: NOW,
        intervalDays: 0,
        easeFactor: 2.5,
        repetitions: 0,
        lapses: 0,
        lastReviewedAt: null,
      },
      NOW,
    );

    expect(preview).toEqual({
      again: {
        state: 'learning',
        dueAt: new Date(NOW.getTime() + MIN),
        intervalDays: 0,
      },
      hard: {
        state: 'learning',
        dueAt: new Date(NOW.getTime() + 90_000),
        intervalDays: 0,
      },
      good: {
        state: 'learning',
        dueAt: new Date(NOW.getTime() + 10 * MIN),
        intervalDays: 0,
      },
      easy: {
        state: 'review',
        dueAt: new Date(NOW.getTime() + 4 * DAY),
        intervalDays: 4,
      },
    });
  });

  it('previews a review card (interval 10, on time) from the sm2-v1 vectors', () => {
    const preview = buildReviewPreview(
      {
        state: 'review',
        dueAt: NOW,
        intervalDays: 10,
        easeFactor: 2.5,
        repetitions: 3,
        lapses: 1,
        lastReviewedAt: new Date(NOW.getTime() - 10 * DAY),
      },
      NOW,
    );

    expect(preview.again).toEqual({
      state: 'relearning',
      dueAt: new Date(NOW.getTime() + 10 * MIN),
      intervalDays: 0,
    });
    expect(preview.hard.intervalDays).toBe(12);
    expect(preview.good.intervalDays).toBe(25);
    expect(preview.easy).toEqual({
      state: 'review',
      dueAt: new Date(NOW.getTime() + 33 * DAY),
      intervalDays: 33,
    });
  });
});
