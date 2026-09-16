import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export const BOUNDED_MIGRATION_TIMEOUTS_MS = {
  lock: 2_000,
  statement: 30_000,
  idleInTransaction: 35_000,
  command: 45_000,
} as const;

export const BOUNDED_MIGRATION_EXIT_CODES = {
  domainPreflight: 3,
  internalFailure: 70,
  usage: 64,
  lockTimeout: 75,
  resolvePrecondition: 78,
  commandTimeout: 124,
} as const;

export type BoundedMigrationTimeouts = {
  lock: number;
  statement: number;
  idleInTransaction: number;
  command: number;
};

export const MIGRATION_STATEMENT_TIMEOUT_ENV = 'MIGRATION_STATEMENT_TIMEOUT_MS';
const MAXIMUM_MIGRATION_STATEMENT_TIMEOUT_MS = 3_600_000;
const IDLE_IN_TRANSACTION_MARGIN_MS =
  BOUNDED_MIGRATION_TIMEOUTS_MS.idleInTransaction -
  BOUNDED_MIGRATION_TIMEOUTS_MS.statement;
const COMMAND_MARGIN_MS =
  BOUNDED_MIGRATION_TIMEOUTS_MS.command -
  BOUNDED_MIGRATION_TIMEOUTS_MS.statement;

const POSTGRES_URL = /postgres(?:ql)?:\/\/[^\s'"`]+/giu;
const PASSWORD_ASSIGNMENT =
  /\b(password|passwd|pwd|secret|token)\s*[=:]\s*[^\s,;]+/giu;
const USER_INFO = /\/\/[^/@\s:]+:[^/@\s]+@/gu;
const PRISMA_TRANSACTION_ABORT =
  /(?:^|\r?\n)(?:Error: )?ERROR: current transaction is aborted, commands ignored until end of transaction block(?:\r?\n|$)/u;
const MEDIA_CLEANUP_AUDIT_MIGRATION =
  '20260813193000_media_cleanup_audit_integrity';
const MEDIA_CLEANUP_AUDIT_CHECKSUM =
  '7b1e8e12bb6040bee629e702d217f54880d41dd7ffb962e3bf89b4cdca6adb08';
const DOMAIN_PREFLIGHT_MARKER =
  'BOUNDED_MIGRATION_DOMAIN_PREFLIGHT P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp';
const LOCK_PREFLIGHT_SCRIPT = String.raw`
const { PrismaClient } = require('@prisma/client');
const client = new PrismaClient();
(async () => {
  try {
    await client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        "DO $hsk$ BEGIN " +
        "IF to_regclass('\"MediaIngestion\"') IS NOT NULL THEN LOCK TABLE \"MediaIngestion\" IN SHARE ROW EXCLUSIVE MODE; END IF; " +
        "IF to_regclass('\"AuditLog\"') IS NOT NULL THEN LOCK TABLE \"AuditLog\" IN SHARE ROW EXCLUSIVE MODE; END IF; " +
        "END $hsk$;"
      );
    });
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'unknown';
    const databaseCode = typeof error?.meta?.code === 'string' ? error.meta.code : 'unknown';
    if (databaseCode === '55P03') {
      process.stderr.write('BOUNDED_MIGRATION_LOCK_TIMEOUT 55P03\n');
      process.exitCode = 75;
    } else {
      process.stderr.write('BOUNDED_MIGRATION_LOCK_PREFLIGHT_FAILED ' + code + ' ' + databaseCode + '\n');
      process.exitCode = 1;
    }
  } finally {
    await client.$disconnect();
  }
})();
`;
// Prisma can replace the original PostgreSQL diagnostic with a generic
// transaction-aborted message. Query only booleans for the exact failed row;
// never emit Prisma's retained raw log or any database payload.
const DOMAIN_FAILURE_CLASSIFICATION_SCRIPT = String.raw`
const { PrismaClient } = require('@prisma/client');
const client = new PrismaClient();
(async () => {
  try {
    const rows = await client.$queryRawUnsafe(
      "SELECT " +
      "logs ~ 'Database error code:[[:space:]]*P0001' " +
      "AND position('Media cleanup lifecycle lacks an exact authoritative audit timestamp' in logs) > 0 AS domain_preflight, " +
      "logs ~ 'Database error code:[[:space:]]*55P03' AS lock_timeout " +
      "FROM \"_prisma_migrations\" " +
      "WHERE migration_name='${MEDIA_CLEANUP_AUDIT_MIGRATION}' " +
      "AND checksum='${MEDIA_CLEANUP_AUDIT_CHECKSUM}' " +
      "AND finished_at IS NULL AND rolled_back_at IS NULL " +
      "ORDER BY started_at DESC LIMIT 1"
    );
    if (rows[0]?.domain_preflight === true) {
      process.stdout.write(
        'BOUNDED_MIGRATION_DOMAIN_PREFLIGHT P3018 P0001 ' +
        'Media cleanup lifecycle lacks an exact authoritative audit timestamp\n'
      );
      process.exitCode = 0;
    } else if (rows[0]?.lock_timeout === true) {
      process.stdout.write('BOUNDED_MIGRATION_LOCK_TIMEOUT P3018 55P03\n');
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
    }
  } catch {
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
})();
`;

const SUPERVISED_PROCESS_HEARTBEAT_INTERVAL_MS = 5_000;
const SUPERVISED_PROCESS_HEARTBEAT_TIMEOUT_MS = 1_000;
const SUPERVISED_PROCESS_TERMINATION_GRACE_MS = 250;
const SUPERVISED_PROCESS_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export type SupervisedBoundedMigrationProcessOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
  heartbeat?: (signal: AbortSignal) => Promise<void>;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  terminationGraceMs?: number;
  maximumOutputBytes?: number;
  processGroupExists?: (processGroupId: number) => boolean;
};

export type SupervisedBoundedMigrationProcessResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  executionError: boolean;
  cancelled: boolean;
};

function boundedProcessGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error: unknown) {
    return (
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code !== 'ESRCH'
    );
  }
}

function waitForBoundedProcessDelay(milliseconds: number): Promise<void> {
  return new Promise((complete) => setTimeout(complete, milliseconds));
}

async function waitForBoundedProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
  processGroupExists: (processGroupId: number) => boolean,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(processGroupId) && Date.now() < deadline) {
    await waitForBoundedProcessDelay(10);
  }
  return !processGroupExists(processGroupId);
}

export async function spawnSupervisedBoundedMigrationProcess(
  executable: string,
  args: string[],
  options: SupervisedBoundedMigrationProcessOptions,
): Promise<SupervisedBoundedMigrationProcessResult> {
  const emptyResult = (
    overrides: Partial<SupervisedBoundedMigrationProcessResult>,
  ): SupervisedBoundedMigrationProcessResult => ({
    status: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    executionError: false,
    cancelled: false,
    ...overrides,
  });
  if (options.signal?.aborted) return emptyResult({ cancelled: true });

  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? SUPERVISED_PROCESS_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs =
    options.heartbeatTimeoutMs ?? SUPERVISED_PROCESS_HEARTBEAT_TIMEOUT_MS;
  const terminationGraceMs =
    options.terminationGraceMs ?? SUPERVISED_PROCESS_TERMINATION_GRACE_MS;
  const maximumOutputBytes =
    options.maximumOutputBytes ?? SUPERVISED_PROCESS_MAX_OUTPUT_BYTES;
  if (
    process.platform === 'win32' ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    !Number.isSafeInteger(heartbeatIntervalMs) ||
    heartbeatIntervalMs <= 0 ||
    !Number.isSafeInteger(heartbeatTimeoutMs) ||
    heartbeatTimeoutMs <= 0 ||
    !Number.isSafeInteger(terminationGraceMs) ||
    terminationGraceMs <= 0 ||
    !Number.isSafeInteger(maximumOutputBytes) ||
    maximumOutputBytes <= 0
  ) {
    return emptyResult({ executionError: true });
  }

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return emptyResult({ executionError: true });
  }

  let status: number | null = null;
  let stdout = '';
  let stderr = '';
  let outputBytes = 0;
  let timedOut = false;
  let executionError = false;
  let cancelled = false;
  let activeHeartbeat:
    | { abort: () => void; completion: Promise<void> }
    | undefined;
  let requestTermination: (() => void) | undefined;
  const terminationRequested = new Promise<void>((complete) => {
    requestTermination = complete;
  });
  const beginTermination = (): void => requestTermination?.();
  const childClosed = new Promise<void>((complete) => {
    child.once('close', (childStatus) => {
      status = childStatus;
      complete();
    });
  });
  const terminate = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined) {
      executionError = true;
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        executionError = true;
      }
    }
  };
  const capture = (
    stream: 'stdout' | 'stderr',
    chunk: Buffer | string,
  ): void => {
    outputBytes += Buffer.byteLength(chunk);
    if (outputBytes > maximumOutputBytes) {
      executionError = true;
      beginTermination();
      return;
    }
    if (stream === 'stdout') stdout += chunk.toString();
    else stderr += chunk.toString();
  };
  child.stdout?.on('data', (chunk: Buffer | string) =>
    capture('stdout', chunk),
  );
  child.stderr?.on('data', (chunk: Buffer | string) =>
    capture('stderr', chunk),
  );
  child.once('error', () => {
    executionError = true;
    beginTermination();
  });

  const startHeartbeat = (): void => {
    if (!options.heartbeat || activeHeartbeat) return;
    const heartbeatCancellation = new AbortController();
    let cancelLogicalHeartbeat: (() => void) | undefined;
    const logicalCancellation = new Promise<'cancelled'>((complete) => {
      cancelLogicalHeartbeat = () => complete('cancelled');
    });
    let heartbeatDeadline: NodeJS.Timeout | undefined;
    const rawHeartbeat = Promise.resolve().then(() =>
      options.heartbeat?.(heartbeatCancellation.signal),
    );
    const boundedHeartbeat = Promise.race([
      rawHeartbeat.then(
        () => 'complete' as const,
        () => 'failed' as const,
      ),
      new Promise<'timeout'>((complete) => {
        heartbeatDeadline = setTimeout(
          () => complete('timeout'),
          heartbeatTimeoutMs,
        );
      }),
      logicalCancellation,
    ]).then((outcome) => {
      if (outcome === 'failed' || outcome === 'timeout') {
        heartbeatCancellation.abort();
        executionError = true;
        beginTermination();
      }
    });
    const completion = boundedHeartbeat.finally(() => {
      if (heartbeatDeadline) clearTimeout(heartbeatDeadline);
      if (activeHeartbeat?.completion === completion) {
        activeHeartbeat = undefined;
      }
    });
    activeHeartbeat = {
      abort: () => {
        heartbeatCancellation.abort();
        cancelLogicalHeartbeat?.();
      },
      completion,
    };
  };
  const heartbeatTimer = options.heartbeat
    ? setInterval(startHeartbeat, heartbeatIntervalMs)
    : undefined;
  const deadlineTimer = setTimeout(() => {
    timedOut = true;
    beginTermination();
  }, options.timeoutMs);
  const abortListener = (): void => {
    cancelled = true;
    beginTermination();
  };
  options.signal?.addEventListener('abort', abortListener, { once: true });

  const firstEvent = await Promise.race([
    childClosed.then(() => 'closed' as const),
    terminationRequested.then(() => 'terminate' as const),
  ]);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  clearTimeout(deadlineTimer);
  options.signal?.removeEventListener('abort', abortListener);

  const processGroupId = child.pid;
  const processGroupExists =
    options.processGroupExists ?? boundedProcessGroupExists;
  if (processGroupId !== undefined) {
    if (firstEvent === 'terminate') {
      terminate('SIGTERM');
      if (
        !(await waitForBoundedProcessGroupExit(
          processGroupId,
          terminationGraceMs,
          processGroupExists,
        ))
      ) {
        terminate('SIGKILL');
      }
    } else if (processGroupExists(processGroupId)) {
      executionError = true;
      terminate('SIGTERM');
      if (
        !(await waitForBoundedProcessGroupExit(
          processGroupId,
          terminationGraceMs,
          processGroupExists,
        ))
      ) {
        terminate('SIGKILL');
      }
    }

    // Cleanup proof is intentionally separate from the work deadline. A deploy
    // descendant must not be reported complete while it can still mutate schema.
    while (processGroupExists(processGroupId)) {
      terminate('SIGKILL');
      await waitForBoundedProcessDelay(10);
    }
  }
  await childClosed;

  if (firstEvent === 'terminate') activeHeartbeat?.abort();
  if (activeHeartbeat) await activeHeartbeat.completion;
  return { status, stdout, stderr, timedOut, executionError, cancelled };
}

