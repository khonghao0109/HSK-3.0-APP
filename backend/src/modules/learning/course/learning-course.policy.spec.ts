import type { ProgressStatus } from '@prisma/client';

import {
  buildLevelPath,
  type LearningPathProgress,
} from '../path/learning-path.policy';
import {
  buildCoursePath,
  DEFAULT_COURSE_CODE,
  resolveCurrentCourseCode,
  selectCourseNextLesson,
  type CourseUnitInput,
} from './learning-course.policy';

const lesson = (id: number, orderIndex: number) => ({
  id,
  title: `L${id}`,
  slug: `l${id}`,
  orderIndex,
});

const progress = (
  entries: Array<[number, ProgressStatus]>,
): Map<number, LearningPathProgress> =>
  new Map(
    entries.map(([id, status]) => [
      id,
      {
        status,
        completionPercent: status === 'done' ? 100 : 0,
        lastActivityAt: null,
      },
    ]),
  );

// Unit order 1 = [1, 2], order 2 = [3, 4]; given out of order on purpose.
const units: CourseUnitInput[] = [
  { id: 20, orderIndex: 2, lessons: [lesson(4, 2), lesson(3, 1)] },
  { id: 10, orderIndex: 1, lessons: [lesson(2, 2), lesson(1, 1)] },
];

const statesOf = (result: ReturnType<typeof buildCoursePath>) =>
  result.flatMap((unit) => unit.lessons.map((l) => [l.id, l.state] as const));

