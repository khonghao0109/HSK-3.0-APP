import {
  ExerciseType,
  Prisma,
  type ProgressStatus,
  type TopicType,
} from '@prisma/client';

import {
  buildLessonReadyWhere,
  PUBLIC_CONTENT_WHERE,
  PUBLIC_LESSON_WORD_WHERE,
} from '../../../common/policies/lesson-readiness.policy';
import {
  PUBLIC_LESSON_EXERCISE_TYPES,
  PUBLIC_LESSON_EXERCISE_WHERE,
} from '../public-exercise.policy';
import { LessonActivityService } from './lesson-activity.service';

const LEVEL = { id: 7, code: 'HSK7_9', name: 'HSK 7-9' };

type ReadyLesson = {
  id: number;
  levelId: number;
  title: string;
  slug: string;
  orderIndex: number;
};

type PathProgress = {
  lessonId: number;
  status: ProgressStatus;
  completionPercent: number;
  lastActivityAt: Date | null;
};

type GraphTopic = {
  id: number;
  title: string;
  subtitle: string | null;
  type: TopicType;
  content: unknown;
  orderIndex: number;
  isPremium: boolean;
  isLocked: boolean;
};

type GraphExercise = {
  id: number;
  topicId: number | null;
  type: ExerciseType;
  prompt: string;
  content: unknown;
  answer: unknown;
  explanation: string | null;
  version: number;
  orderIndex: number;
  media: null;
};

type GraphQuery = {
  where: { id: number };
  select: { topics: { where: unknown }; exercises: { where: unknown } };
};

type Fixture = {
  readyLessons: ReadyLesson[];
  progresses: PathProgress[];
  topics?: GraphTopic[];
  exercises?: GraphExercise[];
  topicProgress?: Array<{ topicId: number; status: ProgressStatus }>;
  attemptedExerciseIds?: number[];
  wordCount?: number;
};

function readyLesson(id: number, orderIndex: number): ReadyLesson {
  return {
    id,
    levelId: LEVEL.id,
    title: `Lesson ${id}`,
    slug: `lesson-${id}`,
    orderIndex,
  };
}

function topic(id: number, type: TopicType, orderIndex: number): GraphTopic {
  return {
    id,
    title: `Topic ${id}`,
    subtitle: null,
    type,
    content: [{ type: 'text', value: `Topic ${id}` }],
    orderIndex,
    isPremium: false,
    isLocked: false,
  };
}

function exercise(
  id: number,
  topicId: number | null,
  orderIndex: number,
  type: ExerciseType = ExerciseType.mcq,
): GraphExercise {
  return {
    id,
    topicId,
    type,
    prompt: `Exercise ${id}`,
    content: { options: [{ id: 'a', text: 'A' }] },
    answer: { optionId: 'a' },
    explanation: null,
    version: 1,
    orderIndex,
    media: null,
  };
}

const t0 = new Date('2026-10-01T00:00:00Z');
const t1 = new Date('2026-10-02T00:00:00Z');
const t2 = new Date('2026-10-03T00:00:00Z');

/**
 * L1 done, L2 the most recent `learning` lesson, L3 opened earlier while L2
 * is not done, L4 without a row behind L3: one lesson per Q18 state.
 */
const FOUR_STATES: Fixture = {
  readyLessons: [
    readyLesson(104, 40),
    readyLesson(101, 10),
    readyLesson(103, 30),
    readyLesson(102, 20),
  ],
  progresses: [
    {
      lessonId: 101,
      status: 'done',
      completionPercent: 100,
      lastActivityAt: t2,
    },
    {
      lessonId: 102,
      status: 'learning',
      completionPercent: 40,
      lastActivityAt: t1,
    },
    {
      lessonId: 103,
      status: 'learning',
      completionPercent: 10,
      lastActivityAt: t0,
    },
  ],
};