export function validateBoundedMigrationTimeouts(
  timeouts: BoundedMigrationTimeouts,
): void {
  if (
    Object.values(timeouts).some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )
  ) {
    throw new Error('Migration timeouts must be positive safe integers.');
  }
  if (timeouts.lock >= timeouts.statement) {
    throw new Error(
      'Migration lock timeout must be smaller than statement timeout.',
    );
  }
  if (
    timeouts.statement >= timeouts.idleInTransaction ||
    timeouts.idleInTransaction >= timeouts.command
  ) {
    throw new Error(
      'Migration statement, idle-transaction and command deadlines must be strictly ordered.',
    );
  }
}

// A migration that builds a large index or rewrites a large table may need a
// longer statement timeout. The lock timeout never widens: a deploy must still
// abort quickly instead of queueing behind application writers.
export function resolveBoundedMigrationTimeouts(
  environment: NodeJS.ProcessEnv,
): BoundedMigrationTimeouts {
  const override = environment[MIGRATION_STATEMENT_TIMEOUT_ENV];
  if (override === undefined) return BOUNDED_MIGRATION_TIMEOUTS_MS;
  const statement = /^[1-9][0-9]{0,6}$/u.test(override)
    ? Number(override)
    : Number.NaN;
  if (
    !Number.isSafeInteger(statement) ||
    statement <= BOUNDED_MIGRATION_TIMEOUTS_MS.lock ||
    statement > MAXIMUM_MIGRATION_STATEMENT_TIMEOUT_MS
  ) {
    throw new Error(
      `${MIGRATION_STATEMENT_TIMEOUT_ENV} must be an integer greater than ${String(
        BOUNDED_MIGRATION_TIMEOUTS_MS.lock,
      )} and at most ${String(MAXIMUM_MIGRATION_STATEMENT_TIMEOUT_MS)} milliseconds.`,
    );
  }
  const timeouts = {
    lock: BOUNDED_MIGRATION_TIMEOUTS_MS.lock,
    statement,
    idleInTransaction: statement + IDLE_IN_TRANSACTION_MARGIN_MS,
    command: statement + COMMAND_MARGIN_MS,
  };
  validateBoundedMigrationTimeouts(timeouts);
  return timeouts;
}

