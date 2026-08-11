import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { buildLessonReadyWhere } from '../../src/common/policies/lesson-readiness.policy';
import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { sha256CanonicalJson } from '../../src/common/utils/canonical-json';
import { CmsActor } from '../../src/modules/cms/cms-workflow';
import { CmsService } from '../../src/modules/cms/cms.service';
import {
  CmsTransactionCheckpoint,
  CmsTransactionCoordinator,
  CmsTransactionOperation,
} from '../../src/modules/cms/cms-transaction-coordinator';
import { PrismaService } from '../../src/prisma/prisma.service';

const STATEMENT_TIMEOUT_MS = 5_000;
const LOCK_TIMEOUT_MS = 3_000;
const TRANSACTION_TIMEOUT_MS = 12_000;
const COORDINATION_TIMEOUT_MS = 2_000;

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
  operationA: CmsTransactionOperation;
  operationB: CmsTransactionOperation;
  transactionAAfterLock: Deferred<void>;
  releaseTransactionA: Deferred<void>;
  transactionBBackendPid: Deferred<number>;
  transactionBAfterLockObserved: boolean;
};

type ProductionRaceResult = {
  transactionA: Outcome;
  transactionB: Outcome;
  transactionBStateBeforeRelease: 'blocked' | 'settled';
  transactionBAfterLockObserved: boolean;
};

type ExpectedBOutcome =
  | { kind: 'commit' }
  | { kind: 'http_error'; status: number; message: string };

class CmsConcurrencyHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CmsConcurrencyHarnessError';
  }
}

class HarnessTransactionCoordinator extends CmsTransactionCoordinator {
  constructor(
    private readonly participant: Participant,
    private readonly control: RaceControl,
  ) {
    super();
  }

  override async checkpoint(
    checkpoint: CmsTransactionCheckpoint,
  ): Promise<void> {
    const expectedOperation =
      this.participant === 'A'
        ? this.control.operationA
        : this.control.operationB;
    if (checkpoint.operation !== expectedOperation) {
      throw new CmsConcurrencyHarnessError(
        `Transaction ${this.participant} reached an unexpected production operation.`,
      );
    }

    if (checkpoint.phase === 'before_lock') {
      const backendPid = await configureTransaction(checkpoint.transaction);
      if (this.participant === 'B') {
        this.control.transactionBBackendPid.resolve(backendPid);
      }
      return;
    }

    if (this.participant === 'A') {
      this.control.transactionAAfterLock.resolve();
      await withTimeout(
        this.control.releaseTransactionA.promise,
        TRANSACTION_TIMEOUT_MS - 2_000,
        'Transaction A production-lock release barrier',
      );
      return;
    }

    this.control.transactionBAfterLockObserved = true;
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
  operationA: CmsTransactionOperation,
  operationB: CmsTransactionOperation,
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new CmsConcurrencyHarnessError(`${label} timed out`)),
      milliseconds,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function asOutcome(promise: Promise<unknown>): Promise<Outcome> {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
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
    "SET LOCAL idle_in_transaction_session_timeout = '7000ms'",
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
    await delay(5);
  }
  throw new CmsConcurrencyHarnessError(
    'Transaction B did not reach a database lock before release.',
  );
}

async function runProductionRace(input: {
  observer: PrismaClient;
  prismaA: PrismaService;
  prismaB: PrismaService;
  operationA: CmsTransactionOperation;
  operationB: CmsTransactionOperation;
  callA: (service: CmsService) => Promise<unknown>;
  callB: (service: CmsService) => Promise<unknown>;
}): Promise<ProductionRaceResult> {
  const control = createRaceControl(input.operationA, input.operationB);
  const serviceA = new CmsService(
    input.prismaA,
    new HarnessTransactionCoordinator('A', control),
  );
  const serviceB = new CmsService(
    input.prismaB,
    new HarnessTransactionCoordinator('B', control),
  );

  const transactionAOutcome = asOutcome(input.callA(serviceA));
  await withTimeout(
    control.transactionAAfterLock.promise,
    TRANSACTION_TIMEOUT_MS,
    'Transaction A production lock checkpoint',
  );

  let transactionBSettled = false;
  const transactionBOutcome = asOutcome(input.callB(serviceB)).finally(() => {
    transactionBSettled = true;
  });

  try {
    const backendPid = await withTimeout(
      control.transactionBBackendPid.promise,
      TRANSACTION_TIMEOUT_MS,
      'Transaction B production connection checkpoint',
    );
    const transactionBStateBeforeRelease = await waitUntilBlockedOrSettled(
      input.observer,
      backendPid,
      () => transactionBSettled,
    );
    control.releaseTransactionA.resolve();
    const [transactionA, transactionB] = await Promise.all([
      transactionAOutcome,
      transactionBOutcome,
    ]);
    return {
      transactionA,
      transactionB,
      transactionBStateBeforeRelease,
      transactionBAfterLockObserved: control.transactionBAfterLockObserved,
    };
  } catch (error) {
    control.releaseTransactionA.resolve();
    await Promise.all([transactionAOutcome, transactionBOutcome]);
    throw error;
  }
}

