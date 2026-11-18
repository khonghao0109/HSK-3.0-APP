import type { Prisma } from '@prisma/client';

import { buildLessonReadyWhere } from '../../../common/policies/lesson-readiness.policy';
import {
  buildLevelPath,
  type LearningPathLesson,
  type LearningPathProgress,
  type LearningPathReadyLesson,
} from './learning-path.policy';

/** Works with `PrismaService` and with an interactive transaction client. */
export type LearningPathReader = Pick<
  Prisma.TransactionClient,
  'lesson' | 'progress'
>;

/**
 * Ready lessons plus the learner's Progress rows, built into Q18 paths per
 * level. `GET /learning/path`, `GET /learning/home` and the lesson activity
 * read position and state from here, so they cannot disagree. `levelId`
 * narrows both queries to one level without changing that level's result:
 * `buildLevelPath` only reads progress of the level's own lessons.
 */
export async function loadLevelPaths(
  db: LearningPathReader,
  userId: number,
  scope: { levelId?: number } = {},
): Promise<Map<number, LearningPathLesson[]>> {
  const readyWhere = buildLessonReadyWhere(
    scope.levelId === undefined ? {} : { levelId: scope.levelId },
  );
  const [readyLessons, progresses] = await Promise.all([
    db.lesson.findMany({
      where: readyWhere,
      orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        levelId: true,
        title: true,
        slug: true,
        orderIndex: true,
      },
    }),
    db.progress.findMany({
      where: { userId, lesson: { is: readyWhere } },
      select: {
        lessonId: true,
        status: true,
        completionPercent: true,
        lastActivityAt: true,
      },
    }),
  ]);

  const progressByLessonId = new Map<number, LearningPathProgress>(
    progresses.map(({ lessonId, ...progress }) => [lessonId, progress]),
  );
  const lessonsByLevelId = new Map<number, LearningPathReadyLesson[]>();
  for (const { levelId, ...lesson } of readyLessons) {
    const list = lessonsByLevelId.get(levelId) ?? [];
    list.push(lesson);
    lessonsByLevelId.set(levelId, list);
  }

  const paths = new Map<number, LearningPathLesson[]>();
  for (const [levelId, lessons] of lessonsByLevelId) {
    paths.set(levelId, buildLevelPath(lessons, progressByLessonId));
  }
  return paths;
}
