import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  BOUNDED_MIGRATION_EXIT_CODES,
  BOUNDED_MIGRATION_TIMEOUTS_MS,
  buildBoundedMigrationEnvironment,
} from './bounded-prisma-migrate-deploy';

export const MEDIA_CLEANUP_AUDIT_MIGRATION =
  '20260813193000_media_cleanup_audit_integrity' as const;
export const MEDIA_CLEANUP_AUDIT_CHECKSUM =
  '7b1e8e12bb6040bee629e702d217f54880d41dd7ffb962e3bf89b4cdca6adb08' as const;

const MIGRATION_NAME_PATTERN = /^\d{14}_[a-z0-9_]+$/u;
// Prisma wraps each migration.sql in one implicit transaction. Explicit
// transaction control inside the file breaks that atomicity (25P02), so a
// resolve target must not contain it.
const EXPLICIT_TRANSACTION_CONTROL =
  /^\s*(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)(?:\s+(?:WORK|TRANSACTION))?\s*;/imu;

// The cleanup-audit predicate is expanded inline because a failed
// media-cleanup-audit migration must leave all of its functions absent.
const VALID_CLEANUP_AUDIT_PREDICATE = String.raw`EXISTS (
  SELECT 1
  FROM "MediaIngestion" candidate
  WHERE audit.action IN (
      'media.ingestion_failed',
      'media.ingestion_cleanup_failed',
      'media.ingestion_cleanup_settling'
    )
    AND audit."targetType"='media_ingestion'
    AND candidate.id=CASE
      WHEN audit."targetId" ~ '^[1-9][0-9]{0,9}$'
        AND audit."targetId"::numeric <= 2147483647
      THEN audit."targetId"::integer
      ELSE NULL
    END
    AND audit."targetId"=candidate.id::text
    AND jsonb_typeof(audit."afterSummary")='object'
    AND jsonb_typeof(audit."afterSummary" -> 'ingestionId')='number'
    AND audit."afterSummary" ->> 'ingestionId'=candidate.id::text
    AND jsonb_typeof(audit."afterSummary" -> 'status')='string'
    AND jsonb_typeof(audit."afterSummary" -> 'failureCode')='string'
    AND length(audit."afterSummary" ->> 'failureCode') > 0
    AND audit."createdAt" >= candidate."startedAt"
    AND audit."createdAt" <= clock_timestamp()::timestamp(3)
    AND (
      (
        audit.action='media.ingestion_failed'
        AND (
          (
            audit."afterSummary" ->> 'status'='cleanup_required'
            AND audit."afterSummary" ->> 'failureCode' IN (
              'OBJECT_WRITE_OUTCOME_UNKNOWN',
              'OBJECT_CLEANUP_REQUIRED',
              'OBJECT_CLEANUP_SETTLING'
            )
            AND candidate."cleanupRequiredAt" IS NOT NULL
            AND audit."createdAt"=candidate."cleanupRequiredAt"
            AND (
              candidate.status='cleanup_required'
              OR (
                candidate.status='processing'
                AND candidate."failureCode"='OBJECT_CLEANUP_IN_PROGRESS'
              )
              OR (
                candidate.status='failed'
                AND candidate."failureCode"='OBJECT_CLEANED'
              )
            )
          )
          OR (
            audit."afterSummary" ->> 'status'='failed'
            AND audit."afterSummary" ->> 'failureCode' NOT IN (
              'OBJECT_WRITE_OUTCOME_UNKNOWN',
              'OBJECT_CLEANUP_REQUIRED',
              'OBJECT_CLEANUP_SETTLING',
              'OBJECT_CLEANUP_IN_PROGRESS',
              'OBJECT_CLEANED'
            )
          )
        )
      )
      OR (
        audit.action='media.ingestion_cleanup_failed'
        AND audit."afterSummary" ->> 'status'='cleanup_required'
        AND audit."afterSummary" ->> 'failureCode'='OBJECT_CLEANUP_REQUIRED'
        AND candidate."cleanupRequiredAt" IS NOT NULL
        AND audit."createdAt" >= candidate."cleanupRequiredAt"
        AND (
          candidate.status='cleanup_required'
          OR (
            candidate.status='processing'
            AND candidate."failureCode"='OBJECT_CLEANUP_IN_PROGRESS'
          )
          OR (
            candidate.status='failed'
            AND candidate."failureCode"='OBJECT_CLEANED'
          )
        )
      )
      OR (
        audit.action='media.ingestion_cleanup_settling'
        AND audit."afterSummary" ->> 'status'='cleanup_required'
        AND audit."afterSummary" ->> 'failureCode'='OBJECT_CLEANUP_SETTLING'
        AND candidate."cleanupRequiredAt" IS NOT NULL
        AND audit."createdAt" >= candidate."cleanupRequiredAt"
        AND (
          candidate.status='cleanup_required'
          OR (
            candidate.status='processing'
            AND candidate."failureCode"='OBJECT_CLEANUP_IN_PROGRESS'
          )
          OR (
            candidate.status='failed'
            AND candidate."failureCode"='OBJECT_CLEANED'
          )
        )
      )
    )
)`;

