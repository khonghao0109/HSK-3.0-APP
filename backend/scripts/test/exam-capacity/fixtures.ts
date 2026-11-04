import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import {
  ContentStatus,
  Prisma,
  QuestionType,
  Skill,
  type PrismaClient,
} from '@prisma/client';

import type { CmsActor } from '../../../src/modules/cms/cms-workflow';
import { CmsTransactionCoordinator } from '../../../src/modules/cms/cms-transaction-coordinator';
import type { CreateQuestionRevisionDto } from '../../../src/modules/cms/dto/create-question-revision.dto';
import type { ReplaceTestStructureDto } from '../../../src/modules/cms/dto/replace-test-structure.dto';
import { QuestionAuthoringService } from '../../../src/modules/cms/question-authoring.service';
import { TestAuthoringService } from '../../../src/modules/cms/test-authoring.service';
import { PrismaService } from '../../../src/prisma/prisma.service';

import type { LearnerFixture } from './driver';
import type {
  InvariantResult,
  LatencySample,
  ServerRssSummary,
} from './metrics';

/**
 * M4.4 B1 — DB disposable, fixture đề thi và phiên đăng nhập cho học viên ảo.
 *
 * - Tạo/drop database + `prisma migrate deploy` giống `pretest:e2e`.
 * - Seed đề bằng đúng service CMS mà harness M4.2a/M4.2c dùng
 *   (`run-exam-start-concurrency.ts` mục seed), không tự INSERT cây đề.
 * - Phiên đăng nhập lưu hash sha256 + JWT cùng shape với `AuthService`
 *   (`auth.service.ts`: `insertSession`, `signToken`) để không gọi login và
 *   không đổi code ứng dụng.
 */

const BACKEND_ROOT = resolve(__dirname, '../../..');
const UUID_SLASH = /-+/gu;
const SAFE_DATABASE_NAME = /^[A-Za-z0-9_]+$/u;
const LEARNER_PASSWORD_PLACEHOLDER = '$argon2id$capacity-fixture-unusable';

type JwtConfig = {
  secrets: Record<string, string>;
  activeKid: string;
};

export type SeededFixture = {
  prisma: PrismaService;
  testId: number;
  questionCount: number;
};

export type LearnerSessionConfig = JwtConfig & {
  /** Refresh token TTL (ngày) — khớp `AUTH_REFRESH_TOKEN_TTL_DAYS`. */
  refreshTokenTtlDays?: number;
  /** Access token TTL — khớp `JWT_EXPIRES_IN` của server đo. */
  accessTokenTtl?: JwtSignOptions['expiresIn'];
};

