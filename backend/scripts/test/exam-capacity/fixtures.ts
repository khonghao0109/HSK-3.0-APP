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
import { seedMediaAssets, type StoredMediaObject } from './media-fixtures';
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

/**
 * Tên invariant dùng chung cho cả ba nơi: fixtures tạo, thresholds đánh giá,
 * metrics.spec đối chiếu. Một nguồn duy nhất để `thresholds.ts` tìm theo `===`
 * thay vì dò chuỗi con, và để không còn literal trùng ở file nào khác.
 */
export const INVARIANT_NAMES = {
  ANSWER_COUNT: 'số ExamAnswer = số PUT 200 duy nhất theo câu',
  SINGLE_RESULT: 'mỗi attempt đã nộp có đúng 1 Result',
  SINGLE_IN_PROGRESS: 'mỗi học viên ≤1 attempt in_progress',
} as const;

/**
 * Invariant kèm cờ áp dụng. `applicable: false` là nguồn duy nhất của verdict
 * n/a: thresholds không dò chuỗi trong `detail` để đoán lý do bỏ qua.
 * Mặc định (mọi invariant khác) là `true`, tức phải có kết luận PASS/FAIL.
 */
export type CapacityInvariant = InvariantResult & { applicable: boolean };

type JwtConfig = {
  secrets: Record<string, string>;
  activeKid: string;
};

export type SeededFixture = {
  prisma: PrismaService;
  testId: number;
  questionCount: number;
  mediaSha256: Map<number, string>;
  mediaDigestList: Array<{
    id: number;
    kind: string;
    sha256: string;
    size: number;
  }>;
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
  audioId: number | null = null,
  imageId: number | null = null,
): CreateQuestionRevisionDto {
  const skill = audioId !== null ? Skill.listening : Skill.reading;
  return {
    type: QuestionType.mcq,
    skill,
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
    audioId,
    imageId,
    tags: ['Gia đình'],
  };
}

function structurePayload(input: {
  expectedUpdatedAt: string;
  listeningQuestionIds: readonly number[];
  readingQuestionIds: readonly number[];
}): ReplaceTestStructureDto {
  const sections: ReplaceTestStructureDto['sections'] = [];

  if (input.listeningQuestionIds.length > 0) {
    const groups: Array<{ title: string; questionIds: number[] }> = [];
    for (
      let start = 0;
      start < input.listeningQuestionIds.length;
      start += 50
    ) {
      groups.push({
        title: `Nhóm nghe ${String(groups.length + 1)}`,
        questionIds: input.listeningQuestionIds.slice(start, start + 50),
      });
    }
    sections.push({ skill: Skill.listening, title: 'Nghe hiểu', groups });
  }

  if (input.readingQuestionIds.length > 0) {
    const groups: Array<{ title: string; questionIds: number[] }> = [];
    for (let start = 0; start < input.readingQuestionIds.length; start += 50) {
      groups.push({
        title: `Nhóm đọc ${String(groups.length + 1)}`,
        questionIds: input.readingQuestionIds.slice(start, start + 50),
      });
    }
    sections.push({ skill: Skill.reading, title: 'Đọc hiểu', groups });
  }

  return {
    expectedUpdatedAt: input.expectedUpdatedAt,
    sections,
  };
}

export type SeedExamFixtureInput = {
  databaseUrl: string;
  questions: number;
  minutes: number;
  audio?: number;
  images?: number;
  mockS3Store?: Map<string, StoredMediaObject>;
};

/**
 * Seed level + admin + N câu mcq đã publish + một đề đã publish.
 * Trả `testId` và số câu thật để driver đối chiếu `q<orderIndex>`.
 */