function setup(fixture: Fixture) {
  const topics = fixture.topics ?? [];
  const exercises = fixture.exercises ?? [];
  const attempted = new Set(fixture.attemptedExerciseIds ?? []);
  const progressByLesson = new Map(
    fixture.progresses.map((progress) => [progress.lessonId, progress]),
  );
  const tx = {
    lesson: {
      findFirst: jest.fn((args: GraphQuery) => {
        const lesson = fixture.readyLessons.find(
          (candidate) => candidate.id === args.where.id,
        );
        if (!lesson) return Promise.resolve(null);
        return Promise.resolve({
          id: lesson.id,
          title: lesson.title,
          description: null,
          slug: lesson.slug,
          orderIndex: lesson.orderIndex,
          levelId: lesson.levelId,
          topics,
          exercises,
        });
      }),
      findMany: jest
        .fn()
        .mockResolvedValue(
          [...fixture.readyLessons].sort(
            (left, right) => left.orderIndex - right.orderIndex,
          ),
        ),
    },
    level: { findUniqueOrThrow: jest.fn().mockResolvedValue(LEVEL) },
    lessonWord: { count: jest.fn().mockResolvedValue(fixture.wordCount ?? 0) },
    progress: {
      findUnique: jest.fn(
        (args: { where: { userId_lessonId: { lessonId: number } } }) => {
          const row = progressByLesson.get(args.where.userId_lessonId.lessonId);
          return Promise.resolve(
            row
              ? {
                  status: row.status,
                  score: null,
                  completionPercent: row.completionPercent,
                  timeSpentSeconds: 0,
                  startedAt: t0,
                  completedAt: row.status === 'done' ? t2 : null,
                  lastActivityAt: row.lastActivityAt,
                }
              : null,
          );
        },
      ),
      findMany: jest.fn().mockResolvedValue(fixture.progresses),
    },
    userTopicProgress: {
      findMany: jest.fn().mockResolvedValue(
        (fixture.topicProgress ?? []).map((row) => ({
          topicId: row.topicId,
          status: row.status,
          completionPercent: row.status === 'done' ? 100 : 0,
          timeSpentSeconds: 0,
          startedAt: t0,
          completedAt: row.status === 'done' ? t1 : null,
          lastActivityAt: t1,
        })),
      ),
    },
    lessonExerciseAttempt: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          exercises
            .filter((item) => attempted.has(item.id))
            .map((item, index) => attemptRow(900 + index, item.id, 1)),
        ),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const service = new LessonActivityService(prisma as never, {} as never);
  return { service, tx, prisma };
}

function attemptRow(id: number, exerciseId: number, attemptNumber: number) {
  return {
    id,
    exerciseId,
    attemptNumber,
    isCorrect: true,
    score: 100,
    durationSeconds: 5,
    exerciseVersion: 1,
    feedbackVersion: 'lesson-activity-v1',
    submittedAt: t1,
    contentSnapshot: {},
    detailJson: null,
  };
}

describe('LessonActivityService.getLessonActivity snapshot', () => {
  it('reads every activity field in one REPEATABLE READ transaction', async () => {
    const { service, prisma } = setup(FOUR_STATES);

    await service.getLessonActivity(1, 102);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });
});

describe('LessonActivityService.getLessonActivity position and state', () => {
  it.each([
    [101, 1, 'done'],
    [102, 2, 'current'],
    [103, 3, 'available'],
    [104, 4, 'locked'],
  ] as const)(
    'reports lesson %i at position %i as %s, like the path',
    async (lessonId, position, state) => {
      const { service } = setup(FOUR_STATES);

      const { data } = await service.getLessonActivity(1, lessonId);

      expect(data.position).toBe(position);
      expect(data.state).toBe(state);
      expect(data.level).toEqual(LEVEL);
    },
  );

  it('never reports a lesson with an own Progress row as locked', async () => {
    const { service } = setup({
      readyLessons: [
        readyLesson(201, 1),
        readyLesson(202, 2),
        readyLesson(203, 3),
      ],
      progresses: [
        {
          lessonId: 203,
          status: 'not_started',
          completionPercent: 0,
          lastActivityAt: null,
        },
      ],
    });

    const opened = await service.getLessonActivity(1, 203);
    const skipped = await service.getLessonActivity(1, 202);

    expect(opened.data.state).toBe('available');
    expect(opened.data.position).toBe(3);
    expect(skipped.data.state).toBe('locked');
  });

  it('reads ready lessons and progress of the lesson level with the path policy', async () => {
    const { service, tx } = setup(FOUR_STATES);

    await service.getLessonActivity(5, 103);

    expect(tx.lesson.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: buildLessonReadyWhere({ levelId: LEVEL.id }),
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(tx.progress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 5,
          lesson: { is: buildLessonReadyWhere({ levelId: LEVEL.id }) },
        },
      }),
    );
  });
});