export type RolledBackResolveTarget = {
  migrationName: string;
  sourceChecksum: string;
  predecessorMigrationCount: number;
  guardsMediaCleanupAudit: boolean;
};

export function readRolledBackResolveTarget(
  backendRoot: string,
  migrationName: string,
): RolledBackResolveTarget {
  if (!MIGRATION_NAME_PATTERN.test(migrationName)) {
    throw new Error('Migration resolve target name is invalid.');
  }
  const migrationsRoot = resolve(backendRoot, 'prisma/migrations');
  const catalog = readdirSync(migrationsRoot)
    .filter((entry) => MIGRATION_NAME_PATTERN.test(entry))
    .sort((left, right) => left.localeCompare(right));
  const predecessorMigrationCount = catalog.indexOf(migrationName);
  if (predecessorMigrationCount < 0) {
    throw new Error('Migration resolve target is not in the source catalog.');
  }
  const source = readFileSync(
    resolve(migrationsRoot, migrationName, 'migration.sql'),
  );
  if (EXPLICIT_TRANSACTION_CONTROL.test(source.toString('utf8'))) {
    throw new Error(
      'Migration resolve target contains explicit transaction control.',
    );
  }
  const sourceChecksum = sha256(source);
  const guardsMediaCleanupAudit =
    migrationName === MEDIA_CLEANUP_AUDIT_MIGRATION;
  if (
    guardsMediaCleanupAudit &&
    sourceChecksum !== MEDIA_CLEANUP_AUDIT_CHECKSUM
  ) {
    throw new Error('Migration resolve target source checksum is not pinned.');
  }
  return {
    migrationName,
    sourceChecksum,
    predecessorMigrationCount,
    guardsMediaCleanupAudit,
  };
}

function assertRolledBackResolveTargetShape(
  target: RolledBackResolveTarget,
): void {
  if (
    !MIGRATION_NAME_PATTERN.test(target.migrationName) ||
    !/^[a-f0-9]{64}$/u.test(target.sourceChecksum) ||
    !Number.isSafeInteger(target.predecessorMigrationCount) ||
    target.predecessorMigrationCount < 0
  ) {
    throw new Error('Migration resolve target is invalid.');
  }
}

const MEDIA_CLEANUP_AUDIT_RESIDUE_QUERY = String.raw`
  (SELECT COUNT(*)
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public'
      AND procedure.proname IN (
        'hsk_is_valid_media_cleanup_audit',
        'hsk_is_valid_current_media_cleanup_audit',
        'hsk_guard_media_cleanup_audit',
        'hsk_require_media_cleanup_audit'
      )) AS "cleanupAuditFunctionCount",
  (SELECT COUNT(*)
    FROM pg_trigger trigger
    JOIN pg_class relation ON relation.oid=trigger.tgrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public'
      AND NOT trigger.tgisinternal
      AND (
        (relation.relname='AuditLog'
          AND trigger.tgname='AuditLog_media_cleanup_integrity')
        OR
        (relation.relname='MediaIngestion'
          AND trigger.tgname='MediaIngestion_cleanup_audit_required')
      )) AS "cleanupAuditTriggerCount",
  (SELECT
    (SELECT COUNT(*)
      FROM "AuditLog" audit
      WHERE audit.action IN (
        'media.ingestion_failed',
        'media.ingestion_cleanup_failed',
        'media.ingestion_cleanup_settling'
      )
      AND NOT (${VALID_CLEANUP_AUDIT_PREDICATE}))
    +
    (SELECT COUNT(*)
      FROM "MediaIngestion" ingestion
      WHERE ingestion."cleanupRequiredAt" IS NOT NULL
        AND (
          ingestion."cleanupRequiredAt" > clock_timestamp()::timestamp(3)
          OR NOT EXISTS (
            SELECT 1
            FROM "AuditLog" audit
            WHERE audit."targetType"='media_ingestion'
              AND audit."targetId"=ingestion.id::text
              AND audit."createdAt"=ingestion."cleanupRequiredAt"
              AND audit."afterSummary" ->> 'status'='cleanup_required'
              AND (${VALID_CLEANUP_AUDIT_PREDICATE})
          )
        ))) AS "authoritativeInvariantViolationCount"
`;

