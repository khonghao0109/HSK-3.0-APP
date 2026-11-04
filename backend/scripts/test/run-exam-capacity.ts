import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import {
  EXAM_ANSWER_BATCH_LIMIT_PER_MINUTE,
  EXAM_ANSWER_SAVE_LIMIT_PER_MINUTE,
  EXAM_ATTEMPT_LIMIT_PER_MINUTE,
  EXAM_ATTEMPT_READ_LIMIT_PER_MINUTE,
  EXAM_ATTEMPT_SUBMIT_LIMIT_PER_MINUTE,
  EXAM_MEDIA_GRANT_LIMIT_PER_MINUTE,
  EXAM_TEST_LIST_LIMIT_PER_MINUTE,
} from '../../src/modules/exam/exam.controller';

import { CAPACITY_ROUTES, type LearnerRun } from './exam-capacity/driver';
import {
  collectInvariants,
  createDisposableDatabase,
  createLearnerSessions,
  dropDisposableDatabase,
  readDeadlockCount,
  readServerRssKb,
  seedExamFixture,
  startActivitySampler,
  startRssSampler,
} from './exam-capacity/fixtures';
import {
  createMockS3Server,
  MOCK_TLS_CERT,
  type MockS3Server,
  type StoredMediaObject,
} from './exam-capacity/media-fixtures';
import {
  renderSummaryMarkdown,
  summarizeSamples,
  type CapacitySummaryInput,
  type DatabaseMetrics,
  type InvariantResult,
} from './exam-capacity/metrics';
import { calculatePeakRequestsPerMinute } from './exam-capacity/preload-planner';
import {
  parseCapacityArgs,
  runLearnerScenario,
} from './exam-capacity/scenarios';
import {
  evaluateThresholds,
  isThresholdsPassing,
} from './exam-capacity/thresholds';

/**
 * M4.4 B1 — runner capacity luồng thi (không dependency mới).
 *
 * Luồng: guard DB disposable → dựng DB + migrate → seed đề/học viên → build
 * (tuỳ chọn) → spawn `node dist/src/main.js` ở process riêng với env inline →
 * đo p50/p95/p99 + DB metrics → invariant → artifact
 * `/tmp/hsk-m44/runs/<timestamp>-<label>/{result.json,summary.md,server.log}` →
 * kill server theo PID → drop DB.
 *
 * B1 chỉ đo và in số; KHÔNG áp ngưỡng P1–P19 (chờ PO). Exit code chỉ phản ánh
 * invariant đúng/sai (prompt mục 7).
 */

const BACKEND_ROOT = resolve(__dirname, '../..');
const ARTIFACT_ROOT = '/tmp/hsk-m44/runs';
const HEALTH_TIMEOUT_MS = 90_000;
const CLIENT_TIMEOUT_MS = 15_000;
const SERVER_APPLICATION_NAME = 'hsk_capacity_server';
const RUNNER_APPLICATION_NAME = 'hsk_capacity_runner';

