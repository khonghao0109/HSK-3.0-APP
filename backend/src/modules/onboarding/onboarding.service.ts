import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import { buildLessonReadyWhere } from '../../common/policies/lesson-readiness.policy';
import { PrismaService } from '../../prisma/prisma.service';

import { CreateGoalDto } from './dto/create-goal.dto';
import {
  LearningPlanView,
  OnboardingNextStep,
  OnboardingStatusView,
  UserGoalView,
} from './onboarding.types';

const GOAL_SELECT = {
  id: true,
  userId: true,
  targetLevelId: true,
  targetBand: true,
  dailyMinutes: true,
  reminderEnabled: true,
  reminderTime: true,
  startDate: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  targetLevel: {
    select: {
      id: true,
      code: true,
      name: true,
      minBand: true,
      maxBand: true,
    },
  },
} satisfies Prisma.UserGoalSelect;

const PLAN_SELECT = {
  id: true,
  userId: true,
  targetLevelId: true,
  targetBand: true,
  generatedFromPlacementId: true,
  status: true,
  startDate: true,
  endDate: true,
  createdAt: true,
  updatedAt: true,
  targetLevel: {
    select: {
      id: true,
      code: true,
      name: true,
      minBand: true,
      maxBand: true,
    },
  },
  items: {
    orderBy: [{ orderIndex: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      orderIndex: true,
      scheduledDate: true,
      status: true,
      lesson: {
        select: {
          id: true,
          title: true,
          description: true,
          orderIndex: true,
          slug: true,
        },
      },
    },
  },
} satisfies Prisma.LearningPlanSelect;

const PLAN_PUBLIC_SELECT = {
  ...PLAN_SELECT,
  items: {
    ...PLAN_SELECT.items,
    where: {
      lesson: { is: buildLessonReadyWhere() },
    },
  },
} satisfies Prisma.LearningPlanSelect;

type GoalRecord = Prisma.UserGoalGetPayload<{ select: typeof GOAL_SELECT }>;
type PlanRecord = Prisma.LearningPlanGetPayload<{ select: typeof PLAN_SELECT }>;

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(
    userId: number,
  ): Promise<ApiSuccessResponse<OnboardingStatusView>> {
    const [goal, plan, completedPlacementCount] = await Promise.all([
      this.prisma.userGoal.findFirst({
        where: { userId, isActive: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          targetLevelId: true,
          targetBand: true,
          startDate: true,
        },
      }),
      this.prisma.learningPlan.findFirst({
        where: { userId, status: 'active' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          targetLevelId: true,
          targetBand: true,
          startDate: true,
          items: {
            orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
            select: { lessonId: true },
          },
        },
      }),
      this.prisma.placementAttempt.count({
        where: { userId, status: 'completed' },
      }),
    ]);

    const hasActiveGoal = goal !== null;
    const hasActiveLearningPlan = plan !== null;
    const readyLessons = goal
      ? await this.prisma.lesson.findMany({
          where: buildLessonReadyWhere({ levelId: goal.targetLevelId }),
          orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
          select: { id: true },
        })
      : [];
    const hasUsableLearningPlan =
      goal !== null &&
      plan !== null &&
      readyLessons.length > 0 &&
      isPlanForGoal(plan, goal) &&
      hasSameLessonSnapshot(
        {
          items: plan.items.map((item) => ({ lesson: { id: item.lessonId } })),
        },
        readyLessons,
      );

    let nextStep: OnboardingNextStep = 'set_goal';
    if (hasActiveGoal) {
      if (readyLessons.length === 0) {
        nextStep = 'content_unavailable';
      } else {
        nextStep = hasUsableLearningPlan ? 'ready' : 'generate_plan';
      }
    }

    return {
      success: true,
      data: {
        hasActiveGoal,
        hasActiveLearningPlan,
        hasUsableLearningPlan,
        hasCompletedPlacement: completedPlacementCount > 0,
        nextStep,
      },
    };
  }

  async getCurrentGoal(
    userId: number,
  ): Promise<ApiSuccessResponse<UserGoalView | null>> {
    const goal = await this.prisma.userGoal.findFirst({
      where: { userId, isActive: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: GOAL_SELECT,
    });

    return {
      success: true,
      data: goal ? serializeGoal(goal) : null,
    };
  }

  async setGoal(
    userId: number,
    dto: CreateGoalDto,
  ): Promise<ApiSuccessResponse<UserGoalView>> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockActiveUser(tx, userId);

      const level = await tx.level.findFirst({
        where: {
          id: dto.targetLevelId,
          status: 'published',
          deletedAt: null,
        },
        select: {
          id: true,
          code: true,
          name: true,
          minBand: true,
          maxBand: true,
        },
      });

      if (!level) {
        throw new NotFoundException('Target level is not available.');
      }

      const targetBand = resolveTargetBand(
        dto.targetBand,
        level.minBand,
        level.maxBand,
      );
      const parsedStartDate = parseDateOnly(dto.startDate, 'startDate');
      const parsedReminderTime = resolveReminderTime(
        dto.reminderEnabled,
        dto.reminderTime,
      );

      const activeGoals = await tx.userGoal.findMany({
        where: { userId, isActive: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: GOAL_SELECT,
      });

      if (activeGoals.length > 1) {
        throw new ConflictException(
          'Multiple active goals require administrative repair.',
        );
      }

      const currentGoal = activeGoals[0];
      if (
        currentGoal &&
        isSameGoal(currentGoal, {
          targetLevelId: level.id,
          targetBand,
          dailyMinutes: dto.dailyMinutes,
          reminderEnabled: dto.reminderEnabled,
          reminderTime: parsedReminderTime,
          startDate: parsedStartDate,
        })
      ) {
        return { success: true, data: serializeGoal(currentGoal) };
      }

      await tx.userGoal.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });

      const createdGoal = await tx.userGoal.create({
        data: {
          userId,
          targetLevelId: level.id,
          targetBand,
          dailyMinutes: dto.dailyMinutes,
          reminderEnabled: dto.reminderEnabled,
          reminderTime: parsedReminderTime,
          startDate: parsedStartDate,
          isActive: true,
        },
        select: GOAL_SELECT,
      });

      return { success: true, data: serializeGoal(createdGoal) };
    });
  }

  async getCurrentLearningPlan(
    userId: number,
  ): Promise<ApiSuccessResponse<LearningPlanView | null>> {
    const plan = await this.prisma.learningPlan.findFirst({
      where: { userId, status: 'active' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: PLAN_PUBLIC_SELECT,
    });

    return {
      success: true,
      data: plan ? serializePlan(plan) : null,
    };
  }

  async generateLearningPlan(
    userId: number,
  ): Promise<ApiSuccessResponse<LearningPlanView>> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockActiveUser(tx, userId);

      const goal = await tx.userGoal.findFirst({
        where: { userId, isActive: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: GOAL_SELECT,
      });

      if (!goal) {
        throw new BadRequestException(
          'An active goal is required before generating a learning plan.',
        );
      }

      const activePlans = await tx.learningPlan.findMany({
        where: { userId, status: 'active' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: PLAN_SELECT,
      });

      if (activePlans.length > 1) {
        throw new ConflictException(
          'Multiple active learning plans require administrative repair.',
        );
      }

      const lessons = await tx.lesson.findMany({
        where: buildLessonReadyWhere({ levelId: goal.targetLevelId }),
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          description: true,
          orderIndex: true,
          slug: true,
        },
      });

      if (lessons.length === 0) {
        throw new ConflictException(
          'No published lessons are available for the selected level.',
        );
      }

      const currentPlan = activePlans[0];
      if (
        currentPlan &&
        isPlanForGoal(currentPlan, goal) &&
        hasSameLessonSnapshot(currentPlan, lessons)
      ) {
        return { success: true, data: serializePlan(currentPlan) };
      }

      const scheduledItems = lessons.map((lesson, index) => ({
        lessonId: lesson.id,
        orderIndex: index + 1,
        scheduledDate: addUtcDays(goal.startDate, index),
      }));
      const endDate = scheduledItems[scheduledItems.length - 1].scheduledDate;

      if (currentPlan) {
        await tx.learningPlan.updateMany({
          where: { userId, status: 'active' },
          data: { status: 'cancelled' },
        });
      }

      const plan = await tx.learningPlan.create({
        data: {
          userId,
          targetLevelId: goal.targetLevelId,
          targetBand: goal.targetBand,
          generatedFromPlacementId: null,
          status: 'active',
          startDate: goal.startDate,
          endDate,
          items: {
            create: scheduledItems,
          },
        },
        select: PLAN_SELECT,
      });

      return { success: true, data: serializePlan(plan) };
    });
  }

  private async lockActiveUser(tx: Prisma.TransactionClient, userId: number) {
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "User"
      WHERE "id" = ${userId}
        AND "status" = 'active'
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;

    if (rows.length !== 1) {
      throw new UnauthorizedException('Account is not available.');
    }
  }
}

