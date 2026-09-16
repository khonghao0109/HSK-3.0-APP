import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  BOUNDED_MIGRATION_EXIT_CODES,
  BOUNDED_MIGRATION_TIMEOUTS_MS,
  buildBoundedMigrationEnvironment,
  classifyBoundedMigrationExitCode,
  isPrismaFailedMigrationRetryBlock,
  normalizeBoundedMigrationDomainPreflight,
  redactBoundedMigrationDiagnostic,
  resolveBoundedMigrationTimeouts,
  resolveLocalPrismaCli,
  validateBoundedMigrationTimeouts,
} from '../operations/bounded-prisma-migrate-deploy';
import * as boundedMigrationDeployModule from '../operations/bounded-prisma-migrate-deploy';
import {
  MEDIA_CLEANUP_AUDIT_CHECKSUM,
  MEDIA_CLEANUP_AUDIT_MIGRATION,
  assertMigrationResolveTarget,
  migrationResolveTargetSha256,
  parseRolledBackResolveArguments,
  readRolledBackResolveTarget,
  runBoundedMigrationResolveRolledBack,
} from '../operations/bounded-prisma-migrate-resolve-rolled-back';
import type { RolledBackResolveTarget } from '../operations/bounded-prisma-migrate-resolve-rolled-back';
import * as boundedMigrationResolveModule from '../operations/bounded-prisma-migrate-resolve-rolled-back';
import {
  assertExactMigrationOnlyCounts,
  assertSafeMigrationAuxiliaryDatabase,
  assertSafeEvidence,
  assertSafeEvidencePath,
  buildPgOptions,
  classifyPrismaTimestampDriftAbort,
  classifyMigrationFailure,
  databaseFingerprint,
  MEDIA_MIGRATION_NAMES,
  parseCountRow,
  parseLockRow,
  readMigrationSourceCatalog,
  redactMigrationDiagnostic,
  sha256,
  waitForBoundedChild,
} from './media-lifecycle-migration-validation.helpers';

type MigrationResolveState = {
  targetMigrationName: string;
  expectedSuccessfulMigrationCount: number;
  targetMigrationId: string | null;
  targetMigrationRowCount: number;
  unresolvedTargetMigrationRowCount: number;
  unresolvedMigrationRowCount: number;
  finishedTargetMigrationRowCount: number;
  rolledBackTargetMigrationRowCount: number;
  successfulMigrationCount: number;
  targetChecksumMatches: boolean;
  sourceChecksumMatches: boolean;
  cleanupAuditFunctionCount: number;
  cleanupAuditTriggerCount: number;
  authoritativeInvariantViolationCount: number;
};

type MigrationResolveDependencies = {
  now: () => number;
  runGuardedResolve: (
    environment: NodeJS.ProcessEnv,
    backendRoot: string,
    deadlineAt: number,
    signal: AbortSignal | undefined,
    target: RolledBackResolveTarget,
  ) => Promise<GuardedResolveWorkerOutcome>;
};

type GuardedResolveWorkerOutcome =
  | { kind: 'unsafe'; state?: MigrationResolveState }
  | { kind: 'internal' }
  | { kind: 'deadline' }
  | { kind: 'cancelled' }
  | { kind: 'committed'; state: MigrationResolveState };

type GuardedResolveTransactionDecision =
  | Exclude<GuardedResolveWorkerOutcome, { kind: 'committed' }>
  | { kind: 'commit'; state: MigrationResolveState };

type ResolveTransaction = {
  $queryRawUnsafe: <T = unknown>(query: string) => Promise<T>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
};

type GuardedResolveWorkerDependencies = {
  now: () => number;
  readSourceChecksum: (migrationName: string) => string;
  runInTransaction: (
    operation: (
      transaction: ResolveTransaction,
    ) => Promise<GuardedResolveTransactionDecision>,
    timeoutMs: number,
  ) => Promise<GuardedResolveTransactionDecision>;
};

type SupervisedMigrationProcessResult = {
  status: number | null;
  timedOut: boolean;
  executionError: boolean;
  cancelled: boolean;
};

type SupervisedMigrationProcessOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  heartbeat?: (signal: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  terminationGraceMs?: number;
  maximumOutputBytes?: number;
  processGroupExists?: (processGroupId: number) => boolean;
};

type SupervisedBoundedMigrationProcessResult =
  SupervisedMigrationProcessResult & {
    stdout: string;
    stderr: string;
  };

type BoundedMigrationDeployContract = typeof boundedMigrationDeployModule & {
  shouldInspectRetainedMigrationFailure?: (
    output: string,
    exitCode: number | null,
    timedOut: boolean,
  ) => boolean;
  spawnSupervisedBoundedMigrationProcess?: (
    executable: string,
    args: string[],
    options: SupervisedMigrationProcessOptions,
  ) => Promise<SupervisedBoundedMigrationProcessResult>;
};

type BoundedMigrationResolveContract = typeof boundedMigrationResolveModule & {
  assertMigrationResolvePreconditions?: (state: MigrationResolveState) => void;
  assertMigrationResolvePostconditions?: (
    state: MigrationResolveState,
    expectedTargetMigrationId?: string | null,
  ) => void;
  runGuardedMigrationResolveWorker?: (
    environment: NodeJS.ProcessEnv,
    backendRoot: string,
    deadlineAt: number,
    dependencies: GuardedResolveWorkerDependencies,
    signal: AbortSignal | undefined,
    target: RolledBackResolveTarget,
  ) => Promise<GuardedResolveWorkerOutcome>;
  selectMigrationResolveProcessExitCode?: (
    resolveExitCode: number,
    signalExitCode?: number,
  ) => number;
};

const validResolveTarget: RolledBackResolveTarget = {
  migrationName: MEDIA_CLEANUP_AUDIT_MIGRATION,
  sourceChecksum: MEDIA_CLEANUP_AUDIT_CHECKSUM,
  predecessorMigrationCount: 18,
  guardsMediaCleanupAudit: true,
};

const validResolvePreconditionState: MigrationResolveState = {
  targetMigrationName: MEDIA_CLEANUP_AUDIT_MIGRATION,
  expectedSuccessfulMigrationCount: 18,
  targetMigrationId: '11111111-1111-4111-8111-111111111111',
  targetMigrationRowCount: 1,
  unresolvedTargetMigrationRowCount: 1,
  unresolvedMigrationRowCount: 1,
  finishedTargetMigrationRowCount: 0,
  rolledBackTargetMigrationRowCount: 0,
  successfulMigrationCount: 18,
  targetChecksumMatches: true,
  sourceChecksumMatches: true,
  cleanupAuditFunctionCount: 0,
  cleanupAuditTriggerCount: 0,
  authoritativeInvariantViolationCount: 0,
};

const validResolvePostconditionState: MigrationResolveState = {
  ...validResolvePreconditionState,
  unresolvedTargetMigrationRowCount: 0,
  unresolvedMigrationRowCount: 0,
  rolledBackTargetMigrationRowCount: 1,
};

const unsafeResolvePreconditionCases: Array<
  [name: string, override: Partial<MigrationResolveState>]
> = [
  [
    'wrong failed-row count',
    {
      targetMigrationRowCount: 2,
      unresolvedTargetMigrationRowCount: 2,
      unresolvedMigrationRowCount: 2,
    },
  ],
  ['missing target row identity', { targetMigrationId: null }],
  ['wrong migration checksum', { targetChecksumMatches: false }],
  ['wrong source checksum', { sourceChecksumMatches: false }],
  ['17 successful migrations', { successfulMigrationCount: 17 }],
  ['19 successful migrations', { successfulMigrationCount: 19 }],
  ['partial cleanup-audit function', { cleanupAuditFunctionCount: 1 }],
  ['partial cleanup-audit trigger', { cleanupAuditTriggerCount: 1 }],
  [
    'unreconciled authoritative invariant',
    { authoritativeInvariantViolationCount: 1 },
  ],
  [
    'already-finished target row',
    {
      unresolvedTargetMigrationRowCount: 0,
      unresolvedMigrationRowCount: 0,
      finishedTargetMigrationRowCount: 1,
      successfulMigrationCount: 19,
    },
  ],
  [
    'already-rolled-back target row',
    {
      unresolvedTargetMigrationRowCount: 0,
      unresolvedMigrationRowCount: 0,
      rolledBackTargetMigrationRowCount: 1,
    },
  ],
  ['second unrelated failed migration', { unresolvedMigrationRowCount: 2 }],
];

