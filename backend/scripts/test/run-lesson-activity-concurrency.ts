import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { SubmitLessonExerciseAttemptDto } from '../../src/modules/learning/activity/dto/lesson-activity-write.dto';
import { classifyLessonActivityPersistenceError } from '../../src/modules/learning/activity/lesson-activity-persistence';
import { LessonActivityService } from '../../src/modules/learning/activity/lesson-activity.service';
import {
  LessonActivityTransactionCheckpoint,
  LessonActivityTransactionCoordinator,
  LessonActivityTransactionOperation,
} from '../../src/modules/learning/activity/lesson-activity-transaction-coordinator';
import { PrismaService } from '../../src/prisma/prisma.service';

const COORDINATION_TIMEOUT_MS = 2_000;
const BARRIER_TIMEOUT_MS = 4_000;

type Participant = 'A' | 'B';
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};
type Outcome =
  | { status: 'fulfilled'; value: unknown }
  | { status: 'rejected'; reason: unknown };
type RaceControl = {
  operationA: LessonActivityTransactionOperation;
  operationB: LessonActivityTransactionOperation;
  aLocked: Deferred<void>;
  releaseA: Deferred<void>;
  bPid: Deferred<number>;
  bCrossedLock: boolean;
};

class ActivityConcurrencyHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityConcurrencyHarnessError';
  }
}

class HarnessCoordinator extends LessonActivityTransactionCoordinator {
  constructor(
    private readonly participant: Participant,
    private readonly control: RaceControl,
    private readonly lockTimeoutMs = 3_000,
  ) {
    super();
  }

