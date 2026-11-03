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

import type { LearnerRun } from './exam-capacity/driver';
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
  renderSummaryMarkdown,
  summarizeSamples,
  type CapacitySummaryInput,
  type DatabaseMetrics,
  type InvariantResult,
} from './exam-capacity/metrics';
import {
  parseCapacityArgs,
  runLearnerScenario,
} from './exam-capacity/scenarios';

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

type Cleanup = {
  server: ChildProcess | null;
  serverLogFd: number | null;
  prisma: Awaited<ReturnType<typeof seedExamFixture>>['prisma'] | null;
  databaseName: string;
  databaseUrl: string;
  keepDatabase: boolean;
  serverPidFile: string | null;
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
  if (args.audio > 0 || args.images > 0) {
    throw new Error(
      'B1 chỉ seed đề không media (--audio 0 --images 0); fixture media để B2',
    );
  }
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
  };
  let cleanupPromise: Promise<void> | null = null;
  const runCleanup = (): Promise<void> => {
    if (cleanupPromise !== null) return cleanupPromise;
    cleanupPromise = (async () => {
      await stopServer(cleanup.server);
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
      `capacity: server NODE_ENV=${serverEnvironment} port=${String(port)} database=${disposable.databaseName}`,
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

    const seedStartedAt = Date.now();
    const fixture = await seedExamFixture({
      databaseUrl: disposable.databaseUrl,
      questions: args.questions,
      minutes: args.minutes,
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
    await assertPortFree(port);
    const serverLogFd = openSync(join(artifactDir, 'server.log'), 'w');
    cleanup.serverLogFd = serverLogFd;
    const server = spawn(process.execPath, [mainEntry], {
      cwd: BACKEND_ROOT,
      env: buildServerEnvironment({
        port,
        metricsPort,
        databaseUrl: databaseUrlForServer(disposable.databaseUrl),
        serverEnvironment,
        kid,
        secrets,
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
      if (code !== 0 && signal === null) {
        console.error(
          `capacity: server exited early with code ${String(code)}`,
        );
      }
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

    const scenario = await runLearnerScenario({
      baseUrl,
      testId: fixture.testId,
      learners,
      answerCount: args.questions,
      answerIntervalMs: args.answerIntervalMs,
      rampSeconds: args.rampSeconds,
      timeoutMs: CLIENT_TIMEOUT_MS,
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
      requestedAnswerCount: args.questions,
      samples: scenario.samples,
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

    const database: DatabaseMetrics = {
      deadlocksBefore,
      deadlocksAfter,
      maxConnections: activityMetrics.maxConnections,
      maxLockWaits: activityMetrics.maxLockWaits,
      samples: activityMetrics.samples,
      samplerErrors: activityMetrics.samplerErrors,
    };
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
    if (failed.length > 0) {
      console.error(
        `capacity: INVARIANTS FAILED: ${failed.map((invariant) => invariant.name).join(' | ')}`,
      );
      process.exitCode = 1;
    } else {
      console.log('capacity: invariants PASS');
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