function requireResolvePreconditionAssertion(): (
  state: MigrationResolveState,
) => void {
  const assertion = (
    boundedMigrationResolveModule as BoundedMigrationResolveContract
  ).assertMigrationResolvePreconditions;
  if (typeof assertion !== 'function') {
    assert.fail(
      'Production resolve must export its precondition policy for the wrapper and rehearsal.',
    );
  }
  return assertion;
}

function requireResolvePostconditionAssertion(): (
  state: MigrationResolveState,
  expectedTargetMigrationId?: string | null,
) => void {
  const assertion = (
    boundedMigrationResolveModule as BoundedMigrationResolveContract
  ).assertMigrationResolvePostconditions;
  if (typeof assertion !== 'function') {
    assert.fail(
      'Production resolve must export its postcondition policy for the wrapper and rehearsal.',
    );
  }
  return assertion;
}

function requireGuardedResolveWorker(
  target: RolledBackResolveTarget = validResolveTarget,
): (
  environment: NodeJS.ProcessEnv,
  backendRoot: string,
  deadlineAt: number,
  dependencies: GuardedResolveWorkerDependencies,
  signal?: AbortSignal,
) => Promise<GuardedResolveWorkerOutcome> {
  const worker = (
    boundedMigrationResolveModule as BoundedMigrationResolveContract
  ).runGuardedMigrationResolveWorker;
  if (typeof worker !== 'function') {
    assert.fail(
      'Production resolve must expose its serialized worker boundary for focused concurrency tests.',
    );
  }
  return (environment, backendRoot, deadlineAt, dependencies, signal) =>
    worker(environment, backendRoot, deadlineAt, dependencies, signal, target);
}

function requireResolveProcessExitSelector(): (
  resolveExitCode: number,
  signalExitCode?: number,
) => number {
  const selector = (
    boundedMigrationResolveModule as BoundedMigrationResolveContract
  ).selectMigrationResolveProcessExitCode;
  if (typeof selector !== 'function') {
    assert.fail(
      'Production resolve must expose its committed-success process-exit policy.',
    );
  }
  return selector;
}

function requireDeployProcessSupervisor(): (
  executable: string,
  args: string[],
  options: SupervisedMigrationProcessOptions,
) => Promise<SupervisedBoundedMigrationProcessResult> {
  const supervisor = (
    boundedMigrationDeployModule as BoundedMigrationDeployContract
  ).spawnSupervisedBoundedMigrationProcess;
  if (typeof supervisor !== 'function') {
    assert.fail(
      'Production deploy must expose its real process-group supervisor for topology tests.',
    );
  }
  return supervisor;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((complete) => setTimeout(complete, milliseconds));
}

function assertProcessDoesNotExist(pid: number): void {
  let exists = true;
  try {
    process.kill(pid, 0);
  } catch (error: unknown) {
    exists =
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'ESRCH';
  }
  assert.equal(exists, false, `Process ${String(pid)} is still alive.`);
}

async function runResolveWithDependencies(
  dependencies: MigrationResolveDependencies,
  // null models an operator invocation without --target-migration.
  targetMigrationName: string | null = MEDIA_CLEANUP_AUDIT_MIGRATION,
): Promise<number> {
  const runWithDependencies =
    runBoundedMigrationResolveRolledBack as unknown as (
      environment: NodeJS.ProcessEnv,
      backendRoot: string,
      dependencies: MigrationResolveDependencies,
      signal: AbortSignal | undefined,
      absoluteDeadlineAt: number | undefined,
      targetMigrationName: string | undefined,
    ) => Promise<number>;
  return runWithDependencies(
    {
      NODE_ENV: 'test',
      DATABASE_URL:
        'postgresql://operator:synthetic@127.0.0.1:5432/hsk_media_recovery_test?schema=public',
      TEST_DATABASE_URL:
        'postgresql://operator:synthetic@127.0.0.1:5432/hsk_media_recovery_test?schema=public',
    },
    process.cwd(),
    dependencies,
    undefined,
    undefined,
    targetMigrationName ?? undefined,
  );
}

void test('owns the production Prisma deploy timeout and environment contract', () => {
  const secret = 'caller-controlled-password';
  const environment = buildBoundedMigrationEnvironment({
    DATABASE_URL: `postgresql://operator:${secret}@db.internal:5432/hsk?schema=public&options=-c%20lock_timeout%3D0`,
    PGOPTIONS: '-c lock_timeout=0 -c statement_timeout=0',
    PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: '1',
  });
  const databaseUrl = new URL(environment.DATABASE_URL ?? '');

  assert.equal(
    databaseUrl.searchParams.get('options'),
    '-c lock_timeout=2000ms -c statement_timeout=30000ms -c idle_in_transaction_session_timeout=35000ms',
  );
  assert.equal(
    environment.PGOPTIONS,
    '-c lock_timeout=2000ms -c statement_timeout=30000ms -c idle_in_transaction_session_timeout=35000ms',
  );
  assert.equal(databaseUrl.searchParams.getAll('options').length, 1);
  assert.equal(environment.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK, undefined);
  assert.doesNotMatch(
    redactBoundedMigrationDiagnostic(environment.DATABASE_URL),
    new RegExp(secret, 'u'),
  );
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['migrate:deploy:production'],
    'node dist/scripts/operations/bounded-prisma-migrate-deploy.js',
  );
  assert.equal(
    packageJson.scripts?.['migrate:resolve:rolled-back:production'],
    'node dist/scripts/operations/bounded-prisma-migrate-resolve-rolled-back.js',
  );
  assert.doesNotMatch(
    `${packageJson.scripts?.['migrate:deploy:production']} ${packageJson.scripts?.['migrate:resolve:rolled-back:production']}`,
    /ts-node|npx/iu,
  );
  const wrapperSource = readFileSync(
    resolve(
      process.cwd(),
      'scripts/operations/bounded-prisma-migrate-deploy.ts',
    ),
    'utf8',
  );
  assert.match(wrapperSource, /'migrate',\s*'deploy'/u);
  assert.match(
    wrapperSource,
    /BOUNDED_MIGRATION_DOMAIN_PREFLIGHT P3018 P0001/u,
  );
  assert.match(wrapperSource, /BOUNDED_MIGRATION_LOCK_TIMEOUT P3018 55P03/u);
  assert.match(wrapperSource, /20260813193000_media_cleanup_audit_integrity/u);
  assert.match(
    wrapperSource,
    /7b1e8e12bb6040bee629e702d217f54880d41dd7ffb962e3bf89b4cdca6adb08/u,
  );
  assert.ok(
    wrapperSource.indexOf('to_regclass(\'\\"MediaIngestion\\"\')') <
      wrapperSource.indexOf('to_regclass(\'\\"AuditLog\\"\')'),
    'Lock preflight must preserve the migration application lock order.',
  );
  assert.doesNotMatch(wrapperSource, /'migrate',\s*'resolve'|'reset'|'push'/u);
  assert.match(
    wrapperSource,
    /spawnCommand:\s*spawnSupervisedBoundedMigrationProcess/u,
  );
  assert.match(wrapperSource, /process\.on\('SIGINT', cancelForSigint\)/u);
  assert.match(wrapperSource, /process\.on\('SIGTERM', cancelForSigterm\)/u);
  assert.doesNotMatch(wrapperSource, /\bspawnSync\b/u);
  assert.doesNotMatch(wrapperSource, /process\.exit\(/u);
});

void test('pins the cleanup-audit recovery target without an external resolve child', () => {
  assert.equal(
    MEDIA_CLEANUP_AUDIT_MIGRATION,
    '20260813193000_media_cleanup_audit_integrity',
  );
  assert.equal(
    MEDIA_CLEANUP_AUDIT_CHECKSUM,
    '7b1e8e12bb6040bee629e702d217f54880d41dd7ffb962e3bf89b4cdca6adb08',
  );
  const wrapperSource = readFileSync(
    resolve(
      process.cwd(),
      'scripts/operations/bounded-prisma-migrate-resolve-rolled-back.ts',
    ),
    'utf8',
  );
  assert.doesNotMatch(wrapperSource, /PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK/u);
  assert.doesNotMatch(wrapperSource, /spawnSupervised|spawnPrisma/u);
  assert.doesNotMatch(wrapperSource, /'migrate',\s*'resolve'/u);
});