function resolveTargetBand(
  requestedBand: number | null | undefined,
  minBand: number,
  maxBand: number,
): number {
  if (requestedBand === null || requestedBand === undefined) {
    if (minBand === maxBand) {
      return minBand;
    }

    throw new BadRequestException(
      `targetBand is required and must be between ${minBand} and ${maxBand}.`,
    );
  }

  if (requestedBand < minBand || requestedBand > maxBand) {
    throw new BadRequestException(
      `targetBand must be between ${minBand} and ${maxBand}.`,
    );
  }

  return requestedBand;
}

function resolveReminderTime(
  reminderEnabled: boolean,
  reminderTime: string | null | undefined,
): Date | null {
  if (!reminderEnabled) {
    if (reminderTime !== null && reminderTime !== undefined) {
      throw new BadRequestException(
        'reminderTime is only allowed when reminderEnabled is true.',
      );
    }

    return null;
  }

  if (!reminderTime) {
    throw new BadRequestException(
      'reminderTime is required when reminderEnabled is true.',
    );
  }

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
    throw new BadRequestException(
      'reminderTime must use HH:mm (24-hour) format.',
    );
  }

  return new Date(`1970-01-01T${reminderTime}:00.000Z`);
}

function parseDateOnly(value: string, fieldName: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${fieldName} must use YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || formatDateOnly(parsed) !== value) {
    throw new BadRequestException(
      `${fieldName} must be a valid calendar date.`,
    );
  }

  return parsed;
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatTimeOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(11, 16) : null;
}