describe('LessonActivityService.getLessonActivity sections', () => {
  const contentFixture: Fixture = {
    readyLessons: [readyLesson(301, 1)],
    progresses: [],
    topics: [
      topic(11, 'vocabulary', 1),
      topic(12, 'vocabulary', 2),
      topic(13, 'grammar', 3),
      topic(14, 'grammar', 4),
      topic(15, 'key_text', 5),
      topic(16, 'quiz', 6),
      topic(17, 'ai_speaking', 7),
    ],
    topicProgress: [
      { topicId: 11, status: 'done' },
      { topicId: 12, status: 'learning' },
      { topicId: 13, status: 'done' },
      { topicId: 15, status: 'done' },
      { topicId: 16, status: 'done' },
      { topicId: 17, status: 'done' },
    ],
    exercises: [
      exercise(21, 11, 1),
      exercise(22, null, 2, ExerciseType.fill_blank),
      exercise(23, null, 3),
    ],
    attemptedExerciseIds: [21, 23],
    wordCount: 6,
  };

  it('counts only vocabulary and grammar topics, done by topic progress', async () => {
    const { service } = setup(contentFixture);

    const { data } = await service.getLessonActivity(1, 301);

    expect(data.sections.vocabulary).toEqual({
      wordCount: 6,
      topicCount: 2,
      topicsDone: 1,
    });
    expect(data.sections.grammar).toEqual({ topicCount: 2, topicsDone: 1 });
  });

  it('counts public exercises and the ones with at least one attempt', async () => {
    const { service } = setup(contentFixture);

    const { data } = await service.getLessonActivity(1, 301);

    expect(data.sections.practice).toEqual({ exerciseCount: 3, attempted: 2 });
  });

  it('counts an exercise with several attempts once', async () => {
    const { service, tx } = setup(contentFixture);
    tx.lessonExerciseAttempt.findMany.mockResolvedValue([
      attemptRow(901, 21, 1),
      attemptRow(902, 21, 2),
    ]);

    const { data } = await service.getLessonActivity(1, 301);

    expect(data.sections.practice).toEqual({ exerciseCount: 3, attempted: 1 });
  });

  it('counts through the public topic, exercise and word filters', async () => {
    const { service, tx } = setup(contentFixture);

    await service.getLessonActivity(1, 301);

    const [graphQuery] = tx.lesson.findFirst.mock.calls[0];
    expect(graphQuery.where).toEqual(buildLessonReadyWhere({ id: 301 }));
    expect(graphQuery.select.topics.where).toEqual(PUBLIC_CONTENT_WHERE);
    expect(graphQuery.select.exercises.where).toBe(
      PUBLIC_LESSON_EXERCISE_WHERE,
    );
    expect(PUBLIC_LESSON_EXERCISE_TYPES).not.toContain(
      ExerciseType.speaking_repeat,
    );
    expect(tx.lessonWord.count).toHaveBeenCalledWith({
      where: { lessonId: 301, ...PUBLIC_LESSON_WORD_WHERE },
    });
    expect(PUBLIC_LESSON_WORD_WHERE).toEqual({
      word: { is: { status: 'published', deletedAt: null } },
    });
  });

  it('reports zero counts for a lesson without topics or exercises', async () => {
    const { service } = setup({
      readyLessons: [readyLesson(401, 1)],
      progresses: [],
    });

    const { data } = await service.getLessonActivity(1, 401);

    expect(data.sections).toEqual({
      vocabulary: { wordCount: 0, topicCount: 0, topicsDone: 0 },
      grammar: { topicCount: 0, topicsDone: 0 },
      practice: { exerciseCount: 0, attempted: 0 },
    });
  });
});
