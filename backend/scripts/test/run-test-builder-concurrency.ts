/**
 * M4.1b production-path concurrency evidence for the test builder. Runs on a
 * fresh migration-only disposable database:
 *
 * 1. publishing a draft test while one of its questions is archived: the
 *    archive commits first, so publish re-reads the locked question and fails
 *    with the documented 409 TEST_NOT_PUBLISHABLE — never a 500;
 * 2. two PUT structure calls with the same expectedUpdatedAt: the loser is a
 *    409 TEST_CONCURRENT_UPDATE and the stored tree belongs to the winner;
 * 3. publishing a question revision that changes the question's skill while a
 *    draft test containing it is published: the revision publish commits first
 *    and the test publish is rejected with question_skill_mismatch; the stored
 *    test never pairs a published status with a section/question skill mismatch,
 * 4. PUT structure races with archiving one of its questions: archive commits
 *    first, the PUT is rejected 409 TEST_QUESTION_NOT_USABLE reason archived;
 * 5. publish test (paused after its Question FOR SHARE locks) races with
 *    archiving one of its questions: publish commits, archive is rejected
 *    409 QUESTION_IN_PUBLISHED_TEST;
 * 6. publish test (same pause) races with publishing a revision that changes
 *    the question skill: publish commits, the revision is rejected 409
 *    QUESTION_IN_PUBLISHED_TEST field skill.
 *
 * The coordinator barrier makes transaction B wait on the real PostgreSQL row
 * lock, then releases A; the harness observes B blocked on a Lock wait event
 * before releasing, so the evidence is about the production lock order, not
 * about sleep timing.
 */
import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import {
  ContentStatus,
  Prisma,
  PrismaClient,
  QuestionType,
  Skill,
} from '@prisma/client';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { CmsActor } from '../../src/modules/cms/cms-workflow';
import {
  CmsTransactionCheckpoint,
  CmsTransactionCoordinator,
  CmsTransactionOperation,
} from '../../src/modules/cms/cms-transaction-coordinator';
import { CreateQuestionRevisionDto } from '../../src/modules/cms/dto/create-question-revision.dto';
import { ReplaceTestStructureDto } from '../../src/modules/cms/dto/replace-test-structure.dto';
import { QuestionAuthoringService } from '../../src/modules/cms/question-authoring.service';
import { TestAuthoringService } from '../../src/modules/cms/test-authoring.service';
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
  operation: CmsTransactionOperation;
  /** Phase where participant A pauses to hold its production locks. */
  aPausePhase: 'after_lock' | 'after_question_locks';
  transactionAAfterLock: Deferred<void>;
  releaseTransactionA: Deferred<void>;
  transactionBBackendPid: Deferred<number>;
  transactionBAfterLockObserved: boolean;
};

class TestBuilderConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestBuilderConcurrencyError';
  }
}

/**
 * Each participant receives its own control, so a race may combine different
 * production operations (question archive / question publish vs test publish).
 */
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
    if (checkpoint.operation !== this.control.operation) {
      throw new TestBuilderConcurrencyError(
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
      if (checkpoint.phase !== this.control.aPausePhase) return;
      this.control.transactionAAfterLock.resolve();
      await withTimeout(
        this.control.releaseTransactionA.promise,
        BARRIER_TIMEOUT_MS,
        'Transaction A production-lock release barrier',
      );
      return;
    }
    if (checkpoint.phase === 'after_lock') {
      this.control.transactionBAfterLockObserved = true;
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

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new TestBuilderConcurrencyError(`${label} timed out.`)),
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
  throw new TestBuilderConcurrencyError(
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
    throw new TestBuilderConcurrencyError(
      'Transaction B never reached the after_lock checkpoint.',
    );
  }
  return { a: aOutcome, b: bOutcome };
}

function conflictBody(outcome: Outcome): Record<string, unknown> | null {
  if (outcome.status !== 'rejected') return null;
  const reason = outcome.reason;
  if (!(reason instanceof HttpException)) {
    throw new TestBuilderConcurrencyError(
      'A racer was rejected with a non-domain error (possible 500).',
    );
  }
  if (reason.getStatus() !== 409) {
    throw new TestBuilderConcurrencyError(
      `A racer was rejected with HTTP ${reason.getStatus()} instead of a 409.`,
    );
  }
  const body = reason.getResponse();
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : null;
}

