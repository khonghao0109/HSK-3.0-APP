import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import {
  assertExerciseAuthoringRace,
  assertFreshExerciseAuthoringCounts,
  ExerciseAuthoringConcurrencyHarnessError,
  type ExerciseAuthoringRaceEvidence,
  type ExerciseAuthoringTransactionOutcome,
  type ExpectedExerciseAuthoringBOutcome,
} from '../../src/common/test-support/exercise-authoring-concurrency-harness';
import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { sha256CanonicalJson } from '../../src/common/utils/canonical-json';
import { CmsActor } from '../../src/modules/cms/cms-workflow';
import {
  CmsTransactionCheckpoint,
  CmsTransactionCoordinator,
} from '../../src/modules/cms/cms-transaction-coordinator';
import { ExerciseAuthoringService } from '../../src/modules/cms/exercise-authoring.service';
import { ExerciseImportService } from '../../src/modules/cms/exercise-import/exercise-import.service';
import { createExerciseImportPreviewHash } from '../../src/modules/cms/exercise-import/lesson-exercise-import';
import { SubmitLessonExerciseAttemptDto } from '../../src/modules/learning/activity/dto/lesson-activity-write.dto';
import { LessonActivityService } from '../../src/modules/learning/activity/lesson-activity.service';
import {
  LessonActivityTransactionCheckpoint,
  LessonActivityTransactionCoordinator,
} from '../../src/modules/learning/activity/lesson-activity-transaction-coordinator';
import { PrismaService } from '../../src/prisma/prisma.service';

const COORDINATION_TIMEOUT_MS = 2_500;
const BARRIER_TIMEOUT_MS = 8_000;
const STATEMENT_TIMEOUT_MS = 7_000;
const LOCK_TIMEOUT_MS = 5_000;

type Participant = 'A' | 'B';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type RaceControl = {
  operationA: string;
  operationB: string;
  transactionAAfterLock: Deferred<void>;
  releaseTransactionA: Deferred<void>;
  transactionBBackendPid: Deferred<number>;
  transactionBAfterLockObserved: boolean;
};

type RunRaceInput = {
  observer: PrismaClient;
  control: RaceControl;
  callA: () => Promise<unknown>;
  callB: () => Promise<unknown>;
  transactionBContract: (
    transactionA: ExerciseAuthoringTransactionOutcome,
    transactionB: ExerciseAuthoringTransactionOutcome,
  ) => boolean;
  finalInvariant: (
    transactionA: ExerciseAuthoringTransactionOutcome,
    transactionB: ExerciseAuthoringTransactionOutcome,
  ) => Promise<boolean>;
};

type ExerciseSnapshot = {
  type: 'mcq';
  prompt: string;
  content: { options: Array<{ id: string; text: string }> };
  answer: { optionId: string };
  explanation: string | null;
  mediaId: null;
  orderIndex: number;
};

class HarnessCmsCoordinator extends CmsTransactionCoordinator {
  constructor(
    private readonly participant: Participant,
    private readonly control: RaceControl,
  ) {
    super();
  }

  override async checkpoint(
    checkpoint: CmsTransactionCheckpoint,
  ): Promise<void> {
    const expected =
      this.participant === 'A'
        ? this.control.operationA
        : this.control.operationB;
    if (String(checkpoint.operation) !== expected) {
      throw new ExerciseAuthoringConcurrencyHarnessError(
        `Transaction ${this.participant} reached an unexpected CMS operation.`,
      );
    }

    if (checkpoint.phase === 'before_lock') {
      const pid = await configureTransaction(checkpoint.transaction);
      if (this.participant === 'B') {
        this.control.transactionBBackendPid.resolve(pid);
      }
      return;
    }

    await afterProductionLock(this.participant, this.control);
  }
}

