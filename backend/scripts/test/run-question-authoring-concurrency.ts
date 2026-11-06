/**
 * M4.1a (TL-85/TL-80) production-path concurrency evidence for the question
 * bank. Runs on a fresh migration-only disposable database:
 *
 * 1. concurrent revision creates on one Question: both commit (n+1, n+2) or
 *    exactly one is rejected with a machine-readable 409 — never a 500/P2002;
 * 2. concurrent publishes of one revision: one applies, the other is
 *    idempotent;
 * 3. concurrent creates that share a tag slug: both commit, exactly one Tag.
 *
 * The coordinator barrier makes transaction B wait on the real PostgreSQL
 * FOR UPDATE lock, then releases A; the harness observes B blocked on a Lock
 * wait event before releasing, so the evidence is about the production lock
 * order, not about sleep timing.
 */
import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { Prisma, PrismaClient, QuestionType, Skill } from '@prisma/client';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { CmsActor } from '../../src/modules/cms/cms-workflow';
import {
  CmsTransactionCheckpoint,
  CmsTransactionCoordinator,
} from '../../src/modules/cms/cms-transaction-coordinator';
import { CreateQuestionRevisionDto } from '../../src/modules/cms/dto/create-question-revision.dto';
import { QuestionAuthoringService } from '../../src/modules/cms/question-authoring.service';
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

type Outcome =
  | { status: 'fulfilled'; value: unknown }
  | { status: 'rejected'; reason: unknown };

type RaceControl = {
  operation: string;
  transactionAAfterLock: Deferred<void>;
  releaseTransactionA: Deferred<void>;
  transactionBBackendPid: Deferred<number>;
  transactionBAfterLockObserved: boolean;
};

class QuestionConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuestionConcurrencyError';
  }
}

class HarnessCoordinator extends CmsTransactionCoordinator {
  constructor(
    private readonly participant: Participant,
    private readonly control: RaceControl,
  ) {
    super();
  }