void test('routes SIGINT and SIGTERM through the bounded transaction cancellation boundary', () => {
  const wrapperSource = readFileSync(
    resolve(
      process.cwd(),
      'scripts/operations/bounded-prisma-migrate-resolve-rolled-back.ts',
    ),
    'utf8',
  );
  assert.match(wrapperSource, /process\.on\('SIGINT', cancelForSigint\)/u);
  assert.match(wrapperSource, /process\.on\('SIGTERM', cancelForSigterm\)/u);
  assert.doesNotMatch(wrapperSource, /PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK/u);
  assert.doesNotMatch(wrapperSource, /spawnSupervised|spawnPrisma/u);
  assert.doesNotMatch(
    wrapperSource,
    /process\.exit\(/u,
    'A hard process exit can interrupt the guarded history transaction.',
  );
});

void test('guards test and production resolve targets with exact environment contracts', () => {
  const disposableUrl =
    'postgresql://operator:synthetic@127.0.0.1:5432/hsk_media_recovery_test?schema=public';
  assert.doesNotThrow(() =>
    assertMigrationResolveTarget({
      NODE_ENV: 'test',
      DATABASE_URL: disposableUrl,
      TEST_DATABASE_URL: disposableUrl,
    }),
  );
  assert.throws(
    () =>
      assertMigrationResolveTarget({
        NODE_ENV: 'test',
        DATABASE_URL:
          'postgresql://operator:synthetic@db.internal:5432/hsk_media_recovery_test?schema=public',
        TEST_DATABASE_URL: disposableUrl,
      }),
    /loopback \*_test target/iu,
  );

  const productionUrl =
    'postgresql://operator:synthetic@db.internal:5432/hsk?schema=public';
  const expectedTargetSha256 = migrationResolveTargetSha256(productionUrl);
  assert.match(expectedTargetSha256, /^[a-f0-9]{64}$/u);
  assert.doesNotThrow(() =>
    assertMigrationResolveTarget({
      NODE_ENV: 'production',
      DATABASE_URL: productionUrl,
      MEDIA_MIGRATION_EXPECTED_TARGET_SHA256: expectedTargetSha256,
    }),
  );
  assert.throws(
    () =>
      assertMigrationResolveTarget({
        NODE_ENV: 'production',
        DATABASE_URL: productionUrl,
        MEDIA_MIGRATION_EXPECTED_TARGET_SHA256: '0'.repeat(64),
      }),
    /production target fingerprint/iu,
  );
});

void test('accepts only the exact production resolve precondition state', () => {
  const assertPreconditions = requireResolvePreconditionAssertion();
  assert.doesNotThrow(() => assertPreconditions(validResolvePreconditionState));
});

void test('rejects every unsafe production resolve precondition', async (context) => {
  for (const [name, override] of unsafeResolvePreconditionCases) {
    await context.test(name, () => {
      const assertPreconditions = requireResolvePreconditionAssertion();
      assert.throws(
        () =>
          assertPreconditions({
            ...validResolvePreconditionState,
            ...override,
          }),
        /resolve precondition/iu,
      );
    });
  }
});

/* eslint-disable @typescript-eslint/require-await -- Promise-shaped test doubles model the async production boundary. */
void test('rejects every unsafe precondition without mutating migration history', async (context) => {
  for (const [name, override] of unsafeResolvePreconditionCases) {
    await context.test(name, async () => {
      let historyMutationCount = 0;
      const worker = requireGuardedResolveWorker();
      const state = { ...validResolvePreconditionState, ...override };
      const outcome = await worker(
        { DATABASE_URL: 'postgresql://synthetic.invalid/hsk?schema=public' },
        process.cwd(),
        46_000,
        {
          now: () => 1_000,
          readSourceChecksum: () =>
            override.sourceChecksumMatches === false
              ? '0'.repeat(64)
              : MEDIA_CLEANUP_AUDIT_CHECKSUM,
          runInTransaction: async (operation) =>
            operation({
              $queryRawUnsafe: async <T>(query: string): Promise<T> =>
                (/pg_try_advisory_xact_lock/u.test(query)
                  ? [{ acquired: true }]
                  : [state]) as T,
              $executeRawUnsafe: async (query) => {
                if (/UPDATE "_prisma_migrations"/u.test(query)) {
                  historyMutationCount += 1;
                  return 1;
                }
                return 0;
              },
            }),
        },
      );

      assert.equal(outcome.kind, 'unsafe');
      assert.equal(historyMutationCount, 0);
    });
  }
});

void test('maps guarded internal verification failure to exit 70', async () => {
  const exitCode = await runResolveWithDependencies({
    now: () => 1_000,
    runGuardedResolve: async () => ({ kind: 'internal' }),
  });

  assert.equal(exitCode, 70);
});

void test('returns success only after the exact rolled-back postcondition', async () => {
  const exitCode = await runResolveWithDependencies({
    now: () => 1_000,
    runGuardedResolve: async () => ({
      kind: 'committed',
      state: validResolvePostconditionState,
    }),
  });

  assert.equal(exitCode, 0);
  const assertPostconditions = requireResolvePostconditionAssertion();
  assert.doesNotThrow(() =>
    assertPostconditions(
      validResolvePostconditionState,
      validResolvePreconditionState.targetMigrationId,
    ),
  );
});

void test('serializes exact precondition, history mutation and postcondition in one bounded transaction', async () => {
  const events: string[] = [];
  let stateReadCount = 0;
  const transaction: ResolveTransaction = {
    $queryRawUnsafe: async <T>(query: string): Promise<T> => {
      if (/pg_try_advisory_xact_lock\(72707369\)/u.test(query)) {
        events.push('advisory');
        return [{ acquired: true }] as T;
      }
      if (/SELECT/u.test(query)) {
        stateReadCount += 1;
        events.push(stateReadCount === 1 ? 'precondition' : 'postcondition');
        return [
          stateReadCount === 1
            ? validResolvePreconditionState
            : validResolvePostconditionState,
        ] as T;
      }
      throw new Error('unexpected query');
    },
    $executeRawUnsafe: async (
      query: string,
      ...values: unknown[]
    ): Promise<number> => {
      if (/LOCK TABLE "_prisma_migrations"/u.test(query)) {
        events.push('lock-history');
      } else if (/LOCK TABLE "MediaIngestion"/u.test(query)) {
        events.push('lock-media');
      } else if (/LOCK TABLE "AuditLog"/u.test(query)) {
        events.push('lock-audit');
      } else if (/UPDATE "_prisma_migrations"/u.test(query)) {
        events.push('mutation');
        assert.match(query, /SET rolled_back_at\s*=\s*clock_timestamp\(\)/u);
        assert.match(query, /finished_at IS NULL/u);
        assert.match(query, /rolled_back_at IS NULL/u);
        assert.deepEqual(values, [
          validResolvePreconditionState.targetMigrationId,
          MEDIA_CLEANUP_AUDIT_MIGRATION,
          MEDIA_CLEANUP_AUDIT_CHECKSUM,
        ]);
        return 1;
      } else {
        throw new Error('unexpected statement');
      }
      return 0;
    },
  };
  const worker = requireGuardedResolveWorker();
  const outcome = await worker(
    { DATABASE_URL: 'postgresql://synthetic.invalid/hsk?schema=public' },
    process.cwd(),
    46_000,
    {
      now: () => 1_000,
      readSourceChecksum: () => MEDIA_CLEANUP_AUDIT_CHECKSUM,
      runInTransaction: async (operation, timeoutMs) => {
        assert.ok(timeoutMs > 0 && timeoutMs < 45_000);
        return operation(transaction);
      },
    },
  );

  assert.deepEqual(outcome, {
    kind: 'committed',
    state: validResolvePostconditionState,
  });
  assert.deepEqual(events, [
    'advisory',
    'lock-history',
    'lock-media',
    'lock-audit',
    'precondition',
    'mutation',
    'postcondition',
  ]);
});

void test('rejects an active migration advisory lock before querying or mutating state', async () => {
  let historyMutationCount = 0;
  const worker = requireGuardedResolveWorker();
  const outcome = await worker(
    { DATABASE_URL: 'postgresql://synthetic.invalid/hsk?schema=public' },
    process.cwd(),
    46_000,
    {
      now: () => 1_000,
      readSourceChecksum: () => MEDIA_CLEANUP_AUDIT_CHECKSUM,
      runInTransaction: async (operation) =>
        operation({
          $queryRawUnsafe: async <T>(query: string): Promise<T> => {
            assert.match(query, /pg_try_advisory_xact_lock\(72707369\)/u);
            return [{ acquired: false }] as T;
          },
          $executeRawUnsafe: async () => {
            historyMutationCount += 1;
            assert.fail(
              'Invariant tables must not be locked after guard rejection.',
            );
          },
        }),
    },
  );

  assert.deepEqual(outcome, { kind: 'unsafe' });
  assert.equal(historyMutationCount, 0);
});

void test('rejects a concurrent invariant writer before querying or mutating state', async () => {
  let lockAttemptCount = 0;
  let stateReadCount = 0;
  const worker = requireGuardedResolveWorker();
  const outcome = await worker(
    { DATABASE_URL: 'postgresql://synthetic.invalid/hsk?schema=public' },
    process.cwd(),
    46_000,
    {
      now: () => 1_000,
      readSourceChecksum: () => MEDIA_CLEANUP_AUDIT_CHECKSUM,
      runInTransaction: async (operation) =>
        operation({
          $queryRawUnsafe: async <T>(query: string): Promise<T> => {
            if (/pg_try_advisory_xact_lock/u.test(query)) {
              return [{ acquired: true }] as T;
            }
            stateReadCount += 1;
            return [validResolvePreconditionState] as T;
          },
          $executeRawUnsafe: async () => {
            lockAttemptCount += 1;
            throw Object.assign(new Error('synthetic lock timeout'), {
              code: 'P2010',
              meta: { code: '55P03' },
            });
          },
        }),
    },
  );

  assert.deepEqual(outcome, { kind: 'unsafe' });
  assert.equal(lockAttemptCount, 1);
  assert.equal(stateReadCount, 0);
});

void test('rolls back the guarded transaction when the exact history row is not mutated', async () => {
  let historyMutationCount = 0;
  let transactionCommitted = false;
  let transactionRolledBack = false;
  const worker = requireGuardedResolveWorker();
  const outcome = await worker(
    { DATABASE_URL: 'postgresql://synthetic.invalid/hsk?schema=public' },
    process.cwd(),
    46_000,
    {
      now: () => 1_000,
      readSourceChecksum: () => MEDIA_CLEANUP_AUDIT_CHECKSUM,
      runInTransaction: async (operation) => {
        try {
          const transactionOutcome = await operation({
            $queryRawUnsafe: async <T>(query: string): Promise<T> =>
              (/pg_try_advisory_xact_lock/u.test(query)
                ? [{ acquired: true }]
                : [validResolvePreconditionState]) as T,
            $executeRawUnsafe: async (query) => {
              if (/UPDATE "_prisma_migrations"/u.test(query)) {
                historyMutationCount += 1;
              }
              return 0;
            },
          });
          transactionCommitted = true;
          return transactionOutcome;
        } catch {
          transactionRolledBack = true;
          throw new Error('synthetic transaction rollback');
        }
      },
    },
  );

  assert.deepEqual(outcome, { kind: 'internal' });
  assert.equal(historyMutationCount, 1);
  assert.equal(transactionCommitted, false);
  assert.equal(transactionRolledBack, true);
});

void test('rolls back the history mutation when the exact postcondition fails', async () => {
  let stateReadCount = 0;
  let transactionCommitted = false;
  let transactionRolledBack = false;
  const worker = requireGuardedResolveWorker();
  const dependenciesWithLegacyChild = {
    now: () => 1_000,
    readSourceChecksum: () => MEDIA_CLEANUP_AUDIT_CHECKSUM,
    runInTransaction: async (
      operation: (
        transaction: ResolveTransaction,
      ) => Promise<GuardedResolveTransactionDecision>,
    ) => {
      try {
        const transactionOutcome = await operation({
          $queryRawUnsafe: async <T>(query: string): Promise<T> => {
            if (/pg_try_advisory_xact_lock/u.test(query)) {
              return [{ acquired: true }] as T;
            }
            stateReadCount += 1;
            return [
              stateReadCount === 1
                ? validResolvePreconditionState
                : {
                    ...validResolvePostconditionState,
                    authoritativeInvariantViolationCount: 1,
                  },
            ] as T;
          },
          $executeRawUnsafe: async (query) =>
            /UPDATE "_prisma_migrations"/u.test(query) ? 1 : 0,
        });
        transactionCommitted = true;
        return transactionOutcome;
      } catch {
        transactionRolledBack = true;
        throw new Error('synthetic transaction rollback');
      }
    },
    // This legacy-only double makes the regression reach the old postcheck.
    // The fixed worker has no child boundary and ignores this property.
    spawnPrisma: async () => ({
      status: 0,
      timedOut: false,
      executionError: false,
      cancelled: false,
    }),
  } as unknown as GuardedResolveWorkerDependencies;
  const outcome = await worker(
    { DATABASE_URL: 'postgresql://synthetic.invalid/hsk?schema=public' },
    process.cwd(),
    46_000,
    dependenciesWithLegacyChild,
  );

  assert.deepEqual(outcome, { kind: 'internal' });
  assert.equal(transactionCommitted, false);
  assert.equal(transactionRolledBack, true);
});

void test('rolls back the history mutation when the transaction deadline expires before commit', async () => {
  let nowCallCount = 0;
  let stateReadCount = 0;
  let historyMutationCount = 0;
  let transactionCommitted = false;
  let transactionRolledBack = false;
  const worker = requireGuardedResolveWorker();
  const dependenciesWithLegacyChild = {
    now: () => {
      nowCallCount += 1;
      return nowCallCount >= 3 ? 45_800 : 1_000;
    },
    readSourceChecksum: () => MEDIA_CLEANUP_AUDIT_CHECKSUM,
    runInTransaction: async (
      operation: (
        transaction: ResolveTransaction,
      ) => Promise<GuardedResolveTransactionDecision>,
    ) => {
      try {
        const transactionOutcome = await operation({
          $queryRawUnsafe: async <T>(query: string): Promise<T> => {
            if (/pg_try_advisory_xact_lock/u.test(query)) {
              return [{ acquired: true }] as T;
            }
            stateReadCount += 1;
            return [
              stateReadCount === 1
                ? validResolvePreconditionState
                : validResolvePostconditionState,
            ] as T;
          },
          $executeRawUnsafe: async (query) => {
            if (/UPDATE "_prisma_migrations"/u.test(query)) {
              historyMutationCount += 1;
              return 1;
            }
            return 0;
          },
        });
        transactionCommitted = true;
        return transactionOutcome;
      } catch {
        transactionRolledBack = true;
        throw new Error('synthetic transaction rollback');
      }
    },
    // The old child-based worker would commit after the child returned even
    // when the enclosing transaction's bounded lifetime had elapsed.
    spawnPrisma: async () => ({
      status: 0,
      timedOut: false,
      executionError: false,
      cancelled: false,
    }),
  } as unknown as GuardedResolveWorkerDependencies;
  const outcome = await worker(
    { DATABASE_URL: 'postgresql://synthetic.invalid/hsk?schema=public' },
    process.cwd(),
    46_000,
    dependenciesWithLegacyChild,
  );

  assert.deepEqual(outcome, { kind: 'deadline' });
  assert.equal(historyMutationCount, 1);
  assert.equal(transactionCommitted, false);
  assert.equal(transactionRolledBack, true);
});

void test('rolls back the history mutation when cancellation arrives before the transaction callback returns', async () => {
  const cancellation = new AbortController();
  let transactionCommitted = false;
  let transactionRolledBack = false;
  const worker = requireGuardedResolveWorker();
  const outcome = await worker(
    { DATABASE_URL: 'postgresql://synthetic.invalid/hsk?schema=public' },
    process.cwd(),
    46_000,
    {
      now: () => 1_000,
      readSourceChecksum: () => MEDIA_CLEANUP_AUDIT_CHECKSUM,
      runInTransaction: async (operation) => {
        try {
          const decision = await operation({
            $queryRawUnsafe: async <T>(query: string): Promise<T> =>
              (/pg_try_advisory_xact_lock/u.test(query)
                ? [{ acquired: true }]
                : [validResolvePreconditionState]) as T,
            $executeRawUnsafe: async (query) => {
              if (/UPDATE "_prisma_migrations"/u.test(query)) {
                cancellation.abort(
                  new Error('synthetic pre-commit cancellation'),
                );
                return 1;
              }
              return 0;
            },
          });
          transactionCommitted = true;
          return decision;
        } catch {
          transactionRolledBack = true;
          throw new Error('synthetic transaction rollback');
        }
      },
    },
    cancellation.signal,
  );

  assert.deepEqual(outcome, { kind: 'cancelled' });
  assert.equal(transactionCommitted, false);
  assert.equal(transactionRolledBack, true);
});

void test('reports committed success when cancellation arrives after the transaction callback returns', async () => {
  const cancellation = new AbortController();
  let stateReadCount = 0;
  const worker = requireGuardedResolveWorker();
  const outcome = await worker(
    { DATABASE_URL: 'postgresql://synthetic.invalid/hsk?schema=public' },
    process.cwd(),
    46_000,
    {
      now: () => 1_000,
      readSourceChecksum: () => MEDIA_CLEANUP_AUDIT_CHECKSUM,
      runInTransaction: async (operation) => {
        const decision = await operation({
          $queryRawUnsafe: async <T>(query: string): Promise<T> => {
            if (/pg_try_advisory_xact_lock/u.test(query)) {
              return [{ acquired: true }] as T;
            }
            stateReadCount += 1;
            return [
              stateReadCount === 1
                ? validResolvePreconditionState
                : validResolvePostconditionState,
            ] as T;
          },
          $executeRawUnsafe: async (query) =>
            /UPDATE "_prisma_migrations"/u.test(query) ? 1 : 0,
        });
        cancellation.abort(new Error('synthetic commit-phase SIGTERM'));
        return decision;
      },
    },
    cancellation.signal,
  );

  assert.equal(cancellation.signal.aborted, true);
  assert.deepEqual(outcome, {
    kind: 'committed',
    state: validResolvePostconditionState,
  });
});

void test('does not report deadline expiry after the guarded transaction commits', async () => {
  const worker = requireGuardedResolveWorker();
  const runWithDependencies =
    runBoundedMigrationResolveRolledBack as unknown as (
      environment: NodeJS.ProcessEnv,
      backendRoot: string,
      dependencies: MigrationResolveDependencies,
      signal: AbortSignal | undefined,
      absoluteDeadlineAt: number,
      targetMigrationName: string,
    ) => Promise<number>;
  const databaseUrl =
    'postgresql://operator:synthetic@127.0.0.1:5432/hsk_media_recovery_test?schema=public';
  const deadlineAt = Date.now() + 50;
  let callbackReturned = false;
  let deadlineObservedDuringCommit = false;
  let stateReadCount = 0;
  const exitCode = await runWithDependencies(
    {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
    },
    process.cwd(),
    {
      now: Date.now,
      runGuardedResolve: (
        environment,
        backendRoot,
        guardedDeadlineAt,
        signal,
      ) =>
        worker(
          environment,
          backendRoot,
          guardedDeadlineAt,
          {
            now: () => guardedDeadlineAt - 1_000,
            readSourceChecksum: () => MEDIA_CLEANUP_AUDIT_CHECKSUM,
            runInTransaction: async (operation) => {
              const decision = await operation({
                $queryRawUnsafe: async <T>(query: string): Promise<T> => {
                  if (/pg_try_advisory_xact_lock/u.test(query)) {
                    return [{ acquired: true }] as T;
                  }
                  stateReadCount += 1;
                  return [
                    stateReadCount === 1
                      ? validResolvePreconditionState
                      : validResolvePostconditionState,
                  ] as T;
                },
                $executeRawUnsafe: async (query) =>
                  /UPDATE "_prisma_migrations"/u.test(query) ? 1 : 0,
              });
              callbackReturned = true;
              await new Promise<void>((complete) => {
                if (signal?.aborted) complete();
                else
                  signal?.addEventListener('abort', () => complete(), {
                    once: true,
                  });
              });
              deadlineObservedDuringCommit = signal?.aborted === true;
              return decision;
            },
          },
          signal,
        ),
    },
    undefined,
    deadlineAt,
    MEDIA_CLEANUP_AUDIT_MIGRATION,
  );

  assert.equal(callbackReturned, true);
  assert.equal(deadlineObservedDuringCommit, true);
  assert.equal(exitCode, 0);
});

void test('keeps committed success authoritative over a late process signal', () => {
  const selectExitCode = requireResolveProcessExitSelector();

  assert.equal(selectExitCode(0, 143), 0);
  assert.equal(selectExitCode(70, 143), 143);
  assert.equal(selectExitCode(70), 70);
});
/* eslint-enable @typescript-eslint/require-await */

void test('uses one end-to-end resolve deadline and maps worker expiry to 124', async () => {
  let observedDeadlineAt = 0;
  const exitCode = await runResolveWithDependencies({
    now: () => 1_000,
    runGuardedResolve: (_environment, _backendRoot, deadlineAt) => {
      observedDeadlineAt = deadlineAt;
      return Promise.resolve({ kind: 'deadline' });
    },
  });

  assert.equal(exitCode, BOUNDED_MIGRATION_EXIT_CODES.commandTimeout);
  assert.equal(
    observedDeadlineAt,
    1_000 + BOUNDED_MIGRATION_TIMEOUTS_MS.command,
  );
});

void test('threads cancellation into the guarded resolve boundary before returning', async () => {
  const cancellation = new AbortController();
  cancellation.abort(new Error('synthetic SIGTERM'));
  let observedCancellation = false;
  const runWithDependencies =
    runBoundedMigrationResolveRolledBack as unknown as (
      environment: NodeJS.ProcessEnv,
      backendRoot: string,
      dependencies: MigrationResolveDependencies,
      signal: AbortSignal,
      absoluteDeadlineAt: number | undefined,
      targetMigrationName: string,
    ) => Promise<number>;
  const databaseUrl =
    'postgresql://operator:synthetic@127.0.0.1:5432/hsk_media_recovery_test?schema=public';
  const exitCode = await runWithDependencies(
    {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
    },
    process.cwd(),
    {
      now: () => 1_000,
      runGuardedResolve: (_environment, _root, _deadline, signal) => {
        observedCancellation = signal?.aborted === true;
        return Promise.resolve({ kind: 'cancelled' });
      },
    },
    cancellation.signal,
    undefined,
    MEDIA_CLEANUP_AUDIT_MIGRATION,
  );

  assert.equal(observedCancellation, true);
  assert.equal(exitCode, BOUNDED_MIGRATION_EXIT_CODES.internalFailure);
});

void test('requires the same migration row identity in the resolve postcondition', () => {
  const assertPostconditions = requireResolvePostconditionAssertion();
  assert.throws(
    () =>
      assertPostconditions(
        {
          ...validResolvePostconditionState,
          targetMigrationId: '22222222-2222-4222-8222-222222222222',
        },
        validResolvePreconditionState.targetMigrationId,
      ),
    /resolve postcondition/iu,
  );
});

void test('kills a real stalled deploy process group with every descendant before any late mutation', async (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX process-group topology is required in production.');
    return;
  }
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), 'hsk-deploy-process-topology-'),
  );
  const pidsPath = join(temporaryRoot, 'pids');
  const lateMutationPath = join(temporaryRoot, 'late-mutation');
  const grandchildScript = String.raw`
const { writeFileSync } = require('node:fs');
process.on('SIGTERM', () => {});
setTimeout(() => writeFileSync(process.argv[1], 'late'), 800);
setInterval(() => {}, 1_000);
`;
  const childScript = String.raw`
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
process.on('SIGTERM', () => {});
const descendant = spawn(
  process.execPath,
  ['-e', ${JSON.stringify(grandchildScript)}, process.argv[2]],
  { stdio: 'ignore' },
);
writeFileSync(process.argv[1], process.pid + ',' + String(descendant.pid));
setInterval(() => {}, 1_000);
`;

  try {
    const supervisor = requireDeployProcessSupervisor();
    const result = await supervisor(
      process.execPath,
      ['-e', childScript, pidsPath, lateMutationPath],
      {
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 150,
        heartbeat: () => Promise.resolve(),
        heartbeatIntervalMs: 25,
        heartbeatTimeoutMs: 50,
        terminationGraceMs: 100,
      },
    );
    assert.equal(result.timedOut, true);
    const pids = readFileSync(pidsPath, 'utf8')
      .split(',')
      .map((value) => Number(value));
    assert.equal(pids.length, 2);
    for (const pid of pids) assertProcessDoesNotExist(pid);
    await delay(900);
    assert.equal(existsSync(lateMutationPath), false);
  } finally {
    if (existsSync(pidsPath)) {
      const [processGroupId] = readFileSync(pidsPath, 'utf8')
        .split(',')
        .map((value) => Number(value));
      try {
        process.kill(-processGroupId, 'SIGKILL');
      } catch {
        // The expected path has already reaped the complete process group.
      }
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

void test('fails closed when bounded migration timeout ordering is invalid', () => {
  assert.doesNotThrow(() =>
    validateBoundedMigrationTimeouts(BOUNDED_MIGRATION_TIMEOUTS_MS),
  );
  assert.throws(
    () =>
      validateBoundedMigrationTimeouts({
        ...BOUNDED_MIGRATION_TIMEOUTS_MS,
        lock: BOUNDED_MIGRATION_TIMEOUTS_MS.statement,
      }),
    /lock timeout must be smaller than statement timeout/iu,
  );
  assert.throws(
    () => buildBoundedMigrationEnvironment({}),
    /DATABASE_URL is required/iu,
  );
  assert.throws(
    () =>
      buildBoundedMigrationEnvironment({
        DATABASE_URL: 'mysql://operator:secret@db.internal/hsk',
      }),
    /valid PostgreSQL URL/iu,
  );
});

void test('uses the repository-local Prisma CLI and a distinct lock-timeout exit', () => {
  const prismaCli = resolveLocalPrismaCli();
  assert.equal(prismaCli, require.resolve('prisma/build/index.js'));
  assert.equal(
    classifyBoundedMigrationExitCode(
      'P3018 Database error code: 55P03 lock timeout',
      1,
      false,
    ),
    BOUNDED_MIGRATION_EXIT_CODES.lockTimeout,
  );
  for (const diagnostic of [
    'unrelated diagnostic: lock timeout policy invalid',
    'P3018 without a database SQLSTATE',
    '55P03 without a Prisma migration failure',
  ]) {
    assert.equal(classifyBoundedMigrationExitCode(diagnostic, 1, false), 1);
  }
  assert.equal(classifyBoundedMigrationExitCode('P3018 P0001', 1, false), 1);
  assert.equal(
    classifyBoundedMigrationExitCode(
      'P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp',
      1,
      false,
    ),
    BOUNDED_MIGRATION_EXIT_CODES.domainPreflight,
  );
  assert.equal(
    classifyBoundedMigrationExitCode('', null, true),
    BOUNDED_MIGRATION_EXIT_CODES.commandTimeout,
  );
  assert.equal(
    isPrismaFailedMigrationRetryBlock(
      'P3009 found failed migrations in the target database',
      1,
    ),
    true,
  );
  assert.equal(isPrismaFailedMigrationRetryBlock('P3009', 0), true);
  assert.equal(isPrismaFailedMigrationRetryBlock('P3018 P0001', 1), false);
});

void test('keeps current P3009 precedence over retained migration logs', () => {
  const current = 'P3009 found failed migrations in the target database';
  for (const childExitCode of [0, 1, 2, null]) {
    for (const retained of [
      '',
      'P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp',
      'P3018 Database error code: 55P03 lock timeout',
    ]) {
      assert.equal(
        classifyBoundedMigrationExitCode(
          `${current}\n${retained}`,
          childExitCode,
          false,
        ),
        1,
      );
    }
  }
});

void test('consults retained migration logs only for the exact transaction-aborted recovery branch', () => {
  const shouldInspect = (
    boundedMigrationDeployModule as BoundedMigrationDeployContract
  ).shouldInspectRetainedMigrationFailure;
  if (typeof shouldInspect !== 'function') {
    assert.fail(
      'Production deploy must expose its retained-log branch policy.',
    );
  }

  assert.equal(
    shouldInspect(
      'P3009 found failed migrations in the target database',
      1,
      false,
    ),
    false,
  );
  assert.equal(
    shouldInspect(
      'ERROR: current transaction is aborted, commands ignored until end of transaction block',
      1,
      false,
    ),
    true,
  );
  assert.equal(
    shouldInspect(
      [
        'Error: unrelated wrapper context',
        'Error: ERROR: current transaction is aborted, commands ignored until end of transaction block',
        'Prisma migration engine stopped',
      ].join('\n'),
      1,
      false,
    ),
    true,
  );
  assert.equal(
    shouldInspect(
      'unrelated prefix ERROR: current transaction is aborted, commands ignored until end of transaction block unrelated suffix',
      1,
      false,
    ),
    false,
  );
  assert.equal(
    shouldInspect(
      'P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp',
      1,
      false,
    ),
    false,
  );
  assert.equal(shouldInspect('unrelated migration error', 1, false), false);
  assert.equal(
    shouldInspect(
      'ERROR: current transaction is aborted, commands ignored until end of transaction block',
      0,
      false,
    ),
    false,
  );
  assert.equal(
    shouldInspect(
      'ERROR: current transaction is aborted, commands ignored until end of transaction block',
      1,
      true,
    ),
    false,
  );
});

void test('normalizes only an exact bounded timestamp-drift classification', () => {
  assert.equal(
    normalizeBoundedMigrationDomainPreflight(
      'P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp',
    ),
    'BOUNDED_MIGRATION_DOMAIN_PREFLIGHT P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp',
  );
  for (const diagnostic of [
    'P3018 P0001',
    'P3018 Media cleanup lifecycle lacks an exact authoritative audit timestamp',
    'P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp',
  ]) {
    assert.equal(
      normalizeBoundedMigrationDomainPreflight(diagnostic),
      undefined,
    );
  }

  const wrapperSource = readFileSync(
    resolve(
      process.cwd(),
      'scripts/operations/bounded-prisma-migrate-deploy.ts',
    ),
    'utf8',
  );
  assert.match(
    wrapperSource,
    /process\.stderr\.write\(`\$\{domainPreflightMarker\}\\n`\)/u,
  );
});

void test('pins a timestamp-drift fixture that reaches the authoritative timestamp branch', () => {
  const fixture = readFileSync(
    join(
      process.cwd(),
      'test/database/media-cleanup-audit-integrity-timestamp-drift.fixture.sql',
    ),
    'utf8',
  );
  assert.match(fixture, /media\.ingestion_cleanup_failed/u);
  assert.match(fixture, /cleanup_required_at \+ INTERVAL '1 millisecond'/u);
  assert.match(fixture, /OBJECT_CLEANUP_REQUIRED/u);
  assert.doesNotMatch(fixture, /media\.ingestion_failed/u);
});

void test('accepts only the two exact Prisma timestamp-drift abort shapes', () => {
  assert.deepEqual(
    classifyPrismaTimestampDriftAbort(
      1,
      'Error: ERROR: current transaction is aborted, commands ignored until end of transaction block',
    ),
    {
      exitCode: 1,
      engineDiagnostic: 'transaction-aborted',
      stage: 'prisma-migrate-deploy',
    },
  );
  assert.deepEqual(
    classifyPrismaTimestampDriftAbort(
      3,
      'BOUNDED_MIGRATION_DOMAIN_PREFLIGHT P3018 P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp',
    ),
    { exitCode: 3, prismaCode: 'P3018', sqlstate: 'P0001' },
  );

  for (const [exitCode, diagnostic] of [
    [0, 'current transaction is aborted'],
    [1, 'P3018 P0001'],
    [3, 'P3018 P0001'],
    [
      3,
      'P3018 Media cleanup lifecycle lacks an exact authoritative audit timestamp',
    ],
    [
      3,
      'P0001 Media cleanup lifecycle lacks an exact authoritative audit timestamp',
    ],
  ] as const) {
    assert.equal(
      classifyPrismaTimestampDriftAbort(exitCode, diagnostic),
      undefined,
    );
  }
});

void test('builds bounded PostgreSQL session timeouts for migration deploy', () => {
  assert.equal(
    buildPgOptions(),
    '-c lock_timeout=2000ms -c statement_timeout=30000ms -c idle_in_transaction_session_timeout=35000ms',
  );
});

void test('hashes the exact real migration directory catalog deterministically', () => {
  const root = resolve(process.cwd(), 'prisma/migrations');
  const first = readMigrationSourceCatalog(root);
  const second = readMigrationSourceCatalog(root);
  assert.deepEqual(second, first);
  const names = first.migrations.map(({ name }) => name);
  assert.deepEqual(
    names,
    readdirSync(root)
      .filter((entry) => entry !== 'migration_lock.toml')
      .sort((left, right) => left.localeCompare(right)),
  );
  const mediaPositions = [
    MEDIA_MIGRATION_NAMES.provenance,
    MEDIA_MIGRATION_NAMES.lifecycle,
    MEDIA_MIGRATION_NAMES.auditIntegrity,
  ].map((name) => names.indexOf(name));
  assert.ok(mediaPositions[0] >= 0);
  assert.deepEqual(mediaPositions, [
    mediaPositions[0],
    mediaPositions[0] + 1,
    mediaPositions[0] + 2,
  ]);
  assert.match(first.catalogChecksumSha256, /^[a-f0-9]{64}$/u);
});

void test('keeps every migration free of explicit transaction control (25P02)', () => {
  const root = resolve(process.cwd(), 'prisma/migrations');
  const { migrations } = readMigrationSourceCatalog(root);
  assert.ok(migrations.length > 0);
  for (const { name } of migrations) {
    const sql = readFileSync(join(root, name, 'migration.sql'), 'utf8');
    assert.doesNotMatch(
      sql,
      /^\s*(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)(?:\s+(?:WORK|TRANSACTION))?\s*;/imu,
      `${name} must let Prisma own the migration transaction.`,
    );
    assert.doesNotThrow(() => readRolledBackResolveTarget(process.cwd(), name));
  }
});

void test('derives resolve targets from the real source catalog', () => {
  const root = resolve(process.cwd(), 'prisma/migrations');
  const names = readMigrationSourceCatalog(root).migrations.map(
    ({ name }) => name,
  );
  const auditIntegrity = readRolledBackResolveTarget(
    process.cwd(),
    MEDIA_CLEANUP_AUDIT_MIGRATION,
  );
  assert.deepEqual(auditIntegrity, {
    migrationName: MEDIA_CLEANUP_AUDIT_MIGRATION,
    sourceChecksum: MEDIA_CLEANUP_AUDIT_CHECKSUM,
    predecessorMigrationCount: names.indexOf(MEDIA_CLEANUP_AUDIT_MIGRATION),
    guardsMediaCleanupAudit: true,
  });

  const latestName = names[names.length - 1];
  const latest = readRolledBackResolveTarget(process.cwd(), latestName);
  assert.equal(latest.predecessorMigrationCount, names.length - 1);
  assert.equal(
    latest.sourceChecksum,
    sha256(readFileSync(join(root, latestName, 'migration.sql'))),
  );
  assert.equal(
    latest.guardsMediaCleanupAudit,
    latestName === MEDIA_CLEANUP_AUDIT_MIGRATION,
  );

  for (const candidate of [
    '',
    '../20260813193000_media_cleanup_audit_integrity',
    '20260813193000_media_cleanup_audit_integrity; DROP TABLE x',
    '29991231235959_not_in_catalog',
  ]) {
    assert.throws(() => readRolledBackResolveTarget(process.cwd(), candidate));
  }
});

void test('rejects a resolve target whose source contains explicit transaction control', () => {
  const backendRoot = mkdtempSync(join(tmpdir(), 'hsk-resolve-target-'));
  try {
    const name = '20260101000000_explicit_transaction';
    mkdirSync(join(backendRoot, 'prisma/migrations', name), {
      recursive: true,
    });
    writeFileSync(
      join(backendRoot, 'prisma/migrations', name, 'migration.sql'),
      'BEGIN;\nCREATE TABLE "Example" (id INTEGER);\nCOMMIT;\n',
    );
    assert.throws(
      () => readRolledBackResolveTarget(backendRoot, name),
      /explicit transaction control/iu,
    );
    writeFileSync(
      join(backendRoot, 'prisma/migrations', name, 'migration.sql'),
      "DO $$\nBEGIN\n  RAISE NOTICE 'ok';\nEND;\n$$;\n",
    );
    assert.equal(
      readRolledBackResolveTarget(backendRoot, name).predecessorMigrationCount,
      0,
    );
  } finally {
    rmSync(backendRoot, { recursive: true, force: true });
  }
});

void test('requires an explicit resolve target migration argument', async () => {
  assert.equal(
    parseRolledBackResolveArguments([
      '--target-migration',
      MEDIA_CLEANUP_AUDIT_MIGRATION,
    ]),
    MEDIA_CLEANUP_AUDIT_MIGRATION,
  );
  assert.equal(
    parseRolledBackResolveArguments([
      `--target-migration=${MEDIA_CLEANUP_AUDIT_MIGRATION}`,
    ]),
    MEDIA_CLEANUP_AUDIT_MIGRATION,
  );
  for (const args of [
    [],
    ['--target-migration'],
    [MEDIA_CLEANUP_AUDIT_MIGRATION],
    ['--target-migration', MEDIA_CLEANUP_AUDIT_MIGRATION, '--force'],
  ]) {
    assert.equal(parseRolledBackResolveArguments(args), undefined);
  }

  let workerCalled = false;
  const dependencies: MigrationResolveDependencies = {
    now: () => 1_000,
    runGuardedResolve: () => {
      workerCalled = true;
      return Promise.resolve({ kind: 'internal' });
    },
  };
  for (const targetMigrationName of [null, '29991231235959_not_in_catalog']) {
    assert.equal(
      await runResolveWithDependencies(dependencies, targetMigrationName),
      BOUNDED_MIGRATION_EXIT_CODES.resolvePrecondition,
    );
  }
  assert.equal(workerCalled, false);
});

/* eslint-disable @typescript-eslint/require-await -- Promise-shaped test doubles model the async production boundary. */
void test('resolves a non-media target without locking media invariant tables', async () => {
  const target: RolledBackResolveTarget = {
    migrationName: '20260914090000_rate_limit_counter',
    sourceChecksum: 'a'.repeat(64),
    predecessorMigrationCount: 19,
    guardsMediaCleanupAudit: false,
  };
  const genericState: MigrationResolveState = {
    ...validResolvePreconditionState,
    targetMigrationName: target.migrationName,
    expectedSuccessfulMigrationCount: 19,
    successfulMigrationCount: 19,
  };
  const events: string[] = [];
  const queries: string[] = [];
  let stateReadCount = 0;
  const worker = requireGuardedResolveWorker(target);
  const outcome = await worker(
    { DATABASE_URL: 'postgresql://synthetic.invalid/hsk?schema=public' },
    process.cwd(),
    46_000,
    {
      now: () => 1_000,
      readSourceChecksum: (migrationName) => {
        assert.equal(migrationName, target.migrationName);
        return target.sourceChecksum;
      },
      runInTransaction: async (operation) =>
        operation({
          $queryRawUnsafe: async <T>(query: string): Promise<T> => {
            if (/pg_try_advisory_xact_lock/u.test(query)) {
              return [{ acquired: true }] as T;
            }
            queries.push(query);
            stateReadCount += 1;
            return [
              stateReadCount === 1
                ? genericState
                : {
                    ...genericState,
                    unresolvedTargetMigrationRowCount: 0,
                    unresolvedMigrationRowCount: 0,
                    rolledBackTargetMigrationRowCount: 1,
                  },
            ] as T;
          },
          $executeRawUnsafe: async (query, ...values) => {
            if (/LOCK TABLE "_prisma_migrations"/u.test(query)) {
              events.push('lock-history');
              return 0;
            }
            if (/UPDATE "_prisma_migrations"/u.test(query)) {
              events.push('mutation');
              assert.deepEqual(values, [
                genericState.targetMigrationId,
                target.migrationName,
                target.sourceChecksum,
              ]);
              return 1;
            }
            throw new Error(`unexpected statement: ${query}`);
          },
        }),
    },
  );

  assert.equal(outcome.kind, 'committed');
  assert.deepEqual(events, ['lock-history', 'mutation']);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query, /migration_name='20260914090000_rate_limit_counter'/u);
    assert.match(query, new RegExp(`checksum='${target.sourceChecksum}'`, 'u'));
    assert.doesNotMatch(query, /"AuditLog"|"MediaIngestion"/u);
  }
});
/* eslint-enable @typescript-eslint/require-await */