export function buildBoundedPgOptions(
  timeouts: BoundedMigrationTimeouts = BOUNDED_MIGRATION_TIMEOUTS_MS,
): string {
  validateBoundedMigrationTimeouts(timeouts);
  return [
    `-c lock_timeout=${String(timeouts.lock)}ms`,
    `-c statement_timeout=${String(timeouts.statement)}ms`,
    `-c idle_in_transaction_session_timeout=${String(timeouts.idleInTransaction)}ms`,
  ].join(' ');
}

export function buildBoundedMigrationEnvironment(
  environment: NodeJS.ProcessEnv,
  timeouts: BoundedMigrationTimeouts = BOUNDED_MIGRATION_TIMEOUTS_MS,
): NodeJS.ProcessEnv {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for bounded Prisma migration.');
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  const pgOptions = buildBoundedPgOptions(timeouts);
  parsed.searchParams.set('options', pgOptions);
  const boundedEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    DATABASE_URL: parsed.toString(),
    PGOPTIONS: pgOptions,
  };
  // Only the guarded resolve helper may disable Prisma's advisory lock after it
  // has acquired the same lock itself. Production deploy must never inherit a
  // caller-controlled bypass.
  delete boundedEnvironment.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK;
  return boundedEnvironment;
}

export function redactBoundedMigrationDiagnostic(value: unknown): string {
  return String(value)
    .replace(POSTGRES_URL, '[REDACTED_DATABASE_URL]')
    .replace(USER_INFO, '//[REDACTED_CREDENTIALS]@')
    .replace(PASSWORD_ASSIGNMENT, '$1=[REDACTED]');
}