  override async checkpoint(
    checkpoint: CmsTransactionCheckpoint,
  ): Promise<void> {
    if (String(checkpoint.operation) !== this.control.operation) {
      throw new QuestionConcurrencyError(
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
    if (this.participant === 'A') {
      this.control.transactionAAfterLock.resolve();
      await withTimeout(
        this.control.releaseTransactionA.promise,
        BARRIER_TIMEOUT_MS,
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

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new QuestionConcurrencyError(`${label} timed out.`)),
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

async function waitUntilLocked(
  observer: PrismaClient,
  backendPid: number,
): Promise<void> {
  const deadline = Date.now() + COORDINATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const activity = await observer.$queryRaw<
      Array<{ waitEventType: string | null }>
    >`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE pid = ${backendPid}
    `;
    if (activity[0]?.waitEventType === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new QuestionConcurrencyError(
    'Transaction B did not reach wait_event_type=Lock before release.',
  );
}

function asOutcome(promise: Promise<unknown>): Promise<Outcome> {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

async function runBarrierRace(
  observer: PrismaClient,
  controlA: RaceControl,
  controlB: RaceControl,
  callA: () => Promise<unknown>,
  callB: () => Promise<unknown>,
): Promise<{ a: Outcome; b: Outcome }> {
  const a = asOutcome(callA());
  await withTimeout(
    controlA.transactionAAfterLock.promise,
    BARRIER_TIMEOUT_MS,
    'Transaction A production lock checkpoint',
  );
  const b = asOutcome(callB());
  const backendPid = await withTimeout(
    controlB.transactionBBackendPid.promise,
    BARRIER_TIMEOUT_MS,
    'Transaction B backend PID checkpoint',
  );
  await waitUntilLocked(observer, backendPid);
  controlA.releaseTransactionA.resolve();
  const [aOutcome, bOutcome] = await Promise.all([a, b]);
  if (!controlB.transactionBAfterLockObserved) {
    throw new QuestionConcurrencyError(
      'Transaction B never reached the after_lock checkpoint.',
    );
  }
  return { a: aOutcome, b: bOutcome };
}

function conflictCode(outcome: Outcome): string | null {
  if (outcome.status !== 'rejected') return null;
  if (!(outcome.reason instanceof HttpException)) {
    throw new QuestionConcurrencyError(
      'A racer was rejected with a non-domain error (possible 500).',
    );
  }
  if (outcome.reason.getStatus() !== 409) {
    throw new QuestionConcurrencyError(
      `A racer was rejected with HTTP ${outcome.reason.getStatus()} instead of a 409.`,
    );
  }
  const body = outcome.reason.getResponse();
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function revisionNumbers(outcome: Outcome): number[] {
  if (outcome.status !== 'fulfilled') return [];
  const value = outcome.value as {
    data?: { revision?: { revision?: unknown } };
  };
  const revision = value.data?.revision?.revision;
  return typeof revision === 'number' ? [revision] : [];
}

function readIdempotent(outcome: Outcome): boolean | null {
  if (outcome.status !== 'fulfilled') return null;
  const value = outcome.value as { data?: { idempotent?: unknown } };
  return typeof value.data?.idempotent === 'boolean'
    ? value.data.idempotent
    : null;
}

function questionPayload(input: {
  levelId: number;
  prompt: string;
  tags: string[];
}): CreateQuestionRevisionDto {
  return {
    type: QuestionType.mcq,
    skill: Skill.reading,
    levelId: input.levelId,
    content: input.prompt,
    answers: {
      options: [
        { id: 'a', text: 'Xin chào' },
        { id: 'b', text: 'Tạm biệt' },
      ],
    },
    correctAnswer: { optionId: 'a' },
    explanation: 'Giải thích cho câu hỏi.',
    difficulty: 2,
    tags: input.tags,
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
  const controlA = createRaceControl('question.create_revision');
  const controlB = createRaceControl('question.create_revision');
  const coordinatorA = new HarnessCoordinator('A', controlA);
  const coordinatorB = new HarnessCoordinator('B', controlB);
  const revisionServiceA = new QuestionAuthoringService(prismaA, coordinatorA);
  const revisionServiceB = new QuestionAuthoringService(prismaB, coordinatorB);
  // Non-race work (fixture, review, tag creates) uses the production no-op
  // coordinator; the harness coordinators reject unexpected operations.
  const plainServiceA = new QuestionAuthoringService(
    prismaA,
    new CmsTransactionCoordinator(),
  );
  const plainServiceB = new QuestionAuthoringService(
    prismaB,
    new CmsTransactionCoordinator(),
  );
  const suffix = randomUUID().replace(/-/gu, '');

  console.log(
    `Running Question Authoring production-path concurrency on "${databaseName}"`,
  );

  try {
    const [counts] = await observer.$queryRaw<
      Array<{ questions: number; tags: number }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM "Question") AS questions,
        (SELECT COUNT(*)::int FROM "Tag") AS tags
    `;
    if (counts?.questions !== 0 || counts.tags !== 0) {
      throw new QuestionConcurrencyError(
        'Question concurrency test requires a fresh migration-only disposable database.',
      );
    }

    const admin = await observer.user.create({
      data: {
        email: `question-concurrency-${suffix}@example.com`,
        password: '$argon2id$question-concurrency-test-hash',
        role: 'admin',
      },
    });
    const actor: CmsActor = { id: admin.id, role: 'admin' };
    const level = await observer.level.upsert({
      where: { code: 'HSK1' },
      update: {},
      create: {
        code: 'HSK1',
        name: 'HSK1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
      },
    });

    const fixture = await plainServiceA.createQuestion(
      actor,
      questionPayload({
        levelId: level.id,
        prompt: 'Câu hỏi khởi tạo cho test đua.',
        tags: ['Gia đình'],
      }),
      { correlationId: `question-fixture-${suffix}` },
    );
    const fixtureQuestionId = fixture.data.question.id;

    // 1. Concurrent revision creates.
    const revisionRace = await runBarrierRace(
      observer,
      controlA,
      controlB,
      () =>
        revisionServiceA.createQuestionRevision(
          actor,
          fixtureQuestionId,
          questionPayload({
            levelId: level.id,
            prompt: 'Bản sửa A.',
            tags: ['Gia đình'],
          }),
          { correlationId: `revision-a-${suffix}` },
        ),
      () =>
        revisionServiceB.createQuestionRevision(
          actor,
          fixtureQuestionId,
          questionPayload({
            levelId: level.id,
            prompt: 'Bản sửa B.',
            tags: ['Gia đình'],
          }),
          { correlationId: `revision-b-${suffix}` },
        ),
    );
    const revisions = [
      ...revisionNumbers(revisionRace.a),
      ...revisionNumbers(revisionRace.b),
    ].sort((left, right) => left - right);
    const rejectedCode =
      conflictCode(revisionRace.a) ?? conflictCode(revisionRace.b);
    const revisionContractHolds =
      revisionRace.a.status === 'fulfilled' &&
      revisionRace.b.status === 'fulfilled'
        ? JSON.stringify(revisions) === JSON.stringify([2, 3])
        : rejectedCode !== null && revisions.length === 1 && revisions[0] === 2;
    const revisionCount = await observer.contentRevision.count({
      where: { entityType: 'question', entityId: fixtureQuestionId },
    });
    if (
      !revisionContractHolds ||
      revisionCount !== (revisions.length >= 2 ? 3 : 2)
    ) {
      throw new QuestionConcurrencyError(
        `Concurrent revision contract failed (revisions=${JSON.stringify(revisions)}, rejected=${String(rejectedCode)}, stored=${revisionCount}).`,
      );
    }
    console.log(
      `Concurrent revisions: GREEN (${revisionRace.a.status}/${revisionRace.b.status}, revisions=${JSON.stringify(revisions)}, rejected=${String(rejectedCode)}).`,
    );

    // 2. Concurrent publishes of the latest revision.
    const latest = await observer.contentRevision.findFirstOrThrow({
      where: { entityType: 'question', entityId: fixtureQuestionId },
      orderBy: { revision: 'desc' },
      select: { id: true, revision: true },
    });
    await plainServiceA.reviewQuestionRevision(
      actor,
      fixtureQuestionId,
      latest.id,
      { decision: 'approved' },
      { correlationId: `approve-${suffix}` },
    );
    const publishControlA = createRaceControl('question.publish');
    const publishControlB = createRaceControl('question.publish');
    const publishServiceA = new QuestionAuthoringService(
      prismaA,
      new HarnessCoordinator('A', publishControlA),
    );
    const publishServiceB = new QuestionAuthoringService(
      prismaB,
      new HarnessCoordinator('B', publishControlB),
    );
    const publishRace = await runBarrierRace(
      observer,
      publishControlA,
      publishControlB,
      () =>
        publishServiceA.publishQuestionRevision(
          actor,
          fixtureQuestionId,
          latest.id,
          { correlationId: `publish-a-${suffix}` },
        ),
      () =>
        publishServiceB.publishQuestionRevision(
          actor,
          fixtureQuestionId,
          latest.id,
          { correlationId: `publish-b-${suffix}` },
        ),
    );
    const idempotentFlags = [
      readIdempotent(publishRace.a),
      readIdempotent(publishRace.b),
    ];
    const live = await observer.question.findUniqueOrThrow({
      where: { id: fixtureQuestionId },
      select: { status: true, version: true },
    });
    const publishContractHolds =
      publishRace.a.status === 'fulfilled' &&
      publishRace.b.status === 'fulfilled' &&
      idempotentFlags.filter((flag) => flag === false).length === 1 &&
      idempotentFlags.filter((flag) => flag === true).length === 1 &&
      live.status === 'published' &&
      live.version === latest.revision;
    if (!publishContractHolds) {
      throw new QuestionConcurrencyError(
        `Concurrent publish contract failed (flags=${JSON.stringify(idempotentFlags)}, live=${JSON.stringify(live)}).`,
      );
    }
    console.log(
      `Concurrent publishes: GREEN (one apply, one idempotent; live v${String(live.version)} published).`,
    );

    // 3. Concurrent tag upsert on the same slug.
    const tagSlug = 'dua-nhan';
    const [tagA, tagB] = await Promise.all([
      plainServiceA.createQuestion(
        actor,
        questionPayload({
          levelId: level.id,
          prompt: 'Câu hỏi tag đua A.',
          tags: ['Đua nhãn'],
        }),
        { correlationId: `tag-a-${suffix}` },
      ),
      plainServiceB.createQuestion(
        actor,
        questionPayload({
          levelId: level.id,
          prompt: 'Câu hỏi tag đua B.',
          tags: ['đua nhãn'],
        }),
        { correlationId: `tag-b-${suffix}` },
      ),
    ]);
    const tags = await observer.tag.findMany({
      where: { slug: tagSlug },
      select: { id: true, name: true },
    });
    const links = await observer.questionTag.count({
      where: { tag: { slug: tagSlug } },
    });
    const tagContractHolds =
      tags.length === 1 && links === 2 && tags[0]?.name === 'Đua nhãn';
    if (!tagContractHolds) {
      throw new QuestionConcurrencyError(
        `Tag upsert race contract failed (tags=${JSON.stringify(tags)}, links=${links}).`,
      );
    }
    console.log(
      'Concurrent tag upsert: GREEN (one Tag row, both questions linked, first display name kept).',
    );

    if (
      typeof tagA.data.question.id !== 'number' ||
      typeof tagB.data.question.id !== 'number'
    ) {
      throw new QuestionConcurrencyError(
        'Concurrent tag create did not return question ids.',
      );
    }

    console.log('Question Authoring production-path concurrency tests passed');
  } finally {
    await Promise.all([
      observer.$disconnect(),
      prismaA.$disconnect(),
      prismaB.$disconnect(),
    ]);
  }
}

function createRaceControl(operation: string): RaceControl {
  return {
    operation,
    transactionAAfterLock: createDeferred<void>(),
    releaseTransactionA: createDeferred<void>(),
    transactionBBackendPid: createDeferred<number>(),
    transactionBAfterLockObserved: false,
  };
}

void main().catch((error: unknown) => {
  const message =
    error instanceof QuestionConcurrencyError
      ? error.message
      : 'Question Authoring concurrency failed with a non-domain error.';
  console.error(message);
  process.exitCode = 1;
});
