/**
 * M4.2a / TL-115 production-path concurrency evidence for "start exam".
 *
 * Runs on a fresh migration-only disposable database (`hsk_m42a_hardening`).
 * Each scenario repeats ROUNDS times and the harness fails on any deadlock
 * (40P01), lock/statement timeout or unexpected (500-class) error:
 *
 *  S1 same learner, same test, two concurrent starts with different keys
 *     -> exactly one attempt and snapshot, both responses carry the same id.
 *  S2 same learner, same key, concurrent -> exactly one attempt.
 *  S3 two learners, same test -> two attempts with the same contentHash.
 *  S4 start races with publishing a question revision that changes
 *     content/explanation (Q116) -> the frozen hash equals the "before" or the
 *     "after" hash and the stored payload still hashes to contentHash.
 *  S5 start races with archiving the test -> the attempt is created with a
 *     complete snapshot before the archive commits; no attempt is created after
 *     the archive has committed.
 *  S6 two concurrent starts while an in-progress attempt has expired -> the old
 *     attempt becomes timed_out exactly once (one timed_out event) and exactly
 *     one new attempt is created.
 *
 * S4/S5 pause the real production transaction at a documented checkpoint, wait
 * for the other transaction to block on the PostgreSQL row lock, then release;
 * the evidence is about the production lock order, not sleep timing.
 */
import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import {
  ContentStatus,
  ExamAttemptStatus,
  Prisma,
  PrismaClient,
  QuestionType,
  Skill,
} from '@prisma/client';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { sha256CanonicalJson } from '../../src/common/utils/canonical-json';
import { CmsActor } from '../../src/modules/cms/cms-workflow';
import {
  CmsTransactionCoordinator,
  type CmsTransactionCheckpoint,
} from '../../src/modules/cms/cms-transaction-coordinator';
import { CreateQuestionRevisionDto } from '../../src/modules/cms/dto/create-question-revision.dto';
import { QuestionAuthoringService } from '../../src/modules/cms/question-authoring.service';
import { ReplaceTestStructureDto } from '../../src/modules/cms/dto/replace-test-structure.dto';
import { TestAuthoringService } from '../../src/modules/cms/test-authoring.service';
import {
  EXAM_SAVE_GRACE_SECONDS,
  ExamService,
} from '../../src/modules/exam/exam.service';
import {
  ExamTransactionCoordinator,
  type ExamTransactionCheckpoint,
} from '../../src/modules/exam/exam-transaction-coordinator';
import { PrismaService } from '../../src/prisma/prisma.service';

const ROUNDS = 20;
/** S-d waits out the real 5 s grace window, so it runs fewer rounds. */
const SAVE_GRACE_ROUNDS = 5;
const COORDINATION_TIMEOUT_MS = 2_500;
const BARRIER_TIMEOUT_MS = 8_000;
const STATEMENT_TIMEOUT_MS = 7_000;
const LOCK_TIMEOUT_MS = 5_000;

class ExamStartConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExamStartConcurrencyError';
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type Outcome =
  | { status: 'fulfilled'; value: unknown }
  | { status: 'rejected'; reason: unknown };

type StartResult = { created: boolean; data: { id: number } };

type SaveResult = { data: { version: number } };

const deadlockCodes: string[] = [];
const serverFaults: string[] = [];

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ExamStartConcurrencyError(`${label} timed out`));
    }, timeoutMs);
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
  throw new ExamStartConcurrencyError(
    'The blocked transaction did not reach wait_event_type=Lock.',
  );
}

function collectCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== 'object') break;
    const record = current as Record<string, unknown>;
    for (const key of ['code', 'sqlState', 'sqlstate'] as const) {
      if (typeof record[key] === 'string') codes.push(record[key]);
    }
    if (typeof record.message === 'string') codes.push(record.message);
    current = record.cause ?? record.meta;
  }
  return codes;
}

/** Fails the scenario on a deadlock or a non-domain rejection (a 500). */
function assertNoServerFault(scenario: string, outcome: Outcome): void {
  if (outcome.status !== 'rejected') return;
  const codes = collectCodes(outcome.reason);
  const text = codes.join('\n');
  if (text.includes('40P01') || text.includes('deadlock detected')) {
    deadlockCodes.push(`${scenario}:${text}`);
    return;
  }
  if (outcome.reason instanceof HttpException) return;
  serverFaults.push(`${scenario}:${text.slice(0, 400)}`);
}

async function expectFulfilled<T>(
  scenario: string,
  promise: Promise<T>,
): Promise<T> {
  try {
    return await promise;
  } catch (error: unknown) {
    serverFaults.push(
      `${scenario}:${error instanceof Error ? error.constructor.name : 'value'}`,
    );
    throw error;
  }
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new ExamStartConcurrencyError(message);
}

function assertRejected(
  label: string,
  outcome: Outcome,
): asserts outcome is { status: 'rejected'; reason: unknown } {
  if (outcome.status !== 'rejected') {
    throw new ExamStartConcurrencyError(`${label} was fulfilled`);
  }
}

function assertFulfilled(
  label: string,
  outcome: Outcome,
): asserts outcome is { status: 'fulfilled'; value: unknown } {
  if (outcome.status !== 'fulfilled') {
    throw new ExamStartConcurrencyError(`${label} was rejected`);
  }
}