/** Gắn thêm query param (dùng cho `connection_limit` của thí nghiệm pool). */
function withQueryParam(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

/** Gắn `application_name` để tách connection của server khỏi runner/sampler. */
function withApplicationName(url: string, applicationName: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('application_name', applicationName);
  return parsed.toString();
}

type Cleanup = {
  server: ChildProcess | null;
  serverLogFd: number | null;
  prisma: Awaited<ReturnType<typeof seedExamFixture>>['prisma'] | null;
  databaseName: string;
  databaseUrl: string;
  keepDatabase: boolean;
  serverPidFile: string | null;
  mockS3: MockS3Server | null;
};

function timestampForPath(date: Date): string {
  return date
    .toISOString()
    .replace(/[:.]/gu, '-')
    .replace('T', '_')
    .replace('Z', '');
}

function randomSecret(): string {
  return randomBytes(48).toString('base64url');
}

/** Server nhận URL sạch query (Prisma mặc định schema public; pg-boss không cần `?schema`). */
function databaseUrlForServer(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

/**
 * Trần rate limit hiệu lực theo `NODE_ENV` của server. Nguồn:
 * `app.module.ts` (global default + media IP), `exam.controller.ts` (route thi),
 * `media-content-throttle.ts` (grant).
 */
export function describeEffectiveLimits(serverEnvironment: string): string[] {
  // Exam constants lấy từ nguồn (`exam.controller.ts`); riêng global default và
  // media per-IP không export nên ghi kèm file nguồn để dễ đối chiếu.
  const testAware = (production: number): number =>
    serverEnvironment === 'test' ? 1_000 : production;
  return [
    `global default (app.module.ts:67): ${serverEnvironment === 'test' ? '1000' : '20'}/phút/user`,
    `exam start (exam.controller.ts): ${String(testAware(EXAM_ATTEMPT_LIMIT_PER_MINUTE))}/phút/user`,
    `exam answer save (exam.controller.ts): ${String(testAware(EXAM_ANSWER_SAVE_LIMIT_PER_MINUTE))}/phút/user`,
    `exam answer batch (exam.controller.ts): ${String(EXAM_ANSWER_BATCH_LIMIT_PER_MINUTE)}/phút/user`,
    `exam attempt/result/review read (exam.controller.ts): ${String(EXAM_ATTEMPT_READ_LIMIT_PER_MINUTE)}/phút/user`,
    `exam submit (exam.controller.ts): ${String(testAware(EXAM_ATTEMPT_SUBMIT_LIMIT_PER_MINUTE))}/phút/user`,
    `exam media-grants (exam.controller.ts): ${String(EXAM_MEDIA_GRANT_LIMIT_PER_MINUTE)}/phút/user`,
    `exam tests list (exam.controller.ts): ${String(EXAM_TEST_LIST_LIMIT_PER_MINUTE)}/phút/user`,
    'GET /exam/tests/:testId (không @Throttle): theo global default',
    `media content per IP (media-content-ip-throttle.ts:5): ${serverEnvironment === 'test' ? '10000' : '600'}/phút`,
    'media content per grant (media-content-throttle.ts:21): 60/phút',
  ];
}

function buildServerEnvironment(input: {
  port: number;
  metricsPort: number;
  databaseUrl: string;
  serverEnvironment: string;
  kid: string;
  secrets: Record<string, string>;
  mediaStorageEndpoint?: string;
  /**
   * Đường dẫn tuyệt đối tới file CA của mock S3. Server tin chain bằng
   * `NODE_EXTRA_CA_CERTS`, không tắt TLS verify.
   */
  mockS3CaPath?: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: input.serverEnvironment,
    PORT: String(input.port),
    DATABASE_URL: input.databaseUrl,
    TRUST_PROXY_HOPS: '0',
    JWT_SECRETS: JSON.stringify(input.secrets),
    JWT_ACTIVE_KID: input.kid,
    // Token do fixture ký (không phải server phát) dùng cùng TTL 6h để W1 dài
    // hơn mặc định 15m mà không phải refresh; đây là env, không đổi code.
    JWT_EXPIRES_IN: '6h',
    AUTH_PASSWORD_PEPPER: randomSecret(),
    ALLOWED_ORIGINS: 'https://app.example.com',
    APP_PUBLIC_URL: 'https://app.example.com',
    MEDIA_STORAGE_PROVIDER: 's3',
    MEDIA_STORAGE_BUCKET: 'hsk-capacity',
    MEDIA_STORAGE_ENDPOINT:
      input.mediaStorageEndpoint ?? 'https://127.0.0.1:9000',
    // Mock S3 dùng chứng chỉ self-signed loopback: server tin chain qua CA của
    // chính nó, KHÔNG tắt TLS verify bằng biến môi trường.
    ...(input.mockS3CaPath === undefined
      ? {}
      : { NODE_EXTRA_CA_CERTS: input.mockS3CaPath }),
    AWS_ACCESS_KEY_ID: 'hsk-capacity-test-key',
    AWS_SECRET_ACCESS_KEY: 'hsk-capacity-test-secret',
    MEDIA_STORAGE_REGION: 'ap-southeast-1',
    MEDIA_SCANNER_PROVIDER: 'clamav',
    MEDIA_SCANNER_HOST: 'localhost',
    MEDIA_SIGNING_SECRET: randomSecret(),
    MEDIA_METRICS_BEARER_TOKEN: randomSecret(),
    MEDIA_METRICS_HOST: '127.0.0.1',
    MEDIA_METRICS_PORT: String(input.metricsPort),
    MAIL_PROVIDER: 'ses',
    MAIL_SES_REGION: 'ap-southeast-1',
    MAIL_FROM: 'noreply@hsk.local',
    JOB_QUEUE_PROVIDER: 'pgboss',
    MEDIA_INGESTION_ENABLED: 'false',
  };
}

/** Fail fast nếu port đã có process nghe: tránh đo nhầm server lạ. */
async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      probe.close();
      reject(
        new Error(
          `Port ${String(port)} is not free (${error.code ?? error.message}); kill the stale server first`,
        ),
      );
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve());
    });
  });
}