function conflictCode(outcome: Outcome): string | null {
  const body = conflictBody(outcome);
  if (body === null) return null;
  const code = body.code;
  return typeof code === 'string' ? code : null;
}

function conflictReasonCodes(outcome: Outcome): string[] {
  const body = conflictBody(outcome);
  if (body === null) return [];
  const raw = body.reasons;
  if (!Array.isArray(raw)) return [];
  const codes: string[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const code = (entry as { code?: unknown }).code;
    if (typeof code === 'string') codes.push(code);
  }
  return codes;
}

/**
 * The in-process HttpException body is flat (`{code, field, reason}`); the HTTP
 * envelope nests those fields under `error.details`, and `conflictBody`
 * already unwraps it via `getResponse()`.
 */
function conflictDetails(outcome: Outcome): Record<string, unknown> | null {
  return conflictBody(outcome);
}

function questionPayload(input: {
  levelId: number;
  prompt: string;
  skill: Skill;
  audioId?: number | null;
}): CreateQuestionRevisionDto {
  return {
    type: QuestionType.mcq,
    skill: input.skill,
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
    audioId: input.audioId ?? null,
    tags: ['Gia đình'],
  };
}

function structurePayload(input: {
  expectedUpdatedAt: string;
  sectionTitle: string;
  groupTitle: string;
  questionId: number;
}): ReplaceTestStructureDto {
  return {
    expectedUpdatedAt: input.expectedUpdatedAt,
    sections: [
      {
        skill: Skill.reading,
        title: input.sectionTitle,
        groups: [
          {
            title: input.groupTitle,
            questionIds: [input.questionId],
          },
        ],
      },
    ],
  };
}

/** Fixture: create, approve and publish a reading question (M4.1a path). */
async function createPublishedQuestion(input: {
  service: QuestionAuthoringService;
  actor: CmsActor;
  levelId: number;
  prompt: string;
  suffix: string;
}): Promise<number> {
  const created = await input.service.createQuestion(
    input.actor,
    questionPayload({
      levelId: input.levelId,
      prompt: input.prompt,
      skill: Skill.reading,
    }),
    { correlationId: `question-create-${input.suffix}` },
  );
  const questionId = created.data.question.id;
  const revisionId = created.data.revision.id;
  await input.service.reviewQuestionRevision(
    input.actor,
    questionId,
    revisionId,
    { decision: 'approved' },
    { correlationId: `question-approve-${input.suffix}` },
  );
  await input.service.publishQuestionRevision(
    input.actor,
    questionId,
    revisionId,
    { correlationId: `question-publish-${input.suffix}` },
  );
  return questionId;
}

