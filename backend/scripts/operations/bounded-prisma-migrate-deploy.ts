import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export const BOUNDED_MIGRATION_TIMEOUTS_MS = {
  lock: 2_000,
  statement: 30_000,
  idleInTransaction: 35_000,
  command: 45_000,
} as const;

export const BOUNDED_MIGRATION_EXIT_CODES = {
  domainPreflight: 3,
  usage: 64,
  lockTimeout: 75,
  commandTimeout: 124,
} as const;

type BoundedMigrationTimeouts = {
  lock: number;
  statement: number;
  idleInTransaction: number;
  command: number;
};

const POSTGRES_URL = /postgres(?:ql)?:\/\/[^\s'"`]+/giu;
const PASSWORD_ASSIGNMENT =
  /\b(password|passwd|pwd|secret|token)\s*[=:]\s*[^\s,;]+/giu;
const USER_INFO = /\/\/[^/@\s:]+:[^/@\s]+@/gu;
const MEDIA_CLEANUP_AUDIT_MIGRATION =
  '20260813193000_media_cleanup_audit_integrity';
const MEDIA_CLEANUP_AUDIT_CHECKSUM =
  'c4a772f832cba6b5dd02385727e17153ec1cf672dd3f67ec90da83dba5026252';
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
  return {
    ...environment,
    DATABASE_URL: parsed.toString(),
    PGOPTIONS: pgOptions,
  };
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
  return exitCode === 1 && /\bP3009\b/iu.test(output);
}

export function runBoundedPrismaMigrateDeploy(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  validateBoundedMigrationTimeouts(BOUNDED_MIGRATION_TIMEOUTS_MS);
  const boundedEnvironment = buildBoundedMigrationEnvironment(environment);
  const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
  const startedAt = Date.now();
  const preflight = spawnSync(process.execPath, ['-e', LOCK_PREFLIGHT_SCRIPT], {
    cwd: process.cwd(),
    env: boundedEnvironment,
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    timeout: Math.min(5_000, BOUNDED_MIGRATION_TIMEOUTS_MS.command),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const preflightOutput = redactBoundedMigrationDiagnostic(
    `${preflight.stdout ?? ''}\n${preflight.stderr ?? ''}`,
  );
  const preflightTimedOut =
    preflight.error !== undefined &&
    'code' in preflight.error &&
    preflight.error.code === 'ETIMEDOUT';
  if (preflightTimedOut) {
    process.stderr.write(
      'Bounded Prisma migration deploy aborted: lock preflight deadline exceeded.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.commandTimeout;
  }
  if (preflight.status !== 0) {
    if (
      preflight.status === BOUNDED_MIGRATION_EXIT_CODES.lockTimeout &&
      /BOUNDED_MIGRATION_LOCK_TIMEOUT 55P03/u.test(preflightOutput)
    ) {
      process.stderr.write(
        'Bounded Prisma migration deploy aborted: database lock timeout (55P03).\n',
      );
      return BOUNDED_MIGRATION_EXIT_CODES.lockTimeout;
    }
    process.stderr.write(`${preflightOutput.trim()}\n`);
    return 1;
  }
  const remainingMs = Math.max(
    1,
    BOUNDED_MIGRATION_TIMEOUTS_MS.command - (Date.now() - startedAt),
  );
  const result = spawnSync(
    process.execPath,
    [resolveLocalPrismaCli(), 'migrate', 'deploy', '--schema', schemaPath],
    {
      cwd: process.cwd(),
      env: boundedEnvironment,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: remainingMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const stdout = redactBoundedMigrationDiagnostic(result.stdout ?? '');
  const stderr = redactBoundedMigrationDiagnostic(result.stderr ?? '');
  const timedOut =
    result.error !== undefined &&
    'code' in result.error &&
    result.error.code === 'ETIMEDOUT';
  let postFailureClassification = '';
  if (!timedOut && result.status !== 0) {
    const postFailureRemainingMs = Math.max(
      1,
      BOUNDED_MIGRATION_TIMEOUTS_MS.command - (Date.now() - startedAt),
    );
    const postFailure = spawnSync(
      process.execPath,
      ['-e', DOMAIN_FAILURE_CLASSIFICATION_SCRIPT],
      {
        cwd: process.cwd(),
        env: boundedEnvironment,
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
        timeout: Math.min(5_000, postFailureRemainingMs),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (
      postFailure.status === 0 &&
      /BOUNDED_MIGRATION_DOMAIN_PREFLIGHT P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp/u.test(
        postFailure.stdout ?? '',
      )
    ) {
      postFailureClassification =
        'BOUNDED_MIGRATION_DOMAIN_PREFLIGHT P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp';
    } else if (
      postFailure.status === 0 &&
      /BOUNDED_MIGRATION_LOCK_TIMEOUT P3018 55P03/u.test(
        postFailure.stdout ?? '',
      )
    ) {
      postFailureClassification = 'BOUNDED_MIGRATION_LOCK_TIMEOUT P3018 55P03';
    }
  }
  const exitCode = classifyBoundedMigrationExitCode(
    `${stdout}\n${stderr}\n${postFailureClassification}`,
    result.status,
    timedOut,
  );
  const domainPreflightMarker = normalizeBoundedMigrationDomainPreflight(
    `${stdout}\n${stderr}\n${postFailureClassification}`,
  );

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.error && !timedOut) {
    process.stderr.write(
      `Bounded Prisma migration command failed to execute: ${redactBoundedMigrationDiagnostic(
        result.error.message,
      )}\n`,
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

function main(): number {
  if (process.argv.slice(2).length !== 0) {
    process.stderr.write(
      'Bounded Prisma migration deploy accepts no caller-controlled arguments.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.usage;
  }
  try {
    return runBoundedPrismaMigrateDeploy();
  } catch (error: unknown) {
    process.stderr.write(`${redactBoundedMigrationDiagnostic(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}
