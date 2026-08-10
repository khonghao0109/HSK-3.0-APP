import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

import { CreateGoalDto } from './dto/create-goal.dto';
import { OnboardingService } from './onboarding.service';

const startDate = new Date('2026-08-11T00:00:00.000Z');
const createdAt = new Date('2026-08-10T00:00:00.000Z');

const level = {
  id: 1,
  code: 'HSK1',
  name: 'HSK 1',
  minBand: 1,
  maxBand: 1,
};

const goal = {
  id: 10,
  userId: 1,
  targetLevelId: level.id,
  targetBand: 1,
  dailyMinutes: 30,
  reminderEnabled: false,
  reminderTime: null,
  startDate,
  isActive: true,
  createdAt,
  updatedAt: createdAt,
  targetLevel: level,
};

const goalDto: CreateGoalDto = {
  targetLevelId: level.id,
  dailyMinutes: 30,
  reminderEnabled: false,
  reminderTime: null,
  startDate: '2026-08-11',
};

function createHarness() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    level: { findFirst: jest.fn() },
    userGoal: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    learningPlan: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    lesson: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    userGoal: { findFirst: jest.fn() },
    learningPlan: { findFirst: jest.fn() },
    placementAttempt: { count: jest.fn() },
  } as unknown as PrismaService;

  return { service: new OnboardingService(prisma), prisma, tx };
}

describe('OnboardingService goals', () => {
  it('rejects a draft/deleted/non-existent level through the public-level lookup', async () => {
    const { service, tx } = createHarness();
    tx.level.findFirst.mockResolvedValue(null);

    await expect(service.setGoal(1, goalDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.level.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 1,
          status: 'published',
          deletedAt: null,
        },
      }),
    );
  });

  it('rejects a target band outside the selected level range', async () => {
    const { service, tx } = createHarness();
    tx.level.findFirst.mockResolvedValue(level);

    await expect(
      service.setGoal(1, { ...goalDto, targetBand: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('automatically resolves the band for a single-band level such as HSK1', async () => {
    const { service, tx } = createHarness();
    tx.level.findFirst.mockResolvedValue(level);
    tx.userGoal.findMany.mockResolvedValue([]);
    tx.userGoal.updateMany.mockResolvedValue({ count: 0 });
    tx.userGoal.create.mockResolvedValue(goal);

    const result = await service.setGoal(1, goalDto);

    expect(tx.userGoal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetBand: 1 }),
      }),
    );
    expect(result.data.targetBand).toBe(1);
  });

  it('requires targetBand for HSK7_9 or any multi-band level', async () => {
    const { service, tx } = createHarness();
    tx.level.findFirst.mockResolvedValue({
      ...level,
      id: 7,
      code: 'HSK7_9',
      minBand: 7,
      maxBand: 9,
    });

    await expect(
      service.setGoal(1, { ...goalDto, targetLevelId: 7 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the active goal for an identical retry without creating a row', async () => {
    const { service, tx } = createHarness();
    tx.level.findFirst.mockResolvedValue(level);
    tx.userGoal.findMany.mockResolvedValue([goal]);

    const result = await service.setGoal(1, goalDto);

    expect(result.data.id).toBe(goal.id);
    expect(tx.userGoal.updateMany).not.toHaveBeenCalled();
    expect(tx.userGoal.create).not.toHaveBeenCalled();
  });

  it('deactivates the old goal before creating a changed goal', async () => {
    const { service, tx } = createHarness();
    tx.level.findFirst.mockResolvedValue(level);
    tx.userGoal.findMany.mockResolvedValue([goal]);
    tx.userGoal.updateMany.mockResolvedValue({ count: 1 });
    tx.userGoal.create.mockResolvedValue({
      ...goal,
      id: 11,
      dailyMinutes: 45,
    });

    await service.setGoal(1, { ...goalDto, dailyMinutes: 45 });

    expect(tx.userGoal.updateMany).toHaveBeenCalledWith({
      where: { userId: 1, isActive: true },
      data: { isActive: false },
    });
    expect(tx.userGoal.create).toHaveBeenCalled();
  });

  it('scopes the current-goal lookup to the JWT owner', async () => {
    const { service, prisma } = createHarness();
    const findFirst = (prisma.userGoal as unknown as { findFirst: jest.Mock })
      .findFirst;
    findFirst.mockResolvedValue(null);

    await expect(service.getCurrentGoal(22)).resolves.toEqual({
      success: true,
      data: null,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 22, isActive: true } }),
    );
  });
});