// Other targets have no domain residue probe: PostgreSQL rolls back the whole
// implicit migration transaction, and their tables may not exist yet.
const NO_DOMAIN_RESIDUE_QUERY = String.raw`
  0 AS "cleanupAuditFunctionCount",
  0 AS "cleanupAuditTriggerCount",
  0 AS "authoritativeInvariantViolationCount"
`;

function buildResolveStateQuery(target: RolledBackResolveTarget): string {
  assertRolledBackResolveTargetShape(target);
  const name = target.migrationName;
  return String.raw`
SELECT
  (SELECT id FROM "_prisma_migrations"
    WHERE migration_name='${name}'
    ORDER BY started_at, id LIMIT 1) AS "targetMigrationId",
  (SELECT COUNT(*) FROM "_prisma_migrations"
    WHERE migration_name='${name}') AS "targetMigrationRowCount",
  (SELECT COUNT(*) FROM "_prisma_migrations"
    WHERE migration_name='${name}'
      AND finished_at IS NULL AND rolled_back_at IS NULL) AS "unresolvedTargetMigrationRowCount",
  (SELECT COUNT(*) FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS "unresolvedMigrationRowCount",
  (SELECT COUNT(*) FROM "_prisma_migrations"
    WHERE migration_name='${name}'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS "finishedTargetMigrationRowCount",
  (SELECT COUNT(*) FROM "_prisma_migrations"
    WHERE migration_name='${name}'
      AND rolled_back_at IS NOT NULL) AS "rolledBackTargetMigrationRowCount",
  (SELECT COUNT(*) FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS "successfulMigrationCount",
  COALESCE((SELECT bool_and(checksum='${target.sourceChecksum}')
    FROM "_prisma_migrations"
    WHERE migration_name='${name}'), false) AS "targetChecksumMatches",
${
  target.guardsMediaCleanupAudit
    ? MEDIA_CLEANUP_AUDIT_RESIDUE_QUERY
    : NO_DOMAIN_RESIDUE_QUERY
}`;
}

function buildResolveStateScript(target: RolledBackResolveTarget): string {
  return String.raw`
const { PrismaClient } = require('@prisma/client');
const client = new PrismaClient();
(async () => {
  try {
    const rows = await client.$queryRawUnsafe(${JSON.stringify(
      buildResolveStateQuery(target),
    )});
    if (rows.length !== 1) throw new Error('unexpected resolve state row count');
    const row = Object.fromEntries(
      Object.entries(rows[0]).map(([key, value]) => [
        key,
        typeof value === 'bigint' ? Number(value) : value,
      ]),
    );
    process.stdout.write(JSON.stringify(row));
  } catch {
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
})();
`;
}

export type MigrationResolveState = {
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

type ResolveStateRow = Omit<
  MigrationResolveState,
  | 'targetMigrationName'
  | 'expectedSuccessfulMigrationCount'
  | 'sourceChecksumMatches'
>;

export type MigrationResolveDependencies = {
  now: () => number;
  runGuardedResolve: (
    environment: NodeJS.ProcessEnv,
    backendRoot: string,
    deadlineAt: number,
    signal: AbortSignal | undefined,
    target: RolledBackResolveTarget,
  ) => Promise<MigrationResolveWorkerOutcome>;
};

export type MigrationResolveWorkerOutcome =
  | { kind: 'unsafe'; state?: MigrationResolveState }
  | { kind: 'internal' }
  | { kind: 'deadline' }
  | { kind: 'cancelled' }
  | { kind: 'committed'; state: MigrationResolveState };

export type MigrationResolveTransactionDecision =
  | Exclude<MigrationResolveWorkerOutcome, { kind: 'committed' }>
  | { kind: 'commit'; state: MigrationResolveState };

export type MigrationResolveTransaction = {
  $queryRawUnsafe: <T = unknown>(query: string) => Promise<T>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
};

export type MigrationResolveWorkerDependencies = {
  now: () => number;
  readSourceChecksum: (migrationName: string) => string;
  runInTransaction: (
    operation: (
      transaction: MigrationResolveTransaction,
    ) => Promise<MigrationResolveTransactionDecision>,
    timeoutMs: number,
  ) => Promise<MigrationResolveTransactionDecision>;
};

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseDatabaseTarget(databaseUrl: string): {
  hostname: string;
  port: string;
  databaseName: string;
  schema: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Migration resolve target guard rejected DATABASE_URL.');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Migration resolve target guard rejected DATABASE_URL.');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!parsed.hostname || !databaseName || databaseName.includes('/')) {
    throw new Error('Migration resolve target guard rejected DATABASE_URL.');
  }
  return {
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port || '5432',
    databaseName,
    schema: parsed.searchParams.get('schema') || 'public',
  };
}