class PidReportingCmsCoordinator extends CmsTransactionCoordinator {
  constructor(private readonly backendPid: Deferred<number>) {
    super();
  }

  override async checkpoint(
    checkpoint: CmsTransactionCheckpoint,
  ): Promise<void> {
    if (checkpoint.phase !== 'before_lock') return;
    this.backendPid.resolve(await configureTransaction(checkpoint.transaction));
  }
}

/**
 * Resolves the backend pid of a save transaction and applies the lock/statement
 * timeouts without pausing it, so a scenario can wait until that transaction is
 * actually blocked on the attempt lock.
 */
class ExamSavePidCoordinator extends ExamTransactionCoordinator {
  constructor(private readonly backendPid: Deferred<number>) {
    super();
  }

  override async checkpoint(
    checkpoint: ExamTransactionCheckpoint,
  ): Promise<void> {
    if (checkpoint.phase !== 'before_attempt_lock') return;
    this.backendPid.resolve(await configureTransaction(checkpoint.transaction));
  }
}

class ExamHarnessCoordinator extends ExamTransactionCoordinator {
  constructor(
    private readonly pausePhase: ExamTransactionCheckpoint['phase'],
    private readonly paused: Deferred<void>,
    private readonly release: Deferred<void>,
    private readonly backendPid: Deferred<number>,
  ) {
    super();
  }

  override async checkpoint(
    checkpoint: ExamTransactionCheckpoint,
  ): Promise<void> {
    if (checkpoint.phase === 'before_user_lock') {
      this.backendPid.resolve(
        await configureTransaction(checkpoint.transaction),
      );
      return;
    }
    if (checkpoint.phase !== this.pausePhase) return;
    this.paused.resolve();
    await withTimeout(
      this.release.promise,
      BARRIER_TIMEOUT_MS,
      'Exam start production-lock release barrier',
    );
  }
}

function questionPayload(input: {
  levelId: number;
  content: string;
  explanation: string;
}): CreateQuestionRevisionDto {
  return {
    type: QuestionType.mcq,
    skill: Skill.reading,
    levelId: input.levelId,
    content: input.content,
    answers: {
      options: [
        { id: 'a', text: 'Đáp án đúng' },
        { id: 'b', text: 'Đáp án sai' },
      ],
    },
    correctAnswer: { optionId: 'a' },
    explanation: input.explanation,
    difficulty: 2,
    audioId: null,
    tags: ['Gia đình'],
  };
}