function stripSearchParameters(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function adminDatabaseUrl(databaseUrl: string): string {
  const parsed = new URL(stripSearchParameters(databaseUrl));
  parsed.pathname = '/postgres';
  return parsed.toString();
}

type AdminConnection = {
  label: string;
  url: string | null;
};

/**
 * Kết nối dùng để CREATE/DROP database. Thử lần lượt: env
 * `CAPACITY_ADMIN_DATABASE_URL` (nếu có), cùng credential nhưng database
 * `postgres`, rồi socket local của user đang chạy (Homebrew: user OS là
 * superuser). Cần vậy vì role ứng dụng thường không có CREATEDB; database được
 * tạo với OWNER là role ứng dụng để migration tạo bảng được.
 */
function isDefaultLocalCluster(databaseUrl: string): boolean {
  const parsed = new URL(stripSearchParameters(databaseUrl));
  const host = parsed.hostname;
  const port = parsed.port === '' ? '5432' : parsed.port;
  // Socket `psql` không mang port của URL: chỉ dùng khi URL trỏ đúng cluster
  // mặc định 5432, nếu không sẽ DROP/CREATE trên cluster khác.
  return (
    (host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]') &&
    port === '5432'
  );
}

function resolveAdminConnections(
  databaseUrl: string,
  override: string | undefined,
): AdminConnection[] {
  const connections: AdminConnection[] = [];
  if (override !== undefined && override.length > 0) {
    connections.push({ label: 'CAPACITY_ADMIN_DATABASE_URL', url: override });
  }
  connections.push({
    label: 'same-credentials/postgres',
    url: adminDatabaseUrl(databaseUrl),
  });
  // Socket chỉ trỏ đúng cluster khi URL là localhost:5432; nếu không, psql
  // không có URL sẽ nói chuyện với cluster khác và có thể drop nhầm database.
  if (isDefaultLocalCluster(databaseUrl)) {
    connections.push({ label: 'local socket', url: null });
  }
  return connections;
}

function psqlAttempt(
  connection: AdminConnection,
  sql: string,
): { ok: boolean; detail: string } {
  const args =
    connection.url === null
      ? ['-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql]
      : [connection.url, '-v', 'ON_ERROR_STOP=1', '-c', sql];
  const result = spawnSync('psql', args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    detail:
      result.status === 0
        ? ''
        : `${connection.label}: psql exit ${String(result.status ?? -1)} ${(result.stderr ?? '').trim().slice(0, 300)}`,
  };
}

function databaseOwner(databaseUrl: string): string {
  const parsed = new URL(stripSearchParameters(databaseUrl));
  const owner = decodeURIComponent(parsed.username);
  if (!SAFE_DATABASE_NAME.test(owner)) {
    throw new Error(`Database user "${owner}" is not safe to interpolate`);
  }
  return owner;
}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd: BACKEND_ROOT,
    env: environment,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit ${String(result.status ?? -1)}`,
    );
  }
}

/**
 * Dựng database disposable mới tinh bằng migration đã commit.
 * Guard tên DB nằm ở `assertDisposableTestDatabase` (runner gọi trước).
 */
export function createDisposableDatabase(input: {
  databaseName: string;
  databaseUrl: string;
  prismaBinary: string;
  nodeExecutable: string;
}): void {
  if (!SAFE_DATABASE_NAME.test(input.databaseName)) {
    throw new Error(
      `Database name "${input.databaseName}" is not safe to interpolate`,
    );
  }
  const owner = databaseOwner(input.databaseUrl);
  const errors: string[] = [];
  let created = false;
  for (const connection of resolveAdminConnections(
    input.databaseUrl,
    process.env.CAPACITY_ADMIN_DATABASE_URL,
  )) {
    const drop = psqlAttempt(
      connection,
      `DROP DATABASE IF EXISTS "${input.databaseName}" WITH (FORCE)`,
    );
    if (!drop.ok) {
      errors.push(drop.detail);
      continue;
    }
    const create = psqlAttempt(
      connection,
      `CREATE DATABASE "${input.databaseName}" OWNER "${owner}"`,
    );
    if (!create.ok) {
      errors.push(create.detail);
      continue;
    }
    console.log(`capacity: database admin connection = ${connection.label}`);
    created = true;
    break;
  }
  if (!created) {
    throw new Error(`Could not create database: ${errors.join(' | ')}`);
  }
  run(input.nodeExecutable, [input.prismaBinary, 'migrate', 'deploy'], {
    ...process.env,
    DATABASE_URL: input.databaseUrl,
  });
}

export function dropDisposableDatabase(input: {
  databaseName: string;
  databaseUrl: string;
}): boolean {
  if (!SAFE_DATABASE_NAME.test(input.databaseName)) return false;
  const errors: string[] = [];
  for (const connection of resolveAdminConnections(
    input.databaseUrl,
    process.env.CAPACITY_ADMIN_DATABASE_URL,
  )) {
    const drop = psqlAttempt(
      connection,
      `DROP DATABASE IF EXISTS "${input.databaseName}" WITH (FORCE)`,
    );
    if (drop.ok) return true;
    errors.push(drop.detail);
  }
  console.error(`capacity: could not drop database: ${errors.join(' | ')}`);
  return false;
}

function questionPayload(
  levelId: number,
  index: number,
): CreateQuestionRevisionDto {
  return {
    type: QuestionType.mcq,
    skill: Skill.reading,
    levelId,
    content: `Câu ${String(index)}: chọn đáp án đúng.`,
    answers: {
      options: [
        { id: 'a', text: `Đáp án đúng ${String(index)}` },
        { id: 'b', text: `Đáp án sai ${String(index)}` },
      ],
    },
    correctAnswer: { optionId: 'a' },
    explanation: `Giải thích câu ${String(index)}.`,
    difficulty: 2,
    audioId: null,
    tags: ['Gia đình'],
  };
}

function structurePayload(input: {
  expectedUpdatedAt: string;
  questionIds: readonly number[];
}): ReplaceTestStructureDto {
  const groups: Array<{ title: string; questionIds: number[] }> = [];
  for (let start = 0; start < input.questionIds.length; start += 50) {
    groups.push({
      title: `Nhóm ${String(groups.length + 1)}`,
      questionIds: input.questionIds.slice(start, start + 50),
    });
  }
  return {
    expectedUpdatedAt: input.expectedUpdatedAt,
    sections: [{ skill: Skill.reading, title: 'Đọc hiểu', groups }],
  };
}

/**
 * Seed level + admin + N câu mcq đã publish + một đề đã publish.
 * Trả `testId` và số câu thật để driver đối chiếu `q<orderIndex>`.
 */
export async function seedExamFixture(input: {
  databaseUrl: string;
  questions: number;
  minutes: number;
}): Promise<SeededFixture> {
  const prisma = new PrismaService({
    datasources: { db: { url: input.databaseUrl } },
  });
  const coordinator = new CmsTransactionCoordinator();
  const questionService = new QuestionAuthoringService(prisma, coordinator);
  const testService = new TestAuthoringService(prisma, coordinator);
  const suffix = randomUUID().replace(UUID_SLASH, '');

  const [counts] = await prisma.$queryRaw<
    Array<{ tests: number; attempts: number }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM "Test") AS tests,
      (SELECT COUNT(*)::int FROM "ExamAttempt") AS attempts
  `;
  if (counts?.tests !== 0 || counts.attempts !== 0) {
    throw new Error(
      'Capacity harness requires a fresh migration-only disposable database',
    );
  }

  const admin = await prisma.user.create({
    data: {
      email: `exam-capacity-${suffix}@example.com`,
      password: LEARNER_PASSWORD_PLACEHOLDER,
      role: 'admin',
    },
    select: { id: true },
  });
  const actor: CmsActor = { id: admin.id, role: 'admin' };
  const level = await prisma.level.upsert({
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

  const questionIds: number[] = [];
  for (let index = 1; index <= input.questions; index += 1) {
    const created = await questionService.createQuestion(
      actor,
      questionPayload(level.id, index),
      { correlationId: `capacity-question-${suffix}-${String(index)}` },
    );
    const questionId = created.data.question.id;
    const revisionId = created.data.revision.id;
    await questionService.reviewQuestionRevision(
      actor,
      questionId,
      revisionId,
      { decision: 'approved' },
      { correlationId: `capacity-question-review-${suffix}-${String(index)}` },
    );
    await questionService.publishQuestionRevision(
      actor,
      questionId,
      revisionId,
      { correlationId: `capacity-question-publish-${suffix}-${String(index)}` },
    );
    questionIds.push(questionId);
  }

  const draft = await testService.createTest(
    actor,
    {
      levelId: level.id,
      title: `Đề capacity M4.4 ${suffix}`,
      duration: input.minutes,
      passScore: 60,
    },
    { correlationId: `capacity-test-${suffix}` },
  );
  const structured = await testService.replaceTestStructure(
    actor,
    draft.data.id,
    structurePayload({
      expectedUpdatedAt: draft.data.updatedAt.toISOString(),
      questionIds,
    }),
    { correlationId: `capacity-structure-${suffix}` },
  );
  await testService.publishTest(
    actor,
    draft.data.id,
    { expectedUpdatedAt: structured.data.updatedAt.toISOString() },
    { correlationId: `capacity-publish-${suffix}` },
  );

  return {
    prisma,
    testId: draft.data.id,
    questionCount: questionIds.length,
  };
}

/**
 * Tạo N học viên + `UserSession` + access token.
 *
 * Không gọi `/auth/login` (prompt B1). Shape phiên và claims bám đúng
 * `AuthService.insertSession`/`signToken`: refresh token thô 32 byte base64url,
 * `tokenHash = sha256(raw)`, JWT HS256 có header `kid`, claims
 * `{sub,email,role,sid}`.
 */
export async function createLearnerSessions(
  prisma: PrismaService,
  count: number,
  config: LearnerSessionConfig,
): Promise<LearnerFixture[]> {
  const jwt = new JwtService({});
  const ttlDays = config.refreshTokenTtlDays ?? 30;
  const secret = config.secrets[config.activeKid];
  if (secret === undefined) {
    throw new Error(`Missing JWT secret for kid "${config.activeKid}"`);
  }
  const suffix = randomUUID().replace(UUID_SLASH, '');
  const learners: LearnerFixture[] = [];

  for (let index = 1; index <= count; index += 1) {
    const email = `capacity-learner-${String(index)}-${suffix}@example.com`;
    const user = await prisma.user.create({
      data: { email, password: LEARNER_PASSWORD_PLACEHOLDER },
      select: { id: true },
    });
    // AuthService chưa export helper tạo session (`insertSession`/`signToken`
    // là private), nên fixture tạo thẳng row UserSession qua Prisma model với
    // đúng shape AuthService ghi: refresh token thô 32 byte, `tokenHash =
    // sha256(raw)`, hạn 30 ngày. Không gọi /auth/login và không đổi code app.
    const rawRefreshToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256')
      .update(rawRefreshToken)
      .digest('hex');
    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      },
      select: { id: true },
    });
    const sessionId = session.id;
    const accessToken = await jwt.signAsync(
      {
        sub: user.id,
        email,
        role: 'user',
        sid: sessionId,
      },
      {
        secret,
        expiresIn: config.accessTokenTtl ?? '6h',
        header: { kid: config.activeKid, alg: 'HS256' },
      },
    );
    learners.push({ index, userId: user.id, email, accessToken });
  }

  return learners;
}