export function resolveLocalPrismaCli(): string {
  return require.resolve('prisma/build/index.js');
}

export function normalizeBoundedMigrationDomainPreflight(
  output: string,
): string | undefined {
  if (
    /\bP3018\b/iu.test(output) &&
    /\bP0001\b/u.test(output) &&
    /Media cleanup lifecycle lacks an exact authoritative audit timestamp/u.test(
      output,
    )
  ) {
    return DOMAIN_PREFLIGHT_MARKER;
  }
  return undefined;
}

export function classifyBoundedMigrationExitCode(
  output: string,
  childExitCode: number | null,
  timedOut: boolean,
): number {
  if (timedOut) return BOUNDED_MIGRATION_EXIT_CODES.commandTimeout;
  if (isPrismaFailedMigrationRetryBlock(output, childExitCode)) return 1;
  if (childExitCode === 0) return 0;
  if (/\bP3018\b/iu.test(output) && /\b55P03\b/u.test(output)) {
    return BOUNDED_MIGRATION_EXIT_CODES.lockTimeout;
  }
  if (normalizeBoundedMigrationDomainPreflight(output)) {
    return BOUNDED_MIGRATION_EXIT_CODES.domainPreflight;
  }
  return childExitCode && childExitCode > 0 && childExitCode <= 255
    ? childExitCode
    : 1;
}

export function isPrismaFailedMigrationRetryBlock(
  output: string,
  exitCode: number | null,
): boolean {
  void exitCode;
  return /\bP3009\b/iu.test(output);
}

export function shouldInspectRetainedMigrationFailure(
  output: string,
  exitCode: number | null,
  timedOut: boolean,
): boolean {
  return (
    !timedOut &&
    exitCode === 1 &&
    !/\bP3009\b/iu.test(output) &&
    PRISMA_TRANSACTION_ABORT.test(output)
  );
}

export type BoundedMigrationDeployDependencies = {
  now: () => number;
  spawnCommand: typeof spawnSupervisedBoundedMigrationProcess;
};

function defaultBoundedMigrationDeployDependencies(): BoundedMigrationDeployDependencies {
  return {
    now: Date.now,
    spawnCommand: spawnSupervisedBoundedMigrationProcess,
  };
}

function remainingBoundedMigrationDeadlineMs(
  deadlineAt: number,
  now: () => number,
): number {
  return Math.floor(deadlineAt - now());
}