function normalizedDatabaseTarget(databaseUrl: string): string {
  const target = parseDatabaseTarget(databaseUrl);
  return `${target.hostname}:${target.port}/${target.databaseName}/${target.schema}`;
}

export function migrationResolveTargetSha256(databaseUrl: string): string {
  return sha256(normalizedDatabaseTarget(databaseUrl));
}

export function assertMigrationResolveTarget(
  environment: NodeJS.ProcessEnv,
): void {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Migration resolve target guard requires DATABASE_URL.');
  }
  const target = parseDatabaseTarget(databaseUrl);
  if (target.schema !== 'public') {
    throw new Error(
      'Migration resolve target guard requires the public schema.',
    );
  }

  if (environment.NODE_ENV === 'test') {
    const expectedUrl = environment.TEST_DATABASE_URL;
    const loopbackHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
    if (
      !expectedUrl ||
      !loopbackHosts.has(target.hostname) ||
      !target.databaseName.endsWith('_test') ||
      normalizedDatabaseTarget(databaseUrl) !==
        normalizedDatabaseTarget(expectedUrl)
    ) {
      throw new Error(
        'Migration resolve target guard requires the exact loopback *_test target.',
      );
    }
    return;
  }

  if (environment.NODE_ENV !== 'production') {
    throw new Error(
      'Migration resolve target guard requires NODE_ENV=test or production.',
    );
  }
  const expectedTargetSha256 =
    environment.MEDIA_MIGRATION_EXPECTED_TARGET_SHA256;
  if (
    !expectedTargetSha256 ||
    !/^[a-f0-9]{64}$/u.test(expectedTargetSha256) ||
    expectedTargetSha256 !== migrationResolveTargetSha256(databaseUrl)
  ) {
    throw new Error(
      'Migration resolve target guard rejected the production target fingerprint.',
    );
  }
}

function isResolveState(value: unknown): value is ResolveStateRow {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  const counts = [
    'targetMigrationRowCount',
    'unresolvedTargetMigrationRowCount',
    'unresolvedMigrationRowCount',
    'finishedTargetMigrationRowCount',
    'rolledBackTargetMigrationRowCount',
    'successfulMigrationCount',
    'cleanupAuditFunctionCount',
    'cleanupAuditTriggerCount',
    'authoritativeInvariantViolationCount',
  ];
  return (
    counts.every(
      (key) => Number.isSafeInteger(state[key]) && Number(state[key]) >= 0,
    ) &&
    typeof state.targetChecksumMatches === 'boolean' &&
    (state.targetMigrationId === null ||
      (typeof state.targetMigrationId === 'string' &&
        state.targetMigrationId.length > 0 &&
        state.targetMigrationId.length <= 128))
  );
}

function withResolveTarget(
  row: ResolveStateRow,
  target: RolledBackResolveTarget,
  sourceChecksumMatches: boolean,
): MigrationResolveState {
  // Expected values come from the source catalog, never from the database row.
  return {
    ...row,
    targetMigrationName: target.migrationName,
    expectedSuccessfulMigrationCount: target.predecessorMigrationCount,
    sourceChecksumMatches,
  };
}

function resolveStateFromRows(
  rows: unknown,
  target: RolledBackResolveTarget,
  sourceChecksumMatches: boolean,
): MigrationResolveState {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) {
    throw new Error('Migration resolve state query returned invalid data.');
  }
  const normalized = Object.fromEntries(
    Object.entries(rows[0] as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === 'bigint' ? Number(value) : value,
    ]),
  );
  if (!isResolveState(normalized)) {
    throw new Error('Migration resolve state query returned invalid data.');
  }
  return withResolveTarget(normalized, target, sourceChecksumMatches);
}

export function readMigrationResolveState(
  environment: NodeJS.ProcessEnv,
  backendRoot: string,
  target: RolledBackResolveTarget,
): MigrationResolveState {
  const script = buildResolveStateScript(target);
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: backendRoot,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    timeout: Math.min(10_000, BOUNDED_MIGRATION_TIMEOUTS_MS.command),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.error) {
    throw new Error('Migration resolve state query failed.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout ?? '');
  } catch {
    throw new Error('Migration resolve state query returned invalid data.');
  }
  if (!isResolveState(parsed)) {
    throw new Error('Migration resolve state query returned invalid data.');
  }

  const sourceChecksumMatches =
    sha256(readFileSync(sourceMigrationPath(backendRoot, target))) ===
    target.sourceChecksum;
  return withResolveTarget(parsed, target, sourceChecksumMatches);
}

