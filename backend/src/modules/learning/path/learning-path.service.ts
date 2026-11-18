import { Injectable } from '@nestjs/common';

import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import { PUBLIC_CONTENT_WHERE } from '../../../common/policies/lesson-readiness.policy';
import { PrismaService } from '../../../prisma/prisma.service';
import { OnboardingService } from '../../onboarding/onboarding.service';
import {
  LearningPathLevelDto,
  LearningPathResponseDto,
} from './dto/learning-path-response.dto';
import {
  selectNextLesson,
  type LearningPathLevel,
} from './learning-path.policy';
import { loadLevelPaths } from './learning-path.reader';

@Injectable()
export class LearningPathService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboarding: OnboardingService,
  ) {}

  async getPath(
    userId: number,
  ): Promise<ApiSuccessResponse<LearningPathResponseDto>> {
    const { nextStep, goal, pathLevels } = await this.loadPathState(userId);

    return {
      success: true,
      data: {
        nextStep,
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

  /**
   * Read-only state shared by `GET /learning/path` and `GET /learning/home`:
   * one onboarding status call and a fixed set of queries per request.
   */
  async loadPathState(userId: number) {
    const [status, goal, levels, levelPaths] = await Promise.all([
      this.onboarding.getStatus(userId),
      this.prisma.userGoal.findFirst({
        where: { userId, isActive: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          targetBand: true,
          dailyMinutes: true,
          learningPurpose: true,
          targetLevel: { select: { code: true, orderIndex: true } },
        },
      }),
      this.prisma.level.findMany({
        where: PUBLIC_CONTENT_WHERE,
        orderBy: { orderIndex: 'asc' },
        select: { id: true, code: true, name: true, orderIndex: true },
      }),
      loadLevelPaths(this.prisma, userId),
    ]);

    const pathLevels: Array<LearningPathLevel & { id: number; name: string }> =
      levels.map((level) => ({
        ...level,
        lessons: levelPaths.get(level.id) ?? [],
      }));

    return { nextStep: status.data.nextStep, goal, pathLevels };
  }
}