function isSameGoal(
  goal: GoalRecord,
  expected: {
    targetLevelId: number;
    targetBand: number;
    dailyMinutes: number;
    reminderEnabled: boolean;
    reminderTime: Date | null;
    startDate: Date;
  },
): boolean {
  return (
    goal.targetLevelId === expected.targetLevelId &&
    goal.targetBand === expected.targetBand &&
    goal.dailyMinutes === expected.dailyMinutes &&
    goal.reminderEnabled === expected.reminderEnabled &&
    formatTimeOnly(goal.reminderTime) ===
      formatTimeOnly(expected.reminderTime) &&
    formatDateOnly(goal.startDate) === formatDateOnly(expected.startDate)
  );
}

function isPlanForGoal(
  plan: { targetLevelId: number; targetBand: number | null; startDate: Date },
  goal: { targetLevelId: number; targetBand: number | null; startDate: Date },
): boolean {
  return (
    plan.targetLevelId === goal.targetLevelId &&
    plan.targetBand === goal.targetBand &&
    formatDateOnly(plan.startDate) === formatDateOnly(goal.startDate)
  );
}

function hasSameLessonSnapshot(
  plan: { items: Array<{ lesson: { id: number } }> },
  lessons: Array<{ id: number }>,
): boolean {
  return (
    plan.items.length === lessons.length &&
    plan.items.every((item, index) => item.lesson.id === lessons[index].id)
  );
}

function serializeGoal(goal: GoalRecord): UserGoalView {
  if (goal.targetBand === null) {
    throw new ConflictException('The active goal has no resolved target band.');
  }

  return {
    id: goal.id,
    targetLevelId: goal.targetLevelId,
    targetBand: goal.targetBand,
    dailyMinutes: goal.dailyMinutes,
    reminderEnabled: goal.reminderEnabled,
    reminderTime: formatTimeOnly(goal.reminderTime),
    startDate: formatDateOnly(goal.startDate),
    isActive: goal.isActive,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    targetLevel: goal.targetLevel,
  };
}

function serializePlan(plan: PlanRecord): LearningPlanView {
  return {
    id: plan.id,
    targetLevelId: plan.targetLevelId,
    targetBand: plan.targetBand,
    generatedFromPlacementId: plan.generatedFromPlacementId,
    status: plan.status,
    startDate: formatDateOnly(plan.startDate),
    endDate: plan.endDate ? formatDateOnly(plan.endDate) : null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    targetLevel: plan.targetLevel,
    items: plan.items.map((item) => ({
      id: item.id,
      orderIndex: item.orderIndex,
      scheduledDate: item.scheduledDate
        ? formatDateOnly(item.scheduledDate)
        : null,
      status: item.status,
      lesson: item.lesson,
    })),
  };
}