describe('buildCoursePath', () => {
  it('orders units and lessons by orderIndex', () => {
    const result = buildCoursePath('textbook', units, progress([]));
    expect(result.map((u) => u.id)).toEqual([10, 20]);
    expect(result.map((u) => u.lessons.map((l) => l.position))).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  describe('textbook (sequential across the course)', () => {
    it('opens only the first lesson of the course', () => {
      expect(
        statesOf(buildCoursePath('textbook', units, progress([]))),
      ).toEqual([
        [1, 'current'],
        [2, 'locked'],
        [3, 'locked'],
        [4, 'locked'],
      ]);
    });

    it('opens the next lesson only once the previous one is done', () => {
      expect(
        statesOf(
          buildCoursePath('textbook', units, progress([[1, 'learning']])),
        ),
      ).toEqual([
        [1, 'current'],
        [2, 'locked'],
        [3, 'locked'],
        [4, 'locked'],
      ]);
      expect(
        statesOf(buildCoursePath('textbook', units, progress([[1, 'done']]))),
      ).toEqual([
        [1, 'done'],
        [2, 'current'],
        [3, 'locked'],
        [4, 'locked'],
      ]);
    });

    it('crosses the unit boundary when the last lesson of the unit is done', () => {
      expect(
        statesOf(
          buildCoursePath(
            'textbook',
            units,
            progress([
              [1, 'done'],
              [2, 'done'],
            ]),
          ),
        ),
      ).toEqual([
        [1, 'done'],
        [2, 'done'],
        [3, 'current'],
        [4, 'locked'],
      ]);
    });

    it('opens a lesson that has Progress even when its predecessor is not done', () => {
      expect(
        statesOf(
          buildCoursePath('textbook', units, progress([[4, 'not_started']])),
        ),
      ).toEqual([
        [1, 'current'],
        [2, 'locked'],
        [3, 'locked'],
        [4, 'available'],
      ]);
    });

    it('treats specialty courses like textbooks', () => {
      expect(
        buildCoursePath('specialty', units, progress([[1, 'done']])),
      ).toEqual(buildCoursePath('textbook', units, progress([[1, 'done']])));
    });
  });

  describe('topic (each unit opens on its own)', () => {
    it('opens the first lesson of every unit', () => {
      expect(statesOf(buildCoursePath('topic', units, progress([])))).toEqual([
        [1, 'current'],
        [2, 'locked'],
        [3, 'current'],
        [4, 'locked'],
      ]);
    });

    it('matches buildLevelPath for every unit', () => {
      const map = progress([
        [1, 'done'],
        [3, 'learning'],
        [4, 'not_started'],
      ]);
      const result = buildCoursePath('topic', units, map);
      for (const unit of result) {
        const input = units.find((u) => u.id === unit.id);
        expect(unit.lessons).toEqual(buildLevelPath(input?.lessons ?? [], map));
      }
    });
  });

  it('only sees the lessons it is given (draft units or lessons are filtered by the reader)', () => {
    const result = buildCoursePath('textbook', [units[1]], progress([]));
    expect(statesOf(result)).toEqual([
      [1, 'current'],
      [2, 'locked'],
    ]);
  });

  it('returns no units for an empty course', () => {
    expect(buildCoursePath('textbook', [], progress([]))).toEqual([]);
  });
});

describe('resolveCurrentCourseCode', () => {
  const published = new Set(['HSK3_TOPIC', 'HSK2_TEXTBOOK']);

  it('uses the active enrollment flagged isCurrent', () => {
    expect(
      resolveCurrentCourseCode(
        [
          { courseCode: 'HSK3_TOPIC', status: 'active', isCurrent: false },
          { courseCode: 'HSK2_TEXTBOOK', status: 'active', isCurrent: true },
        ],
        published,
      ),
    ).toBe('HSK2_TEXTBOOK');
  });

  it('falls back to the default course when only left enrollments exist', () => {
    expect(
      resolveCurrentCourseCode(
        [{ courseCode: 'HSK2_TEXTBOOK', status: 'left', isCurrent: false }],
        published,
      ),
    ).toBe(DEFAULT_COURSE_CODE);
  });

  it('falls back to the default course without enrollments', () => {
    expect(resolveCurrentCourseCode([], published)).toBe('HSK3_TOPIC');
  });

  it('returns null when the default course is not published', () => {
    expect(resolveCurrentCourseCode([], new Set(['HSK2_TEXTBOOK']))).toBeNull();
  });

  it('ignores a current enrollment of a course that is no longer published', () => {
    expect(
      resolveCurrentCourseCode(
        [{ courseCode: 'OLD', status: 'active', isCurrent: true }],
        published,
      ),
    ).toBe('HSK3_TOPIC');
  });
});

describe('selectCourseNextLesson (C3b-UI2)', () => {
  const units: CourseUnitInput[] = [
    { id: 1, orderIndex: 1, lessons: [lesson(11, 1), lesson(12, 2)] },
    { id: 2, orderIndex: 2, lessons: [lesson(21, 1)] },
  ];

  it('picks the first lesson not done of a textbook course', () => {
    const path = buildCoursePath('textbook', units, progress([[11, 'done']]));
    expect(selectCourseNextLesson(path)?.id).toBe(12);
  });

  it('picks the first lesson of a course without Progress', () => {
    const path = buildCoursePath('textbook', units, progress([]));
    expect(selectCourseNextLesson(path)?.id).toBe(11);
  });

  it('prefers the most recently active learning lesson', () => {
    const path = buildCoursePath(
      'textbook',
      units,
      new Map<number, LearningPathProgress>([
        [11, { status: 'done', completionPercent: 100, lastActivityAt: null }],
        [
          12,
          {
            status: 'learning',
            completionPercent: 40,
            lastActivityAt: new Date('2026-11-01T00:00:00Z'),
          },
        ],
        [
          21,
          {
            status: 'learning',
            completionPercent: 10,
            lastActivityAt: new Date('2026-11-20T00:00:00Z'),
          },
        ],
      ]),
    );
    expect(selectCourseNextLesson(path)?.id).toBe(21);
  });

  it('returns null when every lesson is done', () => {
    const path = buildCoursePath(
      'textbook',
      units,
      progress([
        [11, 'done'],
        [12, 'done'],
        [21, 'done'],
      ]),
    );
    expect(selectCourseNextLesson(path)).toBeNull();
  });
});