describe('OnboardingService learning plans', () => {
  const lessons = [
    {
      id: 20,
      title: 'Lesson A',
      description: null,
      orderIndex: 1,
      slug: 'lesson-a',
    },
    {
      id: 21,
      title: 'Lesson B',
      description: 'Second lesson',
      orderIndex: 2,
      slug: 'lesson-b',
    },
  ];

  const plan = {
    id: 30,
    userId: 1,
    targetLevelId: 1,
    targetBand: 1,
    generatedFromPlacementId: null,
    status: 'active',
    startDate,
    endDate: new Date('2026-08-12T00:00:00.000Z'),
    createdAt,
    updatedAt: createdAt,
    targetLevel: level,
    items: lessons.map((lesson, index) => ({
      id: 40 + index,
      orderIndex: index + 1,
      scheduledDate: new Date(
        `2026-08-${String(11 + index).padStart(2, '0')}T00:00:00.000Z`,
      ),
      status: 'planned',
      lesson,
    })),
  };

  it('selects only published, non-deleted lessons in stable order and schedules one per day', async () => {
    const { service, tx } = createHarness();
    tx.userGoal.findFirst.mockResolvedValue(goal);
    tx.learningPlan.findMany.mockResolvedValue([]);
    tx.lesson.findMany.mockResolvedValue(lessons);
    tx.learningPlan.create.mockResolvedValue(plan);

    const result = await service.generateLearningPlan(1);

    expect(tx.lesson.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { levelId: 1, status: 'published', deletedAt: null },
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(tx.learningPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({
                lessonId: 20,
                orderIndex: 1,
                scheduledDate: new Date('2026-08-11T00:00:00.000Z'),
              }),
              expect.objectContaining({
                lessonId: 21,
                orderIndex: 2,
                scheduledDate: new Date('2026-08-12T00:00:00.000Z'),
              }),
            ],
          },
        }),
      }),
    );
    expect(result.data.items.map((item) => item.scheduledDate)).toEqual([
      '2026-08-11',
      '2026-08-12',
    ]);
  });

  it('returns a matching active plan on retry without duplicating plan or items', async () => {
    const { service, tx } = createHarness();
    tx.userGoal.findFirst.mockResolvedValue(goal);
    tx.learningPlan.findMany.mockResolvedValue([plan]);

    const result = await service.generateLearningPlan(1);

    expect(result.data.id).toBe(plan.id);
    expect(tx.lesson.findMany).not.toHaveBeenCalled();
    expect(tx.learningPlan.create).not.toHaveBeenCalled();
  });

  it('rejects a plan with no public lessons instead of creating a misleading empty plan', async () => {
    const { service, tx } = createHarness();
    tx.userGoal.findFirst.mockResolvedValue(goal);
    tx.learningPlan.findMany.mockResolvedValue([]);
    tx.lesson.findMany.mockResolvedValue([]);

    await expect(service.generateLearningPlan(1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.learningPlan.create).not.toHaveBeenCalled();
  });

  it('scopes the current-plan lookup to the JWT owner', async () => {
    const { service, prisma } = createHarness();
    const findFirst = (
      prisma.learningPlan as unknown as { findFirst: jest.Mock }
    ).findFirst;
    findFirst.mockResolvedValue(null);

    await expect(service.getCurrentLearningPlan(22)).resolves.toEqual({
      success: true,
      data: null,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 22, status: 'active' } }),
    );
  });
});