export function summarizeMigrationResolveState(
  state: MigrationResolveState,
): string {
  return [
    `target=${state.targetMigrationName}`,
    `target_rows=${String(state.targetMigrationRowCount)}`,
    `unresolved_target=${String(state.unresolvedTargetMigrationRowCount)}`,
    `unresolved_total=${String(state.unresolvedMigrationRowCount)}`,
    `finished_target=${String(state.finishedTargetMigrationRowCount)}`,
    `rolled_back_target=${String(state.rolledBackTargetMigrationRowCount)}`,
    `successful=${String(state.successfulMigrationCount)}`,
    `expected_successful=${String(state.expectedSuccessfulMigrationCount)}`,
    `target_checksum=${state.targetChecksumMatches ? 'match' : 'mismatch'}`,
    `source_checksum=${state.sourceChecksumMatches ? 'match' : 'mismatch'}`,
    `functions=${String(state.cleanupAuditFunctionCount)}`,
    `triggers=${String(state.cleanupAuditTriggerCount)}`,
    `invariant_violations=${String(
      state.authoritativeInvariantViolationCount,
    )}`,
  ].join(' ');
}

export function assertMigrationResolvePreconditions(
  state: MigrationResolveState,
): void {
  if (
    state.targetMigrationId === null ||
    state.targetMigrationRowCount !== 1 ||
    state.unresolvedTargetMigrationRowCount !== 1 ||
    state.unresolvedMigrationRowCount !== 1 ||
    state.finishedTargetMigrationRowCount !== 0 ||
    state.rolledBackTargetMigrationRowCount !== 0 ||
    !Number.isSafeInteger(state.expectedSuccessfulMigrationCount) ||
    state.successfulMigrationCount !== state.expectedSuccessfulMigrationCount ||
    state.targetChecksumMatches !== true ||
    state.sourceChecksumMatches !== true ||
    state.cleanupAuditFunctionCount !== 0 ||
    state.cleanupAuditTriggerCount !== 0 ||
    state.authoritativeInvariantViolationCount !== 0
  ) {
    throw new Error(
      `Migration resolve precondition rejected state: ${summarizeMigrationResolveState(
        state,
      )}`,
    );
  }
}

export function assertMigrationResolvePostconditions(
  state: MigrationResolveState,
  expectedTargetMigrationId?: string | null,
): void {
  if (
    state.targetMigrationId === null ||
    (expectedTargetMigrationId !== undefined &&
      state.targetMigrationId !== expectedTargetMigrationId) ||
    state.targetMigrationRowCount !== 1 ||
    state.unresolvedTargetMigrationRowCount !== 0 ||
    state.unresolvedMigrationRowCount !== 0 ||
    state.finishedTargetMigrationRowCount !== 0 ||
    state.rolledBackTargetMigrationRowCount !== 1 ||
    !Number.isSafeInteger(state.expectedSuccessfulMigrationCount) ||
    state.successfulMigrationCount !== state.expectedSuccessfulMigrationCount ||
    state.targetChecksumMatches !== true ||
    state.sourceChecksumMatches !== true ||
    state.cleanupAuditFunctionCount !== 0 ||
    state.cleanupAuditTriggerCount !== 0 ||
    state.authoritativeInvariantViolationCount !== 0
  ) {
    throw new Error(
      `Migration resolve postcondition rejected state: ${summarizeMigrationResolveState(
        state,
      )}`,
    );
  }
}

const PRISMA_MIGRATION_ADVISORY_LOCK_QUERY =
  'SELECT pg_try_advisory_xact_lock(72707369) AS "acquired"';
const PRISMA_MIGRATION_HISTORY_GUARD_LOCK =
  'LOCK TABLE "_prisma_migrations" IN SHARE ROW EXCLUSIVE MODE';
const MEDIA_INGESTION_GUARD_LOCK =
  'LOCK TABLE "MediaIngestion" IN SHARE ROW EXCLUSIVE MODE';
const AUDIT_LOG_GUARD_LOCK =
  'LOCK TABLE "AuditLog" IN SHARE ROW EXCLUSIVE MODE';
const MARK_TARGET_MIGRATION_ROLLED_BACK_QUERY = String.raw`
UPDATE "_prisma_migrations"
SET rolled_back_at = clock_timestamp()
WHERE id = $1
  AND migration_name = $2
  AND checksum = $3
  AND finished_at IS NULL
  AND rolled_back_at IS NULL
`;
const RESOLVE_TRANSACTION_SHUTDOWN_RESERVE_MS = 250;

