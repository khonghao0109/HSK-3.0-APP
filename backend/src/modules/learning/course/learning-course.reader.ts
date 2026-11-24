import type { CourseKind, Prisma } from '@prisma/client';

import {
  buildAnyLessonReadyWhere,
  PUBLIC_CONTENT_WHERE,
} from '../../../common/policies/lesson-readiness.policy';
import type { LearningPathProgress } from '../path/learning-path.policy';
import { buildCoursePath, type CoursePathUnit } from './learning-course.policy';

/**
 * Lessons a learner sees in a course: ready lessons, with or without a Level
 * (ADR-009 C3b-1), of published units of a published course.
 */
export function courseLessonWhere(courseId?: number): Prisma.LessonWhereInput {
  return buildAnyLessonReadyWhere({
    courseUnit: {
      is: {
        ...PUBLIC_CONTENT_WHERE,
        course: {
          is: {
            ...PUBLIC_CONTENT_WHERE,
            ...(courseId === undefined ? {} : { id: courseId }),
          },
        },
      },
    },
  });
}

type CoursePathReader = Pick<
  Prisma.TransactionClient,
  'courseUnit' | 'lesson' | 'progress'
>;

/**
 * One course's path for one learner, with the same rule as
 * `GET /learning/courses/:code` (C3a). Read-only. C3b-3 activity uses it for
 * lessons without a Level.
 */
export async function loadCoursePath(
  db: CoursePathReader,
  userId: number,
  course: { id: number; kind: CourseKind },
): Promise<CoursePathUnit[]> {
  const [units, lessons, progresses] = await Promise.all([
    db.courseUnit.findMany({
      where: { ...PUBLIC_CONTENT_WHERE, courseId: course.id },
      select: { id: true, orderIndex: true },
    }),
    db.lesson.findMany({
      where: courseLessonWhere(course.id),
      select: {
        id: true,
        courseUnitId: true,
        title: true,
        slug: true,
        orderIndex: true,
      },
    }),
    db.progress.findMany({
      where: { userId, lesson: { is: courseLessonWhere(course.id) } },
      select: {
        lessonId: true,
        status: true,
        completionPercent: true,
        lastActivityAt: true,
      },
    }),
  ]);
  return buildCoursePath(
    course.kind,
    units.map((unit) => ({
      id: unit.id,
      orderIndex: unit.orderIndex,
      lessons: lessons
        .filter((lesson) => lesson.courseUnitId === unit.id)
        .map(({ id, title, slug, orderIndex }) => ({
          id,
          title,
          slug,
          orderIndex,
        })),
    })),
    new Map<number, LearningPathProgress>(
      progresses.map(({ lessonId, ...progress }) => [lessonId, progress]),
    ),
  );
}