async function waitForHealth(input: {
  baseUrl: string;
  server: ChildProcess;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    if (input.server.exitCode !== null || input.server.signalCode !== null) {
      throw new Error(
        `Server exited before health check (code ${String(input.server.exitCode)})`,
      );
    }
    try {
      const response = await fetch(`${input.baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // Not ready yet.
    }
    await delay(250);
  }
  throw new Error('Server did not become healthy in time');
}

async function stopServer(server: ChildProcess | null): Promise<void> {
  if (server === null || server.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) => {
    server.once('exit', () => resolveExit());
  });
  server.kill('SIGTERM');
  await Promise.race([exited, delay(8_000)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await Promise.race([exited, delay(3_000)]);
  }
}

function writeArtifacts(
  directory: string,
  summary: string,
  result: unknown,
): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'summary.md'), summary);
  writeFileSync(
    join(directory, 'result.json'),
    JSON.stringify(result, null, 2),
  );
}

async function main(): Promise<void> {
  const args = parseCapacityArgs(process.argv.slice(2));
  const connectionLimit = process.env.CAPACITY_CONNECTION_LIMIT;
  const disposable = assertDisposableTestDatabase();
  // Guard chỉ bắt hậu tố *_test; harness này DROP/CREATE database nên chỉ nhận
  // database thuộc sở hữu riêng của M4.4 (tránh xoá hsk_system_test).
  if (!/^hsk_m44_[a-z0-9_]*$/u.test(disposable.databaseName)) {
    throw new Error(
      `Capacity harness only accepts databases named hsk_m44_* (got "${disposable.databaseName}")`,
    );
  }
  const prismaBinary = resolve(
    BACKEND_ROOT,
    'node_modules/prisma/build/index.js',
  );
  if (!existsSync(prismaBinary)) {
    throw new Error(`Missing prisma CLI at ${prismaBinary}`);
  }

  const mainEntry = resolve(BACKEND_ROOT, 'dist/src/main.js');
  if (args.build) {
    const build = spawnSync('npm', ['run', 'build'], {
      cwd: BACKEND_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    if (build.status !== 0) {
      throw new Error(`npm run build failed (exit ${String(build.status)})`);
    }
  }
  if (!existsSync(mainEntry)) {
    throw new Error(
      `Missing ${mainEntry}; run \`npm run build\` or pass --build`,
    );
  }

  const serverEnvironment = 'production';
  const port = args.basePort;
  const metricsPort = args.basePort + 1;
  const kid = 'capacity';
  const secrets = { [kid]: randomSecret() };
  const runId = `${timestampForPath(new Date())}-${args.label}`;
  const artifactDir = join(ARTIFACT_ROOT, runId);

  const cleanup: Cleanup = {
    server: null,
    serverLogFd: null,
    prisma: null,
    databaseName: disposable.databaseName,
    databaseUrl: disposable.databaseUrl,
    keepDatabase: args.keepDatabase,
    serverPidFile: null,
    mockS3: null,
  };
  // Ghi lại cách server kết thúc (code/signal) để phân biệt crash, OOM hay bị
  // process khác kill khi đo dài.
  let serverExit: {
    code: number | null;
    signal: NodeJS.Signals | null;
    at: string;
  } | null = null;
  let cleanupPromise: Promise<void> | null = null;
  const runCleanup = (): Promise<void> => {
    if (cleanupPromise !== null) return cleanupPromise;
    cleanupPromise = (async () => {
      await stopServer(cleanup.server);
      if (cleanup.mockS3 !== null) await cleanup.mockS3.close();
      if (cleanup.serverLogFd !== null) closeSync(cleanup.serverLogFd);
      if (cleanup.prisma !== null) await cleanup.prisma.$disconnect();
      if (!cleanup.keepDatabase) {
        try {
          if (
            !dropDisposableDatabase({
              databaseName: cleanup.databaseName,
              databaseUrl: cleanup.databaseUrl,
            })
          ) {
            // Yêu cầu "drop khi xong": không được exit 0 khi DB còn sót.
            process.exitCode = 1;
          }
        } catch (error: unknown) {
          console.error(
            `drop database failed: ${error instanceof Error ? error.message : 'unknown'}`,
          );
          process.exitCode = 1;
        }
      }
      if (cleanup.serverPidFile !== null) {
        try {
          unlinkSync(cleanup.serverPidFile);
        } catch {
          // Best effort: file có thể đã bị xoá.
        }
      }
    })();
    return cleanupPromise;
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    console.error(`received ${signal}, cleaning up`);
    // Chờ đúng promise cleanup đang chạy (kể cả khi finally đã bắt đầu),
    // không exit sớm làm sót server/DB.
    void (cleanupPromise ?? runCleanup()).finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    console.log(
      `capacity: users=${String(args.users)} ramp=${String(args.rampSeconds)}s questions=${String(args.questions)} minutes=${String(args.minutes)} interval=${String(args.answerIntervalMs)}ms`,
    );
    console.log(
      `capacity: server NODE_ENV=${serverEnvironment} port=${String(port)} database=${disposable.databaseName} connection_limit=${connectionLimit ?? 'default'}`,
    );
    for (const limit of describeEffectiveLimits(serverEnvironment)) {
      console.log(`capacity: limit ${limit}`);
    }

    console.log('capacity: creating disposable database');
    createDisposableDatabase({
      databaseName: disposable.databaseName,
      databaseUrl: disposable.databaseUrl,
      prismaBinary,
      nodeExecutable: process.execPath,
    });

    const mockS3Store = new Map<string, StoredMediaObject>();
    const mockS3 = await createMockS3Server(mockS3Store, 'hsk-capacity');
    cleanup.mockS3 = mockS3;

    const seedStartedAt = Date.now();
    const runnerDatabaseUrl = withApplicationName(
      disposable.databaseUrl,
      RUNNER_APPLICATION_NAME,
    );
    const fixtureAudio =
      args.scenario === 'probe429' ? Math.max(15, args.audio) : args.audio;
    const fixtureQuestions =
      args.scenario === 'probe429'
        ? Math.max(15, args.questions)
        : args.questions;
    const fixture = await seedExamFixture({
      databaseUrl: runnerDatabaseUrl,
      questions: fixtureQuestions,
      minutes: args.minutes,
      audio: fixtureAudio,
      images: args.images,
      mockS3Store,
    });
    cleanup.prisma = fixture.prisma;
    console.log(
      `capacity: seeded test ${String(fixture.testId)} with ${String(fixture.questionCount)} questions in ${String(Date.now() - seedStartedAt)}ms`,
    );

    const learners = await createLearnerSessions(fixture.prisma, args.users, {
      secrets,
      activeKid: kid,
      accessTokenTtl: '6h',
    });
    console.log(
      `capacity: created ${String(learners.length)} learner sessions`,
    );

    mkdirSync(artifactDir, { recursive: true });
    // Chứng chỉ self-signed của mock S3 được ghi thành file CA trong artifact
    // dir của run, rồi server tin nó qua NODE_EXTRA_CA_CERTS (verify TLS bật).
    const mockS3CaPath = join(artifactDir, 'mock-s3-ca.pem');
    writeFileSync(mockS3CaPath, MOCK_TLS_CERT);
    await assertPortFree(port);
    const serverLogFd = openSync(join(artifactDir, 'server.log'), 'w');
    cleanup.serverLogFd = serverLogFd;
    const baseServerDatabaseUrl = withApplicationName(
      databaseUrlForServer(disposable.databaseUrl),
      SERVER_APPLICATION_NAME,
    );
    const serverDatabaseUrl =
      connectionLimit === undefined || connectionLimit.length === 0
        ? baseServerDatabaseUrl
        : withQueryParam(
            baseServerDatabaseUrl,
            'connection_limit',
            connectionLimit,
          );
    const server = spawn(process.execPath, [mainEntry], {
      cwd: BACKEND_ROOT,
      env: buildServerEnvironment({
        port,
        metricsPort,
        databaseUrl: serverDatabaseUrl,
        serverEnvironment,
        kid,
        secrets,
        mediaStorageEndpoint: mockS3.url,
        mockS3CaPath,
      }),
      stdio: ['ignore', serverLogFd, serverLogFd],
    });
    cleanup.server = server;
    const serverPid = server.pid ?? -1;
    const serverPidFile = join(artifactDir, 'server.pid');
    writeFileSync(serverPidFile, `${String(serverPid)}\n`);
    cleanup.serverPidFile = serverPidFile;
    server.once('error', (error: Error) => {
      console.error(`capacity: server spawn error: ${error.message}`);
    });
    server.once('exit', (code, signal) => {
      serverExit = { code, signal, at: new Date().toISOString() };
      console.error(
        `capacity: server exited code=${String(code)} signal=${String(signal)} at ${serverExit.at}`,
      );
    });
    const baseUrl = `http://127.0.0.1:${String(port)}/api/v1`;
    await waitForHealth({ baseUrl, server, timeoutMs: HEALTH_TIMEOUT_MS });
    // Health có thể do process lạ đáp nếu port bẩn; xác nhận child còn sống.
    await delay(500);
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        `Spawned server exited right after health (code ${String(server.exitCode)})`,
      );
    }
    console.log(`capacity: server pid ${String(serverPid)} healthy`);

    const deadlocksBefore = await readDeadlockCount(fixture.prisma);
    const activity = startActivitySampler({
      prisma: fixture.prisma,
      serverApplicationName: SERVER_APPLICATION_NAME,
      intervalMs: 1_000,
    });
    const rss = startRssSampler({
      pid: serverPid,
      intervalMs: 5_000,
    });
    const loadAverageStart = loadavg()
      .map((value) => value.toFixed(2))
      .join(' ');
    const startedAt = new Date();
    const runStartedAt = Date.now();

    const scenarioAnswerCount = args.scenario === 'w7' ? 0 : args.questions;
    const scenario = await runLearnerScenario({
      scenario: args.scenario,
      reconnectRatio: args.reconnectRatio,
      timeoutRatio: args.timeoutRatio,
      submitWindowSeconds: args.submitWindowSeconds,
      baseUrl,
      testId: fixture.testId,
      learners,
      answerCount: scenarioAnswerCount,
      answerIntervalMs: args.answerIntervalMs,
      rampSeconds: args.rampSeconds,
      minutes: args.minutes,
      timeoutMs: CLIENT_TIMEOUT_MS,
      mediaSha256: fixture.mediaSha256,
      onLearnerDone: (run: LearnerRun) => {
        console.log(
          `capacity: learner ${String(run.index)}/${String(learners.length)} attempt=${String(run.attemptId ?? -1)} saved=${String(run.savedQuestionKeys.length)} completed=${String(run.completed)} failures=${String(run.failures.length)}`,
        );
      },
    });
    const finishedAt = new Date();
    const loadAverageEnd = loadavg()
      .map((value) => value.toFixed(2))
      .join(' ');
    const activityMetrics = await activity.stop();
    const rssSummary = rss.stop();
    const deadlocksAfter = await readDeadlockCount(fixture.prisma);

    const expectations = scenario.learners
      .filter(
        (run): run is LearnerRun & { attemptId: number } =>
          run.attemptId !== null,
      )
      .map((run) => ({
        attemptId: run.attemptId,
        // Expected lấy từ workload đã yêu cầu, không lấy từ số đã gửi thành
        // công: nếu driver gửi thiếu thì invariant phải đỏ.
        expectedAnswerCount: run.requestedAnswerCount,
      }));
    const invariants: InvariantResult[] = await collectInvariants({
      prisma: fixture.prisma,
      learners,
      expectations,
      requestedAnswerCount: scenarioAnswerCount,
      samples: scenario.samples,
      scenario: args.scenario,
    });
    const deadlockDelta = deadlocksAfter - deadlocksBefore;
    invariants.push({
      name: '0 deadlock (pg_stat_database delta)',
      ok: deadlockDelta === 0,
      detail: `${String(deadlocksBefore)} → ${String(deadlocksAfter)} (delta ${String(deadlockDelta)})`,
    });
    const lifecycleFailures = scenario.learners.reduce(
      (total, run) => total + run.failures.length,
      0,
    );
    invariants.push({
      name: '0 lỗi sampler pg_stat_activity',
      ok: activityMetrics.samplerErrors === 0,
      detail: `${String(activityMetrics.samplerErrors)} lỗi / ${String(activityMetrics.samples)} mẫu`,
    });
    invariants.push({
      name: '0 lỗi vòng đời học viên (mọi request đúng mã kỳ vọng)',
      ok: lifecycleFailures === 0,
      detail:
        lifecycleFailures === 0
          ? 'ok'
          : `${String(lifecycleFailures)} lỗi: ${scenario.learners
              .flatMap((run) => run.failures)
              .slice(0, 5)
              .join(' | ')}`,
    });

    if (args.scenario === 'w7') {
      const attempts = await fixture.prisma.examAttempt.count({
        where: { userId: { in: learners.map((learner) => learner.userId) } },
      });
      invariants.push({
        name: 'W7 không tạo attempt',
        ok: attempts === 0,
        detail: `${String(attempts)} attempt`,
      });
    }
    if (args.scenario === 'w3') {
      const batchSamples = scenario.samples.filter(
        (sample) =>
          sample.route === 'PUT /exam/attempts/:id/answers' &&
          sample.status === 200,
      );
      invariants.push({
        name: 'W3 có batch answer 200 sau reconnect',
        ok: batchSamples.length > 0,
        detail: `${String(batchSamples.length)} request batch`,
      });
    }
    if (args.scenario === 'w4') {
      const submitSamples = scenario.samples.filter(
        (sample) =>
          sample.route === 'POST /exam/attempts/:id/submit' &&
          sample.status === 200,
      );
      const times = submitSamples
        .map((sample) => sample.startedAtMs)
        .filter((value): value is number => value !== undefined);
      const spreadMs =
        times.length < 2 ? 0 : Math.max(...times) - Math.min(...times);
      invariants.push({
        name: 'W4 100% submit trong cửa sổ',
        ok:
          submitSamples.length === learners.length &&
          spreadMs <= args.submitWindowSeconds * 1_000,
        detail: `${String(submitSamples.length)}/${String(learners.length)} submit, spread ${String(spreadMs)} ms (window ${String(args.submitWindowSeconds * 1_000)} ms)`,
      });
    }
    if (args.scenario === 'w5') {
      const timedOut = await fixture.prisma.examAttempt.count({
        where: {
          userId: { in: learners.map((learner) => learner.userId) },
          status: 'timed_out',
        },
      });
      invariants.push({
        name: 'W5 có attempt timed_out được chấm lười',
        ok: timedOut > 0,
        detail: `${String(timedOut)} timed_out`,
      });
    }
    if (args.scenario === 'w6') {
      const media5xx = scenario.samples.filter(
        (sample) =>
          (sample.route === CAPACITY_ROUTES.mediaContent ||
            sample.route === CAPACITY_ROUTES.mediaGrants) &&
          sample.status >= 500,
      );
      invariants.push({
        name: 'W6 0 lỗi 5xx media',
        ok: media5xx.length === 0,
        detail: `${String(media5xx.length)} lỗi 5xx media`,
      });
      const media429 = scenario.samples.filter(
        (sample) =>
          sample.route === CAPACITY_ROUTES.mediaContent &&
          sample.status === 429,
      );
      invariants.push({
        name: 'W6 số 429 media được ghi rõ',
        ok: true,
        detail: `${String(media429.length)} request 429 media`,
      });
      const sha256Mismatch = scenario.learners
        .flatMap((run) => run.failures)
        .filter((fail) => fail.includes('sha256 mismatch'));
      invariants.push({
        name: 'W6 SHA-256 media khớp seed',
        ok: sha256Mismatch.length === 0,
        detail:
          sha256Mismatch.length === 0
            ? 'ok'
            : sha256Mismatch.slice(0, 3).join(' | '),
      });
    }
    if (args.scenario === 'w45') {
      const submitted = await fixture.prisma.examAttempt.count({
        where: {
          userId: { in: learners.map((learner) => learner.userId) },
          status: 'submitted',
        },
      });
      const timedOut = await fixture.prisma.examAttempt.count({
        where: {
          userId: { in: learners.map((learner) => learner.userId) },
          status: 'timed_out',
        },
      });
      invariants.push({
        name: 'W45 có cả submitted và timed_out',
        ok: submitted > 0 && timedOut > 0,
        detail: `${String(submitted)} submitted, ${String(timedOut)} timed_out`,
      });
      invariants.push({
        name: 'W45 lock wait = 0',
        ok: activityMetrics.maxLockWaits === 0,
        detail: `${String(activityMetrics.maxLockWaits)} lock wait quan sát`,
      });
    }
    if (args.scenario === 'probe429') {
      const probe = scenario.probe429;
      invariants.push({
        name: 'P15 probe429 (a) autosave biên 240/phút/user & không lan',
        ok:
          probe !== undefined &&
          probe.autosave200Count >= 239 &&
          probe.autosave200Count <= 241 &&
          probe.autosaveErrorCode === 'TOO_MANY_REQUESTS' &&
          probe.learner2Errors429 === 0,
        detail:
          probe !== undefined
            ? `user 1: ${String(probe.autosave200Count)} ok trước 429 (req #${String(probe.autosaveFirst429At)}), code ${probe.autosaveErrorCode ?? 'none'}; user 2: ${String(probe.learner2Errors429)} 429`
            : 'thiếu kết quả probe',
      });
      invariants.push({
        name: 'P15 probe429 (b) media biên 600/phút/IP',
        ok:
          probe !== undefined &&
          probe.media200Count >= 599 &&
          probe.media200Count <= 601,
        detail:
          probe !== undefined
            ? `${String(probe.media200Count)} ok trước 429 (req #${String(probe.mediaFirst429At)})`
            : 'thiếu kết quả probe',
      });
    }
    const database: DatabaseMetrics = {
      deadlocksBefore,
      deadlocksAfter,
      maxConnections: activityMetrics.maxConnections,
      maxTotalConnections: activityMetrics.maxTotalConnections,
      maxLockWaits: activityMetrics.maxLockWaits,
      samples: activityMetrics.samples,
      samplerErrors: activityMetrics.samplerErrors,
    };
    const mediaSamples = scenario.samples.filter(
      (sample) => sample.route === CAPACITY_ROUTES.mediaContent,
    );
    const peakMedia =
      mediaSamples.length > 0
        ? calculatePeakRequestsPerMinute(
            mediaSamples
              .map((sample) => sample.startedAtMs)
              .filter((time): time is number => time !== undefined),
          )
        : null;
    const evaluations = evaluateThresholds({
      scenario: args.scenario,
      routeSummaries: summarizeSamples(scenario.samples),
      database,
      serverRssKb: {
        firstKb: rssSummary.firstKb,
        lastKb: rssSummary.lastKb ?? readServerRssKb(serverPid),
        peakKb: rssSummary.peakKb,
      },
      invariants,
      probe429: scenario.probe429,
    });
    const summaryInput: CapacitySummaryInput = {
      label: args.label,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      nodeVersion: process.version,
      serverPid,
      serverEnvironment,
      baseUrl,
      config: {
        users: args.users,
        rampSeconds: args.rampSeconds,
        questions: args.questions,
        minutes: args.minutes,
        answerIntervalMs: args.answerIntervalMs,
        scenario: args.scenario,
        reconnectRatio: args.reconnectRatio,
        timeoutRatio: args.timeoutRatio,
        submitWindowSeconds: args.submitWindowSeconds,
        connectionLimit:
          connectionLimit === undefined || connectionLimit.length === 0
            ? 'default'
            : connectionLimit,
        audioPerTest: args.audio,
        imagesPerTest: args.images,
      },
      effectiveLimits: describeEffectiveLimits(serverEnvironment),
      loadAverageStart,
      loadAverageEnd,
      routeSummaries: summarizeSamples(scenario.samples),
      serverRssKb: {
        firstKb: rssSummary.firstKb,
        lastKb: rssSummary.lastKb ?? readServerRssKb(serverPid),
        peakKb: rssSummary.peakKb,
      },
      database,
      invariants,
      totalRequests: scenario.samples.length,
      evaluations,
      mediaDigestList: fixture.mediaDigestList,
      peakMediaRequestsPerMinute: peakMedia,
      probe429: scenario.probe429,
    };
    const repositoryRoot = resolve(BACKEND_ROOT, '..');
    const buildHead = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).stdout.trim();
    const builtAt = statSync(mainEntry).mtime.toISOString();
    const markdown = renderSummaryMarkdown(summaryInput);
    writeArtifacts(artifactDir, markdown, {
      run: summaryInput,
      build: {
        head: buildHead,
        distEntryModifiedAt: builtAt,
        builtByRunner: args.build,
      },
      serverExit,
      durationSeconds: (Date.now() - runStartedAt) / 1_000,
      machine: {
        platform: process.platform,
        arch: process.arch,
        cpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
      },
      learners: scenario.learners,
      samples: scenario.samples,
      artifactDirectory: artifactDir,
    });

    console.log(`capacity: artifacts ${artifactDir}`);
    console.log(markdown);

    const failed = invariants.filter((invariant) => !invariant.ok);
    const thresholdsPass = isThresholdsPassing(evaluations);
    if (failed.length > 0 || !thresholdsPass) {
      if (failed.length > 0) {
        console.error(
          `capacity: INVARIANTS FAILED: ${failed.map((invariant) => invariant.name).join(' | ')}`,
        );
      }
      if (!thresholdsPass) {
        const failedThresholds = evaluations.filter(
          (item) => item.verdict === 'FAIL',
        );
        console.error(
          `capacity: THRESHOLDS FAILED: ${failedThresholds.map((item) => `${item.code} (${item.criterion}: ${item.observed})`).join(' | ')}`,
        );
      }
      process.exitCode = 1;
    } else {
      console.log('capacity: PASS (invariants OK, thresholds PASS)');
    }
  } finally {
    await runCleanup();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `capacity run failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    process.exitCode = 1;
  });
}

export { main };
