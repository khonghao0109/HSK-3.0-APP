import {
  buildLevelPath,
  selectNextLesson,
  type LearningPathLevel,
  type LearningPathProgress,
  type LearningPathReadyLesson,
} from './learning-path.policy';

type Cell =
  | null
  | { s: 'L'; p?: number; t?: number | null }
  | { s: 'D' }
  | { s: 'N' };

const L = (p = 0, t: number | null = 1): Cell => ({ s: 'L', p, t });
const D: Cell = { s: 'D' };
const N: Cell = { s: 'N' };

function lessonsOf(count: number, firstId = 1): LearningPathReadyLesson[] {
  return Array.from({ length: count }, (_, index) => ({
    id: firstId + index,
    title: `Lesson ${firstId + index}`,
    slug: `lesson-${firstId + index}`,
    orderIndex: (index + 1) * 10,
  }));
}

function progressOf(
  lessons: readonly LearningPathReadyLesson[],
  cells: readonly Cell[],
): Map<number, LearningPathProgress> {
  const map = new Map<number, LearningPathProgress>();
  cells.forEach((cell, index) => {
    if (cell === null) return;
    const id = lessons[index].id;
    if (cell.s === 'D') {
      map.set(id, {
        status: 'done',
        completionPercent: 100,
        lastActivityAt: new Date(1_000),
      });
    } else if (cell.s === 'N') {
      map.set(id, {
        status: 'not_started',
        completionPercent: 0,
        lastActivityAt: null,
      });
    } else {
      map.set(id, {
        status: 'learning',
        completionPercent: cell.p ?? 0,
        lastActivityAt:
          cell.t === null || cell.t === undefined ? null : new Date(cell.t),
      });
    }
  });
  return map;
}

function states(cells: readonly Cell[]) {
  const lessons = lessonsOf(cells.length);
  return buildLevelPath(lessons, progressOf(lessons, cells)).map(
    (lesson) => lesson.state,
  );
}

describe('buildLevelPath', () => {
  it('[C1] returns no lessons for a level without ready lessons', () => {
    expect(buildLevelPath([], new Map())).toEqual([]);
  });

  it('[C2] makes the only lesson current', () => {
    expect(states([null])).toEqual(['current']);
  });

  it('[C3] locks every lesson after an untouched first lesson', () => {
    expect(states([null, null, null])).toEqual(['current', 'locked', 'locked']);
  });

  it('[C4] keeps a learning first lesson current with its percent', () => {
    const lessons = lessonsOf(3);
    const path = buildLevelPath(
      lessons,
      progressOf(lessons, [L(40), null, null]),
    );
    expect(path.map((lesson) => lesson.state)).toEqual([
      'current',
      'locked',
      'locked',
    ]);
    expect(path[0].completionPercent).toBe(40);
  });

  it('[C5] unlocks the lesson after a done lesson as current', () => {
    expect(states([D, null, null])).toEqual(['done', 'current', 'locked']);
  });

  it('[C6] keeps the learning lesson after a done lesson current', () => {
    expect(states([D, L(), null])).toEqual(['done', 'current', 'locked']);
  });

  it('[C7] marks every lesson done when all are done', () => {
    expect(states([D, D, D])).toEqual(['done', 'done', 'done']);
  });

  it('[C8] keeps a learning lesson current ahead of a later done lesson', () => {
    expect(states([L(), D, null])).toEqual(['current', 'done', 'available']);
  });

  it('[C9] unlocks a later lesson that already has a progress row', () => {
    expect(states([null, L(), null])).toEqual([
      'available',
      'current',
      'locked',
    ]);
  });

  it('[C10] picks the most recently active learning lesson as current', () => {
    expect(states([L(0, 10), L(0, 20), null])).toEqual([
      'available',
      'current',
      'locked',
    ]);
  });

  it('[C11] breaks an activity tie by the smaller position', () => {
    expect(states([L(0, 10), L(0, 10), null])).toEqual([
      'current',
      'available',
      'locked',
    ]);
  });

  it('[C12] ranks a learning lesson without activity time last', () => {
    expect(states([L(0, null), L(0, 5)])).toEqual(['available', 'current']);
  });

  it('[C13] never picks a not_started row as the learning current', () => {
    expect(states([null, N, null])).toEqual(['current', 'available', 'locked']);
  });

  it('[C14] makes an inserted lesson after a done lesson available', () => {
    // X is authored later (larger id) but ordered between A and B.
    const [a, b, c] = lessonsOf(3);
    const x = { id: 99, title: 'X', slug: 'x', orderIndex: 15 };
    const path = buildLevelPath(
      [c, x, b, a],
      progressOf([a, x, b, c], [D, null, L(), null]),
    );
    expect(path.map((lesson) => [lesson.id, lesson.state])).toEqual([
      [1, 'done'],
      [99, 'available'],
      [2, 'current'],
      [3, 'locked'],
    ]);
  });

  it('[C15] makes an inserted lesson after a done lesson current', () => {
    const [a, b] = lessonsOf(2);
    const x = { id: 99, title: 'X', slug: 'x', orderIndex: 15 };
    const path = buildLevelPath(
      [b, x, a],
      progressOf([a, x, b], [D, null, null]),
    );
    expect(path.map((lesson) => [lesson.id, lesson.state])).toEqual([
      [1, 'done'],
      [99, 'current'],
      [2, 'locked'],
    ]);
  });

  it('[C16] uses the previous ready lesson after one is withdrawn', () => {
    // Ready A, B, C; B withdrawn leaves A (done) and C (no row).
    const all = lessonsOf(3);
    const ready = [all[0], all[2]];
    const path = buildLevelPath(ready, progressOf(all, [D, null, null]));
    expect(
      path.map((lesson) => [lesson.id, lesson.position, lesson.state]),
    ).toEqual([
      [1, 1, 'done'],
      [3, 2, 'current'],
    ]);
  });

  it('[C17] makes the new first lesson current after the first is withdrawn', () => {
    const all = lessonsOf(2);
    const path = buildLevelPath([all[1]], progressOf(all, [D, null]));
    expect(
      path.map((lesson) => [lesson.id, lesson.position, lesson.state]),
    ).toEqual([[2, 1, 'current']]);
  });

  it('[C18] ignores progress on lessons that are no longer ready', () => {
    // Withdrawn lesson 2 sits between ready lessons with a done row.
    const all = lessonsOf(3);
    const path = buildLevelPath(
      [all[0], all[2]],
      progressOf(all, [null, D, null]),
    );
    expect(path.map((lesson) => [lesson.id, lesson.state])).toEqual([
      [1, 'current'],
      [3, 'locked'],
    ]);
    expect(path).toHaveLength(2);
    expect(path.filter((lesson) => lesson.state === 'done')).toHaveLength(0);
  });

  it('[C19] takes completionPercent from progress and defaults to 0', () => {
    const lessons = lessonsOf(3);
    const path = buildLevelPath(lessons, progressOf(lessons, [D, L(40), null]));
    expect(path.map((lesson) => lesson.completionPercent)).toEqual([
      100, 40, 0,
    ]);
  });
});

