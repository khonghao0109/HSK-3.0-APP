/**
 * M4.2c / TL-155 + review H1 (A2 re-targeted by M4.3 / TL-167): production-
 * path concurrency evidence for "submit exam", proved **on the row lock**
 * instead of on timing.
 *
 * Every main scenario runs in **both orders** with the same shape:
 *   A pauses inside the real transaction (`after_attempt_lock`) and keeps the
 *   `ExamAttempt` row lock; B starts with a coordinator that records its
 *   backend pid; `waitUntilLocked(B)` must observe
 *   `pg_stat_activity.wait_event_type = 'Lock'`; then A is released.
 * A round fails if no real lock wait is observed.
 *
 *  S1  two submits, different keys      -> one 200, one 409 ALREADY_SUBMITTED
 *  S2  two submits, same key            -> both 200, exactly one replayed:true
 *  S3  submit vs GET (expired)          -> GET-first: submit CLOSED,
 *                                          reason expired_on_read;
 *                                          submit-first: submit EXPIRED,
 *                                          reason expired_on_submit
 *  S4  submit vs save                   -> submit-first: save CLOSED, 0 autosaved;
 *                                          save-first: save 200, then submit 200
 *                                          and answeredCount counts that answer
 *  S5  submit vs start (expired)        -> submit-first: EXPIRED;
 *                                          start-first: CLOSED (no EXPIRED)
 *  S6  2 submits + 1 save with barrier  -> no 500, no deadlock, 1 terminal event
 *  S7  2 GET result on a timed_out attempt -> both 200, exactly one Result,
 *                                           reason expired_on_read
 *  S8  submit vs GET result             -> submit-first: GET result 200 and
 *                                          matches the stored Result;
 *                                          GET-first: GET result 409
 *                                          NOT_TERMINAL, submit then 200
 *  S9  User FOR UPDATE (account delete) vs submit -> submit waits on the FK
 *                                          then 200, 0 deadlock
 *
 * The `-pre` controls keep the previous `before_attempt_lock` variants ("the
 * opponent commits first"): the paused transaction has not taken the row lock
 * yet, so by construction they do not claim a lock wait.
 *
 * Runs on a fresh migration-only disposable database. Fails on any deadlock
 * (40P01), lock/statement timeout, unexpected 500, more than one terminal
 * event, a `submitted` attempt without exactly one `Result` covering every
 * test-section skill, a `timed_out` attempt without exactly one lazily graded
 * `Result` in the S7 rounds, or a `Result` on any other status (A2 scores
 * inside the submit transaction; A3 grades `timed_out` lazily on GET result).
 */
import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import {
  ContentStatus,
  ExamAttemptStatus,
  MediaProcessingStatus,
  MediaType,
  Prisma,
  PrismaClient,
  QuestionType,
  Skill,
} from '@prisma/client';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { CmsActor } from '../../src/modules/cms/cms-workflow';
import { CmsTransactionCoordinator } from '../../src/modules/cms/cms-transaction-coordinator';
import { CreateQuestionRevisionDto } from '../../src/modules/cms/dto/create-question-revision.dto';
import { QuestionAuthoringService } from '../../src/modules/cms/question-authoring.service';
import { ReplaceTestStructureDto } from '../../src/modules/cms/dto/replace-test-structure.dto';
import { TestAuthoringService } from '../../src/modules/cms/test-authoring.service';
import { ExamService } from '../../src/modules/exam/exam.service';
import {
  ExamTransactionCoordinator,
  type ExamTransactionCheckpoint,
} from '../../src/modules/exam/exam-transaction-coordinator';
import { PrismaService } from '../../src/prisma/prisma.service';

const ROUNDS = 20;
const COORDINATION_TIMEOUT_MS = 2_500;
const BARRIER_TIMEOUT_MS = 8_000;
const STATEMENT_TIMEOUT_MS = 7_000;
const LOCK_TIMEOUT_MS = 5_000;

class ExamSubmitConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExamSubmitConcurrencyError';
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

type SubmitValue = {
  data: {
    id: number;
    status: string;
    submittedAt: string;
    answeredCount: number;
    unansweredCount: number;
    flaggedCount: number;
    replayed: boolean;
  };
};

type AttemptReadValue = { data: { status: string; remainingSeconds: number } };

/** A3: the 200 body of GET result, as far as the harness asserts it. */
type ExamResultValue = {
  data: {
    attemptId: number;
    status: string;
    score: number;
    maxScore: number;
    counts: { answeredCount: number };
  };
};

