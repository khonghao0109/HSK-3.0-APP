import type { CourseEnrollmentStatus, CourseKind } from '@prisma/client';

import {
  buildLevelPath,
  buildOrderedPath,
  compareReadyLessons,
  isMoreRecent,
  type LearningPathLesson,
  type LearningPathProgress,
  type LearningPathReadyLesson,
} from '../path/learning-path.policy';

/** ADR-009 Q-C4: course a learner studies until they pick one. */
export const DEFAULT_COURSE_CODE = 'HSK3_TOPIC';

export type CourseUnitInput = {
  id: number;
  orderIndex: number;
  lessons: readonly LearningPathReadyLesson[];
};

export type CoursePathUnit = {
  id: number;
  orderIndex: number;
  lessons: LearningPathLesson[];
};

/**
 * ADR-009 §4 unlock rule per course kind (TL 23/11): a `topic` course opens
 * the first lesson of every unit, exactly like the per-level path; `textbook`
 * and `specialty` courses chain lessons across units by
 * (unit.orderIndex, lesson.orderIndex). Lessons with Progress always open.
 * `position` restarts at 1 in each unit. Callers pass only ready lessons of
 * published units.
 */
export function buildCoursePath(
  kind: CourseKind,
  units: readonly CourseUnitInput[],
  progressByLessonId: ReadonlyMap<number, LearningPathProgress>,
): CoursePathUnit[] {
  const ordered = [...units]
    .sort(
      (left, right) => left.orderIndex - right.orderIndex || left.id - right.id,
    )
    .map((unit) => ({
      id: unit.id,
      orderIndex: unit.orderIndex,
      lessons: [...unit.lessons].sort(compareReadyLessons),
    }));

  if (kind === 'topic') {
    return ordered.map((unit) => ({
      ...unit,
      lessons: buildLevelPath(unit.lessons, progressByLessonId),
    }));
  }

  const chained = buildOrderedPath(
    ordered.flatMap((unit) => unit.lessons),
    progressByLessonId,
  );
  let offset = 0;
  return ordered.map((unit) => {
    const lessons = chained
      .slice(offset, offset + unit.lessons.length)
      .map((lesson, index) => ({ ...lesson, position: index + 1 }));
    offset += unit.lessons.length;
    return { ...unit, lessons };
  });
}

export type EnrollmentForCurrent = {
  courseCode: string;
  status: CourseEnrollmentStatus;
  isCurrent: boolean;
};

/**
 * ADR-009 Q-C4, the only place that decides the course being studied: the
 * active enrollment flagged `isCurrent` of a published course, else the
 * default course when it is published, else none. Read-only: a default is
 * never written back. Reused by `/learning/home` and `/learning/path` (C3b).
 */
export function resolveCurrentCourseCode(
  enrollments: readonly EnrollmentForCurrent[],
  publishedCourseCodes: ReadonlySet<string>,
): string | null {
  const current = enrollments.find(
    (enrollment) =>
      enrollment.status === 'active' &&
      enrollment.isCurrent &&
      publishedCourseCodes.has(enrollment.courseCode),
  );
  if (current) return current.courseCode;
  return publishedCourseCodes.has(DEFAULT_COURSE_CODE)
    ? DEFAULT_COURSE_CODE
    : null;
}

/**
 * C3b-UI2 "Học tiếp" of a non-topic course on Home: the most recently active
 * `learning` lesson, else the first lesson not done that is open (the
 * `current` one of the chained path), else none.
 */
export function selectCourseNextLesson(
  units: readonly CoursePathUnit[],
): LearningPathLesson | null {
  const lessons = units.flatMap((unit) => unit.lessons);
  let recent: LearningPathLesson | null = null;
  for (const lesson of lessons) {
    if (lesson.status !== 'learning') continue;
    if (
      recent === null ||
      isMoreRecent(lesson.lastActivityAt, recent.lastActivityAt)
    ) {
      recent = lesson;
    }
  }
  return (
    recent ??
    lessons.find((lesson) => lesson.state === 'current') ??
    lessons.find((lesson) => lesson.state === 'available') ??
    null
  );
}