void test('widens statement-bound deadlines only through the bounded override', () => {
  assert.deepEqual(
    resolveBoundedMigrationTimeouts({}),
    BOUNDED_MIGRATION_TIMEOUTS_MS,
  );
  const widened = resolveBoundedMigrationTimeouts({
    MIGRATION_STATEMENT_TIMEOUT_MS: '600000',
  });
  assert.deepEqual(widened, {
    lock: 2_000,
    statement: 600_000,
    idleInTransaction: 605_000,
    command: 615_000,
  });
  assert.doesNotThrow(() => validateBoundedMigrationTimeouts(widened));
  assert.equal(
    new URL(
      buildBoundedMigrationEnvironment(
        {
          DATABASE_URL:
            'postgresql://operator:synthetic@db.internal:5432/hsk?schema=public',
        },
        widened,
      ).DATABASE_URL ?? '',
    ).searchParams.get('options'),
    '-c lock_timeout=2000ms -c statement_timeout=600000ms -c idle_in_transaction_session_timeout=605000ms',
  );
  for (const value of [
    '',
    '0',
    '2000',
    '-1',
    '1e6',
    '30000ms',
    ' 30000',
    '3600001',
  ]) {
    assert.throws(
      () =>
        resolveBoundedMigrationTimeouts({
          MIGRATION_STATEMENT_TIMEOUT_MS: value,
        }),
      /MIGRATION_STATEMENT_TIMEOUT_MS/u,
    );
  }
});

