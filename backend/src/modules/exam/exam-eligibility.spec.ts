import { ContentStatus } from '@prisma/client';

import { isExamTestVisible, type ExamTestVisibility } from './exam-eligibility';

const NOW = new Date('2026-10-27T09:00:00.000Z');

function test(overrides: Partial<ExamTestVisibility> = {}): ExamTestVisibility {
  return {
    status: ContentStatus.published,
    deletedAt: null,
    availableFrom: null,
    availableTo: null,
    ...overrides,
  };
}

describe('isExamTestVisible (Q119 / TL-111)', () => {
  it('accepts a published, live test without a window', () => {
    expect(isExamTestVisible(test(), NOW)).toBe(true);
  });

  it.each([
    ['draft', { status: ContentStatus.draft }],
    ['archived', { status: ContentStatus.archived }],
    ['soft-deleted', { deletedAt: new Date('2026-10-01T00:00:00.000Z') }],
    [
      'window not open yet',
      { availableFrom: new Date('2026-10-27T09:00:00.001Z') },
    ],
    [
      'window already closed',
      { availableTo: new Date('2026-10-27T09:00:00.000Z') },
    ],
  ])('rejects a %s test', (_label, overrides) => {
    expect(isExamTestVisible(test(overrides), NOW)).toBe(false);
  });

  it('uses an inclusive availableFrom and an exclusive availableTo', () => {
    expect(
      isExamTestVisible(
        test({
          availableFrom: new Date('2026-10-27T09:00:00.000Z'),
          availableTo: new Date('2026-10-27T10:00:00.000Z'),
        }),
        NOW,
      ),
    ).toBe(true);

    expect(
      isExamTestVisible(
        test({ availableTo: new Date('2026-10-27T09:00:00.000Z') }),
        NOW,
      ),
    ).toBe(false);

    expect(
      isExamTestVisible(
        test({ availableFrom: new Date('2026-10-27T09:00:00.001Z') }),
        NOW,
      ),
    ).toBe(false);
  });
});