const deadlockCodes: string[] = [];
const serverFaults: string[] = [];
const missingLockWaits: string[] = [];

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
      reject(new ExamSubmitConcurrencyError(`${label} timed out`));
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
    `SET LOCAL statement_timeout = '${String(STATEMENT_TIMEOUT_MS)}ms'`,
  );
  await transaction.$executeRawUnsafe(
    `SET LOCAL lock_timeout = '${String(LOCK_TIMEOUT_MS)}ms'`,
  );
  await transaction.$executeRawUnsafe(
    `SET LOCAL idle_in_transaction_session_timeout = '${String(BARRIER_TIMEOUT_MS + 2_000)}ms'`,
  );
  const [connection] = await transaction.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid()::int AS pid
  `;
  return connection.pid;
}

/**
 * H1: the only accepted proof of contention. Polls the real backend pid until
 * PostgreSQL reports that it is waiting on a lock; a timeout is a scenario
 * failure, not a soft signal.
 */
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
  missingLockWaits.push(`pid ${String(backendPid)}`);
  throw new ExamSubmitConcurrencyError(
    `waitUntilLocked: backend pid ${String(backendPid)} never reported wait_event_type=Lock`,
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
  const text = collectCodes(outcome.reason).join('\n');
  if (text.includes('40P01') || text.includes('deadlock detected')) {
    deadlockCodes.push(`${scenario}:${text}`);
    return;
  }
  if (outcome.reason instanceof HttpException) return;
  serverFaults.push(`${scenario}:${text.slice(0, 400)}`);
}

function asOutcome(promise: Promise<unknown>): Promise<Outcome> {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new ExamSubmitConcurrencyError(message);
}

function assertRejected(
  label: string,
  outcome: Outcome,
): asserts outcome is { status: 'rejected'; reason: unknown } {
  if (outcome.status !== 'rejected') {
    throw new ExamSubmitConcurrencyError(`${label} was fulfilled`);
  }
}

function assertFulfilled(
  label: string,
  outcome: Outcome,
): asserts outcome is { status: 'fulfilled'; value: unknown } {
  if (outcome.status !== 'fulfilled') {
    throw new ExamSubmitConcurrencyError(`${label} was rejected`);
  }
}

function conflictCode(outcome: { reason: unknown }): string | null {
  if (!(outcome.reason instanceof HttpException)) return null;
  const body = outcome.reason.getResponse() as { code?: unknown };
  return typeof body.code === 'string' ? body.code : null;
}

function expectConflict(label: string, outcome: Outcome, code: string): void {
  assertNoServerFault(label, outcome);
  assertRejected(label, outcome);
  check(
    conflictCode(outcome) === code,
    `${label} rejected with ${String(conflictCode(outcome))} (expected ${code})`,
  );
}

function submitValue(outcome: Outcome): SubmitValue {
  assertFulfilled('submit', outcome);
  return outcome.value as SubmitValue;
}

function attemptReadValue(outcome: Outcome): AttemptReadValue {
  assertFulfilled('attempt read', outcome);
  return outcome.value as AttemptReadValue;
}

/** A3: a GET result must be a documented 200, never a 500/deadlock. */
function resultValue(label: string, outcome: Outcome): ExamResultValue {
  assertNoServerFault(label, outcome);
  assertFulfilled(label, outcome);
  return outcome.value as ExamResultValue;
}

function timeoutReason(event: { metadata: Prisma.JsonValue }): string | null {
  const metadata = event.metadata;
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  const reason = (metadata as Record<string, Prisma.JsonValue>).reason;
  return typeof reason === 'string' ? reason : null;
}

/**
 * Pauses the real production transaction at `holdPhase`. It configures the
 * transaction and records its backend pid at `before_attempt_lock`; when
 * `holdPhase` is `before_attempt_lock` it pauses before taking the row lock
 * (the opponent-commits-first control), otherwise it pauses after `FOR UPDATE`
 * and therefore holds the row lock.
 */
class HoldCoordinator extends ExamTransactionCoordinator {
  constructor(
    private readonly operation:
      | 'exam.submit'
      | 'exam.answer.save'
      | 'exam.attempt.read'
      | 'exam.result.read',
    private readonly holdPhase: 'before_attempt_lock' | 'after_attempt_lock',
    private readonly paused: Deferred<void>,
    private readonly release: Deferred<void>,
    private readonly backendPid: Deferred<number>,
  ) {
    super();
  }

  override async checkpoint(
    checkpoint: ExamTransactionCheckpoint,
  ): Promise<void> {
    if (checkpoint.operation !== this.operation) return;
    if (checkpoint.phase === 'before_attempt_lock') {
      this.backendPid.resolve(
        await configureTransaction(checkpoint.transaction),
      );
      if (this.holdPhase === 'before_attempt_lock') {
        this.paused.resolve();
        await withTimeout(
          this.release.promise,
          BARRIER_TIMEOUT_MS,
          `${this.operation} pre-lock release barrier`,
        );
      }
      return;
    }
    if (
      checkpoint.phase === 'after_attempt_lock' &&
      this.holdPhase === 'after_attempt_lock'
    ) {
      this.paused.resolve();
      await withTimeout(
        this.release.promise,
        BARRIER_TIMEOUT_MS,
        `${this.operation} row-lock release barrier`,
      );
    }
  }
}

/** Records the backend pid at `before_attempt_lock` without pausing. */
class PidCoordinator extends ExamTransactionCoordinator {
  constructor(
    private readonly operation:
      | 'exam.submit'
      | 'exam.answer.save'
      | 'exam.attempt.read'
      | 'exam.result.read',
    private readonly backendPid: Deferred<number>,
  ) {
    super();
  }

  override async checkpoint(
    checkpoint: ExamTransactionCheckpoint,
  ): Promise<void> {
    if (checkpoint.operation !== this.operation) return;
    if (checkpoint.phase !== 'before_attempt_lock') return;
    this.backendPid.resolve(await configureTransaction(checkpoint.transaction));
  }
}

/**
 * Start has no coordinator checkpoint after its `ExamAttempt FOR UPDATE` (the
 * production service must not change in this round), so S5b holds start's row
 * lock with a Prisma middleware that pauses **after** the real lock query
 * resolves. The query still runs on the production transaction; only the pause
 * is test scaffolding.
 */
type StartRowHold = { paused: Deferred<void>; release: Deferred<void> };
let startRowHold: StartRowHold | null = null;

function rawQueryText(args: unknown): string {
  try {
    return JSON.stringify(args) ?? '';
  } catch {
    return '';
  }
}

function installStartRowLockHold(prismaStart: PrismaService): void {
  prismaStart.$use(
    async (
      params: Prisma.MiddlewareParams,
      next: (input: Prisma.MiddlewareParams) => Promise<unknown>,
    ): Promise<unknown> => {
      const result = await next(params);
      const hold = startRowHold;
      if (hold === null) return result;
      if (params.action !== 'queryRaw') return result;
      const text = rawQueryText(params.args);
      if (!text.includes('ExamAttempt') || !text.includes('FOR UPDATE')) {
        return result;
      }
      startRowHold = null;
      hold.paused.resolve();
      await withTimeout(
        hold.release.promise,
        BARRIER_TIMEOUT_MS,
        'S5b start row-lock release barrier',
      );
      return result;
    },
  );
}

/** Records start's backend pid at its last checkpoint before the close branch. */
class StartPidCoordinator extends ExamTransactionCoordinator {
  constructor(private readonly backendPid: Deferred<number>) {
    super();
  }

  override async checkpoint(
    checkpoint: ExamTransactionCheckpoint,
  ): Promise<void> {
    if (checkpoint.phase !== 'after_media_locks') return;
    if (!('transaction' in checkpoint)) return;
    this.backendPid.resolve(await configureTransaction(checkpoint.transaction));
  }
}

function questionPayload(input: {
  levelId: number;
  content: string;
  skill?: Skill;
  audioId?: number;
}): CreateQuestionRevisionDto {
  return {
    type: QuestionType.mcq,
    skill: input.skill ?? Skill.reading,
    levelId: input.levelId,
    content: input.content,
    answers: {
      options: [
        { id: 'a', text: 'Đáp án đúng' },
        { id: 'b', text: 'Đáp án sai' },
      ],
    },
    correctAnswer: { optionId: 'a' },
    explanation: 'Vì đáp án A khớp đoạn văn.',
    difficulty: 2,
    audioId: input.audioId ?? null,
    tags: ['Gia đình'],
  };
}

/**
 * A3a: the seeded test has one section per skill so the Result breakdown must
 * cover both `ResultSkillScore` rows, exactly like a real mixed exam.
 */
function structurePayload(input: {
  expectedUpdatedAt: string;
  questionId: number;
  listeningQuestionId: number;
}): ReplaceTestStructureDto {
  return {
    expectedUpdatedAt: input.expectedUpdatedAt,
    sections: [
      {
        skill: Skill.reading,
        title: 'Đọc hiểu',
        groups: [{ title: 'Nhóm 1', questionIds: [input.questionId] }],
      },
      {
        skill: Skill.listening,
        title: 'Nghe hiểu',
        groups: [{ title: 'Nhóm 2', questionIds: [input.listeningQuestionId] }],
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
  const prismaStart = new PrismaService({
    datasources: { db: { url: databaseUrl } },
  });
  installStartRowLockHold(prismaStart);

  const cmsCoordinator = new CmsTransactionCoordinator();
  const questionService = new QuestionAuthoringService(prismaA, cmsCoordinator);
  const testService = new TestAuthoringService(prismaA, cmsCoordinator);
  const plainExamService = new ExamService(
    prismaA,
    new ExamTransactionCoordinator(),
  );
  const suffix = randomUUID().replace(/-/gu, '');

  const terminalCount = async (attemptId: number): Promise<number> =>
    observer.examAttemptEvent.count({
      where: {
        attemptId,
        type: { in: ['submitted', 'timed_out'] },
      },
    });

  /**
   * Every round, in every scenario, keeps exactly one terminal event. The
   * `Result` rows follow the committed attempt status: A2 scores on the
   * `in_progress -> submitted` transition, so a `submitted` attempt owns exactly
   * one `Result` whose skill scores cover every skill of the frozen test
   * sections; a `timed_out` attempt stays unscored until A3 grades it lazily on
   * GET result. Any other terminal status is a harness bug, not a pass.
   */
  const assertRoundInvariants = async (
    label: string,
    attemptId: number,
    testIdValue: number,
  ): Promise<void> => {
    const terminal = await terminalCount(attemptId);
    check(
      terminal === 1,
      `${label}: ${String(terminal)} terminal events (expected 1)`,
    );
    const attempt = await observer.examAttempt.findUnique({
      where: { id: attemptId },
      select: { status: true },
    });
    if (attempt === null) {
      throw new ExamSubmitConcurrencyError(
        `${label}: attempt ${String(attemptId)} is missing`,
      );
    }

    if (attempt.status === ExamAttemptStatus.submitted) {
      const results = await observer.result.findMany({
        where: { attemptId },
        select: { id: true },
      });
      check(
        results.length === 1,
        `${label}: submitted attempt has ${String(results.length)} Result rows (expected exactly 1)`,
      );
      const resultId = results[0].id;
      const sections = await observer.testSection.findMany({
        where: { testId: testIdValue },
        select: { skill: true },
      });
      const expectedSkills = new Set(sections.map((section) => section.skill));
      check(
        expectedSkills.size > 0,
        `${label}: test ${String(testIdValue)} has no sections to score`,
      );
      const skillScores = await observer.resultSkillScore.findMany({
        where: { resultId },
        select: { skill: true },
      });
      check(
        skillScores.length === expectedSkills.size,
        `${label}: Result ${String(resultId)} has ${String(skillScores.length)} skill scores for ${String(expectedSkills.size)} section skills`,
      );
      const scoredSkills = new Set(skillScores.map((row) => row.skill));
      check(
        scoredSkills.size === skillScores.length,
        `${label}: Result ${String(resultId)} has duplicate skill score rows`,
      );
      for (const skill of expectedSkills) {
        check(
          scoredSkills.has(skill),
          `${label}: Result ${String(resultId)} is missing the ${skill} skill score`,
        );
      }
      return;
    }

    if (attempt.status === ExamAttemptStatus.timed_out) {
      const results = await observer.result.count({ where: { attemptId } });
      check(
        results === 0,
        `${label}: timed_out attempt has ${String(results)} Result rows (A3 grades lazily; expected 0)`,
      );
      return;
    }

    throw new ExamSubmitConcurrencyError(
      `${label}: attempt status is ${attempt.status} (expected submitted or timed_out)`,
    );
  };

  const timedOutEvents = async (
    attemptId: number,
  ): Promise<Array<{ metadata: Prisma.JsonValue }>> =>
    observer.examAttemptEvent.findMany({
      where: { attemptId, type: 'timed_out' },
      select: { metadata: true },
    });

  const autosavedCount = async (attemptId: number): Promise<number> =>
    observer.examAttemptEvent.count({
      where: { attemptId, type: 'autosaved' },
    });

  const attemptCount = async (
    userId: number,
    testIdValue: number,
  ): Promise<number> =>
    observer.examAttempt.count({
      where: { userId, testId: testIdValue },
    });

  console.log(
    `Running exam submit production-path row-lock concurrency on "${databaseName}" (${String(ROUNDS)} rounds/scenario)`,
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
      counts?.tests === 0 && counts?.attempts === 0,
      'exam submit concurrency harness requires a fresh migration-only disposable database',
    );

    const admin = await observer.user.create({
      data: {
        email: `exam-submit-concurrency-${suffix}@example.com`,
        password: 'test-submit-harness-hash',
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
        content: 'Câu hỏi của harness submit',
      }),
      { correlationId: `exam-submit-harness-question-${suffix}` },
    );
    const questionId = created.data.question.id;
    const revisionId = created.data.revision.id;
    await questionService.reviewQuestionRevision(
      actor,
      questionId,
      revisionId,
      { decision: 'approved' },
      { correlationId: `exam-submit-harness-approve-${suffix}` },
    );
    await questionService.publishQuestionRevision(
      actor,
      questionId,
      revisionId,
      { correlationId: `exam-submit-harness-publish-${suffix}` },
    );

    // A3a: a second, listening-skill question so the test has two sections.
    // A listening question must carry a ready audio at publish time.
    const listeningAudio = await observer.media.create({
      data: {
        url: `urn:hsk:test:harness-listening-${suffix}`,
        type: MediaType.audio,
        mimeType: 'audio/mpeg',
        processingStatus: MediaProcessingStatus.ready,
      },
      select: { id: true },
    });
    const listeningCreated = await questionService.createQuestion(
      actor,
      questionPayload({
        levelId: level.id,
        content: 'Câu nghe của harness submit',
        skill: Skill.listening,
        audioId: listeningAudio.id,
      }),
      { correlationId: `exam-submit-harness-listening-question-${suffix}` },
    );
    const listeningQuestionId = listeningCreated.data.question.id;
    await questionService.reviewQuestionRevision(
      actor,
      listeningQuestionId,
      listeningCreated.data.revision.id,
      { decision: 'approved' },
      { correlationId: `exam-submit-harness-listening-approve-${suffix}` },
    );
    await questionService.publishQuestionRevision(
      actor,
      listeningQuestionId,
      listeningCreated.data.revision.id,
      { correlationId: `exam-submit-harness-listening-publish-${suffix}` },
    );

    const draft = await testService.createTest(
      actor,
      {
        levelId: level.id,
        title: `Đề harness submit ${suffix}`,
        duration: 90,
        passScore: 80,
      },
      { correlationId: `exam-submit-harness-test-${suffix}` },
    );
    const structured = await testService.replaceTestStructure(
      actor,
      draft.data.id,
      structurePayload({
        expectedUpdatedAt: draft.data.updatedAt.toISOString(),
        questionId,
        listeningQuestionId,
      }),
      { correlationId: `exam-submit-harness-structure-${suffix}` },
    );
    await testService.publishTest(
      actor,
      draft.data.id,
      { expectedUpdatedAt: structured.data.updatedAt.toISOString() },
      { correlationId: `exam-submit-harness-test-publish-${suffix}` },
    );
    const testId = draft.data.id;

    let learnerSeq = 0;
    const createLearner = async (label: string): Promise<number> => {
      learnerSeq += 1;
      const user = await observer.user.create({
        data: {
          email: `exam-submit-harness-${label}-${String(learnerSeq)}-${suffix}@example.com`,
          password: 'test-submit-harness-hash',
        },
        select: { id: true },
      });
      return user.id;
    };

    const startFor = async (learnerId: number): Promise<number> => {
      const started = await plainExamService.startAttempt(
        learnerId,
        testId,
        randomUUID(),
      );
      return started.data.id;
    };

    const questionKeyFor = async (attemptId: number): Promise<string> => {
      const snapshot = await observer.examAttemptSnapshot.findUniqueOrThrow({
        where: { attemptId },
        select: { payload: true },
      });
      return firstQuestionKey(snapshot.payload);
    };

    const expirePastGrace = async (attemptId: number): Promise<void> => {
      const nowMs = Date.now();
      await observer.examAttempt.update({
        where: { id: attemptId },
        data: {
          startedAt: new Date(nowMs - 91 * 60_000),
          expiresAt: new Date(nowMs - 10_000),
        },
      });
    };

    const submitWith = (
      prisma: PrismaService,
      coordinator: ExamTransactionCoordinator,
      learnerId: number,
      attemptId: number,
      key: string,
    ): Promise<unknown> =>
      new ExamService(prisma, coordinator).submitAttempt(
        learnerId,
        attemptId,
        key,
      );

    const readWith = (
      prisma: PrismaService,
      coordinator: ExamTransactionCoordinator,
      learnerId: number,
      attemptId: number,
    ): Promise<unknown> =>
      new ExamService(prisma, coordinator).getAttemptView(learnerId, attemptId);

    const resultWith = (
      prisma: PrismaService,
      coordinator: ExamTransactionCoordinator,
      learnerId: number,
      attemptId: number,
    ): Promise<unknown> =>
      new ExamService(prisma, coordinator).getAttemptResult(
        learnerId,
        attemptId,
      );

    const saveWith = (
      prisma: PrismaService,
      coordinator: ExamTransactionCoordinator,
      learnerId: number,
      attemptId: number,
      questionKey: string,
    ): Promise<unknown> =>
      new ExamService(prisma, coordinator).saveAnswer(
        learnerId,
        attemptId,
        questionKey,
        {
          answer: { choice: 'a' },
          isFlagged: false,
          expectedVersion: null,
          idempotencyKey: randomUUID(),
        },
      );

    // ---------------------------------------------------------------- S1 ----
    // Two submits, different keys. The holder is whichever submit starts first;
    // each order is exercised by swapping the two services.
    for (const order of ['a', 'b'] as const) {
      await runScenario(`S1${order}`, async () => {
        const learnerId = await createLearner(`s1${order}`);
        const attemptId = await startFor(learnerId);
        const paused = createDeferred<void>();
        const release = createDeferred<void>();
        const holderPid = createDeferred<number>();
        const waiterPid = createDeferred<number>();
        const holder = asOutcome(
          submitWith(
            order === 'a' ? prismaA : prismaB,
            new HoldCoordinator(
              'exam.submit',
              'after_attempt_lock',
              paused,
              release,
              holderPid,
            ),
            learnerId,
            attemptId,
            randomUUID(),
          ),
        );
        await withTimeout(
          holderPid.promise,
          COORDINATION_TIMEOUT_MS,
          `S1${order} holder pid`,
        );
        await withTimeout(
          paused.promise,
          COORDINATION_TIMEOUT_MS,
          `S1${order} holder row lock`,
        );
        const waiter = asOutcome(
          submitWith(
            order === 'a' ? prismaB : prismaA,
            new PidCoordinator('exam.submit', waiterPid),
            learnerId,
            attemptId,
            randomUUID(),
          ),
        );
        await withTimeout(
          waiterPid.promise,
          COORDINATION_TIMEOUT_MS,
          `S1${order} waiter pid`,
        );
        await waitUntilLocked(observer, await waiterPid.promise);
        release.resolve();
        const [held, waited] = await Promise.all([holder, waiter]);
        submitValue(held);
        expectConflict(
          `S1${order} waiter`,
          waited,
          'EXAM_ATTEMPT_ALREADY_SUBMITTED',
        );
        // S1 is the canonical double-submit shape: the holder transitions the
        // attempt and writes the one Result, the waiter must not write another.
        const s1Results = await observer.result.count({ where: { attemptId } });
        check(
          s1Results === 1,
          `S1${order}: submitted attempt has ${String(s1Results)} Result rows (expected exactly 1)`,
        );
        await assertRoundInvariants(`S1${order}`, attemptId, testId);
      });
    }

    // ---------------------------------------------------------------- S2 ----
    // Two submits, same key. Exactly one response may be replayed:true, and the
    // replay must repeat the first submit's submittedAt and all three counts.
    for (const order of ['a', 'b'] as const) {
      await runScenario(`S2${order}`, async () => {
        const learnerId = await createLearner(`s2${order}`);
        const attemptId = await startFor(learnerId);
        const paused = createDeferred<void>();
        const release = createDeferred<void>();
        const holderPid = createDeferred<number>();
        const waiterPid = createDeferred<number>();
        const key = randomUUID();
        const holder = asOutcome(
          submitWith(
            order === 'a' ? prismaA : prismaB,
            new HoldCoordinator(
              'exam.submit',
              'after_attempt_lock',
              paused,
              release,
              holderPid,
            ),
            learnerId,
            attemptId,
            key,
          ),
        );
        await withTimeout(
          holderPid.promise,
          COORDINATION_TIMEOUT_MS,
          `S2${order} holder pid`,
        );
        await withTimeout(
          paused.promise,
          COORDINATION_TIMEOUT_MS,
          `S2${order} holder row lock`,
        );
        const waiter = asOutcome(
          submitWith(
            order === 'a' ? prismaB : prismaA,
            new PidCoordinator('exam.submit', waiterPid),
            learnerId,
            attemptId,
            key,
          ),
        );
        await withTimeout(
          waiterPid.promise,
          COORDINATION_TIMEOUT_MS,
          `S2${order} waiter pid`,
        );
        await waitUntilLocked(observer, await waiterPid.promise);
        release.resolve();
        const [held, waited] = await Promise.all([holder, waiter]);
        const first = submitValue(held);
        const second = submitValue(waited);
        const replayed = [first, second].filter(
          (entry) => entry.data.replayed === true,
        );
        check(
          replayed.length === 1,
          `S2${order}: ${String(replayed.length)} responses reported replayed:true (expected 1)`,
        );
        // The service returns Date objects here (not HTTP JSON), so compare
        // instants, not object identity.
        const firstSubmittedAt = new Date(first.data.submittedAt).getTime();
        const secondSubmittedAt = new Date(second.data.submittedAt).getTime();
        check(
          firstSubmittedAt === secondSubmittedAt,
          `S2${order}: submittedAt differs (${String(firstSubmittedAt)} vs ${String(secondSubmittedAt)})`,
        );
        check(
          second.data.answeredCount === first.data.answeredCount &&
            second.data.unansweredCount === first.data.unansweredCount &&
            second.data.flaggedCount === first.data.flaggedCount,
          `S2${order}: replay counts differ (${JSON.stringify(first.data)} vs ${JSON.stringify(second.data)})`,
        );
        check(
          (await observer.examAttemptEvent.count({
            where: { attemptId, type: 'submitted' },
          })) === 1,
          `S2${order}: more than one submitted event`,
        );
        await assertRoundInvariants(`S2${order}`, attemptId, testId);
      });
    }

    // ---------------------------------------------------------------- S3 ----
    // submit vs GET on an attempt past the grace window.
    // S3a: GET holds the row lock -> submit CLOSED, reason expired_on_read.
    await runScenario('S3a', async () => {
      const learnerId = await createLearner('s3a');
      const attemptId = await startFor(learnerId);
      await expirePastGrace(attemptId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const waiterPid = createDeferred<number>();
      const readOutcome = asOutcome(
        readWith(
          prismaA,
          new HoldCoordinator(
            'exam.attempt.read',
            'after_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S3a read holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S3a read row lock',
      );
      const submitOutcome = asOutcome(
        submitWith(
          prismaB,
          new PidCoordinator('exam.submit', waiterPid),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        waiterPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S3a submit waiter pid',
      );
      await waitUntilLocked(observer, await waiterPid.promise);
      release.resolve();
      const [readResult, submitted] = await Promise.all([
        readOutcome,
        submitOutcome,
      ]);
      check(
        attemptReadValue(readResult).data.status === 'timed_out',
        'S3a GET did not return timed_out',
      );
      expectConflict('S3a submit', submitted, 'EXAM_ATTEMPT_CLOSED');
      const events = await timedOutEvents(attemptId);
      check(
        events.length === 1 &&
          timeoutReason(events[0] ?? { metadata: null }) === 'expired_on_read',
        `S3a: timed_out event reason is ${String(events[0] === undefined ? null : timeoutReason(events[0]))}`,
      );
      await assertRoundInvariants('S3a', attemptId, testId);
    });

    // S3b: submit holds the row lock -> submit EXPIRED, reason expired_on_submit.
    await runScenario('S3b', async () => {
      const learnerId = await createLearner('s3b');
      const attemptId = await startFor(learnerId);
      await expirePastGrace(attemptId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const waiterPid = createDeferred<number>();
      const submitOutcome = asOutcome(
        submitWith(
          prismaA,
          new HoldCoordinator(
            'exam.submit',
            'after_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S3b submit holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S3b submit row lock',
      );
      const readOutcome = asOutcome(
        readWith(
          prismaB,
          new PidCoordinator('exam.attempt.read', waiterPid),
          learnerId,
          attemptId,
        ),
      );
      await withTimeout(
        waiterPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S3b read waiter pid',
      );
      await waitUntilLocked(observer, await waiterPid.promise);
      release.resolve();
      const [submitted, readResult] = await Promise.all([
        submitOutcome,
        readOutcome,
      ]);
      expectConflict('S3b submit', submitted, 'EXAM_ATTEMPT_EXPIRED');
      check(
        attemptReadValue(readResult).data.status === 'timed_out',
        'S3b GET did not return timed_out',
      );
      const events = await timedOutEvents(attemptId);
      check(
        events.length === 1 &&
          timeoutReason(events[0] ?? { metadata: null }) ===
            'expired_on_submit',
        `S3b: timed_out event reason is ${String(events[0] === undefined ? null : timeoutReason(events[0]))}`,
      );
      await assertRoundInvariants('S3b', attemptId, testId);
    });

    // S3-pre (control): submit pauses before the lock, GET commits first.
    await runScenario('S3-pre', async () => {
      const learnerId = await createLearner('s3pre');
      const attemptId = await startFor(learnerId);
      await expirePastGrace(attemptId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const submitOutcome = asOutcome(
        submitWith(
          prismaA,
          new HoldCoordinator(
            'exam.submit',
            'before_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S3-pre submit holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S3-pre submit pre-lock pause',
      );
      const read = await asOutcome(
        plainExamService.getAttemptView(learnerId, attemptId),
      );
      check(
        attemptReadValue(read).data.status === 'timed_out',
        'S3-pre GET did not return timed_out',
      );
      release.resolve();
      const submitted = await submitOutcome;
      expectConflict('S3-pre submit', submitted, 'EXAM_ATTEMPT_CLOSED');
      const events = await timedOutEvents(attemptId);
      check(
        events.length === 1 &&
          timeoutReason(events[0] ?? { metadata: null }) === 'expired_on_read',
        `S3-pre: timed_out event reason is ${String(events[0] === undefined ? null : timeoutReason(events[0]))}`,
      );
      await assertRoundInvariants('S3-pre', attemptId, testId);
    });

    // ---------------------------------------------------------------- S4 ----
    // submit vs save.
    // S4a: submit holds the row lock -> save CLOSED, no new autosaved event.
    await runScenario('S4a', async () => {
      const learnerId = await createLearner('s4a');
      const attemptId = await startFor(learnerId);
      const questionKey = await questionKeyFor(attemptId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const waiterPid = createDeferred<number>();
      const submitOutcome = asOutcome(
        submitWith(
          prismaA,
          new HoldCoordinator(
            'exam.submit',
            'after_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S4a submit holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S4a submit row lock',
      );
      const saveOutcome = asOutcome(
        saveWith(
          prismaB,
          new PidCoordinator('exam.answer.save', waiterPid),
          learnerId,
          attemptId,
          questionKey,
        ),
      );
      await withTimeout(
        waiterPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S4a save waiter pid',
      );
      await waitUntilLocked(observer, await waiterPid.promise);
      release.resolve();
      const [submitted, saved] = await Promise.all([
        submitOutcome,
        saveOutcome,
      ]);
      submitValue(submitted);
      expectConflict('S4a save', saved, 'EXAM_ATTEMPT_CLOSED');
      check(
        (await autosavedCount(attemptId)) === 0,
        'S4a wrote an autosaved event after submit',
      );
      await assertRoundInvariants('S4a', attemptId, testId);
    });

    // S4b: save holds the row lock -> save 200, submit 200 counts that answer.
    await runScenario('S4b', async () => {
      const learnerId = await createLearner('s4b');
      const attemptId = await startFor(learnerId);
      const questionKey = await questionKeyFor(attemptId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const waiterPid = createDeferred<number>();
      const saveOutcome = asOutcome(
        saveWith(
          prismaA,
          new HoldCoordinator(
            'exam.answer.save',
            'after_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
          questionKey,
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S4b save holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S4b save row lock',
      );
      const submitOutcome = asOutcome(
        submitWith(
          prismaB,
          new PidCoordinator('exam.submit', waiterPid),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        waiterPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S4b submit waiter pid',
      );
      await waitUntilLocked(observer, await waiterPid.promise);
      release.resolve();
      const [saved, submitted] = await Promise.all([
        saveOutcome,
        submitOutcome,
      ]);
      assertFulfilled('S4b save', saved);
      const submitData = submitValue(submitted);
      check(
        submitData.data.answeredCount === 1,
        `S4b answeredCount is ${String(submitData.data.answeredCount)} (expected 1)`,
      );
      check(
        (await autosavedCount(attemptId)) === 1,
        'S4b did not keep exactly one autosaved event',
      );
      await assertRoundInvariants('S4b', attemptId, testId);
    });

    // S4-pre (control): save pauses before the lock, submit commits first.
    await runScenario('S4-pre', async () => {
      const learnerId = await createLearner('s4pre');
      const attemptId = await startFor(learnerId);
      const questionKey = await questionKeyFor(attemptId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const saveOutcome = asOutcome(
        saveWith(
          prismaA,
          new HoldCoordinator(
            'exam.answer.save',
            'before_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
          questionKey,
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S4-pre save holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S4-pre save pre-lock pause',
      );
      const submitted = await asOutcome(
        submitWith(
          prismaB,
          new ExamTransactionCoordinator(),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      submitValue(submitted);
      release.resolve();
      const saved = await saveOutcome;
      expectConflict('S4-pre save', saved, 'EXAM_ATTEMPT_CLOSED');
      check(
        (await autosavedCount(attemptId)) === 0,
        'S4-pre wrote an autosaved event after submit',
      );
      await assertRoundInvariants('S4-pre', attemptId, testId);
    });

    // ---------------------------------------------------------------- S5 ----
    // submit vs start on an expired attempt.
    // S5a: submit holds the row lock -> start waits, submit EXPIRED.
    await runScenario('S5a', async () => {
      const learnerId = await createLearner('s5a');
      const attemptId = await startFor(learnerId);
      await expirePastGrace(attemptId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const startPid = createDeferred<number>();
      const submitOutcome = asOutcome(
        submitWith(
          prismaA,
          new HoldCoordinator(
            'exam.submit',
            'after_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S5a submit holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S5a submit row lock',
      );
      const startOutcome = asOutcome(
        new ExamService(
          prismaB,
          new StartPidCoordinator(startPid),
        ).startAttempt(learnerId, testId, randomUUID()),
      );
      await withTimeout(
        startPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S5a start waiter pid',
      );
      await waitUntilLocked(observer, await startPid.promise);
      release.resolve();
      const [submitted, started] = await Promise.all([
        submitOutcome,
        startOutcome,
      ]);
      expectConflict('S5a submit', submitted, 'EXAM_ATTEMPT_EXPIRED');
      assertFulfilled('S5a start', started);
      const status = (
        await observer.examAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          select: { status: true },
        })
      ).status;
      check(
        status === ExamAttemptStatus.timed_out,
        `S5a old attempt is ${status} (expected timed_out)`,
      );
      const events = await timedOutEvents(attemptId);
      check(
        events.length === 1 &&
          timeoutReason(events[0] ?? { metadata: null }) ===
            'expired_on_submit',
        `S5a: timed_out event reason is ${String(events[0] === undefined ? null : timeoutReason(events[0]))}`,
      );
      check(
        (await attemptCount(learnerId, testId)) === 2,
        'S5a did not leave exactly two attempts',
      );
      await assertRoundInvariants('S5a', attemptId, testId);
    });

    // S5b: start holds the row lock -> submit CLOSED (never EXPIRED).
    await runScenario('S5b', async () => {
      const learnerId = await createLearner('s5b');
      const attemptId = await startFor(learnerId);
      await expirePastGrace(attemptId);
      const startPid = createDeferred<number>();
      const submitPid = createDeferred<number>();
      const hold: StartRowHold = {
        paused: createDeferred<void>(),
        release: createDeferred<void>(),
      };
      try {
        startRowHold = hold;
        const startOutcome = asOutcome(
          new ExamService(
            prismaStart,
            new StartPidCoordinator(startPid),
          ).startAttempt(learnerId, testId, randomUUID()),
        );
        await withTimeout(
          startPid.promise,
          COORDINATION_TIMEOUT_MS,
          'S5b start holder pid',
        );
        await withTimeout(
          hold.paused.promise,
          COORDINATION_TIMEOUT_MS,
          'S5b start row lock',
        );
        const submitOutcome = asOutcome(
          submitWith(
            prismaB,
            new PidCoordinator('exam.submit', submitPid),
            learnerId,
            attemptId,
            randomUUID(),
          ),
        );
        await withTimeout(
          submitPid.promise,
          COORDINATION_TIMEOUT_MS,
          'S5b submit waiter pid',
        );
        await waitUntilLocked(observer, await submitPid.promise);
        hold.release.resolve();
        const [started, submitted] = await Promise.all([
          startOutcome,
          submitOutcome,
        ]);
        assertFulfilled('S5b start', started);
        expectConflict('S5b submit', submitted, 'EXAM_ATTEMPT_CLOSED');
        const status = (
          await observer.examAttempt.findUniqueOrThrow({
            where: { id: attemptId },
            select: { status: true },
          })
        ).status;
        check(
          status === ExamAttemptStatus.timed_out,
          `S5b old attempt is ${status} (expected timed_out)`,
        );
        const events = await timedOutEvents(attemptId);
        check(
          events.length === 1 &&
            timeoutReason(events[0] ?? { metadata: null }) ===
              'expired_on_start',
          `S5b: timed_out event reason is ${String(events[0] === undefined ? null : timeoutReason(events[0]))}`,
        );
        check(
          (await attemptCount(learnerId, testId)) === 2,
          'S5b did not leave exactly two attempts',
        );
        await assertRoundInvariants('S5b', attemptId, testId);
      } finally {
        startRowHold = null;
      }
    });

    // S5-pre (control): submit pauses before the lock, start closes first.
    await runScenario('S5-pre', async () => {
      const learnerId = await createLearner('s5pre');
      const attemptId = await startFor(learnerId);
      await expirePastGrace(attemptId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const submitOutcome = asOutcome(
        submitWith(
          prismaA,
          new HoldCoordinator(
            'exam.submit',
            'before_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S5-pre submit holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S5-pre submit pre-lock pause',
      );
      const started = await asOutcome(
        plainExamService.startAttempt(learnerId, testId, randomUUID()),
      );
      assertFulfilled('S5-pre start', started);
      release.resolve();
      const submitted = await submitOutcome;
      expectConflict('S5-pre submit', submitted, 'EXAM_ATTEMPT_CLOSED');
      const events = await timedOutEvents(attemptId);
      check(
        events.length === 1 &&
          timeoutReason(events[0] ?? { metadata: null }) === 'expired_on_start',
        `S5-pre: timed_out event reason is ${String(events[0] === undefined ? null : timeoutReason(events[0]))}`,
      );
      check(
        (await attemptCount(learnerId, testId)) === 2,
        'S5-pre did not leave exactly two attempts',
      );
      await assertRoundInvariants('S5-pre', attemptId, testId);
    });

    // ---------------------------------------------------------------- S6 ----
    // Two submits + one save: only the first submit transitions; the rest see
    // the committed submitted status. No 500 and no deadlock.
    await runScenario('S6', async () => {
      const learnerId = await createLearner('s6');
      const attemptId = await startFor(learnerId);
      const questionKey = await questionKeyFor(attemptId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const submitPid = createDeferred<number>();
      const savePid = createDeferred<number>();
      const holder = asOutcome(
        submitWith(
          prismaA,
          new HoldCoordinator(
            'exam.submit',
            'after_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S6 holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S6 holder row lock',
      );
      const secondSubmit = asOutcome(
        submitWith(
          prismaB,
          new PidCoordinator('exam.submit', submitPid),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      const concurrentSave = asOutcome(
        saveWith(
          prismaB,
          new PidCoordinator('exam.answer.save', savePid),
          learnerId,
          attemptId,
          questionKey,
        ),
      );
      await withTimeout(
        submitPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S6 second submit pid',
      );
      await withTimeout(
        savePid.promise,
        COORDINATION_TIMEOUT_MS,
        'S6 save pid',
      );
      await waitUntilLocked(observer, await submitPid.promise);
      await waitUntilLocked(observer, await savePid.promise);
      release.resolve();
      const [first, second, saved] = await Promise.all([
        holder,
        secondSubmit,
        concurrentSave,
      ]);
      submitValue(first);
      expectConflict(
        'S6 second submit',
        second,
        'EXAM_ATTEMPT_ALREADY_SUBMITTED',
      );
      expectConflict('S6 save', saved, 'EXAM_ATTEMPT_CLOSED');
      await assertRoundInvariants('S6', attemptId, testId);
    });

    // ---------------------------------------------------------------- S7 ----
    // A3/TL-165: two GET result calls on the same `timed_out` attempt race for
    // the attempt row lock. The winner applies the lazy timeout and grades; the
    // waiter then sees the committed Result. Exactly one Result, no deadlock.
    for (const order of ['a', 'b'] as const) {
      await runScenario(`S7${order}`, async () => {
        const learnerId = await createLearner(`s7${order}`);
        const attemptId = await startFor(learnerId);
        await expirePastGrace(attemptId);
        const paused = createDeferred<void>();
        const release = createDeferred<void>();
        const holderPid = createDeferred<number>();
        const waiterPid = createDeferred<number>();
        const holder = asOutcome(
          resultWith(
            order === 'a' ? prismaA : prismaB,
            new HoldCoordinator(
              'exam.result.read',
              'after_attempt_lock',
              paused,
              release,
              holderPid,
            ),
            learnerId,
            attemptId,
          ),
        );
        await withTimeout(
          holderPid.promise,
          COORDINATION_TIMEOUT_MS,
          `S7${order} holder pid`,
        );
        await withTimeout(
          paused.promise,
          COORDINATION_TIMEOUT_MS,
          `S7${order} holder row lock`,
        );
        const waiter = asOutcome(
          resultWith(
            order === 'a' ? prismaB : prismaA,
            new PidCoordinator('exam.result.read', waiterPid),
            learnerId,
            attemptId,
          ),
        );
        await withTimeout(
          waiterPid.promise,
          COORDINATION_TIMEOUT_MS,
          `S7${order} waiter pid`,
        );
        await waitUntilLocked(observer, await waiterPid.promise);
        release.resolve();
        const [held, waited] = await Promise.all([holder, waiter]);
        const first = resultValue(`S7${order} holder`, held);
        const second = resultValue(`S7${order} waiter`, waited);
        check(
          first.data.attemptId === attemptId &&
            second.data.attemptId === attemptId,
          `S7${order}: GET result returned another attempt`,
        );
        check(
          first.data.status === 'timed_out' &&
            second.data.status === 'timed_out',
          `S7${order}: GET result status is ${first.data.status}/${second.data.status} (expected timed_out)`,
        );
        check(
          first.data.score === second.data.score &&
            first.data.counts.answeredCount ===
              second.data.counts.answeredCount,
          `S7${order}: the two GET result bodies disagree`,
        );
        const results = await observer.result.findMany({
          where: { attemptId },
          select: { id: true, score: true, maxScore: true },
        });
        check(
          results.length === 1,
          `S7${order}: ${String(results.length)} Result rows (expected exactly 1)`,
        );
        check(
          results[0]?.score === first.data.score &&
            results[0]?.maxScore === first.data.maxScore,
          `S7${order}: GET result does not match the stored Result`,
        );
        const events = await timedOutEvents(attemptId);
        check(
          events.length === 1 &&
            timeoutReason(events[0] ?? { metadata: null }) ===
              'expired_on_read',
          `S7${order}: timed_out event is not the single expired_on_read transition`,
        );
      });
    }

    // ---------------------------------------------------------------- S8 ----
    // A3: submit vs GET result on the same attempt. S8a: submit holds the lock,
    // so GET result observes the committed submission and returns the same
    // Result. S8b: GET result holds the lock first, so it answers 409
    // NOT_TERMINAL and the submit is the only writer.
    await runScenario('S8a', async () => {
      const learnerId = await createLearner('s8a');
      const attemptId = await startFor(learnerId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const waiterPid = createDeferred<number>();
      const submitOutcome = asOutcome(
        submitWith(
          prismaA,
          new HoldCoordinator(
            'exam.submit',
            'after_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S8a submit holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S8a submit row lock',
      );
      const resultOutcome = asOutcome(
        resultWith(
          prismaB,
          new PidCoordinator('exam.result.read', waiterPid),
          learnerId,
          attemptId,
        ),
      );
      await withTimeout(
        waiterPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S8a result waiter pid',
      );
      await waitUntilLocked(observer, await waiterPid.promise);
      release.resolve();
      const [submitted, readResult] = await Promise.all([
        submitOutcome,
        resultOutcome,
      ]);
      submitValue(submitted);
      const view = resultValue('S8a GET result', readResult);
      const results = await observer.result.findMany({
        where: { attemptId },
        select: { score: true, maxScore: true },
      });
      check(
        results.length === 1,
        `S8a: ${String(results.length)} Result rows (expected exactly 1)`,
      );
      check(
        view.data.status === 'submitted',
        `S8a: GET result status is ${view.data.status} (expected submitted)`,
      );
      check(
        view.data.score === results[0]?.score &&
          view.data.maxScore === results[0]?.maxScore,
        'S8a: GET result does not match the Result written by submit',
      );
      await assertRoundInvariants('S8a', attemptId, testId);
    });

    await runScenario('S8b', async () => {
      const learnerId = await createLearner('s8b');
      const attemptId = await startFor(learnerId);
      const paused = createDeferred<void>();
      const release = createDeferred<void>();
      const holderPid = createDeferred<number>();
      const waiterPid = createDeferred<number>();
      const resultOutcome = asOutcome(
        resultWith(
          prismaA,
          new HoldCoordinator(
            'exam.result.read',
            'after_attempt_lock',
            paused,
            release,
            holderPid,
          ),
          learnerId,
          attemptId,
        ),
      );
      await withTimeout(
        holderPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S8b result holder pid',
      );
      await withTimeout(
        paused.promise,
        COORDINATION_TIMEOUT_MS,
        'S8b result row lock',
      );
      const submitOutcome = asOutcome(
        submitWith(
          prismaB,
          new PidCoordinator('exam.submit', waiterPid),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        waiterPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S8b submit waiter pid',
      );
      await waitUntilLocked(observer, await waiterPid.promise);
      release.resolve();
      const [readResult, submitted] = await Promise.all([
        resultOutcome,
        submitOutcome,
      ]);
      expectConflict('S8b GET result', readResult, 'EXAM_ATTEMPT_NOT_TERMINAL');
      submitValue(submitted);
      check(
        (await observer.result.count({ where: { attemptId } })) === 1,
        'S8b: the submit did not leave exactly one Result',
      );
      await assertRoundInvariants('S8b', attemptId, testId);
    });

    // ---------------------------------------------------------------- S9 ----
    // A3: a transaction that holds `User FOR UPDATE` (the shape of account
    // deletion) vs submit. The submit itself never locks User, but its Result
    // insert takes an implicit `FOR KEY SHARE` on the User row, so the submit
    // must wait and then finish — never deadlock.
    await runScenario('S9', async () => {
      const learnerId = await createLearner('s9');
      const attemptId = await startFor(learnerId);
      const userLocked = createDeferred<void>();
      const releaseUser = createDeferred<void>();
      const userLockTx = observer.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL statement_timeout = '${String(STATEMENT_TIMEOUT_MS)}ms'`,
          );
          await tx.$executeRawUnsafe(
            `SET LOCAL lock_timeout = '${String(LOCK_TIMEOUT_MS)}ms'`,
          );
          const rows = await tx.$queryRaw<Array<{ id: number }>>`
            SELECT "id" FROM "User" WHERE "id" = ${learnerId} FOR UPDATE
          `;
          check(rows.length === 1, 'S9 user lock did not find the learner row');
          userLocked.resolve();
          await withTimeout(
            releaseUser.promise,
            BARRIER_TIMEOUT_MS,
            'S9 user lock release barrier',
          );
        },
        { timeout: BARRIER_TIMEOUT_MS + 2_000 },
      );
      await withTimeout(
        userLocked.promise,
        COORDINATION_TIMEOUT_MS,
        'S9 user lock',
      );
      const submitPid = createDeferred<number>();
      const submitOutcome = asOutcome(
        submitWith(
          prismaB,
          new PidCoordinator('exam.submit', submitPid),
          learnerId,
          attemptId,
          randomUUID(),
        ),
      );
      await withTimeout(
        submitPid.promise,
        COORDINATION_TIMEOUT_MS,
        'S9 submit pid',
      );
      // The Result insert waits on the User row lock taken above.
      await waitUntilLocked(observer, await submitPid.promise);
      releaseUser.resolve();
      const [locked, submitted] = await Promise.all([
        asOutcome(userLockTx),
        submitOutcome,
      ]);
      assertFulfilled('S9 user lock tx', locked);
      submitValue(submitted);
      const attempt = await observer.examAttempt.findUniqueOrThrow({
        where: { id: attemptId },
        select: { status: true },
      });
      check(
        attempt.status === ExamAttemptStatus.submitted,
        `S9: attempt status is ${attempt.status} (expected submitted)`,
      );
      check(
        (await observer.result.count({ where: { attemptId } })) === 1,
        'S9: the submit did not leave exactly one Result',
      );
      await assertRoundInvariants('S9', attemptId, testId);
    });

    // Harness-wide sanity. A2: every committed `submitted` attempt owns exactly
    // one Result. A3: a `timed_out` attempt may own exactly one lazily graded
    // Result (S7 grades one per round) and no other status may own any.
    const submittedAttempts = await observer.examAttempt.count({
      where: { status: ExamAttemptStatus.submitted },
    });
    // A3a: the global Result checks below are only meaningful if at least one
    // round actually committed a submit; a broken fixture must fail here.
    check(
      submittedAttempts > 0,
      'harness committed no submitted attempt: the grading checks would be vacuous',
    );
    const scoredRows = await observer.result.findMany({
      select: { attemptId: true, attempt: { select: { status: true } } },
    });
    const scoredSubmitted = scoredRows.filter(
      (row) => row.attempt?.status === ExamAttemptStatus.submitted,
    ).length;
    const scoredTimedOut = scoredRows.filter(
      (row) => row.attempt?.status === ExamAttemptStatus.timed_out,
    ).length;
    check(
      scoredSubmitted === submittedAttempts,
      `harness left ${String(scoredSubmitted)} Result rows for ${String(submittedAttempts)} submitted attempts (expected exactly one Result per submitted attempt)`,
    );
    check(
      scoredRows.length === scoredSubmitted + scoredTimedOut,
      `harness left ${String(scoredRows.length - scoredSubmitted - scoredTimedOut)} Result rows on attempts that are neither submitted nor timed_out`,
    );
    // S7 runs both orders (S7a and S7b), so each round grades two timed_out
    // attempts exactly once.
    const expectedLazyResults = ROUNDS * 2;
    check(
      scoredTimedOut === expectedLazyResults,
      `harness left ${String(scoredTimedOut)} lazily graded timed_out Results (expected ${String(expectedLazyResults)}, one per S7 round)`,
    );
  } finally {
    await Promise.all([
      observer.$disconnect(),
      prismaA.$disconnect(),
      prismaB.$disconnect(),
      prismaStart.$disconnect(),
    ]);
  }
}