class HarnessActivityCoordinator extends LessonActivityTransactionCoordinator {
  constructor(
    private readonly participant: Participant,
    private readonly control: RaceControl,
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
    if (String(checkpoint.operation) !== expected) {
      throw new ExerciseAuthoringConcurrencyHarnessError(
        `Transaction ${this.participant} reached an unexpected Activity operation.`,
      );
    }

    const phase = String(checkpoint.phase);
    if (phase === 'before_user_lock') {
      const pid = await configureTransaction(checkpoint.transaction);
      if (this.participant === 'B') {
        this.control.transactionBBackendPid.resolve(pid);
      }
      return;
    }
    if (phase === 'after_content_lock') {
      await afterProductionLock(this.participant, this.control);
    }
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

function createRaceControl(
  operationA: string,
  operationB: string,
): RaceControl {
  return {
    operationA,
    operationB,
    transactionAAfterLock: createDeferred<void>(),
    releaseTransactionA: createDeferred<void>(),
    transactionBBackendPid: createDeferred<number>(),
    transactionBAfterLockObserved: false,
  };
}

async function afterProductionLock(
  participant: Participant,
  control: RaceControl,
): Promise<void> {
  if (participant === 'A') {
    control.transactionAAfterLock.resolve();
    await withTimeout(
      control.releaseTransactionA.promise,
      BARRIER_TIMEOUT_MS,
      'Transaction A production-lock release barrier',
    );
    return;
  }
  control.transactionBAfterLockObserved = true;
}

function asOutcome(
  promise: Promise<unknown>,
): Promise<ExerciseAuthoringTransactionOutcome> {
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
      () =>
        reject(
          new ExerciseAuthoringConcurrencyHarnessError(`${label} timed out.`),
        ),
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
): Promise<number> {
  await transaction.$executeRawUnsafe(
    `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`,
  );
  await transaction.$executeRawUnsafe(
    `SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`,
  );
  await transaction.$executeRawUnsafe(
    `SET LOCAL idle_in_transaction_session_timeout = '${BARRIER_TIMEOUT_MS + 2_000}ms'`,
  );
  const [connection] = await transaction.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid()::int AS pid
  `;
  return connection.pid;
}

async function waitUntilBlockedOrSettled(
  observer: PrismaClient,
  backendPid: number,
  isSettled: () => boolean,
): Promise<'blocked' | 'settled'> {
  const deadline = Date.now() + COORDINATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isSettled()) return 'settled';
    const activity = await observer.$queryRaw<
      Array<{ waitEventType: string | null }>
    >`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE pid = ${backendPid}
    `;
    if (activity[0]?.waitEventType === 'Lock') return 'blocked';
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new ExerciseAuthoringConcurrencyHarnessError(
    'Transaction B did not reach wait_event_type=Lock before release.',
  );
}

async function runRace(
  input: RunRaceInput,
): Promise<ExerciseAuthoringRaceEvidence> {
  const transactionAOutcome = asOutcome(input.callA());
  await withTimeout(
    input.control.transactionAAfterLock.promise,
    BARRIER_TIMEOUT_MS,
    'Transaction A production lock checkpoint',
  );

  let transactionBSettled = false;
  const transactionBOutcome = asOutcome(input.callB()).finally(() => {
    transactionBSettled = true;
  });

  try {
    const backendPid = await withTimeout(
      input.control.transactionBBackendPid.promise,
      BARRIER_TIMEOUT_MS,
      'Transaction B backend PID checkpoint',
    );
    const transactionBStateBeforeRelease = await waitUntilBlockedOrSettled(
      input.observer,
      backendPid,
      () => transactionBSettled,
    );
    input.control.releaseTransactionA.resolve();
    const [transactionA, transactionB] = await Promise.all([
      transactionAOutcome,
      transactionBOutcome,
    ]);
    const finalInvariantHolds = await input.finalInvariant(
      transactionA,
      transactionB,
    );
    return {
      transactionA,
      transactionB,
      transactionBStateBeforeRelease,
      transactionBAfterLockObserved:
        input.control.transactionBAfterLockObserved,
      transactionBContractHolds: input.transactionBContract(
        transactionA,
        transactionB,
      ),
      finalInvariantHolds,
    };
  } catch (error) {
    input.control.releaseTransactionA.resolve();
    await Promise.all([transactionAOutcome, transactionBOutcome]);
    throw error;
  }
}

async function assertMigrationOnlyDatabase(observer: PrismaClient) {
  const [counts] = await observer.$queryRaw<
    Array<{
      users: number;
      levels: number;
      lessons: number;
      topics: number;
      exercises: number;
      attempts: number;
      events: number;
      progresses: number;
      revisions: number;
      reviews: number;
      media: number;
      importJobs: number;
      importRowErrors: number;
      audits: number;
    }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM "User") AS users,
      (SELECT COUNT(*)::int FROM "Level") AS levels,
      (SELECT COUNT(*)::int FROM "Lesson") AS lessons,
      (SELECT COUNT(*)::int FROM "Topic") AS topics,
      (SELECT COUNT(*)::int FROM "LessonExercise") AS exercises,
      (SELECT COUNT(*)::int FROM "LessonExerciseAttempt") AS attempts,
      (SELECT COUNT(*)::int FROM "LearningEvent") AS events,
      (SELECT COUNT(*)::int FROM "Progress") AS progresses,
      (SELECT COUNT(*)::int FROM "ContentRevision") AS revisions,
      (SELECT COUNT(*)::int FROM "ContentReview") AS reviews,
      (SELECT COUNT(*)::int FROM "Media") AS media,
      (SELECT COUNT(*)::int FROM "ImportJob") AS "importJobs",
      (SELECT COUNT(*)::int FROM "ImportRowError") AS "importRowErrors",
      (SELECT COUNT(*)::int FROM "AuditLog") AS audits
  `;
  if (!counts) {
    throw new ExerciseAuthoringConcurrencyHarnessError(
      'Exercise Authoring preflight did not return database counts.',
    );
  }
  assertFreshExerciseAuthoringCounts(counts);
}

function exerciseSnapshot(input: {
  prompt: string;
  correctOptionId: 'a' | 'b';
  explanation: string;
  orderIndex?: number;
}): ExerciseSnapshot {
  return {
    type: 'mcq',
    prompt: input.prompt,
    content: {
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
    },
    answer: { optionId: input.correctOptionId },
    explanation: input.explanation,
    mediaId: null,
    orderIndex: input.orderIndex ?? 1,
  };
}

async function createLessonFixture(
  observer: PrismaClient,
  levelId: number,
  orderIndex: number,
  suffix: string,
) {
  const lesson = await observer.lesson.create({
    data: {
      levelId,
      title: `Exercise concurrency lesson ${orderIndex}`,
      slug: `exercise-concurrency-${orderIndex}-${suffix}`,
      orderIndex,
      status: 'published',
      publishedAt: new Date(),
    },
  });
  const topic = await observer.topic.create({
    data: {
      lessonId: lesson.id,
      title: `Exercise concurrency topic ${orderIndex}`,
      content: [{ type: 'text', value: 'Concurrency fixture.' }],
      orderIndex: 1,
      status: 'published',
      publishedAt: new Date(),
    },
  });
  return { lesson, topic };
}

async function createExerciseFixture(input: {
  observer: PrismaClient;
  adminId: number;
  lessonId: number;
  topicId: number;
  snapshot: ExerciseSnapshot;
  status: 'draft' | 'published';
  revision?: number;
  approved?: boolean;
}) {
  const revisionNumber = input.revision ?? 1;
  const exercise = await input.observer.lessonExercise.create({
    data: {
      lessonId: input.lessonId,
      topicId: input.topicId,
      ...input.snapshot,
      status: input.status,
      version: revisionNumber,
      publishedAt: input.status === 'published' ? new Date() : null,
      publishedById: input.status === 'published' ? input.adminId : null,
      createdById: input.adminId,
      updatedById: input.adminId,
    },
  });
  const revision = await input.observer.contentRevision.create({
    data: {
      entityType: 'lesson_exercise',
      entityId: exercise.id,
      revision: revisionNumber,
      snapshot: input.snapshot,
      contentHash: sha256CanonicalJson(input.snapshot),
      authorId: input.adminId,
      ...(input.approved
        ? {
            reviews: {
              create: { reviewerId: input.adminId, decision: 'approved' },
            },
          }
        : {}),
    },
  });
  return { exercise, revision };
}

function readData(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const data = (value as Record<string, unknown>).data;
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

function readNestedRecord(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = record?.[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFulfilledWith(
  outcome: ExerciseAuthoringTransactionOutcome,
  predicate: (data: Record<string, unknown>) => boolean,
): boolean {
  if (outcome.status !== 'fulfilled') return false;
  const data = readData(outcome.value);
  return data !== null && predicate(data);
}

function reportRace(
  scenario: Parameters<typeof assertExerciseAuthoringRace>[0],
  evidence: ExerciseAuthoringRaceEvidence,
  expectedB: ExpectedExerciseAuthoringBOutcome,
  summary: string,
) {
  assertExerciseAuthoringRace(scenario, evidence, expectedB);
  console.log(
    `${summary}: GREEN (B observed Lock; production contract and final invariant passed).`,
  );
}

async function main(): Promise<void> {
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
  const suffix = randomUUID().replace(/-/gu, '');
  const actor: CmsActor = { id: 0, role: 'admin' };

  console.log(
    `Running Exercise Authoring production-path concurrency on "${databaseName}"`,
  );

  try {
    await assertMigrationOnlyDatabase(observer);
    const admin = await observer.user.create({
      data: {
        email: `exercise-concurrency-admin-${suffix}@example.com`,
        password: '$argon2id$exercise-concurrency-test-hash',
        role: 'admin',
      },
    });
    actor.id = admin.id;
    const learner = await observer.user.create({
      data: {
        email: `exercise-concurrency-learner-${suffix}@example.com`,
        password: '$argon2id$exercise-concurrency-test-hash',
        role: 'user',
      },
    });
    const level = await observer.level.create({
      data: {
        name: 'HSK 1',
        code: 'HSK1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
      },
    });

    const revisionParent = await createLessonFixture(
      observer,
      level.id,
      1,
      suffix,
    );
    const stableV1 = exerciseSnapshot({
      prompt: 'Stable V1',
      correctOptionId: 'a',
      explanation: 'A is correct in V1.',
    });
    const revisionFixture = await createExerciseFixture({
      observer,
      adminId: admin.id,
      lessonId: revisionParent.lesson.id,
      topicId: revisionParent.topic.id,
      snapshot: stableV1,
      status: 'published',
      approved: true,
    });
    const revisionV2 = exerciseSnapshot({
      prompt: 'Concurrent draft V2',
      correctOptionId: 'b',
      explanation: 'B is correct in V2.',
    });
    const revisionV3 = exerciseSnapshot({
      prompt: 'Concurrent draft V3',
      correctOptionId: 'a',
      explanation: 'A is correct in V3.',
    });
    const revisionControl = createRaceControl(
      'exercise.create_revision',
      'exercise.create_revision',
    );
    const revisionServiceA = new ExerciseAuthoringService(
      prismaA,
      new HarnessCmsCoordinator('A', revisionControl),
    );
    const revisionServiceB = new ExerciseAuthoringService(
      prismaB,
      new HarnessCmsCoordinator('B', revisionControl),
    );
    const revisionRace = await runRace({
      observer,
      control: revisionControl,
      callA: () =>
        revisionServiceA.createExerciseRevision(
          actor,
          revisionFixture.exercise.id,
          revisionV2,
          { correlationId: `revision-a-${suffix}` },
        ),
      callB: () =>
        revisionServiceB.createExerciseRevision(
          actor,
          revisionFixture.exercise.id,
          revisionV3,
          { correlationId: `revision-b-${suffix}` },
        ),
      transactionBContract: (_a, b) =>
        isFulfilledWith(
          b,
          (data) => readNestedRecord(data, 'revision')?.revision === 3,
        ),
      finalInvariant: async () => {
        const [exercise, revisions] = await Promise.all([
          observer.lessonExercise.findUniqueOrThrow({
            where: { id: revisionFixture.exercise.id },
            select: { prompt: true, version: true, status: true },
          }),
          observer.contentRevision.findMany({
            where: {
              entityType: 'lesson_exercise',
              entityId: revisionFixture.exercise.id,
            },
            orderBy: { revision: 'asc' },
            select: { revision: true },
          }),
        ]);
        return (
          exercise.prompt === stableV1.prompt &&
          exercise.version === 1 &&
          exercise.status === 'published' &&
          revisions.map((revision) => revision.revision).join(',') === '1,2,3'
        );
      },
    });
    reportRace(
      'concurrent-revisions',
      revisionRace,
      { kind: 'commit' },
      'Concurrent revisions',
    );

    const publishParent = await createLessonFixture(
      observer,
      level.id,
      2,
      suffix,
    );
    const publishSnapshot = exerciseSnapshot({
      prompt: 'Publish once',
      correctOptionId: 'a',
      explanation: 'Published once.',
    });
    const publishFixture = await createExerciseFixture({
      observer,
      adminId: admin.id,
      lessonId: publishParent.lesson.id,
      topicId: publishParent.topic.id,
      snapshot: publishSnapshot,
      status: 'draft',
      approved: true,
    });
    const publishControl = createRaceControl(
      'exercise.publish',
      'exercise.publish',
    );
    const publishServiceA = new ExerciseAuthoringService(
      prismaA,
      new HarnessCmsCoordinator('A', publishControl),
    );
    const publishServiceB = new ExerciseAuthoringService(
      prismaB,
      new HarnessCmsCoordinator('B', publishControl),
    );
    const publishRace = await runRace({
      observer,
      control: publishControl,
      callA: () =>
        publishServiceA.publishExerciseRevision(
          actor,
          publishFixture.exercise.id,
          publishFixture.revision.id,
          { correlationId: `publish-a-${suffix}` },
        ),
      callB: () =>
        publishServiceB.publishExerciseRevision(
          actor,
          publishFixture.exercise.id,
          publishFixture.revision.id,
          { correlationId: `publish-b-${suffix}` },
        ),
      transactionBContract: (_a, b) =>
        isFulfilledWith(b, (data) => data.idempotent === true),
      finalInvariant: async () => {
        const [exercise, auditCount] = await Promise.all([
          observer.lessonExercise.findUniqueOrThrow({
            where: { id: publishFixture.exercise.id },
            select: { status: true, version: true, publishedAt: true },
          }),
          observer.auditLog.count({
            where: {
              action: 'lesson_exercise.published',
              targetId: String(publishFixture.exercise.id),
            },
          }),
        ]);
        return (
          exercise.status === 'published' &&
          exercise.version === 1 &&
          exercise.publishedAt !== null &&
          auditCount === 1
        );
      },
    });
    reportRace(
      'concurrent-publishes',
      publishRace,
      { kind: 'commit' },
      'Concurrent publishes',
    );

    const archiveParent = await createLessonFixture(
      observer,
      level.id,
      3,
      suffix,
    );
    const archiveSnapshot = exerciseSnapshot({
      prompt: 'Archive before publish',
      correctOptionId: 'a',
      explanation: 'Archived.',
    });
    const archiveFixture = await createExerciseFixture({
      observer,
      adminId: admin.id,
      lessonId: archiveParent.lesson.id,
      topicId: archiveParent.topic.id,
      snapshot: archiveSnapshot,
      status: 'draft',
      approved: true,
    });
    const archiveControl = createRaceControl(
      'exercise.archive',
      'exercise.publish',
    );
    const archiveServiceA = new ExerciseAuthoringService(
      prismaA,
      new HarnessCmsCoordinator('A', archiveControl),
    );
    const archiveServiceB = new ExerciseAuthoringService(
      prismaB,
      new HarnessCmsCoordinator('B', archiveControl),
    );
    const archiveRace = await runRace({
      observer,
      control: archiveControl,
      callA: () =>
        archiveServiceA.archiveExercise(actor, archiveFixture.exercise.id, {
          correlationId: `archive-a-${suffix}`,
        }),
      callB: () =>
        archiveServiceB.publishExerciseRevision(
          actor,
          archiveFixture.exercise.id,
          archiveFixture.revision.id,
          { correlationId: `archive-b-${suffix}` },
        ),
      transactionBContract: () => true,
      finalInvariant: async () => {
        const [exercise, publishAudits, archiveAudits] = await Promise.all([
          observer.lessonExercise.findUniqueOrThrow({
            where: { id: archiveFixture.exercise.id },
            select: { status: true, deletedAt: true },
          }),
          observer.auditLog.count({
            where: {
              action: 'lesson_exercise.published',
              targetId: String(archiveFixture.exercise.id),
            },
          }),
          observer.auditLog.count({
            where: {
              action: 'lesson_exercise.archived',
              targetId: String(archiveFixture.exercise.id),
            },
          }),
        ]);
        return (
          exercise.status === 'archived' &&
          exercise.deletedAt !== null &&
          publishAudits === 0 &&
          archiveAudits === 1
        );
      },
    });
    reportRace(
      'publish-archive',
      archiveRace,
      {
        kind: 'domain_error',
        status: 409,
        message: 'Archived LessonExercise cannot be changed.',
      },
      'Archive versus publish',
    );

    const submitParent = await createLessonFixture(
      observer,
      level.id,
      4,
      suffix,
    );
    const submitV1 = exerciseSnapshot({
      prompt: 'Submit V1',
      correctOptionId: 'a',
      explanation: 'A is correct in V1.',
    });
    const submitV2 = exerciseSnapshot({
      prompt: 'Submit V2',
      correctOptionId: 'b',
      explanation: 'B is correct in V2.',
    });
    const submitFixture = await createExerciseFixture({
      observer,
      adminId: admin.id,
      lessonId: submitParent.lesson.id,
      topicId: submitParent.topic.id,
      snapshot: submitV1,
      status: 'published',
      approved: true,
    });
    const submitRevision2 = await observer.contentRevision.create({
      data: {
        entityType: 'lesson_exercise',
        entityId: submitFixture.exercise.id,
        revision: 2,
        snapshot: submitV2,
        contentHash: sha256CanonicalJson(submitV2),
        authorId: admin.id,
        reviews: {
          create: { reviewerId: admin.id, decision: 'approved' },
        },
      },
    });
    await observer.progress.create({
      data: {
        userId: learner.id,
        lessonId: submitParent.lesson.id,
        status: 'learning',
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
    const submitControl = createRaceControl(
      'exercise.publish',
      'exercise.submit',
    );
    const submitServiceA = new ExerciseAuthoringService(
      prismaA,
      new HarnessCmsCoordinator('A', submitControl),
    );
    const submitServiceB = new LessonActivityService(
      prismaB,
      new HarnessActivityCoordinator('B', submitControl),
    );
    const submittedAnswer: SubmitLessonExerciseAttemptDto = {
      answer: { optionId: 'b' },
      durationSeconds: 2,
    };
    const submitRace = await runRace({
      observer,
      control: submitControl,
      callA: () =>
        submitServiceA.publishExerciseRevision(
          actor,
          submitFixture.exercise.id,
          submitRevision2.id,
          { correlationId: `submit-a-${suffix}` },
        ),
      callB: () =>
        submitServiceB.submitAttempt(
          learner.id,
          submitFixture.exercise.id,
          submittedAnswer,
          'publish-submit-attempt-01',
        ),
      transactionBContract: (_a, b) =>
        isFulfilledWith(
          b,
          (data) => data.exerciseVersion === 2 && data.score === 100,
        ),
      finalInvariant: async () => {
        const [exercise, attempts, eventCount] = await Promise.all([
          observer.lessonExercise.findUniqueOrThrow({
            where: { id: submitFixture.exercise.id },
            select: { prompt: true, version: true, answer: true },
          }),
          observer.lessonExerciseAttempt.findMany({
            where: {
              userId: learner.id,
              exerciseId: submitFixture.exercise.id,
            },
            select: {
              exerciseVersion: true,
              score: true,
              contentSnapshot: true,
            },
          }),
          observer.learningEvent.count({
            where: {
              userId: learner.id,
              exerciseId: submitFixture.exercise.id,
              type: 'exercise_submitted',
            },
          }),
        ]);
        const snapshot = attempts[0]?.contentSnapshot;
        const snapshotRecord =
          snapshot !== null &&
          typeof snapshot === 'object' &&
          !Array.isArray(snapshot)
            ? (snapshot as Record<string, unknown>)
            : null;
        return (
          exercise.prompt === submitV2.prompt &&
          exercise.version === 2 &&
          JSON.stringify(exercise.answer) === JSON.stringify(submitV2.answer) &&
          attempts.length === 1 &&
          attempts[0]?.exerciseVersion === 2 &&
          attempts[0]?.score === 100 &&
          JSON.stringify(snapshotRecord?.authoritativeAnswer) ===
            JSON.stringify(submitV2.answer) &&
          eventCount === 1
        );
      },
    });
    reportRace(
      'publish-submit',
      submitRace,
      { kind: 'commit' },
      'Publish versus submit with distinct admin and learner',
    );

    const sameActorParent = await createLessonFixture(
      observer,
      level.id,
      5,
      suffix,
    );
    const sameActorV1 = exerciseSnapshot({
      prompt: 'Same actor submit V1',
      correctOptionId: 'a',
      explanation: 'A is correct in V1.',
    });
    const sameActorV2 = exerciseSnapshot({
      prompt: 'Same actor submit V2',
      correctOptionId: 'b',
      explanation: 'B is correct in V2.',
    });
    const sameActorFixture = await createExerciseFixture({
      observer,
      adminId: admin.id,
      lessonId: sameActorParent.lesson.id,
      topicId: sameActorParent.topic.id,
      snapshot: sameActorV1,
      status: 'published',
      approved: true,
    });
    const sameActorRevision2 = await observer.contentRevision.create({
      data: {
        entityType: 'lesson_exercise',
        entityId: sameActorFixture.exercise.id,
        revision: 2,
        snapshot: sameActorV2,
        contentHash: sha256CanonicalJson(sameActorV2),
        authorId: admin.id,
        reviews: {
          create: { reviewerId: admin.id, decision: 'approved' },
        },
      },
    });
    await observer.progress.create({
      data: {
        userId: admin.id,
        lessonId: sameActorParent.lesson.id,
        status: 'learning',
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
    const sameActorControl = createRaceControl(
      'exercise.publish',
      'exercise.submit',
    );
    const sameActorPublishService = new ExerciseAuthoringService(
      prismaA,
      new HarnessCmsCoordinator('A', sameActorControl),
    );
    const sameActorSubmitService = new LessonActivityService(
      prismaB,
      new HarnessActivityCoordinator('B', sameActorControl),
    );
    const sameActorRace = await runRace({
      observer,
      control: sameActorControl,
      callA: () =>
        sameActorPublishService.publishExerciseRevision(
          actor,
          sameActorFixture.exercise.id,
          sameActorRevision2.id,
          { correlationId: `same-actor-publish-${suffix}` },
        ),
      callB: () =>
        sameActorSubmitService.submitAttempt(
          admin.id,
          sameActorFixture.exercise.id,
          { answer: { optionId: 'b' }, durationSeconds: 3 },
          'same-actor-publish-submit-01',
        ),
      transactionBContract: (_a, b) =>
        isFulfilledWith(
          b,
          (data) => data.exerciseVersion === 2 && data.score === 100,
        ),
      finalInvariant: async () => {
        const [exercise, attempts, eventCount] = await Promise.all([
          observer.lessonExercise.findUniqueOrThrow({
            where: { id: sameActorFixture.exercise.id },
            select: { prompt: true, version: true },
          }),
          observer.lessonExerciseAttempt.findMany({
            where: {
              userId: admin.id,
              exerciseId: sameActorFixture.exercise.id,
            },
            select: { exerciseVersion: true, score: true },
          }),
          observer.learningEvent.count({
            where: {
              userId: admin.id,
              exerciseId: sameActorFixture.exercise.id,
              type: 'exercise_submitted',
            },
          }),
        ]);
        return (
          exercise.prompt === sameActorV2.prompt &&
          exercise.version === 2 &&
          attempts.length === 1 &&
          attempts[0]?.exerciseVersion === 2 &&
          attempts[0]?.score === 100 &&
          eventCount === 1
        );
      },
    });
    reportRace(
      'same-actor-publish-submit',
      sameActorRace,
      { kind: 'commit' },
      'Same-actor publish versus submit lock order',
    );

    const archiveSubmitParent = await createLessonFixture(
      observer,
      level.id,
      6,
      suffix,
    );
    const archiveSubmitSnapshot = exerciseSnapshot({
      prompt: 'Archive while submitting',
      correctOptionId: 'a',
      explanation: 'Historical attempt must remain coherent.',
    });
    const archiveSubmitFixture = await createExerciseFixture({
      observer,
      adminId: admin.id,
      lessonId: archiveSubmitParent.lesson.id,
      topicId: archiveSubmitParent.topic.id,
      snapshot: archiveSubmitSnapshot,
      status: 'published',
      approved: true,
    });
    await observer.progress.create({
      data: {
        userId: learner.id,
        lessonId: archiveSubmitParent.lesson.id,
        status: 'learning',
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
    const setupActivityService = new LessonActivityService(
      prismaB,
      new LessonActivityTransactionCoordinator(),
    );
    await setupActivityService.submitAttempt(
      learner.id,
      archiveSubmitFixture.exercise.id,
      { answer: { optionId: 'a' }, durationSeconds: 1 },
      'archive-submit-initial-01',
    );
    const archiveSubmitControl = createRaceControl(
      'exercise.archive',
      'exercise.submit',
    );
    const archiveSubmitAuthoringService = new ExerciseAuthoringService(
      prismaA,
      new HarnessCmsCoordinator('A', archiveSubmitControl),
    );
    const archiveSubmitActivityService = new LessonActivityService(
      prismaB,
      new HarnessActivityCoordinator('B', archiveSubmitControl),
    );
    const archiveSubmitRace = await runRace({
      observer,
      control: archiveSubmitControl,
      callA: () =>
        archiveSubmitAuthoringService.archiveExercise(
          actor,
          archiveSubmitFixture.exercise.id,
          { correlationId: `archive-submit-a-${suffix}` },
        ),
      callB: () =>
        archiveSubmitActivityService.submitAttempt(
          learner.id,
          archiveSubmitFixture.exercise.id,
          { answer: { optionId: 'a' }, durationSeconds: 4 },
          'archive-submit-race-02',
        ),
      transactionBContract: () => true,
      finalInvariant: async () => {
        const [exercise, attempts, events, archiveAudits] = await Promise.all([
          observer.lessonExercise.findUniqueOrThrow({
            where: { id: archiveSubmitFixture.exercise.id },
            select: { status: true, deletedAt: true },
          }),
          observer.lessonExerciseAttempt.count({
            where: {
              userId: learner.id,
              exerciseId: archiveSubmitFixture.exercise.id,
            },
          }),
          observer.learningEvent.count({
            where: {
              userId: learner.id,
              exerciseId: archiveSubmitFixture.exercise.id,
              type: 'exercise_submitted',
            },
          }),
          observer.auditLog.count({
            where: {
              action: 'lesson_exercise.archived',
              targetId: String(archiveSubmitFixture.exercise.id),
            },
          }),
        ]);
        return (
          exercise.status === 'archived' &&
          exercise.deletedAt !== null &&
          attempts === 1 &&
          events === 1 &&
          archiveAudits === 1
        );
      },
    });
    reportRace(
      'archive-submit',
      archiveSubmitRace,
      {
        kind: 'domain_error',
        status: 404,
        message: 'Exercise not found or not public.',
      },
      'Archive versus submit with historical retention',
    );

    const importParent = await createLessonFixture(
      observer,
      level.id,
      7,
      suffix,
    );
    const dataSource = await observer.dataSource.findUniqueOrThrow({
      where: { code: 'HSK_WORD_LIST_HSK1' },
      select: { id: true },
    });
    const importRows = [
      {
        sourceKey: `exercise-import-${suffix}`,
        lessonId: importParent.lesson.id,
        topicId: importParent.topic.id,
        ...exerciseSnapshot({
          prompt: 'Imported once',
          correctOptionId: 'a',
          explanation: 'Imported idempotently.',
        }),
      },
    ];
    const importDto = {
      dataSourceId: dataSource.id,
      fileName: `exercise-concurrency-${suffix}.json`,
      rows: importRows,
      previewHash: createExerciseImportPreviewHash({
        dataSourceId: dataSource.id,
        fileName: `exercise-concurrency-${suffix}.json`,
        rows: importRows,
      }),
    };
    const importKey = `exercise-import-${suffix}`;
    const importControl = createRaceControl(
      'exercise_import.commit',
      'exercise_import.commit',
    );
    const importServiceA = new ExerciseImportService(
      prismaA,
      new HarnessCmsCoordinator('A', importControl),
    );
    const importServiceB = new ExerciseImportService(
      prismaB,
      new HarnessCmsCoordinator('B', importControl),
    );
    const importRace = await runRace({
      observer,
      control: importControl,
      callA: () =>
        importServiceA.commit(actor, importDto, importKey, {
          correlationId: `import-a-${suffix}`,
        }),
      callB: () =>
        importServiceB.commit(actor, importDto, importKey, {
          correlationId: `import-b-${suffix}`,
        }),
      transactionBContract: (a, b) => {
        if (a.status !== 'fulfilled' || b.status !== 'fulfilled') return false;
        const dataA = readData(a.value);
        const dataB = readData(b.value);
        const jobA = readNestedRecord(dataA, 'importJob');
        const jobB = readNestedRecord(dataB, 'importJob');
        return (
          jobA?.id === jobB?.id &&
          dataB?.idempotent === true &&
          dataB.importedRows === 1
        );
      },
      finalInvariant: async () => {
        const [jobs, exercises] = await Promise.all([
          observer.importJob.findMany({
            where: { idempotencyKey: importKey },
            select: { id: true, status: true, importedRows: true },
          }),
          observer.lessonExercise.findMany({
            where: {
              dataSourceId: dataSource.id,
              sourceKey: importRows[0].sourceKey,
            },
            select: { id: true, status: true },
          }),
        ]);
        if (
          jobs.length !== 1 ||
          jobs[0]?.status !== 'completed' ||
          jobs[0]?.importedRows !== 1 ||
          exercises.length !== 1 ||
          exercises[0]?.status !== 'draft'
        ) {
          return false;
        }
        const revisionCount = await observer.contentRevision.count({
          where: {
            entityType: 'lesson_exercise',
            entityId: exercises[0].id,
          },
        });
        return revisionCount === 1;
      },
    });
    reportRace(
      'import-idempotency-retry',
      importRace,
      { kind: 'commit' },
      'Import idempotency retry',
    );

    console.log('Exercise Authoring production-path concurrency tests passed');
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
    error instanceof ExerciseAuthoringConcurrencyHarnessError
      ? error.message
      : 'Exercise Authoring concurrency failed with a non-domain error.';
  console.error(message);
  process.exitCode = 1;
});