function level(
  code: string,
  orderIndex: number,
  cells: readonly Cell[],
  firstId: number,
): LearningPathLevel {
  const lessons = lessonsOf(cells.length, firstId);
  return {
    code,
    orderIndex,
    lessons: buildLevelPath(lessons, progressOf(lessons, cells)),
  };
}

describe('selectNextLesson', () => {
  it('[N1] starts the goal level at position 1 without progress', () => {
    const levels = [
      level('HSK1', 1, [null, null], 100),
      level('HSK3', 3, [null, null], 300),
    ];
    expect(selectNextLesson({ levels, targetLevelOrderIndex: 3 })).toEqual({
      lessonId: 300,
      title: 'Lesson 300',
      slug: 'lesson-300',
      levelCode: 'HSK3',
      position: 1,
    });
  });

  it('[N2] moves to the next level when the goal level is done', () => {
    const levels = [
      level('HSK3', 3, [D, D], 300),
      level('HSK4', 4, [D, null, null], 400),
    ];
    expect(
      selectNextLesson({ levels, targetLevelOrderIndex: 3 }),
    ).toMatchObject({ lessonId: 401, levelCode: 'HSK4', position: 2 });
  });

  it('[N3] returns null when the goal and higher levels are done or empty', () => {
    const levels = [
      level('HSK1', 1, [null], 100),
      level('HSK3', 3, [D, D], 300),
      level('HSK4', 4, [], 400),
      level('HSK5', 5, [D], 500),
    ];
    expect(selectNextLesson({ levels, targetLevelOrderIndex: 3 })).toBeNull();
  });

  it('[N4] continues the most recent learning lesson on any level', () => {
    const levels = [
      level('HSK1', 1, [L(20, 50), null], 100),
      level('HSK3', 3, [L(10, 40), null], 300),
    ];
    expect(
      selectNextLesson({ levels, targetLevelOrderIndex: 3 }),
    ).toMatchObject({ lessonId: 100, levelCode: 'HSK1', position: 1 });
  });

  it('[N5] returns null without a goal or a learning lesson', () => {
    const levels = [
      level('HSK1', 1, [D, null], 100),
      level('HSK3', 3, [null], 300),
    ];
    expect(
      selectNextLesson({ levels, targetLevelOrderIndex: null }),
    ).toBeNull();
  });

  it('[N7] skips a done or empty next level for a later level with a current lesson', () => {
    const levels = [
      level('HSK3', 3, [D], 300),
      level('HSK4', 4, [D, D], 400),
      level('HSK5', 5, [], 500),
      level('HSK6', 6, [null, null], 600),
    ];
    expect(
      selectNextLesson({ levels, targetLevelOrderIndex: 3 }),
    ).toMatchObject({ lessonId: 600, levelCode: 'HSK6', position: 1 });
  });

  it('[N8] goes to a higher level when the goal level is no longer published', () => {
    const levels = [
      level('HSK1', 1, [null], 100),
      level('HSK4', 4, [null], 400),
    ];
    expect(
      selectNextLesson({ levels, targetLevelOrderIndex: 3 }),
    ).toMatchObject({ lessonId: 400, levelCode: 'HSK4', position: 1 });
  });

  it('[N6] returns null when the goal level has no ready lessons', () => {
    const levels = [
      level('HSK1', 1, [null, null], 100),
      level('HSK3', 3, [], 300),
    ];
    expect(selectNextLesson({ levels, targetLevelOrderIndex: 3 })).toBeNull();
  });
});