/** Số connection + lock wait của chính database đang đo. */
export async function readActivitySnapshot(
  prisma: PrismaClient,
  serverApplicationName: string,
): Promise<{
  serverConnections: number;
  totalConnections: number;
  serverLockWaits: number;
}> {
  const rows = await prisma.$queryRaw<
    Array<{
      server_connections: number;
      total_connections: number;
      server_lock_waits: number;
    }>
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE application_name = ${serverApplicationName}
      )::int AS server_connections,
      COUNT(*)::int AS total_connections,
      COUNT(*) FILTER (
        WHERE application_name = ${serverApplicationName}
          AND wait_event_type = 'Lock'
      )::int AS server_lock_waits
    FROM pg_stat_activity
    WHERE datname = current_database()
  `;
  return {
    serverConnections: rows[0]?.server_connections ?? 0,
    totalConnections: rows[0]?.total_connections ?? 0,
    serverLockWaits: rows[0]?.server_lock_waits ?? 0,
  };
}

export async function readDeadlockCount(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ deadlocks: number }>>`
    SELECT deadlocks::int AS deadlocks
    FROM pg_stat_database
    WHERE datname = current_database()
  `;
  return rows[0]?.deadlocks ?? 0;
}

/** Mẫu pg_stat_activity mỗi 1 s; chỉ giữ đỉnh để artifact gọn. */
export function startActivitySampler(input: {
  prisma: PrismaClient;
  serverApplicationName: string;
  intervalMs: number;
}): {
  stop: () => Promise<{
    maxConnections: number;
    maxTotalConnections: number;
    maxLockWaits: number;
    samples: number;
    samplerErrors: number;
  }>;
} {
  let maxConnections = 0;
  let maxTotalConnections = 0;
  let maxLockWaits = 0;
  let samples = 0;
  let samplerErrors = 0;
  let inFlight: Promise<void> | null = null;
  const takeSample = (): void => {
    if (inFlight !== null) return;
    inFlight = readActivitySnapshot(input.prisma, input.serverApplicationName)
      .then((snapshot) => {
        samples += 1;
        maxConnections = Math.max(maxConnections, snapshot.serverConnections);
        maxTotalConnections = Math.max(
          maxTotalConnections,
          snapshot.totalConnections,
        );
        maxLockWaits = Math.max(maxLockWaits, snapshot.serverLockWaits);
      })
      .catch(() => {
        samplerErrors += 1;
      })
      .finally(() => {
        inFlight = null;
      });
  };
  const timer = setInterval(takeSample, input.intervalMs);
  timer.unref();

  return {
    stop: async () => {
      clearInterval(timer);
      // Drain the in-flight query: số đỉnh phải phản ánh cả giây cuối.
      if (inFlight !== null) await inFlight;
      return {
        maxConnections,
        maxTotalConnections,
        maxLockWaits,
        samples,
        samplerErrors,
      };
    },
  };
}

/** RSS của server (KB) đọc bằng `ps`; null khi process đã thoát. */
export function readServerRssKb(pid: number): number | null {
  const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const value = Number(result.stdout.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export type RssSampler = {
  stop: () => ServerRssSummary;
};

export function startRssSampler(input: {
  pid: number;
  intervalMs: number;
}): RssSampler {
  let firstKb: number | null = null;
  let lastKb: number | null = null;
  let peakKb: number | null = null;
  const sample = (): void => {
    const value = readServerRssKb(input.pid);
    if (value === null) return;
    if (firstKb === null) firstKb = value;
    lastKb = value;
    peakKb = Math.max(peakKb ?? 0, value);
  };
  sample();
  const timer = setInterval(sample, input.intervalMs);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      sample();
      return { firstKb, lastKb, peakKb };
    },
  };
}

export type LearnerExpectation = {
  attemptId: number;
  expectedAnswerCount: number;
};

/**
 * Invariant sau run (prompt mục 7): một bài in_progress/học viên, đúng một
 * `Result` cho mỗi attempt đã nộp, số `ExamAnswer` khớp số PUT 200 theo câu.
 */
export async function collectInvariants(input: {
  prisma: PrismaClient;
  learners: readonly { userId: number }[];
  expectations: readonly LearnerExpectation[];
  /** Số câu mỗi học viên phải trả lời theo workload (--questions). */
  requestedAnswerCount: number;
  samples: readonly LatencySample[];
}): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];
  const userIds = input.learners.map((learner) => learner.userId);
  if (userIds.length === 0) {
    return [
      {
        name: 'có học viên để đối chiếu',
        ok: false,
        detail: '0 learner trong run',
      },
    ];
  }
  // Server-side truth thay vì đếm sample: W3 lưu phần còn lại bằng route batch
  // (một request 200 chứa nhiều item), nên đếm request sẽ sai.
  const expectationIds = input.expectations.map(
    (expectation) => expectation.attemptId,
  );
  const answerTotals =
    expectationIds.length === 0
      ? [{ total: 0, distinct_pairs: 0 }]
      : await input.prisma.$queryRaw<
          Array<{ total: number; distinct_pairs: number }>
        >`
          SELECT
            COUNT(*)::int AS total,
            COUNT(DISTINCT ("attemptId", "snapshotQuestionKey"))::int
              AS distinct_pairs
          FROM "ExamAnswer"
          WHERE "attemptId" IN (${Prisma.join(expectationIds)})
        `;
  const expectedPutOk = userIds.length * input.requestedAnswerCount;
  results.push({
    name: 'tổng answer đã lưu = số học viên × số câu',
    ok: (answerTotals[0]?.total ?? 0) === expectedPutOk,
    detail: `${String(answerTotals[0]?.total ?? 0)}/${String(expectedPutOk)}`,
  });
  results.push({
    name: 'số answer duy nhất theo (attempt, câu) = học viên × câu',
    ok: (answerTotals[0]?.distinct_pairs ?? 0) === expectedPutOk,
    detail: `${String(answerTotals[0]?.distinct_pairs ?? 0)}/${String(expectedPutOk)}`,
  });

  const inProgress = await input.prisma.$queryRaw<
    Array<{ userId: number; count: number }>
  >`
    SELECT "userId", COUNT(*)::int AS count
    FROM "ExamAttempt"
    WHERE "userId" IN (${Prisma.join(userIds)})
      AND "status" = 'in_progress'
    GROUP BY "userId"
  `;
  const offenders = inProgress.filter((row) => row.count > 1);
  results.push({
    name: 'mỗi học viên ≤1 attempt in_progress',
    ok: offenders.length === 0,
    detail:
      offenders.length === 0
        ? 'ok'
        : offenders
            .map((row) => `user ${String(row.userId)}: ${String(row.count)}`)
            .join(', '),
  });

  const submitted = await input.prisma.$queryRaw<
    Array<{ attemptId: number; results: number }>
  >`
    SELECT attempt.id AS "attemptId", COUNT(result.id)::int AS results
    FROM "ExamAttempt" attempt
    LEFT JOIN "Result" result ON result."attemptId" = attempt.id
    WHERE attempt."userId" IN (${Prisma.join(userIds)})
      AND attempt."status" IN ('submitted', 'timed_out')
    GROUP BY attempt.id
  `;
  const badResults = submitted.filter((row) => row.results !== 1);
  results.push({
    name: 'mỗi attempt đã nộp có đúng 1 Result',
    ok: badResults.length === 0,
    detail:
      badResults.length === 0
        ? `ok (${String(submitted.length)} attempt)`
        : badResults
            .map(
              (row) =>
                `attempt ${String(row.attemptId)}: ${String(row.results)}`,
            )
            .join(', '),
  });

  const attemptIds = input.expectations.map(
    (expectation) => expectation.attemptId,
  );
  const answerCounts =
    attemptIds.length === 0
      ? []
      : await input.prisma.$queryRaw<
          Array<{ attemptId: number; answers: number }>
        >`
          SELECT "attemptId", COUNT(*)::int AS answers
          FROM "ExamAnswer"
          WHERE "attemptId" IN (${Prisma.join(attemptIds)})
          GROUP BY "attemptId"
        `;
  const answersByAttempt = new Map(
    answerCounts.map((row) => [row.attemptId, row.answers] as const),
  );
  const mismatches = input.expectations.filter(
    (expectation) =>
      (answersByAttempt.get(expectation.attemptId) ?? 0) !==
      expectation.expectedAnswerCount,
  );
  results.push({
    name: 'số ExamAnswer = số PUT 200 duy nhất theo câu',
    ok:
      input.requestedAnswerCount === 0 ||
      (input.expectations.length > 0 && mismatches.length === 0),
    detail:
      input.requestedAnswerCount === 0
        ? 'không áp dụng (W7 không trả lời)'
        : input.expectations.length === 0
          ? 'không có attempt nào để đối chiếu'
          : mismatches.length === 0
            ? `ok (${String(input.expectations.length)} attempt)`
            : mismatches
                .map(
                  (expectation) =>
                    `attempt ${String(expectation.attemptId)}: db ${String(
                      answersByAttempt.get(expectation.attemptId) ?? 0,
                    )} vs gửi ${String(expectation.expectedAnswerCount)}`,
                )
                .join(', '),
  });

  const serverErrors = input.samples.filter(
    (sample) => sample.status >= 500,
  ).length;
  results.push({
    name: '0 lỗi 5xx',
    ok: serverErrors === 0,
    detail: `${String(serverErrors)} response 5xx`,
  });

  return results;
}