function structurePayload(input: {
  expectedUpdatedAt: string;
  questionId: number;
}): ReplaceTestStructureDto {
  return {
    expectedUpdatedAt: input.expectedUpdatedAt,
    sections: [
      {
        skill: Skill.reading,
        title: 'Đọc hiểu',
        groups: [{ title: 'Nhóm 1', questionIds: [input.questionId] }],
      },
    ],
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
  const cmsCoordinator = new CmsTransactionCoordinator();
  const questionService = new QuestionAuthoringService(prismaA, cmsCoordinator);
  const testService = new TestAuthoringService(prismaA, cmsCoordinator);
  const examService = new ExamService(
    prismaA,
    new ExamTransactionCoordinator(),
  );
  const suffix = randomUUID().replace(/-/gu, '');

  console.log(
    `Running exam start production-path concurrency on "${databaseName}" (${String(ROUNDS)} rounds/scenario)`,
  );

  try {
    const [counts] = await observer.$queryRaw<
      Array<{ tests: number; attempts: number }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM "Test") AS tests,
        (SELECT COUNT(*)::int FROM "ExamAttempt") AS attempts
    `;
    check(
      counts?.tests === 0 && counts.attempts === 0,
      'exam start concurrency harness requires a fresh migration-only disposable database',
    );

    const admin = await observer.user.create({
      data: {
        email: `exam-start-concurrency-${suffix}@example.com`,
        password: '$argon2id$exam-start-concurrency-hash',
        role: 'admin',
      },
      select: { id: true },
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
        status: ContentStatus.published,
        publishedAt: new Date(),
      },
      select: { id: true },
    });

    const created = await questionService.createQuestion(
      actor,
      questionPayload({
        levelId: level.id,
        content: 'Câu hỏi khởi đầu của harness',
        explanation: 'Giải thích ban đầu.',
      }),
      { correlationId: `exam-harness-question-${suffix}` },
    );
    const questionId = created.data.question.id;
    const revisionId = created.data.revision.id;
    await questionService.reviewQuestionRevision(
      actor,
      questionId,
      revisionId,
      { decision: 'approved' },
      { correlationId: `exam-harness-approve-${suffix}` },
    );
    await questionService.publishQuestionRevision(
      actor,
      questionId,
      revisionId,
      { correlationId: `exam-harness-publish-${suffix}` },
    );

    const publishedTest = await createPublishedTest({
      service: testService,
      actor,
      levelId: level.id,
      questionId,
      title: `Đề harness M4.2a ${suffix}`,
      suffix,
    });

    let learnerSeq = 0;
    const createLearner = async (label: string): Promise<number> => {
      learnerSeq += 1;
      const user = await observer.user.create({
        data: {
          email: `exam-harness-${label}-${String(learnerSeq)}-${suffix}@example.com`,
          password: '$argon2id$exam-harness-learner-hash',
        },
        select: { id: true },
      });
      return user.id;
    };

    await runScenario('S1', async () => {
      const learnerId = await createLearner('s1');
      const [first, second] = await Promise.all([
        expectFulfilled(
          'S1',
          examService.startAttempt(
            learnerId,
            publishedTest.testId,
            randomUUID(),
          ),
        ),
        expectFulfilled(
          'S1',
          examService.startAttempt(
            learnerId,
            publishedTest.testId,
            randomUUID(),
          ),
        ),
      ]);
      check(
        first.data.id === second.data.id,
        `S1 returned two different attempt ids (${String(first.data.id)} vs ${String(second.data.id)})`,
      );
      check(
        first.created !== second.created,
        'S1 expected exactly one creator',
      );
      const attempts = await observer.examAttempt.count({
        where: { userId: learnerId, testId: publishedTest.testId },
      });
      const snapshots = await observer.examAttemptSnapshot.count({
        where: { attemptId: first.data.id },
      });
      check(attempts === 1, `S1 created ${String(attempts)} attempts`);
      check(snapshots === 1, `S1 created ${String(snapshots)} snapshots`);
    });

    const sharedKey = randomUUID();
    await runScenario('S2', async () => {
      const learnerId = await createLearner('s2');
      const [first, second] = await Promise.all([
        expectFulfilled(
          'S2',
          examService.startAttempt(learnerId, publishedTest.testId, sharedKey),
        ),
        expectFulfilled(
          'S2',
          examService.startAttempt(learnerId, publishedTest.testId, sharedKey),
        ),
      ]);
      check(
        first.data.id === second.data.id,
        'S2 returned two different attempt ids for one idempotency key',
      );
      check(
        (await observer.examAttempt.count({
          where: { userId: learnerId, testId: publishedTest.testId },
        })) === 1,
        'S2 created more than one attempt',
      );
    });

    await runScenario('S3', async () => {
      const learnerA = await createLearner('s3a');
      const learnerB = await createLearner('s3b');
      const [first, second] = await Promise.all([
        expectFulfilled(
          'S3',
          examService.startAttempt(
            learnerA,
            publishedTest.testId,
            randomUUID(),
          ),
        ),
        expectFulfilled(
          'S3',
          examService.startAttempt(
            learnerB,
            publishedTest.testId,
            randomUUID(),
          ),
        ),
      ]);
      check(first.data.id !== second.data.id, 'S3 reused one attempt');
      const hashes = await observer.examAttemptSnapshot.findMany({
        where: { attemptId: { in: [first.data.id, second.data.id] } },
        select: { contentHash: true },
      });
      check(
        hashes.length === 2,
        `S3 created ${String(hashes.length)} snapshots`,
      );
      check(
        hashes[0]?.contentHash === hashes[1]?.contentHash,
        'S3 snapshots have different contentHash values',
      );
    });

    await runScenario('S4', async () => {
      // The raced start needs a learner without a live attempt: TL-112b
      // returns an existing attempt before the pause checkpoint (Q121), so a
      // reused learner would never reach the Question lock.
      const racedLearnerId = await createLearner('s4race');
      const before = await startAndHash(
        observer,
        examService,
        await createLearner('s4before'),
        publishedTest.testId,
      );
      const content = `Nội dung sửa đổi vòng ${String(learnerSeq)} ${suffix}`;
      const explanation = `Giải thích sửa đổi vòng ${String(learnerSeq)} ${suffix}`;
      const revision = await expectFulfilled(
        'S4',
        questionService.createQuestionRevision(
          actor,
          questionId,
          questionPayload({
            levelId: level.id,
            content,
            explanation,
          }),
          { correlationId: `s4-revision-${suffix}-${String(learnerSeq)}` },
        ),
      );
      await questionService.reviewQuestionRevision(
        actor,
        questionId,
        revision.data.revision.id,
        { decision: 'approved' },
        { correlationId: `s4-approve-${suffix}-${String(learnerSeq)}` },
      );

      const startedControl = createExamControl();
      const revisionPid = createDeferred<number>();
      const examServiceA = new ExamService(
        prismaA,
        new ExamHarnessCoordinator(
          'after_question_locks',
          startedControl.paused,
          startedControl.release,
          startedControl.backendPid,
        ),
      );
      const revisionServiceB = new QuestionAuthoringService(
        prismaB,
        new PidReportingCmsCoordinator(revisionPid),
      );

      const startOutcome = asOutcome(
        examServiceA.startAttempt(
          racedLearnerId,
          publishedTest.testId,
          randomUUID(),
        ),
      );
      await withTimeout(
        startedControl.paused.promise,
        BARRIER_TIMEOUT_MS,
        'S4 exam start production-lock checkpoint',
      );
      const revisionOutcome = asOutcome(
        revisionServiceB.publishQuestionRevision(
          actor,
          questionId,
          revision.data.revision.id,
          { correlationId: `s4-publish-${suffix}-${String(learnerSeq)}` },
        ),
      );
      const backendPid = await withTimeout(
        revisionPid.promise,
        BARRIER_TIMEOUT_MS,
        'S4 revision backend pid',
      );
      await waitUntilLocked(observer, backendPid);
      startedControl.release.resolve();
      const [started, revised] = await Promise.all([
        startOutcome,
        revisionOutcome,
      ]);
      assertNoServerFault('S4', started);
      assertNoServerFault('S4', revised);
      assertFulfilled('S4 start', started);

      const attemptId = (started.value as StartResult).data.id;
      const after = await startAndHash(
        observer,
        examService,
        await createLearner('s4after'),
        publishedTest.testId,
      );
      check(revised.status === 'fulfilled', 'S4 the revision publish failed');
      check(
        before !== after,
        'S4 the revision did not change the snapshot hash (race has no effect)',
      );
      const racedSnapshot =
        await observer.examAttemptSnapshot.findUniqueOrThrow({
          where: { attemptId },
          select: { contentHash: true, payload: true },
        });
      check(
        racedSnapshot.contentHash ===
          sha256CanonicalJson(racedSnapshot.payload),
        'S4 stored payload no longer matches contentHash',
      );
      check(
        racedSnapshot.contentHash === before ||
          racedSnapshot.contentHash === after,
        'S4 contentHash is neither the before nor the after hash (hybrid snapshot)',
      );
      const payloadText = JSON.stringify(racedSnapshot.payload);
      const hasNewContent = payloadText.includes(content);
      const hasNewExplanation = payloadText.includes(explanation);
      check(
        hasNewContent === hasNewExplanation,
        'S4 snapshot mixes the old content with the new explanation (hybrid state)',
      );
    });

    const archivedTests: number[] = [];
    await runScenario('S5', async () => {
      const learnerId = await createLearner('s5');
      const roundSuffix = `${suffix}-s5-${String(learnerSeq)}`;
      const test = await createPublishedTest({
        service: testService,
        actor,
        levelId: level.id,
        questionId,
        title: `Đề harness S5 ${roundSuffix}`,
        suffix: roundSuffix,
      });
      archivedTests.push(test.testId);

      const startedControl = createExamControl();
      const archivePid = createDeferred<number>();
      const examServiceA = new ExamService(
        prismaA,
        new ExamHarnessCoordinator(
          'after_test_lock',
          startedControl.paused,
          startedControl.release,
          startedControl.backendPid,
        ),
      );
      const archiveServiceB = new TestAuthoringService(
        prismaB,
        new PidReportingCmsCoordinator(archivePid),
      );

      const startOutcome = asOutcome(
        examServiceA.startAttempt(learnerId, test.testId, randomUUID()),
      );
      await withTimeout(
        startedControl.paused.promise,
        BARRIER_TIMEOUT_MS,
        'S5 exam start production-lock checkpoint',
      );
      const archiveOutcome = asOutcome(
        archiveServiceB.archiveTest(actor, test.testId, {
          correlationId: `s5-archive-${roundSuffix}`,
        }),
      );
      const backendPid = await withTimeout(
        archivePid.promise,
        BARRIER_TIMEOUT_MS,
        'S5 archive backend pid',
      );
      await waitUntilLocked(observer, backendPid);
      startedControl.release.resolve();
      const [started, archived] = await Promise.all([
        startOutcome,
        archiveOutcome,
      ]);
      assertNoServerFault('S5', started);
      assertNoServerFault('S5', archived);

      const attempts = await observer.examAttempt.findMany({
        where: { testId: test.testId },
        select: { id: true },
      });
      const archivedRow = await observer.test.findUniqueOrThrow({
        where: { id: test.testId },
        select: { status: true },
      });
      check(
        archived.status === 'fulfilled' &&
          archivedRow.status === ContentStatus.archived,
        'S5 the archive did not commit',
      );
      if (started.status === 'fulfilled') {
        const attemptId = (started.value as StartResult).data.id;
        check(
          attempts.length === 1 && attempts[0]?.id === attemptId,
          'S5 the committed attempt is not the only attempt of the test',
        );
        const snapshot = await observer.examAttemptSnapshot.findUnique({
          where: { attemptId },
          select: { contentHash: true, payload: true },
        });
        check(snapshot !== null, 'S5 the created attempt has no snapshot');
        check(
          snapshot !== null &&
            snapshot.contentHash === sha256CanonicalJson(snapshot.payload),
          'S5 the created snapshot is incomplete or does not match its hash',
        );
        check(
          JSON.stringify(snapshot?.payload ?? null).includes('"questions"'),
          'S5 the frozen payload has no questions',
        );
      } else {
        // A 404 is the only documented rejection for a start after archive.
        check(
          started.reason instanceof HttpException &&
            started.reason.getStatus() === 404,
          'S5 the rejected start was not a 404',
        );
        check(attempts.length === 0, 'S5 created an attempt after the archive');
      }
    });

    await runScenario('S6', async () => {
      const learnerId = await createLearner('s6');
      const first = await expectFulfilled(
        'S6',
        examService.startAttempt(learnerId, publishedTest.testId, randomUUID()),
      );
      const nowMs = Date.now();
      await observer.examAttempt.update({
        where: { id: first.data.id },
        data: {
          startedAt: new Date(nowMs - 91 * 60_000),
          expiresAt: new Date(nowMs - 60_000),
        },
      });

      const [left, right] = await Promise.all([
        expectFulfilled(
          'S6',
          examService.startAttempt(
            learnerId,
            publishedTest.testId,
            randomUUID(),
          ),
        ),
        expectFulfilled(
          'S6',
          examService.startAttempt(
            learnerId,
            publishedTest.testId,
            randomUUID(),
          ),
        ),
      ]);
      check(
        left.data.id === right.data.id,
        'S6 the two starts created different attempts',
      );
      check(
        left.data.id !== first.data.id,
        'S6 returned the expired attempt instead of creating a new one',
      );
      const oldAttempt = await observer.examAttempt.findUniqueOrThrow({
        where: { id: first.data.id },
        select: {
          status: true,
          remainingSeconds: true,
          submittedAt: true,
          expiresAt: true,
        },
      });
      check(
        oldAttempt.status === ExamAttemptStatus.timed_out,
        `S6 the expired attempt is ${oldAttempt.status}`,
      );
      check(oldAttempt.remainingSeconds === 0, 'S6 remainingSeconds is not 0');
      check(
        oldAttempt.submittedAt?.getTime() === oldAttempt.expiresAt.getTime(),
        'S6 submittedAt does not equal expiresAt',
      );
      const timedOutEvents = await observer.examAttemptEvent.count({
        where: { attemptId: first.data.id, type: 'timed_out' },
      });
      check(
        timedOutEvents === 1,
        `S6 wrote ${String(timedOutEvents)} timed_out events`,
      );
      const attempts = await observer.examAttempt.count({
        where: { userId: learnerId, testId: publishedTest.testId },
      });
      check(attempts === 2, `S6 left ${String(attempts)} attempts`);
    });

    await runScenario('S-a', async () => {
      const learnerId = await createLearner('sa');
      const started = await examService.startAttempt(
        learnerId,
        publishedTest.testId,
        randomUUID(),
      );
      const attemptId = started.data.id;
      const questionKey = await firstQuestionKey(observer, attemptId);
      const initial = await expectFulfilled(
        'S-a',
        examService.saveAnswer(learnerId, attemptId, questionKey, {
          answer: { choice: 'a' },
          isFlagged: false,
          expectedVersion: null,
          idempotencyKey: randomUUID(),
        }),
      );
      check(
        initial.data.version === 1,
        'S-a the initial save is not version 1',
      );

      // Both writers see version 1 and try to move it to 2: only one may win.
      const [left, right] = await Promise.all([
        asOutcome(
          examService.saveAnswer(learnerId, attemptId, questionKey, {
            answer: { choice: 'a' },
            isFlagged: false,
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
          }),
        ),
        asOutcome(
          examService.saveAnswer(learnerId, attemptId, questionKey, {
            answer: { choice: 'b' },
            isFlagged: false,
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
          }),
        ),
      ]);
      assertNoServerFault('S-a', left);
      assertNoServerFault('S-a', right);
      const saved = [left, right].filter(
        (outcome) => outcome.status === 'fulfilled',
      );
      const conflicts = [left, right].filter(
        (outcome) =>
          outcome.status === 'rejected' &&
          outcome.reason instanceof HttpException &&
          outcome.reason.getStatus() === 409,
      );
      check(
        saved.length === 1 && conflicts.length === 1,
        `S-a expected exactly 1 saved and 1 conflict (saved ${String(saved.length)}, conflicts ${String(conflicts.length)})`,
      );
      const winner = saved[0];
      check(
        winner !== undefined &&
          winner.status === 'fulfilled' &&
          (winner.value as SaveResult).data.version === 2,
        'S-a the winner is not version 2',
      );
      const row = await observer.examAnswer.findFirstOrThrow({
        where: { attemptId },
        select: { version: true },
      });
      check(row.version === 2, `S-a stored version is ${String(row.version)}`);
      const autosaved = await observer.examAttemptEvent.count({
        where: { attemptId, type: 'autosaved' },
      });
      check(
        autosaved === 2,
        `S-a wrote ${String(autosaved)} autosaved events (expected 2)`,
      );
    });

    await runScenario('S-b', async () => {
      const learnerId = await createLearner('sb');
      const started = await examService.startAttempt(
        learnerId,
        publishedTest.testId,
        randomUUID(),
      );
      const attemptId = started.data.id;
      const questionKey = await firstQuestionKey(observer, attemptId);
      const sharedKey = randomUUID();
      const body = {
        answer: { choice: 'a' },
        isFlagged: true,
        expectedVersion: null,
        idempotencyKey: sharedKey,
      };

      const [left, right] = await Promise.all([
        examService.saveAnswer(learnerId, attemptId, questionKey, body),
        examService.saveAnswer(learnerId, attemptId, questionKey, body),
      ]);
      const versions = [left.data.version, right.data.version];
      check(
        versions[0] === 1 && versions[1] === 1,
        `S-b replay changed the version (${versions.join(',')})`,
      );
      check(
        (await observer.examAnswer.count({ where: { attemptId } })) === 1,
        'S-b wrote more than one answer row',
      );
      const autosaved = await observer.examAttemptEvent.count({
        where: { attemptId, type: 'autosaved' },
      });
      check(
        autosaved === 1,
        `S-b wrote ${String(autosaved)} autosaved events (expected 1)`,
      );
    });

    await runScenario('S-c', async () => {
      const learnerId = await createLearner('sc');
      const started = await examService.startAttempt(
        learnerId,
        publishedTest.testId,
        randomUUID(),
      );
      const attemptId = started.data.id;
      const questionKey = await firstQuestionKey(observer, attemptId);

      // Pause the start after its Test lock, then save into the live attempt it
      // is about to return. The save never needs the User/Test locks, so the
      // two transactions must not block each other or deadlock.
      const control = createExamControl();
      const pausedStartService = new ExamService(
        prismaA,
        new ExamHarnessCoordinator(
          'after_test_lock',
          control.paused,
          control.release,
          control.backendPid,
        ),
      );
      const startOutcome = asOutcome(
        pausedStartService.startAttempt(
          learnerId,
          publishedTest.testId,
          randomUUID(),
        ),
      );
      await withTimeout(
        control.paused.promise,
        BARRIER_TIMEOUT_MS,
        'S-c exam start production-lock checkpoint',
      );
      const saved = await withTimeout(
        asOutcome(
          examService.saveAnswer(learnerId, attemptId, questionKey, {
            answer: { choice: 'a' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: randomUUID(),
          }),
        ),
        BARRIER_TIMEOUT_MS,
        'S-c save while the start is paused',
      );
      control.release.resolve();
      const start = await startOutcome;
      assertNoServerFault('S-c', start);
      assertNoServerFault('S-c', saved);
      assertFulfilled('S-c start', start);
      assertFulfilled('S-c save', saved);
      check(
        (start.value as StartResult).data.id === attemptId,
        'S-c the start did not return the live attempt',
      );
      check(
        (saved.value as SaveResult).data.version === 1,
        'S-c the interleaved save was not persisted',
      );
    });

    await runScenario(
      'S-d',
      async () => {
        const learnerId = await createLearner('sd');
        const started = await examService.startAttempt(
          learnerId,
          publishedTest.testId,
          randomUUID(),
        );
        const attemptId = started.data.id;
        const questionKey = await firstQuestionKey(observer, attemptId);
        const nowMs = Date.now();
        // expiresAt + 5 s grace lands ~3 s after this line: the first save is
        // inside the window, the second one is past it.
        await observer.examAttempt.update({
          where: { id: attemptId },
          data: {
            startedAt: new Date(nowMs - 91 * 60_000),
            expiresAt: new Date(nowMs - 2_000),
          },
        });

        const inside = await expectFulfilled(
          'S-d',
          examService.saveAnswer(learnerId, attemptId, questionKey, {
            answer: { choice: 'a' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: randomUUID(),
          }),
        );
        check(
          inside.data.version === 1,
          'S-d the in-grace save is not version 1',
        );

        await new Promise((resolve) => setTimeout(resolve, 3_200));
        const outside = await asOutcome(
          examService.saveAnswer(learnerId, attemptId, questionKey, {
            answer: { choice: 'b' },
            isFlagged: false,
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
          }),
        );
        assertNoServerFault('S-d', outside);
        check(
          outside.status === 'rejected' &&
            outside.reason instanceof HttpException &&
            outside.reason.getStatus() === 409,
          'S-d the save past the grace window was not rejected with 409',
        );

        // No half state: either the row is untouched and still in progress, or
        // it is exactly `timed_out` with submittedAt = expiresAt and 0 seconds
        // left, and the late save wrote nothing.
        const attempt = await observer.examAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          select: {
            status: true,
            submittedAt: true,
            expiresAt: true,
            remainingSeconds: true,
          },
        });
        check(
          attempt.status === ExamAttemptStatus.timed_out,
          `S-d the attempt is ${attempt.status} after the grace window`,
        );
        check(
          attempt.remainingSeconds === 0,
          'S-d remainingSeconds is not 0 after the timeout',
        );
        check(
          attempt.submittedAt?.getTime() === attempt.expiresAt.getTime(),
          'S-d submittedAt does not equal expiresAt',
        );
        const timedOut = await observer.examAttemptEvent.count({
          where: { attemptId, type: 'timed_out' },
        });
        check(
          timedOut === 1,
          `S-d wrote ${String(timedOut)} timed_out events (expected 1)`,
        );
        const autosaved = await observer.examAttemptEvent.count({
          where: { attemptId, type: 'autosaved' },
        });
        check(
          autosaved === 1,
          `S-d wrote ${String(autosaved)} autosaved events (expected 1)`,
        );
        const answers = await observer.examAnswer.findMany({
          where: { attemptId },
          select: { version: true, answer: true },
        });
        check(
          answers.length === 1 && answers[0]?.version === 1,
          'S-d the late save changed the answer row',
        );
      },
      SAVE_GRACE_ROUNDS,
    );

    await runScenario('S-e', async () => {
      const learnerId = await createLearner('se');
      const first = await expectFulfilled(
        'S-e',
        examService.startAttempt(learnerId, publishedTest.testId, randomUUID()),
      );
      const attemptId = first.data.id;
      const nowMs = Date.now();
      await observer.examAttempt.update({
        where: { id: attemptId },
        data: {
          startedAt: new Date(nowMs - 91 * 60_000),
          expiresAt: new Date(nowMs - 10_000),
        },
      });

      // T1 pauses after the media locks, before the end-of-start branch; T2
      // (GET) times the attempt out first; T1 must then skip its own update.
      const control = createExamControl();
      const pausedStartService = new ExamService(
        prismaA,
        new ExamHarnessCoordinator(
          'after_media_locks',
          control.paused,
          control.release,
          control.backendPid,
        ),
      );
      const startOutcome = asOutcome(
        pausedStartService.startAttempt(
          learnerId,
          publishedTest.testId,
          randomUUID(),
        ),
      );
      await withTimeout(
        control.paused.promise,
        BARRIER_TIMEOUT_MS,
        'S-e exam start production-lock checkpoint',
      );
      const lazyTimeout = await asOutcome(
        examService.getAttemptView(learnerId, attemptId),
      );
      assertNoServerFault('S-e', lazyTimeout);
      assertFulfilled('S-e GET attempt', lazyTimeout);
      control.release.resolve();
      const started = await startOutcome;
      assertNoServerFault('S-e', started);
      assertFulfilled('S-e start', started);

      const timedOutEvents = await observer.examAttemptEvent.count({
        where: { attemptId, type: 'timed_out' },
      });
      check(
        timedOutEvents === 1,
        `S-e wrote ${String(timedOutEvents)} timed_out events for the timed-out attempt (expected 1)`,
      );
      const row = await observer.examAttempt.findUniqueOrThrow({
        where: { id: attemptId },
        select: { status: true },
      });
      check(
        row.status === ExamAttemptStatus.timed_out,
        'S-e attempt is not timed_out',
      );
      const live = await observer.examAttempt.findMany({
        where: {
          userId: learnerId,
          testId: publishedTest.testId,
          status: ExamAttemptStatus.in_progress,
        },
        select: { id: true },
      });
      check(
        live.length === 1 &&
          live[0]?.id === (started.value as StartResult).data.id,
        'S-e did not leave exactly one new in_progress attempt',
      );
      check(
        (await observer.examAttempt.count({
          where: { userId: learnerId, testId: publishedTest.testId },
        })) === 2,
        'S-e left an unexpected number of attempts',
      );
    });

    await runScenario(
      'S-f',
      async () => {
        const learnerId = await createLearner('sf');
        const started = await examService.startAttempt(
          learnerId,
          publishedTest.testId,
          randomUUID(),
        );
        const attemptId = started.data.id;
        const questionKey = await firstQuestionKey(observer, attemptId);
        const nowMs = Date.now();
        // Threshold = expiresAt + 5 s is ~3 s away: T1 (holding the lock) is
        // inside the window, T2 (waiting for the lock) must be judged with the
        // clock read *after* it acquires the lock.
        await observer.examAttempt.update({
          where: { id: attemptId },
          data: {
            startedAt: new Date(nowMs - 91 * 60_000),
            expiresAt: new Date(nowMs - 2_000),
          },
        });

        const holdControl = createExamControl();
        const holdingSave = new ExamService(
          prismaA,
          new ExamHarnessCoordinator(
            'after_attempt_lock',
            holdControl.paused,
            holdControl.release,
            holdControl.backendPid,
          ),
        );
        const t1 = asOutcome(
          holdingSave.saveAnswer(learnerId, attemptId, questionKey, {
            answer: { choice: 'a' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: randomUUID(),
          }),
        );
        await withTimeout(
          holdControl.paused.promise,
          BARRIER_TIMEOUT_MS,
          'S-f save lock hold checkpoint',
        );

        const t2Pid = createDeferred<number>();
        const waitingSave = new ExamService(
          prismaB,
          new ExamSavePidCoordinator(t2Pid),
        );
        const t2 = asOutcome(
          waitingSave.saveAnswer(learnerId, attemptId, questionKey, {
            answer: { choice: 'b' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: randomUUID(),
          }),
        );
        const waitingPid = await withTimeout(
          t2Pid.promise,
          BARRIER_TIMEOUT_MS,
          'S-f waiting save backend pid',
        );
        await waitUntilLocked(observer, waitingPid);

        // Release only after the grace window has passed. `expiresAt` was set
        // to `nowMs - 2 s`, so the threshold is `nowMs + 3 s`; wait for that
        // instant plus a small poll margin instead of a fixed sleep.
        const graceDeadlineMs =
          nowMs - 2_000 + EXAM_SAVE_GRACE_SECONDS * 1_000 + 150;
        while (Date.now() < graceDeadlineMs) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        holdControl.release.resolve();

        const [held, rejected] = await Promise.all([t1, t2]);
        assertNoServerFault('S-f', held);
        assertNoServerFault('S-f', rejected);
        assertFulfilled('S-f holding save', held);
        check(
          rejected.status === 'rejected' &&
            rejected.reason instanceof HttpException &&
            rejected.reason.getStatus() === 409,
          'S-f the waiting save was not rejected with 409',
        );
        assertRejected('S-f waiting save', rejected);
        const rejectedBody = (
          rejected.reason as HttpException
        ).getResponse() as {
          code?: unknown;
        };
        check(
          rejectedBody.code === 'EXAM_ATTEMPT_EXPIRED',
          `S-f the waiting save returned ${String(rejectedBody.code)} instead of EXAM_ATTEMPT_EXPIRED`,
        );
        const attempt = await observer.examAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          select: { status: true, submittedAt: true, expiresAt: true },
        });
        check(
          attempt.status === ExamAttemptStatus.timed_out,
          `S-f the attempt is ${attempt.status} after the grace window`,
        );
        check(
          attempt.submittedAt?.getTime() === attempt.expiresAt.getTime(),
          'S-f submittedAt does not equal expiresAt',
        );
        check(
          (await observer.examAttemptEvent.count({
            where: { attemptId, type: 'timed_out' },
          })) === 1,
          'S-f did not write exactly one timed_out event',
        );
        check(
          (await observer.examAttemptEvent.count({
            where: { attemptId, type: 'autosaved' },
          })) === 1,
          'S-f did not keep exactly one autosaved event',
        );
      },
      SAVE_GRACE_ROUNDS,
    );

    for (const testId of archivedTests) {
      const archived = await observer.test.findUniqueOrThrow({
        where: { id: testId },
        select: { status: true },
      });
      check(
        archived.status === ContentStatus.archived,
        'S5 fixture test was not archived',
      );
    }
  } finally {
    await Promise.all([
      observer.$disconnect(),
      prismaA.$disconnect(),
      prismaB.$disconnect(),
    ]);
  }
}

type ExamControl = {
  paused: Deferred<void>;
  release: Deferred<void>;
  backendPid: Deferred<number>;
};

function createExamControl(): ExamControl {
  return {
    paused: createDeferred<void>(),
    release: createDeferred<void>(),
    backendPid: createDeferred<number>(),
  };
}

function asOutcome(promise: Promise<unknown>): Promise<Outcome> {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

/** The frozen snapshot key (`q<placement order>`) of the only harness question. */
async function firstQuestionKey(
  observer: PrismaClient,
  attemptId: number,
): Promise<string> {
  const snapshot = await observer.examAttemptSnapshot.findUniqueOrThrow({
    where: { attemptId },
    select: { payload: true },
  });
  const payload = snapshot.payload as {
    sections: Array<{
      groups: Array<{ questions: Array<{ key: string }> }>;
    }>;
  };
  const key = payload.sections[0]?.groups[0]?.questions[0]?.key;
  if (key === undefined) {
    throw new ExamStartConcurrencyError(
      'The harness attempt snapshot has no question key.',
    );
  }
  return key;
}

async function startAndHash(
  observer: PrismaClient,
  service: ExamService,
  learnerId: number,
  testId: number,
): Promise<string> {
  const started = await service.startAttempt(learnerId, testId, randomUUID());
  const snapshot = await observer.examAttemptSnapshot.findUniqueOrThrow({
    where: { attemptId: started.data.id },
    select: { contentHash: true },
  });
  return snapshot.contentHash;
}

async function createPublishedTest(input: {
  service: TestAuthoringService;
  actor: CmsActor;
  levelId: number;
  questionId: number;
  title: string;
  suffix: string;
}): Promise<{ testId: number; updatedAt: Date }> {
  const draft = await input.service.createTest(
    input.actor,
    {
      levelId: input.levelId,
      title: input.title,
      duration: 90,
      passScore: 80,
    },
    { correlationId: `test-create-${input.suffix}` },
  );
  const structured = await input.service.replaceTestStructure(
    input.actor,
    draft.data.id,
    structurePayload({
      expectedUpdatedAt: draft.data.updatedAt.toISOString(),
      questionId: input.questionId,
    }),
    { correlationId: `test-structure-${input.suffix}` },
  );
  await input.service.publishTest(
    input.actor,
    draft.data.id,
    { expectedUpdatedAt: structured.data.updatedAt.toISOString() },
    { correlationId: `test-publish-${input.suffix}` },
  );
  return { testId: draft.data.id, updatedAt: structured.data.updatedAt };
}

async function runScenario(
  name: string,
  run: (round: number) => Promise<void>,
  rounds: number = ROUNDS,
): Promise<void> {
  for (let round = 1; round <= rounds; round += 1) {
    try {
      await run(round);
    } catch (error: unknown) {
      if (error instanceof ExamStartConcurrencyError) {
        throw new ExamStartConcurrencyError(
          `${name} round ${String(round)}: ${error.message}`,
        );
      }
      throw error;
    }
  }
  console.log(`${name}: ${String(rounds)} rounds GREEN`);
}

main()
  .then(() => {
    if (deadlockCodes.length > 0) {
      console.error(`deadlocks observed: ${String(deadlockCodes.length)}`);
      for (const entry of deadlockCodes.slice(0, 3)) console.error(entry);
      process.exitCode = 1;
      console.log('RESULT: FAIL');
      return;
    }
    if (serverFaults.length > 0) {
      console.error(`unexpected server faults: ${String(serverFaults.length)}`);
      for (const entry of serverFaults.slice(0, 3)) console.error(entry);
      process.exitCode = 1;
      console.log('RESULT: FAIL');
      return;
    }
    console.log('deadlocks: 0');
    console.log('RESULT: PASS');
  })
  .catch((error: unknown) => {
    if (error instanceof ExamStartConcurrencyError) {
      console.error(error.message);
    } else {
      console.error(
        `exam start concurrency failed (${error instanceof Error ? error.constructor.name : 'value'})`,
      );
      if (error instanceof Error) {
        console.error(error.message.slice(0, 2_000));
      }
    }
    process.exitCode = 1;
    console.log('RESULT: FAIL');
  });