function sourceMigrationPath(
  backendRoot: string,
  target: RolledBackResolveTarget,
): string {
  assertRolledBackResolveTargetShape(target);
  return resolve(
    backendRoot,
    'prisma/migrations',
    target.migrationName,
    'migration.sql',
  );
}

function isPostgresLockTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    meta?: { code?: unknown };
  };
  return candidate.code === '55P03' || candidate.meta?.code === '55P03';
}

function remainingDeadlineMs(
  deadlineAt: number,
  now: () => number,
  reserveMs = 0,
): number {
  return Math.floor(deadlineAt - now() - reserveMs);
}

function defaultResolveWorkerDependencies(
  environment: NodeJS.ProcessEnv,
  backendRoot: string,
): MigrationResolveWorkerDependencies {
  return {
    now: Date.now,
    readSourceChecksum: (migrationName) =>
      sha256(
        readFileSync(
          resolve(
            backendRoot,
            'prisma/migrations',
            migrationName,
            'migration.sql',
          ),
        ),
      ),
    runInTransaction: async (operation, timeoutMs) => {
      const client = new PrismaClient({
        datasources: { db: { url: environment.DATABASE_URL } },
      });
      let decision: MigrationResolveTransactionDecision | undefined;
      let committedMutation = false;
      let transactionFailed = false;
      let transactionError: unknown;
      try {
        decision = await client.$transaction(
          async (transaction) =>
            operation(transaction as unknown as MigrationResolveTransaction),
          {
            maxWait: Math.min(BOUNDED_MIGRATION_TIMEOUTS_MS.lock, timeoutMs),
            timeout: timeoutMs,
            isolationLevel: 'ReadCommitted',
          },
        );
        committedMutation = decision.kind === 'commit';
      } catch (error: unknown) {
        transactionFailed = true;
        transactionError = error;
      }
      try {
        await client.$disconnect();
      } catch (error: unknown) {
        // Once Prisma has acknowledged COMMIT, connection cleanup cannot turn
        // that durable mutation back into a reported cancellation/failure.
        if (!committedMutation && !transactionFailed) {
          transactionFailed = true;
          transactionError = error;
        }
      }
      if (transactionFailed) throw transactionError;
      if (!decision) {
        throw new Error('Migration resolve transaction returned no decision.');
      }
      return decision;
    },
  };
}

function isAdvisoryLockResult(
  value: unknown,
): value is Array<{ acquired: boolean }> {
  return (
    Array.isArray(value) &&
    value.length === 1 &&
    value[0] !== null &&
    typeof value[0] === 'object' &&
    typeof (value[0] as { acquired?: unknown }).acquired === 'boolean'
  );
}