/** Fixture: create a draft test and replace its whole structure. */
async function createDraftTestWithStructure(input: {
  service: TestAuthoringService;
  actor: CmsActor;
  levelId: number;
  title: string;
  sectionTitle: string;
  questionId: number;
  suffix: string;
}): Promise<{ testId: number; updatedAt: Date }> {
  const created = await input.service.createTest(
    input.actor,
    {
      levelId: input.levelId,
      title: input.title,
      duration: 30,
      passScore: 50,
    },
    { correlationId: `test-create-${input.suffix}` },
  );
  const structured = await input.service.replaceTestStructure(
    input.actor,
    created.data.id,
    structurePayload({
      expectedUpdatedAt: created.data.updatedAt.toISOString(),
      sectionTitle: input.sectionTitle,
      groupTitle: 'Nhóm câu hỏi',
      questionId: input.questionId,
    }),
    { correlationId: `test-structure-${input.suffix}` },
  );
  return {
    testId: created.data.id,
    updatedAt: structured.data.updatedAt,
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
  // Non-race fixture work uses the production no-op coordinator; the harness
  // coordinators reject any operation they were not built for.
  const plainQuestionService = new QuestionAuthoringService(
    prismaA,
    new CmsTransactionCoordinator(),
  );
  const plainTestService = new TestAuthoringService(
    prismaA,
    new CmsTransactionCoordinator(),
  );
  const suffix = randomUUID().replace(/-/gu, '');

  console.log(
    `Running Test Builder production-path concurrency on "${databaseName}"`,
  );

  try {
    const [counts] = await observer.$queryRaw<
      Array<{ tests: number; questions: number }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM "Test") AS tests,
        (SELECT COUNT(*)::int FROM "Question") AS questions
    `;
    if (counts?.tests !== 0 || counts.questions !== 0) {
      throw new TestBuilderConcurrencyError(
        'Test Builder concurrency test requires a fresh migration-only disposable database.',
      );
    }

    const admin = await observer.user.create({
      data: {
        email: `test-builder-concurrency-${suffix}@example.com`,
        password: '$argon2id$test-builder-concurrency-test-hash',
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
    const audio = await observer.media.create({
      data: {
        url: `https://cdn.example.test/test-builder-concurrency-${suffix}.mp3`,
        type: 'audio',
        mimeType: 'audio/mpeg',
        size: 16_384,
        duration: 7,
        originalFilename: 'test-builder-concurrency-audio.mp3',
        processingStatus: 'ready',
        uploadedById: admin.id,
        updatedById: admin.id,
      },
    });

    // 1. Publish a draft test while one of its questions is archived.
    const archivedQuestionId = await createPublishedQuestion({
      service: plainQuestionService,
      actor,
      levelId: level.id,
      prompt: 'Câu hỏi bị lưu trữ trong lúc publish test.',
      suffix: `archive-${suffix}`,
    });
    const archiveRaceTest = await createDraftTestWithStructure({
      service: plainTestService,
      actor,
      levelId: level.id,
      title: 'Bài kiểm tra đua lưu trữ câu hỏi',
      sectionTitle: 'Phần đọc (lưu trữ)',
      questionId: archivedQuestionId,
      suffix: `archive-test-${suffix}`,
    });
    const archiveControl = createRaceControl('question.archive');
    const archivePublishControl = createRaceControl('test.publish');
    const archiveServiceA = new QuestionAuthoringService(
      prismaA,
      new HarnessCoordinator('A', archiveControl),
    );
    const archivePublishServiceB = new TestAuthoringService(
      prismaB,
      new HarnessCoordinator('B', archivePublishControl),
    );
    const archiveRace = await runBarrierRace(
      observer,
      archiveControl,
      archivePublishControl,
      () =>
        archiveServiceA.archiveQuestion(actor, archivedQuestionId, {
          correlationId: `archive-a-${suffix}`,
        }),
      () =>
        archivePublishServiceB.publishTest(
          actor,
          archiveRaceTest.testId,
          { expectedUpdatedAt: archiveRaceTest.updatedAt.toISOString() },
          { correlationId: `archive-publish-b-${suffix}` },
        ),
    );
    const archiveCode = conflictCode(archiveRace.a);
    const archivePublishCode = conflictCode(archiveRace.b);
    if (
      archiveRace.a.status !== 'fulfilled' ||
      archiveRace.b.status !== 'rejected' ||
      archivePublishCode !== 'TEST_NOT_PUBLISHABLE'
    ) {
      throw new TestBuilderConcurrencyError(
        `Scenario 1 produced an unexpected race outcome (archive=${archiveRace.a.status}/${String(archiveCode)}, publish=${archiveRace.b.status}/${String(archivePublishCode)}).`,
      );
    }
    const [archivedTestState, archivedQuestionState] = await Promise.all([
      observer.test.findUniqueOrThrow({
        where: { id: archiveRaceTest.testId },
        select: { status: true, publishedAt: true },
      }),
      observer.question.findUniqueOrThrow({
        where: { id: archivedQuestionId },
        select: { status: true, deletedAt: true },
      }),
    ]);
    const questionArchived =
      archivedQuestionState.status === ContentStatus.archived &&
      archivedQuestionState.deletedAt !== null;
    const testStillDraft = archivedTestState.status === ContentStatus.draft;
    const consistentArchiveState =
      (questionArchived && testStillDraft) ||
      (archivedQuestionState.status === ContentStatus.published &&
        archivedTestState.status === ContentStatus.published);
    if (!consistentArchiveState || !questionArchived || !testStillDraft) {
      throw new TestBuilderConcurrencyError(
        `Scenario 1 left an inconsistent state (test=${archivedTestState.status}, question=${archivedQuestionState.status}, deletedAt=${String(archivedQuestionState.deletedAt)}).`,
      );
    }
    console.log(
      'Publish test vs archive question: GREEN (archive committed; publish rejected 409 TEST_NOT_PUBLISHABLE; test left draft).',
    );

    // 2. Two PUT structure calls with the same expectedUpdatedAt.
    const structureQuestionId = await createPublishedQuestion({
      service: plainQuestionService,
      actor,
      levelId: level.id,
      prompt: 'Câu hỏi cho đua cập nhật cấu trúc.',
      suffix: `structure-${suffix}`,
    });
    const structureRaceTest = await createDraftTestWithStructure({
      service: plainTestService,
      actor,
      levelId: level.id,
      title: 'Bài kiểm tra đua cấu trúc',
      sectionTitle: 'Phần đọc ban đầu',
      questionId: structureQuestionId,
      suffix: `structure-test-${suffix}`,
    });
    const staleUpdatedAt = structureRaceTest.updatedAt.toISOString();
    const structureControlA = createRaceControl('test.structure_update');
    const structureControlB = createRaceControl('test.structure_update');
    const structureServiceA = new TestAuthoringService(
      prismaA,
      new HarnessCoordinator('A', structureControlA),
    );
    const structureServiceB = new TestAuthoringService(
      prismaB,
      new HarnessCoordinator('B', structureControlB),
    );
    const structureRace = await runBarrierRace(
      observer,
      structureControlA,
      structureControlB,
      () =>
        structureServiceA.replaceTestStructure(
          actor,
          structureRaceTest.testId,
          structurePayload({
            expectedUpdatedAt: staleUpdatedAt,
            sectionTitle: 'Phần đọc A thắng',
            groupTitle: 'Nhóm A thắng',
            questionId: structureQuestionId,
          }),
          { correlationId: `structure-a-${suffix}` },
        ),
      () =>
        structureServiceB.replaceTestStructure(
          actor,
          structureRaceTest.testId,
          structurePayload({
            expectedUpdatedAt: staleUpdatedAt,
            sectionTitle: 'Phần đọc B thua',
            groupTitle: 'Nhóm B thua',
            questionId: structureQuestionId,
          }),
          { correlationId: `structure-b-${suffix}` },
        ),
    );
    const structureWinnerCode = conflictCode(structureRace.a);
    const structureStaleCode = conflictCode(structureRace.b);
    if (
      structureRace.a.status !== 'fulfilled' ||
      structureRace.b.status !== 'rejected' ||
      structureStaleCode !== 'TEST_CONCURRENT_UPDATE'
    ) {
      throw new TestBuilderConcurrencyError(
        `Scenario 2 produced an unexpected race outcome (winner=${structureRace.a.status}/${String(structureWinnerCode)}, stale=${structureRace.b.status}/${String(structureStaleCode)}).`,
      );
    }
    const storedStructure = await observer.test.findUniqueOrThrow({
      where: { id: structureRaceTest.testId },
      select: {
        status: true,
        updatedAt: true,
        sections: {
          orderBy: { orderIndex: 'asc' },
          select: {
            title: true,
            groups: {
              orderBy: { orderIndex: 'asc' },
              select: { title: true },
            },
          },
        },
      },
    });
    const winningSectionTitle = storedStructure.sections[0]?.title;
    const winningGroupTitle = storedStructure.sections[0]?.groups[0]?.title;
    const storedUpdatedAt = storedStructure.updatedAt.getTime();
    const previousUpdatedAt = structureRaceTest.updatedAt.getTime();
    if (
      storedStructure.status !== ContentStatus.draft ||
      storedStructure.sections.length !== 1 ||
      winningSectionTitle !== 'Phần đọc A thắng' ||
      winningGroupTitle !== 'Nhóm A thắng' ||
      storedUpdatedAt <= previousUpdatedAt
    ) {
      throw new TestBuilderConcurrencyError(
        `Scenario 2 stored structure does not match the winner (status=${storedStructure.status}, sections=${String(storedStructure.sections.length)}, title=${String(winningSectionTitle)}, group=${String(winningGroupTitle)}).`,
      );
    }
    console.log(
      'Two PUT structure calls with the same token: GREEN (winner committed; loser rejected 409 TEST_CONCURRENT_UPDATE; token advanced).',
    );

    // 3. Publish a draft test while a question revision changes its skill.
    const skillQuestionId = await createPublishedQuestion({
      service: plainQuestionService,
      actor,
      levelId: level.id,
      prompt: 'Câu hỏi cho đua đổi kỹ năng.',
      suffix: `skill-${suffix}`,
    });
    const skillRaceTest = await createDraftTestWithStructure({
      service: plainTestService,
      actor,
      levelId: level.id,
      title: 'Bài kiểm tra đua đổi kỹ năng',
      sectionTitle: 'Phần đọc (đổi kỹ năng)',
      questionId: skillQuestionId,
      suffix: `skill-test-${suffix}`,
    });
    const skillRevision = await plainQuestionService.createQuestionRevision(
      actor,
      skillQuestionId,
      questionPayload({
        levelId: level.id,
        prompt: 'Bản sửa đổi kỹ năng sang nghe.',
        skill: Skill.listening,
        audioId: audio.id,
      }),
      { correlationId: `skill-revision-${suffix}` },
    );
    if (skillRevision.data.idempotent) {
      throw new TestBuilderConcurrencyError(
        'Scenario 3 setup created an idempotent revision instead of a new one.',
      );
    }
    const skillRevisionId = skillRevision.data.revision.id;
    await plainQuestionService.reviewQuestionRevision(
      actor,
      skillQuestionId,
      skillRevisionId,
      { decision: 'approved' },
      { correlationId: `skill-approve-${suffix}` },
    );
    const skillPublishControl = createRaceControl('question.publish');
    const skillTestControl = createRaceControl('test.publish');
    const skillPublishServiceA = new QuestionAuthoringService(
      prismaA,
      new HarnessCoordinator('A', skillPublishControl),
    );
    const skillTestPublishServiceB = new TestAuthoringService(
      prismaB,
      new HarnessCoordinator('B', skillTestControl),
    );
    const skillRace = await runBarrierRace(
      observer,
      skillPublishControl,
      skillTestControl,
      () =>
        skillPublishServiceA.publishQuestionRevision(
          actor,
          skillQuestionId,
          skillRevisionId,
          { correlationId: `skill-publish-a-${suffix}` },
        ),
      () =>
        skillTestPublishServiceB.publishTest(
          actor,
          skillRaceTest.testId,
          { expectedUpdatedAt: skillRaceTest.updatedAt.toISOString() },
          { correlationId: `skill-publish-b-${suffix}` },
        ),
    );
    const skillPublishCode = conflictCode(skillRace.a);
    const skillTestCode = conflictCode(skillRace.b);
    const skillReasonCodes = conflictReasonCodes(skillRace.b);
    const publishedSkillOutcome =
      skillRace.a.status === 'fulfilled' &&
      skillRace.b.status === 'rejected' &&
      skillTestCode === 'TEST_NOT_PUBLISHABLE' &&
      skillReasonCodes.includes('question_skill_mismatch');
    if (!publishedSkillOutcome) {
      throw new TestBuilderConcurrencyError(
        `Scenario 3 produced an undocumented outcome (revision=${skillRace.a.status}/${String(skillPublishCode)}, test=${skillRace.b.status}/${String(skillTestCode)}, reasons=${JSON.stringify(skillReasonCodes)}).`,
      );
    }
    const skillRows = await observer.$queryRaw<
      Array<{
        testStatus: string;
        sectionSkill: string;
        questionSkill: string;
      }>
    >`
      SELECT
        t."status"::text AS "testStatus",
        s."skill"::text AS "sectionSkill",
        q."skill"::text AS "questionSkill"
      FROM "Test" t
      JOIN "TestSection" s ON s."testId" = t."id"
      JOIN "TestQuestion" tq ON tq."testId" = t."id"
      JOIN "Question" q ON q."id" = tq."questionId"
      WHERE t."id" = ${skillRaceTest.testId}
    `;
    const skillInvariantHolds =
      skillRows.length === 1 &&
      skillRows.every(
        (row) =>
          row.testStatus !== ContentStatus.published ||
          row.sectionSkill === row.questionSkill,
      );
    if (!skillInvariantHolds) {
      throw new TestBuilderConcurrencyError(
        `Scenario 3 stored a published test with a skill mismatch (${JSON.stringify(skillRows)}).`,
      );
    }
    console.log(
      'Publish test vs question revision skill change: GREEN (one documented 409 domain outcome; no stored published skill mismatch).',
    );

    // 4. Archive question while PUT structure references it (H3).
    const raceQuestionId = await createPublishedQuestion({
      service: plainQuestionService,
      actor,
      levelId: level.id,
      prompt: 'Câu hỏi cho đua lưu trữ với PUT structure.',
      suffix: `h3-${suffix}`,
    });
    const emptyTest = await plainTestService.createTest(
      actor,
      {
        levelId: level.id,
        title: 'Bài kiểm tra đua PUT structure với lưu trữ',
        duration: 30,
        passScore: 50,
      },
      { correlationId: `h3-test-${suffix}` },
    );
    const h3ArchiveControl = createRaceControl('question.archive');
    const h3StructureControl = createRaceControl('test.structure_update');
    const h3ArchiveServiceA = new QuestionAuthoringService(
      prismaA,
      new HarnessCoordinator('A', h3ArchiveControl),
    );
    const h3StructureServiceB = new TestAuthoringService(
      prismaB,
      new HarnessCoordinator('B', h3StructureControl),
    );
    const h3Race = await runBarrierRace(
      observer,
      h3ArchiveControl,
      h3StructureControl,
      () =>
        h3ArchiveServiceA.archiveQuestion(actor, raceQuestionId, {
          correlationId: `h3-archive-a-${suffix}`,
        }),
      () =>
        h3StructureServiceB.replaceTestStructure(
          actor,
          emptyTest.data.id,
          structurePayload({
            expectedUpdatedAt: emptyTest.data.updatedAt.toISOString(),
            sectionTitle: 'Phần đọc (H3)',
            groupTitle: 'Nhóm H3',
            questionId: raceQuestionId,
          }),
          { correlationId: `h3-structure-b-${suffix}` },
        ),
    );
    const h3ArchiveCode = conflictCode(h3Race.a);
    const h3StructureCode = conflictCode(h3Race.b);
    const h3Details = conflictDetails(h3Race.b);
    const h3Placements = await observer.testQuestion.count({
      where: { testId: emptyTest.data.id },
    });
    if (
      h3Race.a.status !== 'fulfilled' ||
      h3Race.b.status !== 'rejected' ||
      h3StructureCode !== 'TEST_QUESTION_NOT_USABLE' ||
      h3Details?.reason !== 'archived' ||
      h3Details?.field !== 'sections[0].groups[0].questionIds[0]' ||
      h3Placements !== 0
    ) {
      throw new TestBuilderConcurrencyError(
        `Scenario 4 produced an unexpected outcome (archive=${h3Race.a.status}/${String(h3ArchiveCode)}, structure=${h3Race.b.status}/${String(h3StructureCode)}, details=${JSON.stringify(h3Details)}, placements=${String(h3Placements)}).`,
      );
    }
    console.log(
      'PUT structure vs archive question: GREEN (archive committed; PUT rejected 409 TEST_QUESTION_NOT_USABLE reason archived; test left empty).',
    );

    // 5. Publish test pauses after its Question FOR SHARE locks, then B archives
    // one of those questions (H4, reverse order).
    const reverseArchiveQuestionId = await createPublishedQuestion({
      service: plainQuestionService,
      actor,
      levelId: level.id,
      prompt: 'Câu hỏi cho đua publish trước archive (H4).',
      suffix: `h4a-${suffix}`,
    });
    const reverseArchiveTest = await createDraftTestWithStructure({
      service: plainTestService,
      actor,
      levelId: level.id,
      title: 'Bài kiểm tra publish trước archive',
      sectionTitle: 'Phần đọc (H4 archive)',
      questionId: reverseArchiveQuestionId,
      suffix: `h4a-test-${suffix}`,
    });
    const h4aPublishControl = createRaceControl(
      'test.publish',
      'after_question_locks',
    );
    const h4aArchiveControl = createRaceControl('question.archive');
    const h4aPublishServiceA = new TestAuthoringService(
      prismaA,
      new HarnessCoordinator('A', h4aPublishControl),
    );
    const h4aArchiveServiceB = new QuestionAuthoringService(
      prismaB,
      new HarnessCoordinator('B', h4aArchiveControl),
    );
    const h4aRace = await runBarrierRace(
      observer,
      h4aPublishControl,
      h4aArchiveControl,
      () =>
        h4aPublishServiceA.publishTest(
          actor,
          reverseArchiveTest.testId,
          { expectedUpdatedAt: reverseArchiveTest.updatedAt.toISOString() },
          { correlationId: `h4a-publish-a-${suffix}` },
        ),
      () =>
        h4aArchiveServiceB.archiveQuestion(actor, reverseArchiveQuestionId, {
          correlationId: `h4a-archive-b-${suffix}`,
        }),
    );
    const h4aPublishCode = conflictCode(h4aRace.a);
    const h4aArchiveCode = conflictCode(h4aRace.b);
    const [h4aTestState, h4aQuestionState] = await Promise.all([
      observer.test.findUniqueOrThrow({
        where: { id: reverseArchiveTest.testId },
        select: { status: true },
      }),
      observer.question.findUniqueOrThrow({
        where: { id: reverseArchiveQuestionId },
        select: { status: true, deletedAt: true },
      }),
    ]);
    if (
      h4aRace.a.status !== 'fulfilled' ||
      h4aRace.b.status !== 'rejected' ||
      h4aArchiveCode !== 'QUESTION_IN_PUBLISHED_TEST' ||
      h4aTestState.status !== ContentStatus.published ||
      h4aQuestionState.status !== ContentStatus.published ||
      h4aQuestionState.deletedAt !== null
    ) {
      throw new TestBuilderConcurrencyError(
        `Scenario 5 produced an unexpected outcome (publish=${h4aRace.a.status}/${String(h4aPublishCode)}, archive=${h4aRace.b.status}/${String(h4aArchiveCode)}, test=${h4aTestState.status}, question=${h4aQuestionState.status}).`,
      );
    }
    console.log(
      'Publish test then archive question: GREEN (publish committed; archive rejected 409 QUESTION_IN_PUBLISHED_TEST; question still published).',
    );

    // 6. Publish test pauses after its Question FOR SHARE locks, then B
    // publishes a revision that changes the skill (H4 + TL-99).
    const reverseSkillQuestionId = await createPublishedQuestion({
      service: plainQuestionService,
      actor,
      levelId: level.id,
      prompt: 'Câu hỏi cho đua publish trước đổi kỹ năng (H4).',
      suffix: `h4b-${suffix}`,
    });
    const reverseSkillTest = await createDraftTestWithStructure({
      service: plainTestService,
      actor,
      levelId: level.id,
      title: 'Bài kiểm tra publish trước đổi kỹ năng',
      sectionTitle: 'Phần đọc (H4 skill)',
      questionId: reverseSkillQuestionId,
      suffix: `h4b-test-${suffix}`,
    });
    const reverseSkillRevision =
      await plainQuestionService.createQuestionRevision(
        actor,
        reverseSkillQuestionId,
        questionPayload({
          levelId: level.id,
          prompt: 'Bản sửa đổi kỹ năng trong đua H4.',
          skill: Skill.listening,
          audioId: audio.id,
        }),
        { correlationId: `h4b-revision-${suffix}` },
      );
    if (reverseSkillRevision.data.idempotent) {
      throw new TestBuilderConcurrencyError(
        'Scenario 6 setup created an idempotent revision instead of a new one.',
      );
    }
    await plainQuestionService.reviewQuestionRevision(
      actor,
      reverseSkillQuestionId,
      reverseSkillRevision.data.revision.id,
      { decision: 'approved' },
      { correlationId: `h4b-approve-${suffix}` },
    );
    const h4bPublishControl = createRaceControl(
      'test.publish',
      'after_question_locks',
    );
    const h4bRevisionControl = createRaceControl('question.publish');
    const h4bPublishServiceA = new TestAuthoringService(
      prismaA,
      new HarnessCoordinator('A', h4bPublishControl),
    );
    const h4bRevisionServiceB = new QuestionAuthoringService(
      prismaB,
      new HarnessCoordinator('B', h4bRevisionControl),
    );
    const h4bRace = await runBarrierRace(
      observer,
      h4bPublishControl,
      h4bRevisionControl,
      () =>
        h4bPublishServiceA.publishTest(
          actor,
          reverseSkillTest.testId,
          { expectedUpdatedAt: reverseSkillTest.updatedAt.toISOString() },
          { correlationId: `h4b-publish-a-${suffix}` },
        ),
      () =>
        h4bRevisionServiceB.publishQuestionRevision(
          actor,
          reverseSkillQuestionId,
          reverseSkillRevision.data.revision.id,
          { correlationId: `h4b-revision-b-${suffix}` },
        ),
    );
    const h4bPublishCode = conflictCode(h4bRace.a);
    const h4bRevisionCode = conflictCode(h4bRace.b);
    const h4bDetails = conflictDetails(h4bRace.b);
    const [h4bTestState, h4bQuestionState] = await Promise.all([
      observer.test.findUniqueOrThrow({
        where: { id: reverseSkillTest.testId },
        select: { status: true },
      }),
      observer.question.findUniqueOrThrow({
        where: { id: reverseSkillQuestionId },
        select: { skill: true, status: true },
      }),
    ]);
    if (
      h4bRace.a.status !== 'fulfilled' ||
      h4bRace.b.status !== 'rejected' ||
      h4bRevisionCode !== 'QUESTION_IN_PUBLISHED_TEST' ||
      h4bDetails?.field !== 'skill' ||
      h4bTestState.status !== ContentStatus.published ||
      h4bQuestionState.skill !== Skill.reading
    ) {
      throw new TestBuilderConcurrencyError(
        `Scenario 6 produced an unexpected outcome (publish=${h4bRace.a.status}/${String(h4bPublishCode)}, revision=${h4bRace.b.status}/${String(h4bRevisionCode)}, field=${String(h4bDetails?.field)}, test=${h4bTestState.status}, skill=${h4bQuestionState.skill}).`,
      );
    }
    console.log(
      'Publish test then question revision skill change: GREEN (publish committed; revision rejected 409 QUESTION_IN_PUBLISHED_TEST field skill; question skill unchanged).',
    );

    console.log('Test Builder production-path concurrency tests passed');
  } finally {
    await Promise.all([
      observer.$disconnect(),
      prismaA.$disconnect(),
      prismaB.$disconnect(),
    ]);
  }
}

function createRaceControl(
  operation: CmsTransactionOperation,
  aPausePhase: 'after_lock' | 'after_question_locks' = 'after_lock',
): RaceControl {
  return {
    operation,
    aPausePhase,
    transactionAAfterLock: createDeferred<void>(),
    releaseTransactionA: createDeferred<void>(),
    transactionBBackendPid: createDeferred<number>(),
    transactionBAfterLockObserved: false,
  };
}

void main().catch((error: unknown) => {
  const message =
    error instanceof TestBuilderConcurrencyError
      ? error.message
      : 'Test Builder concurrency failed with a non-domain error.';
  console.error(message);
  process.exitCode = 1;
});