function assertProductionRace(
  scenario: string,
  result: ProductionRaceResult,
  expectedB: ExpectedBOutcome,
): void {
  if (result.transactionA.status !== 'fulfilled') {
    throw new CmsConcurrencyHarnessError(
      `${scenario}: production transaction A failed.`,
    );
  }
  if (result.transactionBStateBeforeRelease !== 'blocked') {
    throw new CmsConcurrencyHarnessError(
      `${scenario}: production transaction B settled before A released.`,
    );
  }
  if (!result.transactionBAfterLockObserved) {
    throw new CmsConcurrencyHarnessError(
      `${scenario}: transaction B did not cross the production lock checkpoint.`,
    );
  }

  if (expectedB.kind === 'commit') {
    if (result.transactionB.status !== 'fulfilled') {
      throw new CmsConcurrencyHarnessError(
        `${scenario}: production transaction B failed instead of committing.`,
      );
    }
    return;
  }

  if (result.transactionB.status !== 'rejected') {
    throw new CmsConcurrencyHarnessError(
      `${scenario}: stale production operation produced false-green success.`,
    );
  }
  const reason = result.transactionB.reason;
  if (
    !(reason instanceof HttpException) ||
    reason.getStatus() !== expectedB.status ||
    reason.message !== expectedB.message
  ) {
    throw new CmsConcurrencyHarnessError(
      `${scenario}: transaction B rejected outside the expected production domain contract.`,
    );
  }
}