export async function runGuardedMigrationResolveWorker(
  environment: NodeJS.ProcessEnv,
  backendRoot: string,
  deadlineAt: number,
  dependencies: MigrationResolveWorkerDependencies | undefined,
  signal: AbortSignal | undefined,
  target: RolledBackResolveTarget,
): Promise<MigrationResolveWorkerOutcome> {
  if (signal?.aborted) return { kind: 'cancelled' };
  if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= 0) {
    return { kind: 'internal' };
  }
  let stateQuery: string;
  try {
    stateQuery = buildResolveStateQuery(target);
  } catch {
    return { kind: 'unsafe' };
  }
  const effectiveDependencies =
    dependencies ?? defaultResolveWorkerDependencies(environment, backendRoot);
  const transactionTimeoutMs = remainingDeadlineMs(
    deadlineAt,
    effectiveDependencies.now,
    RESOLVE_TRANSACTION_SHUTDOWN_RESERVE_MS,
  );
  if (transactionTimeoutMs <= 0) return { kind: 'deadline' };

  try {
    const decision = await effectiveDependencies.runInTransaction(
      async (transaction) => {
        const advisoryLock = await transaction.$queryRawUnsafe(
          PRISMA_MIGRATION_ADVISORY_LOCK_QUERY,
        );
        if (!isAdvisoryLockResult(advisoryLock)) return { kind: 'internal' };
        if (!advisoryLock[0].acquired) return { kind: 'unsafe' };

        try {
          await transaction.$executeRawUnsafe(
            PRISMA_MIGRATION_HISTORY_GUARD_LOCK,
          );
          if (target.guardsMediaCleanupAudit) {
            await transaction.$executeRawUnsafe(MEDIA_INGESTION_GUARD_LOCK);
            await transaction.$executeRawUnsafe(AUDIT_LOG_GUARD_LOCK);
          }
        } catch (error: unknown) {
          if (isPostgresLockTimeout(error)) return { kind: 'unsafe' };
          return { kind: 'internal' };
        }

        const sourceChecksumMatches =
          effectiveDependencies.readSourceChecksum(target.migrationName) ===
          target.sourceChecksum;
        let preconditionState: MigrationResolveState;
        try {
          preconditionState = resolveStateFromRows(
            await transaction.$queryRawUnsafe(stateQuery),
            target,
            sourceChecksumMatches,
          );
        } catch {
          return { kind: 'internal' };
        }
        try {
          assertMigrationResolvePreconditions(preconditionState);
        } catch {
          return { kind: 'unsafe', state: preconditionState };
        }

        const mutationDeadlineMs = remainingDeadlineMs(
          deadlineAt,
          effectiveDependencies.now,
          RESOLVE_TRANSACTION_SHUTDOWN_RESERVE_MS,
        );
        if (mutationDeadlineMs <= 0) return { kind: 'deadline' };
        if (signal?.aborted) return { kind: 'cancelled' };

        const mutatedRows = await transaction.$executeRawUnsafe(
          MARK_TARGET_MIGRATION_ROLLED_BACK_QUERY,
          preconditionState.targetMigrationId,
          target.migrationName,
          target.sourceChecksum,
        );
        if (mutatedRows !== 1) {
          throw new Error(
            'Migration resolve history mutation did not update exactly one row.',
          );
        }

        // Any failure after the history mutation must reject the transaction so
        // Prisma rolls it back instead of committing an unverified resolve.
        if (signal?.aborted) {
          throw new Error(
            'Migration resolve cancelled after history mutation.',
          );
        }
        if (
          remainingDeadlineMs(
            deadlineAt,
            effectiveDependencies.now,
            RESOLVE_TRANSACTION_SHUTDOWN_RESERVE_MS,
          ) <= 0
        ) {
          throw new Error('Migration resolve deadline expired after mutation.');
        }

        const postconditionState = resolveStateFromRows(
          await transaction.$queryRawUnsafe(stateQuery),
          target,
          effectiveDependencies.readSourceChecksum(target.migrationName) ===
            target.sourceChecksum,
        );
        assertMigrationResolvePostconditions(
          postconditionState,
          preconditionState.targetMigrationId,
        );
        if (signal?.aborted) {
          throw new Error(
            'Migration resolve cancelled before guarded transaction commit.',
          );
        }
        if (
          remainingDeadlineMs(
            deadlineAt,
            effectiveDependencies.now,
            RESOLVE_TRANSACTION_SHUTDOWN_RESERVE_MS,
          ) <= 0
        ) {
          throw new Error(
            'Migration resolve deadline expired before transaction commit.',
          );
        }
        // Returning this decision is the irrevocable boundary: Prisma now owns
        // COMMIT. The worker reports success only after $transaction resolves.
        return { kind: 'commit', state: postconditionState };
      },
      transactionTimeoutMs,
    );
    return decision.kind === 'commit'
      ? { kind: 'committed', state: decision.state }
      : decision;
  } catch {
    if (
      remainingDeadlineMs(deadlineAt, effectiveDependencies.now) <=
      RESOLVE_TRANSACTION_SHUTDOWN_RESERVE_MS
    ) {
      return { kind: 'deadline' };
    }
    return signal?.aborted ? { kind: 'cancelled' } : { kind: 'internal' };
  }
}

export function selectMigrationResolveProcessExitCode(
  resolveExitCode: number,
  signalExitCode?: number,
): number {
  return resolveExitCode === 0 ? 0 : (signalExitCode ?? resolveExitCode);
}

function defaultResolveDependencies(): MigrationResolveDependencies {
  return {
    now: Date.now,
    runGuardedResolve: (environment, backendRoot, deadlineAt, signal, target) =>
      runGuardedMigrationResolveWorker(
        environment,
        backendRoot,
        deadlineAt,
        undefined,
        signal,
        target,
      ),
  };
}