void test('observes a fast child exit without blocking the Node event loop', async () => {
  const child = spawn(
    process.execPath,
    ['-e', "process.stdout.write('ready')"],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const result = await waitForBoundedChild(child, 2_000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'ready');
  assert.equal(result.stderr, '');
});

void test('accepts only an exact zero-row migration preflight', () => {
  assert.doesNotThrow(() =>
    assertExactMigrationOnlyCounts({
      users: 0,
      media: 0,
      ingestions: 0,
      audits: 0,
    }),
  );
  for (const field of ['users', 'media', 'ingestions', 'audits'] as const) {
    const counts = { users: 0, media: 0, ingestions: 0, audits: 0 };
    counts[field] = 1;
    assert.throws(
      () => assertExactMigrationOnlyCounts(counts),
      /fresh migration-only disposable database/iu,
    );
  }
});

void test('classifies bounded migration failures without false-green timeouts', () => {
  assert.equal(
    classifyMigrationFailure('SQLSTATE 55P03 lock timeout'),
    'lock_timeout',
  );
  assert.equal(
    classifyMigrationFailure('SQLSTATE 57014 statement timeout'),
    'statement_timeout',
  );
  assert.equal(
    classifyMigrationFailure('SQLSTATE 25P03 idle-in-transaction timeout'),
    'idle_transaction_timeout',
  );
  assert.equal(
    classifyMigrationFailure('P0001 migration found malformed immutable audit'),
    'domain_preflight',
  );
  assert.equal(
    classifyMigrationFailure('P1001 connection refused'),
    'connection',
  );
  assert.equal(
    classifyMigrationFailure('SQLSTATE 23514 unexpected constraint'),
    'migration_error',
  );
});

void test('redacts database URLs and credential assignments', () => {
  const secret = 'do-not-leak-this-password';
  const diagnostic = redactMigrationDiagnostic(
    `postgresql://admin:${secret}@127.0.0.1:55439/hsk_test password=${secret}`,
  );
  assert.doesNotMatch(diagnostic, new RegExp(secret, 'u'));
  assert.doesNotMatch(diagnostic, /postgresql:\/\//u);
  assert.doesNotThrow(() => assertSafeEvidence({ diagnostic }));
  assert.doesNotThrow(() => assertSafeEvidence({ diagnostic }));
  assert.throws(
    () =>
      assertSafeEvidence({ databaseUrl: `postgresql://app:${secret}@db/x` }),
    /credential-bearing/iu,
  );
});

void test('confines machine evidence to the task-owned test-results root', () => {
  const root =
    '/workspace/backend/test-results/media-lifecycle-migration-validation';
  assert.equal(
    assertSafeEvidencePath(root, `${root}/upgrade-evidence.json`),
    `${root}/upgrade-evidence.json`,
  );
  assert.throws(
    () => assertSafeEvidencePath(root, `${root}/../escaped.json`),
    /task-owned test-results/iu,
  );
  assert.throws(
    () => assertSafeEvidencePath(root, root),
    /task-owned test-results/iu,
  );
  assert.throws(
    () => assertSafeEvidencePath(root, `${root}/evidence.txt`),
    /task-owned test-results/iu,
  );
});

void test('emits a non-secret database fingerprint', () => {
  const value = databaseFingerprint(
    'postgresql://admin:secret@127.0.0.1:55439/hsk_migration_test?schema=public',
  );
  assert.deepEqual(value, {
    hostFingerprintSha256: sha256('127.0.0.1:55439'),
    port: 55439,
    databaseName: 'hsk_migration_test',
    guardedTestSuffix: true,
  });
  assert.doesNotMatch(JSON.stringify(value), /admin|secret|postgresql/iu);
});

void test('parses only exact count and lock rows', () => {
  assert.deepEqual(parseCountRow('0|0|0|0\n'), {
    users: 0,
    media: 0,
    ingestions: 0,
    audits: 0,
  });
  assert.deepEqual(parseLockRow('2|1'), { granted: 2, waiting: 1 });
  assert.throws(() => parseCountRow('0|0|0'), /invalid count-only/iu);
  assert.throws(() => parseLockRow('1|-1'), /invalid count/iu);
});

void test('accepts only a separate loopback disposable public shadow database', () => {
  const primary =
    'postgresql://app:secret@127.0.0.1:55439/hsk_primary_test?schema=public';
  assert.deepEqual(
    assertSafeMigrationAuxiliaryDatabase(
      'postgresql://app:secret@127.0.0.1:55439/hsk_shadow_test?schema=public',
      primary,
      'MEDIA_MIGRATION_SHADOW_DATABASE_URL',
    ),
    {
      databaseName: 'hsk_shadow_test',
      host: '127.0.0.1',
      port: 55439,
      normalizedIdentity: '127.0.0.1:55439/hsk_shadow_test',
    },
  );
});

void test('rejects destructive shadow targets outside the guarded cluster policy', () => {
  const primary =
    'postgresql://app:secret@127.0.0.1:55439/hsk_primary_test?schema=public';
  for (const candidate of [
    primary,
    'postgresql://app:secret@prod.internal:55439/hsk_shadow_test?schema=public',
    'postgresql://app:secret@127.0.0.1:5432/hsk_shadow_test?schema=public',
    'postgresql://app:secret@127.0.0.1:55439/production?schema=public',
    'postgresql://app:secret@127.0.0.1:55439/hsk_shadow_test?schema=tenant',
    'postgresql://app:secret@127.0.0.1:55439/hsk_shadow_test?schema=public&schema=public',
    'postgresql://app:secret@127.0.0.1:55439/hsk_shadow_test?sslmode=require',
    'mysql://app:secret@127.0.0.1:55439/hsk_shadow_test',
  ]) {
    let message = '';
    try {
      assertSafeMigrationAuxiliaryDatabase(
        candidate,
        primary,
        'MEDIA_MIGRATION_SHADOW_DATABASE_URL',
      );
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.notEqual(message, '');
    assert.doesNotMatch(message, /postgresql:\/\/|app|secret/iu);
  }
});