async function assertMigrationOnlyDatabase(observer: PrismaClient) {
  const [counts] = await observer.$queryRaw<
    Array<{
      users: number;
      levels: number;
      lessons: number;
      topics: number;
      revisions: number;
      reviews: number;
    }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM "User") AS users,
      (SELECT COUNT(*)::int FROM "Level") AS levels,
      (SELECT COUNT(*)::int FROM "Lesson") AS lessons,
      (SELECT COUNT(*)::int FROM "Topic") AS topics,
      (SELECT COUNT(*)::int FROM "ContentRevision") AS revisions,
      (SELECT COUNT(*)::int FROM "ContentReview") AS reviews
  `;
  if (!counts || Object.values(counts).some((count) => count !== 0)) {
    throw new CmsConcurrencyHarnessError(
      'CMS concurrency test requires a fresh migration-only disposable database.',
    );
  }
}

async function assertContentReviewImmutable(
  observer: PrismaClient,
  reviewId: number,
): Promise<void> {
  const updateOutcome = await asOutcome(
    observer.contentReview.update({
      where: { id: reviewId },
      data: { decision: 'rejected' },
    }),
  );
  const deleteOutcome = await asOutcome(
    observer.contentReview.delete({ where: { id: reviewId } }),
  );
  if (
    updateOutcome.status !== 'rejected' ||
    deleteOutcome.status !== 'rejected'
  ) {
    throw new CmsConcurrencyHarnessError(
      'ContentReview immutable trigger did not reject update and delete.',
    );
  }
}

function lessonSnapshot(input: {
  title: string;
  orderIndex: number;
  slug: string;
}) {
  return {
    title: input.title,
    description: null,
    orderIndex: input.orderIndex,
    slug: input.slug,
  };
}

function topicSnapshot(input: { title: string; orderIndex: number }) {
  return {
    title: input.title,
    subtitle: null,
    type: 'vocabulary' as const,
    content: { blocks: [{ type: 'text', value: input.title }] },
    orderIndex: input.orderIndex,
    isPremium: false,
    isLocked: false,
  };
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
  const suffix = randomUUID().replace(/-/g, '');
  const actor: CmsActor = { id: 0, role: 'admin' };

  console.log(`Running CMS service-level concurrency on "${databaseName}"`);

  try {
    await assertMigrationOnlyDatabase(observer);
    const admin = await observer.user.create({
      data: {
        email: `cms-concurrency-${suffix}@example.com`,
        password: '$argon2id$cms-concurrency-test-hash',
        role: 'admin',
      },
    });
    actor.id = admin.id;
    const level = await observer.level.create({
      data: {
        name: 'HSK1',
        code: 'HSK1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
      },
    });

    const publishLessonSnapshot = lessonSnapshot({
      title: 'Publish lesson versus archive topic',
      orderIndex: 1,
      slug: `publish-archive-${suffix}`,
    });
    const publishArchiveLesson = await observer.lesson.create({
      data: {
        levelId: level.id,
        ...publishLessonSnapshot,
        status: 'draft',
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    const publishLessonRevision = await observer.contentRevision.create({
      data: {
        entityType: 'lesson',
        entityId: publishArchiveLesson.id,
        revision: 1,
        snapshot: publishLessonSnapshot,
        contentHash: sha256CanonicalJson(publishLessonSnapshot),
        authorId: admin.id,
        reviews: {
          create: { reviewerId: admin.id, decision: 'approved' },
        },
      },
    });
    const onlyTopic = await observer.topic.create({
      data: {
        lessonId: publishArchiveLesson.id,
        title: 'Only public topic',
        content: {},
        orderIndex: 1,
        status: 'published',
      },
    });
    const publishArchiveRace = await runProductionRace({
      observer,
      prismaA,
      prismaB,
      operationA: 'lesson.publish',
      operationB: 'topic.archive',
      callA: (service) =>
        service.publishLessonRevision(
          actor,
          publishArchiveLesson.id,
          publishLessonRevision.id,
          { correlationId: `race-1-a-${suffix}` },
        ),
      callB: (service) =>
        service.archiveTopic(actor, onlyTopic.id, {
          correlationId: `race-1-b-${suffix}`,
        }),
    });
    assertProductionRace(
      'publish Lesson versus archive Topic',
      publishArchiveRace,
      {
        kind: 'commit',
      },
    );
    const publishArchiveFinal = await observer.lesson.findUniqueOrThrow({
      where: { id: publishArchiveLesson.id },
      select: {
        status: true,
        topics: { select: { status: true, deletedAt: true } },
      },
    });
    const publishArchivePublic = await observer.lesson.count({
      where: buildLessonReadyWhere({ id: publishArchiveLesson.id }),
    });
    if (
      publishArchiveFinal.status !== 'published' ||
      publishArchiveFinal.topics[0]?.status !== 'archived' ||
      publishArchivePublic !== 0
    ) {
      throw new CmsConcurrencyHarnessError(
        'publish/archive final state violated dynamic readiness.',
      );
    }
    console.log(
      'Publish Lesson / archive Topic: GREEN (CmsService/CmsService; B observed Lock; both committed; public hidden)',
    );

    const archivePublishLesson = await observer.lesson.create({
      data: {
        levelId: level.id,
        title: 'Archive lesson versus publish topic',
        orderIndex: 2,
        slug: `archive-publish-${suffix}`,
        status: 'published',
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    const publishTopicSnapshot = topicSnapshot({
      title: 'Draft topic',
      orderIndex: 1,
    });
    const draftTopic = await observer.topic.create({
      data: {
        lessonId: archivePublishLesson.id,
        ...publishTopicSnapshot,
        status: 'draft',
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    const publishTopicRevision = await observer.contentRevision.create({
      data: {
        entityType: 'topic',
        entityId: draftTopic.id,
        revision: 1,
        snapshot: publishTopicSnapshot,
        contentHash: sha256CanonicalJson(publishTopicSnapshot),
        authorId: admin.id,
        reviews: {
          create: { reviewerId: admin.id, decision: 'approved' },
        },
      },
    });
    const archivePublishRace = await runProductionRace({
      observer,
      prismaA,
      prismaB,
      operationA: 'lesson.archive',
      operationB: 'topic.publish',
      callA: (service) =>
        service.archiveLesson(actor, archivePublishLesson.id, {
          correlationId: `race-2-a-${suffix}`,
        }),
      callB: (service) =>
        service.publishTopicRevision(
          actor,
          draftTopic.id,
          publishTopicRevision.id,
          { correlationId: `race-2-b-${suffix}` },
        ),
    });
    assertProductionRace(
      'archive Lesson versus publish Topic',
      archivePublishRace,
      {
        kind: 'http_error',
        status: 404,
        message: 'Parent lesson not found.',
      },
    );
    const archivePublishFinal = await observer.topic.findUniqueOrThrow({
      where: { id: draftTopic.id },
      select: { status: true, lesson: { select: { status: true } } },
    });
    if (
      archivePublishFinal.status !== 'draft' ||
      archivePublishFinal.lesson.status !== 'archived' ||
      (await observer.lesson.count({
        where: buildLessonReadyWhere({ id: archivePublishLesson.id }),
      })) !== 0
    ) {
      throw new CmsConcurrencyHarnessError(
        'archive/publish final state violated parent lifecycle.',
      );
    }
    console.log(
      'Archive Lesson / publish Topic: GREEN (CmsService/CmsService; B observed parent Lock; actual 404 domain rejection; public hidden)',
    );

    const reviewSnapshot = lessonSnapshot({
      title: 'Concurrent review lesson',
      orderIndex: 3,
      slug: `review-${suffix}`,
    });
    const reviewLesson = await observer.lesson.create({
      data: {
        levelId: level.id,
        ...reviewSnapshot,
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    const reviewRevision = await observer.contentRevision.create({
      data: {
        entityType: 'lesson',
        entityId: reviewLesson.id,
        revision: 1,
        snapshot: reviewSnapshot,
        contentHash: sha256CanonicalJson(reviewSnapshot),
        authorId: admin.id,
      },
    });
    const reviewRace = await runProductionRace({
      observer,
      prismaA,
      prismaB,
      operationA: 'lesson.review',
      operationB: 'lesson.review',
      callA: (service) =>
        service.reviewLessonRevision(
          actor,
          reviewLesson.id,
          reviewRevision.id,
          { decision: 'approved' },
          { correlationId: `race-3-a-${suffix}` },
        ),
      callB: (service) =>
        service.reviewLessonRevision(
          actor,
          reviewLesson.id,
          reviewRevision.id,
          { decision: 'changes_requested' },
          { correlationId: `race-3-b-${suffix}` },
        ),
    });
    assertProductionRace('two reviews on one revision', reviewRace, {
      kind: 'commit',
    });
    const reviews = await observer.contentReview.findMany({
      where: { revisionId: reviewRevision.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, decision: true },
    });
    if (reviews.length !== 2 || reviews[0]?.decision !== 'changes_requested') {
      throw new CmsConcurrencyHarnessError(
        'concurrent review final authoritative decision is invalid.',
      );
    }
    await assertContentReviewImmutable(observer, reviews[0].id);
    console.log(
      'Concurrent reviews: GREEN (CmsService/CmsService; B observed Lock; both appended; latest authoritative; immutable trigger enforced)',
    );

    const liveSnapshot = lessonSnapshot({
      title: 'Stable live V1',
      orderIndex: 4,
      slug: `revision-publish-${suffix}`,
    });
    const revisionLesson = await observer.lesson.create({
      data: {
        levelId: level.id,
        ...liveSnapshot,
        status: 'published',
        publishedAt: new Date(),
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    await observer.topic.create({
      data: {
        lessonId: revisionLesson.id,
        title: 'Public topic',
        content: {},
        orderIndex: 1,
        status: 'published',
      },
    });
    const revision1 = await observer.contentRevision.create({
      data: {
        entityType: 'lesson',
        entityId: revisionLesson.id,
        revision: 1,
        snapshot: liveSnapshot,
        contentHash: sha256CanonicalJson(liveSnapshot),
        authorId: admin.id,
        reviews: {
          create: { reviewerId: admin.id, decision: 'approved' },
        },
      },
    });
    const draftV2 = {
      title: 'Draft V2',
      description: null,
      orderIndex: 4,
      slug: liveSnapshot.slug,
    };
    const revisionPublishRace = await runProductionRace({
      observer,
      prismaA,
      prismaB,
      operationA: 'lesson.create_revision',
      operationB: 'lesson.publish',
      callA: (service) =>
        service.createLessonRevision(actor, revisionLesson.id, draftV2, {
          correlationId: `race-4-a-${suffix}`,
        }),
      callB: (service) =>
        service.publishLessonRevision(actor, revisionLesson.id, revision1.id, {
          correlationId: `race-4-b-${suffix}`,
        }),
    });
    assertProductionRace(
      'publish old revision versus create newer revision',
      revisionPublishRace,
      {
        kind: 'http_error',
        status: 409,
        message:
          'Only the latest content revision can be used for this action.',
      },
    );
    const revisionPublishFinal = await observer.lesson.findUniqueOrThrow({
      where: { id: revisionLesson.id },
      select: { title: true, status: true },
    });
    const latestRevision = await observer.contentRevision.findFirstOrThrow({
      where: { entityType: 'lesson', entityId: revisionLesson.id },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: { revision: true },
    });
    if (
      revisionPublishFinal.title !== liveSnapshot.title ||
      revisionPublishFinal.status !== 'published' ||
      latestRevision.revision !== 2 ||
      (await observer.lesson.count({
        where: buildLessonReadyWhere({ id: revisionLesson.id }),
      })) !== 1
    ) {
      throw new CmsConcurrencyHarnessError(
        'revision/publish final state exposed an invalid live version.',
      );
    }
    console.log(
      'Publish / create revision: GREEN (CmsService/CmsService; B observed Lock; actual stale 409; live V1 stable)',
    );
    console.log(
      'Mutation sensitivity armed: removing the production parent Lesson lock makes B settle before release and fails the harness.',
    );
    console.log('CMS service-level concurrency tests passed');
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
    error instanceof CmsConcurrencyHarnessError
      ? error.message
      : 'CMS service-level concurrency test failed with a non-domain error.';
  console.error(message);
  process.exitCode = 1;
});