  override async checkpoint(
    checkpoint: LessonActivityTransactionCheckpoint,
  ): Promise<void> {
    const expected =
      this.participant === 'A'
        ? this.control.operationA
        : this.control.operationB;
    if (checkpoint.operation !== expected) {
      throw new ActivityConcurrencyHarnessError(
        `Transaction ${this.participant} reached an unexpected production operation.`,
      );
    }

    if (checkpoint.phase === 'before_user_lock') {
      const pid = await configureTransaction(
        checkpoint.transaction,
        this.lockTimeoutMs,
      );
      if (this.participant === 'B') this.control.bPid.resolve(pid);
      return;
    }

    if (this.participant === 'A') {
      this.control.aLocked.resolve();
      await withTimeout(
        this.control.releaseA.promise,
        BARRIER_TIMEOUT_MS,
        'Transaction A release barrier',
      );
      return;
    }
    this.control.bCrossedLock = true;
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createControl(
  operationA: LessonActivityTransactionOperation,
  operationB: LessonActivityTransactionOperation,
): RaceControl {
  return {
    operationA,
    operationB,
    aLocked: createDeferred<void>(),
    releaseA: createDeferred<void>(),
    bPid: createDeferred<number>(),
    bCrossedLock: false,
  };
}

function asOutcome(promise: Promise<unknown>): Promise<Outcome> {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ActivityConcurrencyHarnessError(`${label} timed out.`)),
      milliseconds,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function configureTransaction(
  transaction: Prisma.TransactionClient,
  lockTimeoutMs: number,
): Promise<number> {
  await transaction.$executeRawUnsafe(`SET LOCAL statement_timeout = '4500ms'`);
  await transaction.$executeRawUnsafe(
    `SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`,
  );
  const [backend] = await transaction.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid()::int AS pid
  `;
  return backend.pid;
}

async function waitUntilBlockedOrSettled(
  observer: PrismaClient,
  pid: number,
  isSettled: () => boolean,
) {
  const deadline = Date.now() + COORDINATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isSettled()) return 'settled' as const;
    const state = await observer.$queryRaw<
      Array<{ waitEventType: string | null }>
    >`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE pid = ${pid}
    `;
    if (state[0]?.waitEventType === 'Lock') return 'blocked' as const;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new ActivityConcurrencyHarnessError(
    'Transaction B did not reach wait_event_type=Lock before release.',
  );
}

async function runRace(input: {
  observer: PrismaClient;
  prismaA: PrismaService;
  prismaB: PrismaService;
  operationA: LessonActivityTransactionOperation;
  operationB: LessonActivityTransactionOperation;
  callA: (service: LessonActivityService) => Promise<unknown>;
  callB: (service: LessonActivityService) => Promise<unknown>;
}) {
  const control = createControl(input.operationA, input.operationB);
  const serviceA = new LessonActivityService(
    input.prismaA,
    new HarnessCoordinator('A', control),
  );
  const serviceB = new LessonActivityService(
    input.prismaB,
    new HarnessCoordinator('B', control),
  );
  const outcomeA = asOutcome(input.callA(serviceA));
  await withTimeout(control.aLocked.promise, BARRIER_TIMEOUT_MS, 'A user lock');
  let bSettled = false;
  const outcomeB = asOutcome(input.callB(serviceB)).finally(() => {
    bSettled = true;
  });

  try {
    const pid = await withTimeout(
      control.bPid.promise,
      BARRIER_TIMEOUT_MS,
      'B pid',
    );
    const state = await waitUntilBlockedOrSettled(
      input.observer,
      pid,
      () => bSettled,
    );
    if (state !== 'blocked') {
      throw new ActivityConcurrencyHarnessError(
        'Transaction B settled before Transaction A released.',
      );
    }
    control.releaseA.resolve();
    const [transactionA, transactionB] = await Promise.all([
      outcomeA,
      outcomeB,
    ]);
    if (transactionA.status !== 'fulfilled') {
      throw new ActivityConcurrencyHarnessError(
        'Transaction A did not commit.',
      );
    }
    if (transactionB.status !== 'fulfilled') {
      throw new ActivityConcurrencyHarnessError(
        'Transaction B failed outside the expected serialized success path.',
      );
    }
    if (!control.bCrossedLock) {
      throw new ActivityConcurrencyHarnessError(
        'Transaction B never crossed the production user-lock checkpoint.',
      );
    }
    return { transactionA, transactionB };
  } catch (error) {
    control.releaseA.resolve();
    await Promise.all([outcomeA, outcomeB]);
    throw error;
  }
}

async function assertMigrationOnlyDatabase(observer: PrismaClient) {
  const [counts] = await observer.$queryRaw<Array<Record<string, number>>>`
    SELECT
      (SELECT COUNT(*)::int FROM "User") AS users,
      (SELECT COUNT(*)::int FROM "Level") AS levels,
      (SELECT COUNT(*)::int FROM "Lesson") AS lessons,
      (SELECT COUNT(*)::int FROM "Topic") AS topics,
      (SELECT COUNT(*)::int FROM "LessonExercise") AS exercises,
      (SELECT COUNT(*)::int FROM "LessonExerciseAttempt") AS attempts,
      (SELECT COUNT(*)::int FROM "Progress") AS progresses,
      (SELECT COUNT(*)::int FROM "UserTopicProgress") AS topic_progresses,
      (SELECT COUNT(*)::int FROM "LearningEvent") AS events
  `;
  if (!counts || Object.values(counts).some((count) => count !== 0)) {
    throw new ActivityConcurrencyHarnessError(
      'Lesson Activity concurrency test requires a fresh migration-only disposable database.',
    );
  }
}

async function createTopicFixture(
  observer: PrismaClient,
  levelId: number,
  orderIndex: number,
  suffix: string,
) {
  const lesson = await observer.lesson.create({
    data: {
      levelId,
      title: `Activity concurrency topic ${orderIndex}`,
      slug: `activity-concurrency-topic-${orderIndex}-${suffix}`,
      orderIndex,
      status: 'published',
      publishedAt: new Date(),
    },
  });
  const topic = await observer.topic.create({
    data: {
      lessonId: lesson.id,
      title: `Topic ${orderIndex}`,
      content: {},
      orderIndex: 1,
      status: 'published',
      publishedAt: new Date(),
    },
  });
  const exercise = await observer.lessonExercise.create({
    data: {
      lessonId: lesson.id,
      topicId: topic.id,
      type: 'mcq',
      prompt: 'Choose A',
      content: {
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
      answer: { optionId: 'a' },
      orderIndex: 1,
      status: 'published',
    },
  });
  return { lesson, topic, exercise };
}

async function createStandaloneFixture(
  observer: PrismaClient,
  levelId: number,
  orderIndex: number,
  suffix: string,
) {
  const lesson = await observer.lesson.create({
    data: {
      levelId,
      title: `Activity concurrency standalone ${orderIndex}`,
      slug: `activity-concurrency-standalone-${orderIndex}-${suffix}`,
      orderIndex,
      status: 'published',
      publishedAt: new Date(),
      stories: {
        create: {
          levelId,
          title: `Instructions ${orderIndex}`,
          slug: `activity-concurrency-story-${orderIndex}-${suffix}`,
          content: {},
          status: 'published',
        },
      },
    },
  });
  const exercise = await observer.lessonExercise.create({
    data: {
      lessonId: lesson.id,
      type: 'mcq',
      prompt: 'Choose A',
      content: {
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
      answer: { optionId: 'a' },
      orderIndex: 1,
      status: 'published',
    },
  });
  return { lesson, exercise };
}

const correctAttempt: SubmitLessonExerciseAttemptDto = {
  answer: { optionId: 'a' },
  durationSeconds: 7,
};

async function main() {
  const { databaseName, databaseUrl } = assertDisposableTestDatabase();
  const observer = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const prismaA = new PrismaService({
    datasources: { db: { url: databaseUrl } },
  });
  const prismaB = new PrismaService({
    datasources: { db: { url: databaseUrl } },
  });
  const suffix = randomUUID().replace(/-/g, '');
  console.log(
    `Running Lesson Activity production-path concurrency on "${databaseName}"`,
  );

  try {
    await assertMigrationOnlyDatabase(observer);
    const user = await observer.user.create({
      data: {
        email: `activity-concurrency-${suffix}@example.com`,
        password: '$argon2id$activity-concurrency-test-hash',
      },
    });
    const level = await observer.level.create({
      data: {
        name: 'HSK1',
        code: 'HSK1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        status: 'published',
        publishedAt: new Date(),
      },
    });
    const setup = new LessonActivityService(
      observer as PrismaService,
      new LessonActivityTransactionCoordinator(),
    );

    const same = await createTopicFixture(observer, level.id, 1, suffix);
    await setup.startLesson(user.id, same.lesson.id, 'same-start-lesson');
    await setup.startTopic(user.id, same.topic.id, 'same-start-topic01');
    const sameRace = await runRace({
      observer,
      prismaA,
      prismaB,
      operationA: 'exercise.submit',
      operationB: 'exercise.submit',
      callA: (service) =>
        service.submitAttempt(
          user.id,
          same.exercise.id,
          correctAttempt,
          'same-key-attempt1',
        ),
      callB: (service) =>
        service.submitAttempt(
          user.id,
          same.exercise.id,
          correctAttempt,
          'same-key-attempt1',
        ),
    });
    const sameCounts = await Promise.all([
      observer.lessonExerciseAttempt.count({
        where: { userId: user.id, exerciseId: same.exercise.id },
      }),
      observer.learningEvent.count({
        where: { userId: user.id, exerciseId: same.exercise.id },
      }),
    ]);
    if (
      sameCounts[0] !== 1 ||
      sameCounts[1] !== 1 ||
      JSON.stringify(sameRace.transactionA.value) !==
        JSON.stringify(sameRace.transactionB.value)
    ) {
      throw new ActivityConcurrencyHarnessError(
        'Same-key race created duplicate facts or returned a different result.',
      );
    }
    console.log(
      'Same key: GREEN (B observed Lock; both production calls resolved one attempt/event).',
    );

    const different = await createTopicFixture(observer, level.id, 2, suffix);
    await setup.startLesson(user.id, different.lesson.id, 'diff-start-lesson');
    const differentRace = await runRace({
      observer,
      prismaA,
      prismaB,
      operationA: 'exercise.submit',
      operationB: 'exercise.submit',
      callA: (service) =>
        service.submitAttempt(
          user.id,
          different.exercise.id,
          correctAttempt,
          'different-key-one',
        ),
      callB: (service) =>
        service.submitAttempt(
          user.id,
          different.exercise.id,
          correctAttempt,
          'different-key-two',
        ),
    });
    void differentRace;
    const attemptNumbers = (
      await observer.lessonExerciseAttempt.findMany({
        where: { userId: user.id, exerciseId: different.exercise.id },
        orderBy: { attemptNumber: 'asc' },
        select: { attemptNumber: true },
      })
    ).map((attempt) => attempt.attemptNumber);
    if (attemptNumbers.join(',') !== '1,2') {
      throw new ActivityConcurrencyHarnessError(
        'Different-key race did not produce consecutive attempt numbers.',
      );
    }
    console.log(
      'Different keys: GREEN (B observed Lock; final attemptNumber sequence 1,2).',
    );

    const topicRaceFixture = await createTopicFixture(
      observer,
      level.id,
      3,
      suffix,
    );
    await setup.startLesson(
      user.id,
      topicRaceFixture.lesson.id,
      'topic-race-lesson',
    );
    await setup.startTopic(
      user.id,
      topicRaceFixture.topic.id,
      'topic-race-start01',
    );
    await runRace({
      observer,
      prismaA,
      prismaB,
      operationA: 'exercise.submit',
      operationB: 'topic.complete',
      callA: (service) =>
        service.submitAttempt(
          user.id,
          topicRaceFixture.exercise.id,
          correctAttempt,
          'topic-race-attempt',
        ),
      callB: (service) =>
        service.completeTopic(
          user.id,
          topicRaceFixture.topic.id,
          'topic-race-complete',
        ),
    });
    const finalTopic = await observer.userTopicProgress.findUniqueOrThrow({
      where: {
        userId_topicId: { userId: user.id, topicId: topicRaceFixture.topic.id },
      },
    });
    if (finalTopic.status !== 'done' || finalTopic.completionPercent !== 100) {
      throw new ActivityConcurrencyHarnessError(
        'Submit/topic-complete race regressed final topic progress.',
      );
    }
    console.log(
      'Submit / Topic complete: GREEN (B observed Lock; final Topic done/100).',
    );

    const lessonRaceFixture = await createStandaloneFixture(
      observer,
      level.id,
      4,
      suffix,
    );
    await setup.startLesson(
      user.id,
      lessonRaceFixture.lesson.id,
      'lesson-race-start',
    );
    await runRace({
      observer,
      prismaA,
      prismaB,
      operationA: 'exercise.submit',
      operationB: 'lesson.complete',
      callA: (service) =>
        service.submitAttempt(
          user.id,
          lessonRaceFixture.exercise.id,
          correctAttempt,
          'lesson-race-attempt',
        ),
      callB: (service) =>
        service.completeLesson(
          user.id,
          lessonRaceFixture.lesson.id,
          'lesson-race-complete',
        ),
    });
    const finalLesson = await observer.progress.findUniqueOrThrow({
      where: {
        userId_lessonId: {
          userId: user.id,
          lessonId: lessonRaceFixture.lesson.id,
        },
      },
    });
    if (
      finalLesson.status !== 'done' ||
      finalLesson.completionPercent !== 100
    ) {
      throw new ActivityConcurrencyHarnessError(
        'Final attempt/lesson-complete race produced invalid progress.',
      );
    }
    console.log(
      'Final attempt / Lesson complete: GREEN (B observed Lock; final Lesson done/100).',
    );

    const timeoutFixture = await createTopicFixture(
      observer,
      level.id,
      5,
      suffix,
    );
    await setup.startLesson(
      user.id,
      timeoutFixture.lesson.id,
      'timeout-start-lesson',
    );
    const timeoutControl = createControl('exercise.submit', 'exercise.submit');
    const timeoutServiceA = new LessonActivityService(
      prismaA,
      new HarnessCoordinator('A', timeoutControl),
    );
    const timeoutServiceB = new LessonActivityService(
      prismaB,
      new HarnessCoordinator('B', timeoutControl, 800),
    );
    const timeoutKey = 'timeout-retry-key01';
    const timeoutA = asOutcome(
      timeoutServiceA.submitAttempt(
        user.id,
        timeoutFixture.exercise.id,
        correctAttempt,
        timeoutKey,
      ),
    );
    await withTimeout(
      timeoutControl.aLocked.promise,
      BARRIER_TIMEOUT_MS,
      'timeout A lock',
    );
    let timeoutBSettled = false;
    const timeoutB = asOutcome(
      timeoutServiceB.submitAttempt(
        user.id,
        timeoutFixture.exercise.id,
        correctAttempt,
        timeoutKey,
      ),
    ).finally(() => {
      timeoutBSettled = true;
    });
    const timeoutPid = await withTimeout(
      timeoutControl.bPid.promise,
      BARRIER_TIMEOUT_MS,
      'timeout B pid',
    );
    const timeoutState = await waitUntilBlockedOrSettled(
      observer,
      timeoutPid,
      () => timeoutBSettled,
    );
    if (timeoutState !== 'blocked') {
      throw new ActivityConcurrencyHarnessError(
        'Timeout scenario did not observe Transaction B blocked.',
      );
    }
    const timeoutBResult = await timeoutB;
    timeoutControl.releaseA.resolve();
    const timeoutAResult = await timeoutA;
    if (
      timeoutAResult.status !== 'fulfilled' ||
      timeoutBResult.status !== 'rejected' ||
      !(timeoutBResult.reason instanceof HttpException) ||
      timeoutBResult.reason.getStatus() !== 503
    ) {
      throw new ActivityConcurrencyHarnessError(
        'Lock timeout was incorrectly classified as business success.',
      );
    }
    const retry = await setup.submitAttempt(
      user.id,
      timeoutFixture.exercise.id,
      correctAttempt,
      timeoutKey,
    );
    if (
      (await observer.lessonExerciseAttempt.count({
        where: { userId: user.id, exerciseId: timeoutFixture.exercise.id },
      })) !== 1 ||
      retry.data.attemptNumber !== 1
    ) {
      throw new ActivityConcurrencyHarnessError(
        'Retry after timeout did not resolve to exactly one attempt.',
      );
    }
    console.log(
      'Timeout retry: GREEN (B observed Lock, returned 503; same-key retry found one committed fact).',
    );

    const classifierMatrix = [
      [{ code: '55P03' }, 'timeout'],
      [{ code: '57014' }, 'timeout'],
      [{ code: '40P01' }, 'concurrent_retry'],
      [{ code: 'P2028' }, 'timeout'],
      [{ code: '08006' }, 'connection_error'],
      [{ code: 'P2002' }, 'unique_conflict'],
    ] as const;
    for (const [error, expected] of classifierMatrix) {
      if (classifyLessonActivityPersistenceError(error) !== expected) {
        throw new ActivityConcurrencyHarnessError(
          'Persistence classifier matrix produced an unsafe classification.',
        );
      }
    }
    console.log(
      'Failure classifier: GREEN (timeout/deadlock/connection/constraint are never business success).',
    );
    console.log('Lesson Activity production-path concurrency tests passed');
  } finally {
    await Promise.all([
      observer.$disconnect(),
      prismaA.$disconnect(),
      prismaB.$disconnect(),
    ]);
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof ActivityConcurrencyHarnessError
      ? error.message
      : 'Lesson Activity concurrency failed with a non-domain error.';
  console.error(message);
  process.exitCode = 1;
});
