import type { PrismaClient } from '@prisma/client';

import { buildLessonReadyWhere } from '../../src/common/policies/lesson-readiness.policy';

/**
 * Unlocks `lessonId` for `userId` under the sequential path (Q18) by marking
 * the ready lesson right before it in its level `done`. A row that is
 * already `done` is left untouched; another row keeps its `startedAt`.
 */
export async function completePreviousReadyLesson(
  prisma: PrismaClient,
  userId: number,
  lessonId: number,
): Promise<void> {
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    select: { id: true, levelId: true, orderIndex: true },
  });
  const previous = await prisma.lesson.findFirst({
    where: buildLessonReadyWhere({
      levelId: lesson.levelId,
      AND: [
        {
          OR: [
            { orderIndex: { lt: lesson.orderIndex } },
            { orderIndex: lesson.orderIndex, id: { lt: lesson.id } },
          ],
        },
      ],
    }),
    orderBy: [{ orderIndex: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  if (!previous) return;

  const key = { userId_lessonId: { userId, lessonId: previous.id } };
  const existing = await prisma.progress.findUnique({
    where: key,
    select: { status: true, startedAt: true },
  });
  if (existing?.status === 'done') return;
  const now = new Date();
  const done = {
    status: 'done' as const,
    completionPercent: 100,
    startedAt: existing?.startedAt ?? now,
    completedAt: now,
    lastActivityAt: now,
  };
  await prisma.progress.upsert({
    where: key,
    create: { userId, lessonId: previous.id, ...done },
    update: done,
  });
}
