import type { ProgressStatus } from '@prisma/client';

export const LEARNING_PATH_LESSON_STATES = [
  'done',
  'current',
  'available',
  'locked',
] as const;

export type LearningPathLessonState =
  (typeof LEARNING_PATH_LESSON_STATES)[number];

export type LearningPathProgress = {
  status: ProgressStatus;
  completionPercent: number;
  lastActivityAt: Date | null;
};

export type LearningPathReadyLesson = {
  id: number;
  title: string;
  slug: string;
  orderIndex: number;
};

export type LearningPathLesson = {
  id: number;
  title: string;
  slug: string;
  position: number;
  state: LearningPathLessonState;
  completionPercent: number;
  status: ProgressStatus | null;
  lastActivityAt: Date | null;
};

/**
 * Q18 unlock rule shared by `GET /learning/path` and `startLesson`: the
 * first ready lesson of a level, a lesson whose previous ready lesson is
 * done, or a lesson the learner already has a Progress row for.
 */
export function isLessonUnlocked(input: {
  isFirst: boolean;
  previousStatus: ProgressStatus | null;
  hasProgress: boolean;
}): boolean {
  return input.isFirst || input.previousStatus === 'done' || input.hasProgress;
}

export function compareReadyLessons(
  left: { orderIndex: number; id: number },
  right: { orderIndex: number; id: number },
): number {
  return left.orderIndex - right.orderIndex || left.id - right.id;
}

/** Newest `lastActivityAt` first, null last; ties keep the earlier item. */
function isMoreRecent(candidate: Date | null, best: Date | null): boolean {
  if (candidate === null) return false;
  if (best === null) return true;
  return candidate.getTime() > best.getTime();
}

export function buildLevelPath(
  readyLessons: readonly LearningPathReadyLesson[],
  progressByLessonId: ReadonlyMap<number, LearningPathProgress>,
): LearningPathLesson[] {
  const ordered = [...readyLessons].sort(compareReadyLessons);
  const rows = ordered.map((lesson, index) => {
    const progress = progressByLessonId.get(lesson.id) ?? null;
    const previous =
      index > 0
        ? (progressByLessonId.get(ordered[index - 1].id) ?? null)
        : null;
    return {
      lesson,
      progress,
      position: index + 1,
      unlocked: isLessonUnlocked({
        isFirst: index === 0,
        previousStatus: previous?.status ?? null,
        hasProgress: progress !== null,
      }),
    };
  });

  let current: (typeof rows)[number] | undefined;
  for (const row of rows) {
    if (!row.unlocked || row.progress?.status !== 'learning') continue;
    if (
      current === undefined ||
      isMoreRecent(
        row.progress.lastActivityAt,
        current.progress?.lastActivityAt ?? null,
      )
    ) {
      current = row;
    }
  }
  current ??= rows.find(
    (row) => row.unlocked && row.progress?.status !== 'done',
  );

  return rows.map((row): LearningPathLesson => {
    let state: LearningPathLessonState = 'locked';
    if (row.progress?.status === 'done') state = 'done';
    else if (row === current) state = 'current';
    else if (row.unlocked) state = 'available';
    return {
      id: row.lesson.id,
      title: row.lesson.title,
      slug: row.lesson.slug,
      position: row.position,
      state,
      completionPercent: row.progress?.completionPercent ?? 0,
      status: row.progress?.status ?? null,
      lastActivityAt: row.progress?.lastActivityAt ?? null,
    };
  });
}

export type LearningPathLevel = {
  code: string;
  orderIndex: number;
  lessons: readonly LearningPathLesson[];
};

export type NextLesson = {
  lessonId: number;
  title: string;
  slug: string;
  levelCode: string;
  position: number;
};

function toNextLesson(
  level: LearningPathLevel,
  lesson: LearningPathLesson,
): NextLesson {
  return {
    lessonId: lesson.id,
    title: lesson.title,
    slug: lesson.slug,
    levelCode: level.code,
    position: lesson.position,
  };
}

function currentOf(level: LearningPathLevel): LearningPathLesson | undefined {
  return level.lessons.find((lesson) => lesson.state === 'current');
}

/**
 * Picks the lesson to continue: the most recently active `learning` lesson
 * on any level, else the current lesson of the goal level, else the current
 * lesson of the first higher level that has one. Without a goal only the
 * first rule applies. Shared with the Home endpoint (M2.B10).
 */
export function selectNextLesson(input: {
  levels: readonly LearningPathLevel[];
  targetLevelOrderIndex: number | null;
}): NextLesson | null {
  const levels = [...input.levels].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  );

  let recent: { level: LearningPathLevel; lesson: LearningPathLesson } | null =
    null;
  for (const level of levels) {
    for (const lesson of level.lessons) {
      if (lesson.status !== 'learning') continue;
      if (
        recent === null ||
        isMoreRecent(lesson.lastActivityAt, recent.lesson.lastActivityAt)
      ) {
        recent = { level, lesson };
      }
    }
  }
  if (recent) return toNextLesson(recent.level, recent.lesson);

  const target = input.targetLevelOrderIndex;
  if (target === null) return null;

  const targetLevel = levels.find((level) => level.orderIndex === target);
  const targetCurrent = targetLevel ? currentOf(targetLevel) : undefined;
  if (targetLevel && targetCurrent) {
    return toNextLesson(targetLevel, targetCurrent);
  }

  for (const level of levels) {
    if (level.orderIndex <= target) continue;
    const lesson = currentOf(level);
    if (lesson) return toNextLesson(level, lesson);
  }
  return null;
}