export async function runBoundedMigrationResolveRolledBack(
  environment: NodeJS.ProcessEnv = process.env,
  backendRoot = process.cwd(),
  dependencies?: MigrationResolveDependencies,
  signal?: AbortSignal,
  absoluteDeadlineAt?: number,
  targetMigrationName?: string,
): Promise<number> {
  const effectiveDependencies = dependencies ?? defaultResolveDependencies();
  const deadlineAt =
    absoluteDeadlineAt ??
    effectiveDependencies.now() + BOUNDED_MIGRATION_TIMEOUTS_MS.command;
  try {
    assertMigrationResolveTarget(environment);
  } catch {
    process.stderr.write(
      'Bounded Prisma migration resolve aborted: target guard rejected the request.\n',
    );
    return Promise.resolve(BOUNDED_MIGRATION_EXIT_CODES.resolvePrecondition);
  }

  let target: RolledBackResolveTarget;
  try {
    if (targetMigrationName === undefined) {
      throw new Error('Migration resolve target is required.');
    }
    target = readRolledBackResolveTarget(backendRoot, targetMigrationName);
  } catch {
    process.stderr.write(
      'Bounded Prisma migration resolve aborted: target migration is missing, unknown, unpinned or contains explicit transaction control.\n',
    );
    return Promise.resolve(BOUNDED_MIGRATION_EXIT_CODES.resolvePrecondition);
  }

  let boundedEnvironment: NodeJS.ProcessEnv;
  try {
    boundedEnvironment = buildBoundedMigrationEnvironment(environment);
  } catch {
    process.stderr.write(
      'Bounded Prisma migration resolve aborted: bounded environment is invalid.\n',
    );
    return Promise.resolve(BOUNDED_MIGRATION_EXIT_CODES.resolvePrecondition);
  }
  const remainingMs = remainingDeadlineMs(
    deadlineAt,
    effectiveDependencies.now,
  );
  if (remainingMs <= 0) {
    process.stderr.write(
      'Bounded Prisma migration resolve aborted: command deadline exceeded.\n',
    );
    return Promise.resolve(BOUNDED_MIGRATION_EXIT_CODES.commandTimeout);
  }

  const cancellation = new AbortController();
  let deadlineExpired = false;
  const deadlineTimer = setTimeout(() => {
    deadlineExpired = true;
    cancellation.abort(new Error('resolve deadline'));
  }, remainingMs);
  const externalAbort = (): void =>
    cancellation.abort(new Error('resolve cancellation'));
  if (signal?.aborted) externalAbort();
  signal?.addEventListener('abort', externalAbort, { once: true });

  let outcome: MigrationResolveWorkerOutcome;
  try {
    outcome = await effectiveDependencies.runGuardedResolve(
      boundedEnvironment,
      backendRoot,
      deadlineAt,
      cancellation.signal,
      target,
    );
  } catch {
    outcome = deadlineExpired ? { kind: 'deadline' } : { kind: 'internal' };
  } finally {
    clearTimeout(deadlineTimer);
    signal?.removeEventListener('abort', externalAbort);
  }
  if (outcome.kind === 'committed') {
    process.stdout.write(
      `Bounded Prisma migration resolve verified: ${summarizeMigrationResolveState(
        outcome.state,
      )}.\n`,
    );
    return 0;
  }
  if (deadlineExpired || outcome.kind === 'deadline') {
    process.stderr.write(
      'Bounded Prisma migration resolve aborted: command deadline exceeded.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.commandTimeout;
  }
  if (outcome.kind === 'cancelled') {
    process.stderr.write(
      'Bounded Prisma migration resolve aborted: cancellation received.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.internalFailure;
  }
  if (outcome.kind === 'internal') {
    process.stderr.write(
      'Bounded Prisma migration resolve aborted: command boundary failed internally.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.internalFailure;
  }
  if (outcome.kind === 'unsafe') {
    const summary = outcome.state
      ? ` (${summarizeMigrationResolveState(outcome.state)})`
      : '';
    process.stderr.write(
      `Bounded Prisma migration resolve aborted: unsafe precondition${summary}.\n`,
    );
    return BOUNDED_MIGRATION_EXIT_CODES.resolvePrecondition;
  }

  return BOUNDED_MIGRATION_EXIT_CODES.internalFailure;
}

export function parseRolledBackResolveArguments(
  args: readonly string[],
): string | undefined {
  if (args.length === 2 && args[0] === '--target-migration') return args[1];
  if (args.length === 1 && args[0].startsWith('--target-migration=')) {
    return args[0].slice('--target-migration='.length);
  }
  return undefined;
}

async function main(): Promise<number> {
  const targetMigrationName = parseRolledBackResolveArguments(
    process.argv.slice(2),
  );
  if (targetMigrationName === undefined) {
    process.stderr.write(
      'Usage: bounded Prisma migration resolve requires --target-migration <migration_name>.\n',
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
  const deadlineAt = Date.now() + BOUNDED_MIGRATION_TIMEOUTS_MS.command;
  try {
    const result = await runBoundedMigrationResolveRolledBack(
      process.env,
      process.cwd(),
      undefined,
      cancellation.signal,
      deadlineAt,
      targetMigrationName,
    );
    return selectMigrationResolveProcessExitCode(result, signalExitCode);
  } catch {
    process.stderr.write(
      'Bounded Prisma migration resolve aborted: unexpected internal failure.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.internalFailure;
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