export async function runBoundedPrismaMigrateDeploy(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies?: BoundedMigrationDeployDependencies,
  signal?: AbortSignal,
  absoluteDeadlineAt?: number,
): Promise<number> {
  const timeouts = resolveBoundedMigrationTimeouts(environment);
  const effectiveDependencies =
    dependencies ?? defaultBoundedMigrationDeployDependencies();
  const deadlineAt =
    absoluteDeadlineAt ?? effectiveDependencies.now() + timeouts.command;
  const boundedEnvironment = buildBoundedMigrationEnvironment(
    environment,
    timeouts,
  );
  const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
  const preflightRemainingMs = remainingBoundedMigrationDeadlineMs(
    deadlineAt,
    effectiveDependencies.now,
  );
  if (preflightRemainingMs <= 0) {
    process.stderr.write(
      'Bounded Prisma migration deploy aborted: lock preflight deadline exceeded.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.commandTimeout;
  }
  const preflight = await effectiveDependencies.spawnCommand(
    process.execPath,
    ['-e', LOCK_PREFLIGHT_SCRIPT],
    {
      cwd: process.cwd(),
      env: boundedEnvironment,
      maximumOutputBytes: 64 * 1024,
      timeoutMs: Math.min(5_000, preflightRemainingMs),
      signal,
    },
  );
  const preflightOutput = redactBoundedMigrationDiagnostic(
    `${preflight.stdout}\n${preflight.stderr}`,
  );
  if (preflight.timedOut) {
    process.stderr.write(
      'Bounded Prisma migration deploy aborted: lock preflight deadline exceeded.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.commandTimeout;
  }
  if (preflight.cancelled) {
    process.stderr.write(
      'Bounded Prisma migration deploy aborted: cancellation received.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.internalFailure;
  }
  if (preflight.executionError || preflight.status !== 0) {
    if (
      !preflight.executionError &&
      preflight.status === BOUNDED_MIGRATION_EXIT_CODES.lockTimeout &&
      /BOUNDED_MIGRATION_LOCK_TIMEOUT 55P03/u.test(preflightOutput)
    ) {
      process.stderr.write(
        'Bounded Prisma migration deploy aborted: database lock timeout (55P03).\n',
      );
      return BOUNDED_MIGRATION_EXIT_CODES.lockTimeout;
    }
    if (preflightOutput.trim()) {
      process.stderr.write(`${preflightOutput.trim()}\n`);
    }
    if (preflight.executionError) {
      process.stderr.write(
        'Bounded Prisma migration deploy aborted: lock preflight process failed internally.\n',
      );
    }
    return 1;
  }
  const remainingMs = remainingBoundedMigrationDeadlineMs(
    deadlineAt,
    effectiveDependencies.now,
  );
  if (remainingMs <= 0) {
    process.stderr.write(
      'Bounded Prisma migration deploy aborted: command deadline exceeded.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.commandTimeout;
  }
  const result = await effectiveDependencies.spawnCommand(
    process.execPath,
    [resolveLocalPrismaCli(), 'migrate', 'deploy', '--schema', schemaPath],
    {
      cwd: process.cwd(),
      env: boundedEnvironment,
      timeoutMs: remainingMs,
      signal,
    },
  );
  const stdout = redactBoundedMigrationDiagnostic(result.stdout);
  const stderr = redactBoundedMigrationDiagnostic(result.stderr);
  const timedOut = result.timedOut;
  const childExitCode =
    result.executionError || result.cancelled ? null : result.status;
  let postFailureClassification = '';
  const currentOutput = `${stdout}\n${stderr}`;
  if (
    !result.executionError &&
    !result.cancelled &&
    shouldInspectRetainedMigrationFailure(
      currentOutput,
      childExitCode,
      timedOut,
    )
  ) {
    const postFailureRemainingMs = remainingBoundedMigrationDeadlineMs(
      deadlineAt,
      effectiveDependencies.now,
    );
    if (postFailureRemainingMs > 0) {
      const postFailure = await effectiveDependencies.spawnCommand(
        process.execPath,
        ['-e', DOMAIN_FAILURE_CLASSIFICATION_SCRIPT],
        {
          cwd: process.cwd(),
          env: boundedEnvironment,
          maximumOutputBytes: 64 * 1024,
          timeoutMs: Math.min(5_000, postFailureRemainingMs),
          signal,
        },
      );
      if (
        !postFailure.executionError &&
        !postFailure.cancelled &&
        !postFailure.timedOut &&
        postFailure.status === 0 &&
        /BOUNDED_MIGRATION_DOMAIN_PREFLIGHT P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp/u.test(
          postFailure.stdout,
        )
      ) {
        postFailureClassification =
          'BOUNDED_MIGRATION_DOMAIN_PREFLIGHT P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp';
      } else if (
        !postFailure.executionError &&
        !postFailure.cancelled &&
        !postFailure.timedOut &&
        postFailure.status === 0 &&
        /BOUNDED_MIGRATION_LOCK_TIMEOUT P3018 55P03/u.test(postFailure.stdout)
      ) {
        postFailureClassification =
          'BOUNDED_MIGRATION_LOCK_TIMEOUT P3018 55P03';
      }
    }
  }
  const exitCode = classifyBoundedMigrationExitCode(
    `${currentOutput}\n${postFailureClassification}`,
    childExitCode,
    timedOut,
  );
  const domainPreflightMarker = normalizeBoundedMigrationDomainPreflight(
    `${currentOutput}\n${postFailureClassification}`,
  );

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.executionError && !timedOut) {
    process.stderr.write(
      'Bounded Prisma migration command failed to execute or clean up safely.\n',
    );
  } else if (result.cancelled && !timedOut) {
    process.stderr.write(
      'Bounded Prisma migration deploy aborted: cancellation received.\n',
    );
  }
  if (exitCode === BOUNDED_MIGRATION_EXIT_CODES.lockTimeout) {
    process.stderr.write(
      'Bounded Prisma migration deploy aborted: database lock timeout.\n',
    );
  } else if (
    exitCode === BOUNDED_MIGRATION_EXIT_CODES.domainPreflight &&
    domainPreflightMarker
  ) {
    process.stderr.write(`${domainPreflightMarker}\n`);
    process.stderr.write(
      'Bounded Prisma migration deploy aborted: P3018 database preflight P0001.\n',
    );
  } else if (exitCode === BOUNDED_MIGRATION_EXIT_CODES.commandTimeout) {
    process.stderr.write(
      'Bounded Prisma migration deploy aborted: command deadline exceeded.\n',
    );
  }
  return exitCode;
}

async function main(): Promise<number> {
  if (process.argv.slice(2).length !== 0) {
    process.stderr.write(
      'Bounded Prisma migration deploy accepts no caller-controlled arguments.\n',
    );
    return Promise.resolve(BOUNDED_MIGRATION_EXIT_CODES.usage);
  }
  const cancellation = new AbortController();
  let signalExitCode: number | undefined;
  const cancelForSigint = (): void => {
    signalExitCode ??= 130;
    cancellation.abort(new Error('SIGINT'));
  };
  const cancelForSigterm = (): void => {
    signalExitCode ??= 143;
    cancellation.abort(new Error('SIGTERM'));
  };
  process.on('SIGINT', cancelForSigint);
  process.on('SIGTERM', cancelForSigterm);
  try {
    const deadlineAt =
      Date.now() + resolveBoundedMigrationTimeouts(process.env).command;
    const result = await runBoundedPrismaMigrateDeploy(
      process.env,
      undefined,
      cancellation.signal,
      deadlineAt,
    );
    return signalExitCode ?? result;
  } catch (error: unknown) {
    process.stderr.write(`${redactBoundedMigrationDiagnostic(error)}\n`);
    return 1;
  } finally {
    process.removeListener('SIGINT', cancelForSigint);
    process.removeListener('SIGTERM', cancelForSigterm);
  }
}

if (require.main === module) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
