import { Injectable } from '@nestjs/common';

import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import {
  buildLessonReadyWhere,
  PUBLIC_CONTENT_WHERE,
} from '../../../common/policies/lesson-readiness.policy';
import { PrismaService } from '../../../prisma/prisma.service';
import { OnboardingService } from '../../onboarding/onboarding.service';
import {
  LearningPathLevelDto,
  LearningPathResponseDto,
} from './dto/learning-path-response.dto';
import {
  buildLevelPath,
  selectNextLesson,
  type LearningPathLevel,
  type LearningPathProgress,
  type LearningPathReadyLesson,
} from './learning-path.policy';

@Injectable()
export class LearningPathService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboarding: OnboardingService,
  ) {}

  async getPath(
    userId: number,
  ): Promise<ApiSuccessResponse<LearningPathResponseDto>> {
    const [status, goal, levels, readyLessons, progresses] = await Promise.all([
      this.onboarding.getStatus(userId),
      this.prisma.userGoal.findFirst({
        where: { userId, isActive: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          targetBand: true,
          learningPurpose: true,
          targetLevel: { select: { code: true, orderIndex: true } },
        },
      }),
      this.prisma.level.findMany({
        where: PUBLIC_CONTENT_WHERE,
        orderBy: { orderIndex: 'asc' },
        select: { id: true, code: true, name: true, orderIndex: true },
      }),
      this.prisma.lesson.findMany({
        where: buildLessonReadyWhere(),
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          levelId: true,
          title: true,
          slug: true,
          orderIndex: true,
        },
      }),
      this.prisma.progress.findMany({
        where: { userId, lesson: { is: buildLessonReadyWhere() } },
        select: {
          lessonId: true,
          status: true,
          completionPercent: true,
          lastActivityAt: true,
        },
      }),
    ]);

    const progressByLessonId = new Map<number, LearningPathProgress>(
      progresses.map((progress) => [progress.lessonId, progress]),
    );
    const lessonsByLevelId = new Map<number, LearningPathReadyLesson[]>();
    for (const { levelId, ...lesson } of readyLessons) {
      const list = lessonsByLevelId.get(levelId) ?? [];
      list.push(lesson);
      lessonsByLevelId.set(levelId, list);
    }

    const pathLevels: Array<LearningPathLevel & { id: number; name: string }> =
      levels.map((level) => ({
        ...level,
        lessons: buildLevelPath(
          lessonsByLevelId.get(level.id) ?? [],
          progressByLessonId,
        ),
      }));

    return {
      success: true,
      data: {
        nextStep: status.data.nextStep,
        goal: goal
          ? {
              targetLevelCode: goal.targetLevel.code,
              targetBand: goal.targetBand,
              learningPurpose: goal.learningPurpose,
            }
          : null,
        levels: pathLevels.map(
          (level): LearningPathLevelDto => ({
            id: level.id,
            code: level.code,
            name: level.name,
            orderIndex: level.orderIndex,
            lessonCount: level.lessons.length,
            completedCount: level.lessons.filter(
              (lesson) => lesson.state === 'done',
            ).length,
            lessons: level.lessons.map((lesson) => ({
              id: lesson.id,
              title: lesson.title,
              slug: lesson.slug,
              position: lesson.position,
              state: lesson.state,
              completionPercent: lesson.completionPercent,
            })),
          }),
        ),
        nextLesson: selectNextLesson({
          levels: pathLevels,
          targetLevelOrderIndex: goal?.targetLevel.orderIndex ?? null,
        }),
      },
    };
  }
}