function firstQuestionKey(payload: Prisma.JsonValue): string {
  const root = payload as {
    sections: Array<{
      groups: Array<{ questions: Array<{ key: string }> }>;
    }>;
  };
  const key = root.sections[0]?.groups[0]?.questions?.[0]?.key;
  if (key === undefined) {
    throw new ExamSubmitConcurrencyError(
      'The harness attempt snapshot has no question key.',
    );
  }
  return key;
}

async function runScenario(
  name: string,
  run: (round: number) => Promise<void>,
): Promise<void> {
  for (let round = 1; round <= ROUNDS; round += 1) {
    try {
      await run(round);
    } catch (error: unknown) {
      if (error instanceof ExamSubmitConcurrencyError) {
        throw new ExamSubmitConcurrencyError(
          `${name} round ${String(round)}: ${error.message}`,
        );
      }
      throw error;
    }
  }
  console.log(`${name}: ${String(ROUNDS)} rounds GREEN`);
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
    if (missingLockWaits.length > 0) {
      console.error(
        `rounds without a real lock wait: ${String(missingLockWaits.length)}`,
      );
      process.exitCode = 1;
      console.log('RESULT: FAIL');
      return;
    }
    console.log('deadlocks: 0');
    console.log('lock waits observed: yes');
    console.log('RESULT: PASS');
  })
  .catch((error: unknown) => {
    if (error instanceof ExamSubmitConcurrencyError) {
      console.error(error.message);
    } else {
      console.error(
        `exam submit concurrency failed (${error instanceof Error ? error.constructor.name : 'value'})`,
      );
      if (error instanceof Error) {
        console.error(error.message.slice(0, 2_000));
      }
    }
    process.exitCode = 1;
    console.log('RESULT: FAIL');
  });