export async function seedExamFixture(
  input: SeedExamFixtureInput,
): Promise<SeededFixture> {
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

  const store = input.mockS3Store ?? new Map<string, StoredMediaObject>();
  const mediaSeed = await seedMediaAssets({
    prisma,
    adminId: admin.id,
    audioCount: input.audio ?? 0,
    imagesCount: input.images ?? 0,
    store,
    suffix,
  });

  const questionIds: number[] = [];
  const listeningQuestionIds: number[] = [];
  const readingQuestionIds: number[] = [];

  for (let index = 1; index <= input.questions; index += 1) {
    const audioId =
      index <= mediaSeed.audioMediaIds.length
        ? (mediaSeed.audioMediaIds[index - 1] ?? null)
        : null;
    const imageId =
      index <= mediaSeed.imageMediaIds.length
        ? (mediaSeed.imageMediaIds[index - 1] ?? null)
        : null;

    const created = await questionService.createQuestion(
      actor,
      questionPayload(level.id, index, audioId, imageId),
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
    if (audioId !== null) {
      listeningQuestionIds.push(questionId);
    } else {
      readingQuestionIds.push(questionId);
    }
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
      listeningQuestionIds,
      readingQuestionIds,
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
    mediaSha256: mediaSeed.mediaSha256,
    mediaDigestList: mediaSeed.mediaDigestList,
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

/** Một phiên đang chặn phiên khác giữ lock. */
export type LockWaitBlocker = {
  pid: number;
  waitEvent: string | null;
  state: string | null;
  query: string;
};

/** Một lần sampler bắt gặp server đang chờ lock. */
export type LockWaitDetail = {
  sampledAt: string;
  pid: number;
  waitEventType: string | null;
  waitEvent: string | null;
  state: string | null;
  queryAgeMs: number | null;
  xactAgeMs: number | null;
  query: string;
  blockingPids: number[];
  blockers: LockWaitBlocker[];
};

export type LockWaitDetailSummary = {
  /** Tối đa `LOCK_WAIT_DETAIL_LIMIT` bản ghi chi tiết đầu tiên. */
  kept: LockWaitDetail[];
  /** Tổng số lần sampler thấy lock wait, kể cả phần không giữ chi tiết. */
  total: number;
};

/** Trần số bản ghi chi tiết giữ lại trong artifact. */
export const LOCK_WAIT_DETAIL_LIMIT = 20;

/**
 * Giữ tối đa `limit` bản ghi chi tiết nhưng vẫn đếm toàn bộ số lần quan sát.
 * Hàm thuần để unit test điều khiển được phần cắt/đếm.
 */
export function appendLockWaitDetails(
  state: LockWaitDetailSummary,
  records: readonly LockWaitDetail[],
  limit: number = LOCK_WAIT_DETAIL_LIMIT,
): LockWaitDetailSummary {
  const total = state.total + records.length;
  const kept =
    state.kept.length >= limit
      ? state.kept
      : [...state.kept, ...records].slice(0, limit);
  return { kept, total };
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** `json_agg` có thể về dạng chuỗi hoặc object tuỳ driver; chuẩn hoá cả hai. */
function normalizeBlockers(value: unknown): LockWaitBlocker[] {
  const parsed: unknown =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed)) return [];
  const blockers: LockWaitBlocker[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const pid = record['pid'];
    if (typeof pid !== 'number') continue;
    blockers.push({
      pid,
      waitEvent: asNullableString(record['waitEvent']),
      state: asNullableString(record['state']),
      query: asNullableString(record['query']) ?? '',
    });
  }
  return blockers;
}

/** Số connection + lock wait và chi tiết phiên chờ của database đang đo. */
export async function readActivitySnapshot(
  prisma: PrismaClient,
  serverApplicationName: string,
): Promise<{
  serverConnections: number;
  totalConnections: number;
  serverLockWaits: number;
  lockWaitRecords: LockWaitDetail[];
}> {
  const rows = await prisma.$queryRaw<
    Array<{
      server_connections: number;
      total_connections: number;
      server_lock_waits: number;
      lock_waits: unknown;
    }>
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE a.application_name = ${serverApplicationName}
      )::int AS server_connections,
      COUNT(*)::int AS total_connections,
      COUNT(*) FILTER (
        WHERE a.application_name = ${serverApplicationName}
          AND a.wait_event_type = 'Lock'
      )::int AS server_lock_waits,
      COALESCE(
        json_agg(
          json_build_object(
            'pid', a.pid,
            'waitEventType', a.wait_event_type,
            'waitEvent', a.wait_event,
            'state', a.state,
            'queryAgeMs', (EXTRACT(EPOCH FROM (now() - a.query_start)) * 1000)::int,
            'xactAgeMs', (EXTRACT(EPOCH FROM (now() - a.xact_start)) * 1000)::int,
            'query', left(a.query, 200),
            'blockingPids', pg_blocking_pids(a.pid),
            'blockers', (
              SELECT json_agg(
                json_build_object(
                  'pid', b.pid,
                  'waitEvent', b.wait_event,
                  'state', b.state,
                  'query', left(b.query, 200)
                )
              )
              FROM pg_stat_activity b
              WHERE b.pid = ANY (pg_blocking_pids(a.pid))
            )
          )
        ) FILTER (
          WHERE a.application_name = ${serverApplicationName}
            AND a.wait_event_type = 'Lock'
        ),
        '[]'::json
      ) AS lock_waits
    FROM pg_stat_activity a
    WHERE a.datname = current_database()
  `;
  const row = rows[0];
  const sampledAt = new Date().toISOString();
  const rawLockWaits = row?.lock_waits;
  const parsedLockWaits: unknown =
    typeof rawLockWaits === 'string'
      ? (JSON.parse(rawLockWaits) as unknown)
      : rawLockWaits;
  const lockWaitRecords: LockWaitDetail[] = [];
  if (Array.isArray(parsedLockWaits)) {
    for (const entry of parsedLockWaits) {
      if (typeof entry !== 'object' || entry === null) continue;
      const rec = entry as Record<string, unknown>;
      const pid = rec['pid'];
      if (typeof pid !== 'number') continue;
      const blockingPids = Array.isArray(rec['blockingPids'])
        ? (rec['blockingPids'] as number[])
        : [];
      lockWaitRecords.push({
        sampledAt,
        pid,
        waitEventType: asNullableString(rec['waitEventType']),
        waitEvent: asNullableString(rec['waitEvent']),
        state: asNullableString(rec['state']),
        queryAgeMs:
          typeof rec['queryAgeMs'] === 'number' ? rec['queryAgeMs'] : null,
        xactAgeMs:
          typeof rec['xactAgeMs'] === 'number' ? rec['xactAgeMs'] : null,
        query: asNullableString(rec['query']) ?? '',
        blockingPids,
        blockers: normalizeBlockers(rec['blockers']),
      });
    }
  }
  return {
    serverConnections: row?.server_connections ?? 0,
    totalConnections: row?.total_connections ?? 0,
    serverLockWaits: row?.server_lock_waits ?? 0,
    lockWaitRecords,
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

export function startActivitySampler(input: {
  prisma: PrismaClient;
  serverApplicationName: string;
  intervalMs: number;
}): {
  stop: () => Promise<{
    maxConnections: number;
    maxTotalConnections: number;
    maxLockWaits: number;
    lockWaitDetails: LockWaitDetailSummary;
    samples: number;
    samplerErrors: number;
  }>;
} {
  let maxConnections = 0;
  let maxTotalConnections = 0;
  let maxLockWaits = 0;
  let samples = 0;
  let samplerErrors = 0;
  let lockWaitDetails: LockWaitDetailSummary = { kept: [], total: 0 };
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
        if (snapshot.serverLockWaits > 0) {
          if (snapshot.lockWaitRecords.length > 0) {
            lockWaitDetails = appendLockWaitDetails(
              lockWaitDetails,
              snapshot.lockWaitRecords,
            );
          } else {
            lockWaitDetails = {
              kept: lockWaitDetails.kept,
              total: lockWaitDetails.total + snapshot.serverLockWaits,
            };
          }
        }
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
        lockWaitDetails,
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
  scenario?: string;
}): Promise<CapacityInvariant[]> {
  const results: CapacityInvariant[] = [];
  const userIds = input.learners.map((learner) => learner.userId);
  if (userIds.length === 0) {
    return [
      {
        name: 'có học viên để đối chiếu',
        ok: false,
        detail: '0 learner trong run',
        applicable: true,
      },
    ];
  }
  const isSpecialScenario =
    input.scenario === 'w7' || input.scenario === 'probe429';
  // Một cờ duy nhất quyết định n/a: scenario không đi qua đường trả lời
  // (w7/probe429) hoặc workload không yêu cầu trả lời câu nào.
  const answersApplicable =
    !isSpecialScenario && input.requestedAnswerCount > 0;
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
    ok: !answersApplicable || (answerTotals[0]?.total ?? 0) === expectedPutOk,
    applicable: answersApplicable,
    detail: answersApplicable
      ? `${String(answerTotals[0]?.total ?? 0)}/${String(expectedPutOk)}`
      : `n/a (${input.scenario ?? 'w7'} không trả lời)`,
  });
  results.push({
    name: 'số answer duy nhất theo (attempt, câu) = học viên × câu',
    ok:
      !answersApplicable ||
      (answerTotals[0]?.distinct_pairs ?? 0) === expectedPutOk,
    applicable: answersApplicable,
    detail: answersApplicable
      ? `${String(answerTotals[0]?.distinct_pairs ?? 0)}/${String(expectedPutOk)}`
      : `n/a (${input.scenario ?? 'w7'} không trả lời)`,
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
    name: INVARIANT_NAMES.SINGLE_IN_PROGRESS,
    ok: offenders.length === 0,
    applicable: true,
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
    name: INVARIANT_NAMES.SINGLE_RESULT,
    ok: badResults.length === 0,
    applicable: true,
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
    name: INVARIANT_NAMES.ANSWER_COUNT,
    ok:
      !answersApplicable ||
      (input.expectations.length > 0 && mismatches.length === 0),
    applicable: answersApplicable,
    detail: !answersApplicable
      ? `n/a (${input.scenario ?? 'w7'} không trả lời)`
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
    applicable: true,
    detail: `${String(serverErrors)} response 5xx`,
  });

  return results;
}
