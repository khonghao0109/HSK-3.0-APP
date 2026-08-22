import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { BOUNDED_MIGRATION_EXIT_CODES } from '../operations/bounded-prisma-migrate-deploy';
import {
  assertExactMigrationOnlyCounts,
  assertSafeMigrationAuxiliaryDatabase,
  assertSafeEvidence,
  assertSafeEvidencePath,
  buildPgOptions,
  classifyMigrationFailure,
  databaseFingerprint,
  MEDIA_MIGRATION_NAMES,
  MEDIA_MIGRATION_TIMEOUTS_MS,
  parseCountRow,
  parseLockRow,
  redactMigrationDiagnostic,
  sha256,
} from './media-lifecycle-migration-validation.helpers';

type CommandResult = {
  evidenceId: string;
  status: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

type CommandEvidence = {
  id: string;
  commandRef: string;
  outcome: 'PASS' | 'FAIL' | 'EXPECTED_ABORT';
  exitCode: number | null;
  durationMs: number;
  logSha256: string;
};

type MigrationRow = {
  name: string;
  checksum: string;
};

const expectedOutcome = process.env.MEDIA_MIGRATION_EXPECTED_OUTCOME ?? 'pass';
if (expectedOutcome !== 'pass' && expectedOutcome !== 'lock_timeout') {
  throw new Error(
    'MEDIA_MIGRATION_EXPECTED_OUTCOME must be pass or lock_timeout.',
  );
}

const runId = randomUUID();
const startedAt = new Date().toISOString();
const started = Date.now();
const commands: CommandEvidence[] = [];
let commandSequence = 0;
const database = assertDisposableTestDatabase();
const guardedPrimary = assertSafeMigrationAuxiliaryDatabase(
  database.testDatabaseUrl,
  database.testDatabaseUrl,
  'MEDIA_MIGRATION_ADMIN_DATABASE_URL',
);
if (guardedPrimary.databaseName !== database.databaseName) {
  throw new Error('Disposable database identities do not match.');
}
const databaseIdentity = databaseFingerprint(database.testDatabaseUrl);
if (!databaseIdentity.guardedTestSuffix) {
  throw new Error('Disposable database guard did not produce a test suffix.');
}

const migrationsRoot = resolve(process.cwd(), 'prisma/migrations');
const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
const evidenceRoot = resolve(
  process.cwd(),
  'test-results/media-lifecycle-migration-validation',
);
const evidencePath = assertSafeEvidencePath(
  evidenceRoot,
  process.env.MEDIA_MIGRATION_EVIDENCE_PATH ??
    resolve(evidenceRoot, 'upgrade-evidence.json'),
);
const pgOptions = buildPgOptions();

const preflightCounts = readPreflightCounts();
assertExactMigrationOnlyCounts(preflightCounts);
const beforeMigrations = readMigrationCatalog('migration-catalog-before');
assertExactStartingCatalog(beforeMigrations);
const locksBefore = inspectTargetLocks('target-locks-before');
const serverVersion = queryScalar('server-version', 'SHOW server_version');
const git = {
  commit: gitScalar('git-commit', ['rev-parse', 'HEAD']),
  treeSha: gitScalar('git-tree', ['rev-parse', 'HEAD^{tree}']),
};

const sourceMigrations = [
  migrationSource(MEDIA_MIGRATION_NAMES.lifecycle),
  migrationSource(MEDIA_MIGRATION_NAMES.auditIntegrity),
];
const startingMigration = migrationSource(MEDIA_MIGRATION_NAMES.provenance);
assertCatalogChecksum(beforeMigrations, startingMigration);

const deploy = runCommand(
  'bounded-upgrade-deploy',
  'npm',
  ['run', 'migrate:deploy:production'],
  MEDIA_MIGRATION_TIMEOUTS_MS.command + 5_000,
  {},
  expectedOutcome === 'lock_timeout' ? 'lock_timeout' : undefined,
);
const combinedDeployOutput = `${deploy.stdout}\n${deploy.stderr}`;

if (expectedOutcome === 'lock_timeout') {
  const failureKind = classifyMigrationFailure(combinedDeployOutput);
  if (
    deploy.status !== BOUNDED_MIGRATION_EXIT_CODES.lockTimeout ||
    failureKind !== 'lock_timeout' ||
    !/\b55P03\b/u.test(combinedDeployOutput) ||
    !/Bounded Prisma migration deploy aborted: database lock timeout/iu.test(
      combinedDeployOutput,
    )
  ) {
    throw new Error(
      `Expected exact lock timeout; observed status=${String(
        deploy.status,
      )} classification=${failureKind}.`,
    );
  }
  const afterAbort = readMigrationCatalog('migration-catalog-after-abort');
  if (afterAbort.length !== beforeMigrations.length) {
    throw new Error(
      'Lock-timeout rehearsal did not roll back migration catalog.',
    );
  }
  const locksAfter = inspectTargetLocks('target-locks-after-abort');
  writeEvidence({
    schemaVersion: 1,
    scope: 'bounded_upgrade_only',
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    git,
    sourceBinding: sourceBinding([startingMigration, ...sourceMigrations]),
    outcome: 'expected_lock_timeout',
    database: { ...databaseIdentity, serverVersion },
    timeoutsMs: MEDIA_MIGRATION_TIMEOUTS_MS,
    preflightCounts,
    migrations: migrationEvidence(
      beforeMigrations,
      afterAbort,
      sourceMigrations,
    ),
    locks: { before: locksBefore, after: locksAfter },
    benchmark: null,
    checks: {
      upgradeMigrationDeploy: {
        commandRef: 'bounded-upgrade-deploy',
        outcome: 'EXPECTED_ABORT',
      },
      migrateStatus: { outcome: 'NOT_RUN' },
      drift: { outcome: 'NOT_RUN' },
    },
    commands,
    durationMs: Date.now() - started,
  });
  console.log(
    'PASS: migration deploy rejected by the exact bounded lock timeout.',
  );
  process.exit(0);
}

if (deploy.status !== 0) {
  throw new Error(
    `Bounded migration deploy failed (${classifyMigrationFailure(
      combinedDeployOutput,
    )}): ${redactMigrationDiagnostic(combinedDeployOutput)}`,
  );
}

const status = runCommand(
  'migration-status',
  'npx',
  ['prisma', 'migrate', 'status'],
  MEDIA_MIGRATION_TIMEOUTS_MS.command,
);
requireSuccess(status, 'prisma migrate status');
if (!/Database schema is up to date!/u.test(status.stdout)) {
  throw new Error(
    'Prisma migration status did not confirm an up-to-date schema.',
  );
}

const afterMigrations = readMigrationCatalog('migration-catalog-after');
assertFinalCatalog(beforeMigrations, afterMigrations, sourceMigrations);
const locksAfter = inspectTargetLocks('target-locks-after');
if (locksAfter.waiting !== 0) {
  throw new Error(
    'Migration deploy left a waiting lock on a media integrity table.',
  );
}

const benchmark = runRepresentativeBenchmark();
const migrationHistoryDrift = runDrift('migration-history');
const liveDrift = runDrift('live-datamodel');

writeEvidence({
  schemaVersion: 1,
  scope: 'bounded_upgrade_only',
  runId,
  startedAt,
  completedAt: new Date().toISOString(),
  git,
  sourceBinding: sourceBinding([startingMigration, ...sourceMigrations]),
  outcome: 'pass',
  database: { ...databaseIdentity, serverVersion },
  timeoutsMs: MEDIA_MIGRATION_TIMEOUTS_MS,
  preflightCounts,
  migrations: migrationEvidence(
    beforeMigrations,
    afterMigrations,
    sourceMigrations,
  ),
  locks: { before: locksBefore, after: locksAfter },
  benchmark,
  checks: {
    upgradeMigrationDeploy: {
      commandRef: 'bounded-upgrade-deploy',
      outcome: 'PASS',
      durationMs: deploy.durationMs,
    },
    migrateStatus: {
      commandRef: 'migration-status',
      outcome: 'PASS',
      durationMs: status.durationMs,
    },
    drift: {
      migrationHistoryToDatamodel: migrationHistoryDrift,
      liveToDatamodel: liveDrift,
    },
  },
  commands,
  durationMs: Date.now() - started,
});
console.log(
  `PASS: migrations ${sourceMigrations.map(({ name }) => name).join(', ')} deployed with bounded timeouts.`,
);
console.log(`Evidence: ${evidencePath}`);

function runCommand(
  commandRef: string,
  executable: string,
  args: string[],
  timeoutMs: number,
  extraEnvironment: NodeJS.ProcessEnv = {},
  expectedFailure?: 'lock_timeout',
): CommandResult {
  const commandStarted = Date.now();
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnvironment,
      DATABASE_URL: database.databaseUrl,
      TEST_DATABASE_URL: database.testDatabaseUrl,
      PGOPTIONS: pgOptions,
    },
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const durationMs = Date.now() - commandStarted;
  const status = result.status ?? 1;
  const classification = classifyMigrationFailure(`${stdout}\n${stderr}`);
  const exactExpectedLockAbort =
    expectedFailure === 'lock_timeout' &&
    status === BOUNDED_MIGRATION_EXIT_CODES.lockTimeout &&
    /\b55P03\b/u.test(`${stdout}\n${stderr}`) &&
    /Bounded Prisma migration deploy aborted: database lock timeout/iu.test(
      `${stdout}\n${stderr}`,
    );
  const evidenceId = `media-migration-${String(++commandSequence).padStart(
    3,
    '0',
  )}`;
  commands.push({
    id: evidenceId,
    commandRef,
    outcome:
      status === 0
        ? 'PASS'
        : exactExpectedLockAbort && classification === 'lock_timeout'
          ? 'EXPECTED_ABORT'
          : 'FAIL',
    exitCode: result.status,
    durationMs,
    logSha256: sha256(`${stdout}\u0000${stderr}`),
  });
  if (result.error) {
    throw new Error(
      `Bounded command execution failed: ${redactMigrationDiagnostic(
        result.error.message,
      )}`,
    );
  }
  return {
    evidenceId,
    status,
    stdout,
    stderr,
    durationMs,
  };
}

function psql(
  commandRef: string,
  sql: string,
  timeoutMs = 10_000,
): CommandResult {
  return runCommand(
    commandRef,
    'psql',
    [
      database.testDatabaseUrl,
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    timeoutMs,
  );
}

function queryScalar(commandRef: string, sql: string): string {
  const result = psql(commandRef, sql);
  requireSuccess(result, 'database scalar query');
  const value = result.stdout.trim();
  if (!value || value.includes('\n')) {
    throw new Error('Database scalar query returned an invalid result.');
  }
  return value;
}

function readPreflightCounts() {
  return parseCountRow(
    queryScalar(
      'migration-only-preflight-counts',
      `
      SELECT
        (SELECT COUNT(*) FROM "User")::text || '|' ||
        (SELECT COUNT(*) FROM "Media")::text || '|' ||
        (SELECT COUNT(*) FROM "MediaIngestion")::text || '|' ||
        (SELECT COUNT(*) FROM "AuditLog")::text
    `,
    ),
  );
}

function inspectTargetLocks(commandRef: string) {
  return parseLockRow(
    queryScalar(
      commandRef,
      `
      SELECT
        COUNT(*) FILTER (WHERE lock.granted)::text || '|' ||
        COUNT(*) FILTER (WHERE NOT lock.granted)::text
      FROM pg_locks AS lock
      WHERE lock.relation IN (
        to_regclass('public."MediaIngestion"'),
        to_regclass('public."AuditLog"')
      )
    `,
    ),
  );
}

function readMigrationCatalog(commandRef: string): MigrationRow[] {
  const result = psql(
    commandRef,
    `
    SELECT migration_name || '|' || checksum
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    ORDER BY started_at, migration_name
  `,
  );
  requireSuccess(result, 'migration catalog query');
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const separator = row.indexOf('|');
      if (separator <= 0 || separator === row.length - 1) {
        throw new Error('Migration catalog returned an invalid row.');
      }
      return {
        name: row.slice(0, separator),
        checksum: row.slice(separator + 1),
      };
    });
}

function migrationSource(name: string): MigrationRow {
  const bytes = readFileSync(join(migrationsRoot, name, 'migration.sql'));
  return { name, checksum: sha256(bytes) };
}

function assertExactStartingCatalog(rows: MigrationRow[]): void {
  if (
    rows.length !== 17 ||
    rows[rows.length - 1]?.name !== MEDIA_MIGRATION_NAMES.provenance
  ) {
    throw new Error(
      `Media migration validation requires exactly 17 applied migrations ending at ${MEDIA_MIGRATION_NAMES.provenance}.`,
    );
  }
}

function assertCatalogChecksum(
  rows: MigrationRow[],
  source: MigrationRow,
): void {
  const catalog = rows.find(({ name }) => name === source.name);
  if (!catalog || catalog.checksum !== source.checksum) {
    throw new Error(`Migration checksum mismatch for ${source.name}.`);
  }
}

function assertFinalCatalog(
  before: MigrationRow[],
  after: MigrationRow[],
  source: MigrationRow[],
): void {
  if (
    after.length !== before.length + 2 ||
    after[after.length - 1]?.name !== MEDIA_MIGRATION_NAMES.auditIntegrity
  ) {
    throw new Error(
      'Bounded deploy did not apply exactly the forward migration.',
    );
  }
  for (const migration of source) assertCatalogChecksum(after, migration);
}

function migrationEvidence(
  before: MigrationRow[],
  after: MigrationRow[],
  source: MigrationRow[],
) {
  const catalogSerialization = after
    .map(({ name, checksum }) => `${name}:${checksum}`)
    .join('\n');
  return {
    beforeCount: before.length,
    afterCount: after.length,
    catalogChecksumSha256: sha256(catalogSerialization),
    latestNames: source.map(({ name }) => name),
    latestChecksums: source.map(({ name, checksum }) => ({
      name,
      sourceChecksumSha256: checksum,
      databaseChecksumSha256:
        after.find((migration) => migration.name === name)?.checksum ?? null,
    })),
  };
}

function runDrift(kind: 'migration-history' | 'live-datamodel') {
  const shadowUrl = process.env.MEDIA_MIGRATION_SHADOW_DATABASE_URL;
  if (!shadowUrl) {
    throw new Error(
      'MEDIA_MIGRATION_SHADOW_DATABASE_URL is required for isolated drift validation.',
    );
  }
  assertSafeMigrationAuxiliaryDatabase(
    shadowUrl,
    database.testDatabaseUrl,
    'MEDIA_MIGRATION_SHADOW_DATABASE_URL',
  );
  const args =
    kind === 'migration-history'
      ? [
          'prisma',
          'migrate',
          'diff',
          '--from-migrations',
          resolve(process.cwd(), 'prisma/migrations'),
          '--to-schema-datamodel',
          schemaPath,
          '--shadow-database-url',
          shadowUrl,
          '--exit-code',
        ]
      : [
          'prisma',
          'migrate',
          'diff',
          '--from-url',
          database.databaseUrl,
          '--to-schema-datamodel',
          schemaPath,
          '--exit-code',
        ];
  const result = runCommand(
    `drift-${kind}`,
    'npx',
    args,
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
  requireSuccess(result, `${kind} drift`);
  return { status: 'empty', durationMs: result.durationMs };
}

function runRepresentativeBenchmark() {
  const fixtureRows = 1_000;
  const result = psql(
    'representative-benchmark',
    `
      BEGIN;
      SET LOCAL statement_timeout = '${String(
        MEDIA_MIGRATION_TIMEOUTS_MS.statement,
      )}ms';
      WITH actor AS (
        INSERT INTO "User" (email, password, role, status, "createdAt", "updatedAt")
        VALUES ('media-migration-benchmark@example.test', 'synthetic-not-a-secret', 'admin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      ), source AS (
        INSERT INTO "DataSource" (
          code, name, version, "referenceUrl", license, attribution,
          "contentHash", "createdById", "createdAt", "updatedAt"
        )
        SELECT 'MEDIA_MIGRATION_BENCHMARK', 'Synthetic migration benchmark', '2026.08',
          'https://example.test/media-migration-benchmark', 'Synthetic fixture',
          'Synthetic attribution', repeat('9', 64), actor.id, CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM actor
        RETURNING id, "createdById"
      ), ingestion AS (
        INSERT INTO "MediaIngestion" (
          "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint",
          status, "originalFilename", "declaredMimeType", size, "storageProvider",
          "processingToken", "attemptCount", "failureCode", "startedAt", "updatedAt"
        )
        SELECT "createdById", id, repeat('7', 64), repeat('8', 64), 'failed',
          'benchmark.png', 'image/png', 8, 'memory-test',
          'f2000000-0000-4000-8000-00000000002f', 1, 'STORAGE_WRITE_FAILED',
          CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP
        FROM source
        RETURNING id, "actorId"
      )
      INSERT INTO "AuditLog" (
        "actorId", action, "targetType", "targetId", "afterSummary", "createdAt"
      )
      SELECT ingestion."actorId", 'media.ingestion_failed', 'media_ingestion',
        ingestion.id::text,
        jsonb_build_object(
          'ingestionId', ingestion.id,
          'status', 'failed',
          'failureCode', 'STORAGE_WRITE_FAILED'
        ),
        CURRENT_TIMESTAMP
      FROM ingestion, generate_series(1, ${String(fixtureRows)});
      EXPLAIN (ANALYZE, FORMAT JSON)
      SELECT COUNT(*)
      FROM "AuditLog" AS audit
      WHERE audit.action IN (
        'media.ingestion_failed',
        'media.ingestion_cleanup_failed',
        'media.ingestion_cleanup_settling'
      )
        AND NOT hsk_is_valid_media_cleanup_audit(
          audit.action,
          audit."targetType",
          audit."targetId",
          audit."afterSummary",
          audit."createdAt"
        );
      ROLLBACK;
    `,
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
  requireSuccess(result, 'representative audit benchmark');
  const start = result.stdout.indexOf('[\n  {');
  const endMarker = '\nROLLBACK';
  const end = result.stdout.lastIndexOf(endMarker);
  if (start < 0 || end <= start) {
    throw new Error('Representative benchmark returned invalid JSON evidence.');
  }
  const plan = JSON.parse(result.stdout.slice(start, end)) as Array<{
    'Planning Time': number;
    'Execution Time': number;
  }>;
  const planningTimeMs = plan[0]?.['Planning Time'];
  const executionTimeMs = plan[0]?.['Execution Time'];
  if (
    typeof planningTimeMs !== 'number' ||
    typeof executionTimeMs !== 'number' ||
    executionTimeMs > 5_000
  ) {
    throw new Error(
      'Representative cleanup-audit benchmark exceeded its budget.',
    );
  }
  return { fixtureRows, planningTimeMs, executionTimeMs };
}

function requireSuccess(result: CommandResult, label: string): void {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (${classifyMigrationFailure(
        `${result.stdout}\n${result.stderr}`,
      )}): ${redactMigrationDiagnostic(`${result.stdout}\n${result.stderr}`)}`,
    );
  }
}

function gitScalar(commandRef: string, args: string[]): string {
  const result = runCommand(commandRef, 'git', args, 5_000);
  requireSuccess(result, commandRef);
  const value = result.stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(`${commandRef} returned an invalid Git object ID.`);
  }
  return value;
}

function sourceBinding(migrations: MigrationRow[]) {
  const relativePaths = [
    'package.json',
    'scripts/operations/bounded-prisma-migrate-deploy.ts',
    'scripts/operations/bounded-prisma-migrate-resolve-rolled-back.ts',
    'scripts/test/media-lifecycle-migration-validation.helpers.ts',
    'scripts/test/media-lifecycle-migration-validation.helpers.spec.ts',
    'scripts/test/run-media-lifecycle-migration-validation.ts',
    'test/database/media-cleanup-audit-integrity-adversarial.fixture.sql',
    'test/database/media-cleanup-audit-integrity-future.fixture.sql',
    'test/database/media-cleanup-audit-integrity.integration.sql',
    'test/database/media-cleanup-audit-integrity-timestamp-drift-reconcile.fixture.sql',
    'test/database/media-cleanup-audit-integrity-timestamp-drift.fixture.sql',
    'test/database/media-lifecycle-telemetry-cleanup-upgrade.fixture.sql',
  ];
  const files = relativePaths.map((relativePath) => ({
    path: relativePath,
    sha256: sha256(readFileSync(resolve(process.cwd(), relativePath))),
  }));
  for (const migration of migrations) {
    files.push({
      path: `prisma/migrations/${migration.name}/migration.sql`,
      sha256: migration.checksum,
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    digestSha256: sha256(
      files.map(({ path, sha256: digest }) => `${path}:${digest}`).join('\n'),
    ),
    files,
  };
}

function writeEvidence(evidence: unknown): void {
  assertSafeEvidence(evidence);
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  assertNoSymlinkPath(evidenceRoot, dirname(evidencePath));
  const temporaryPath = `${evidencePath}.${String(process.pid)}.tmp`;
  if (existsSync(temporaryPath)) {
    throw new Error('Migration evidence temporary file already exists.');
  }
  writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  renameSync(temporaryPath, evidencePath);
  const junitPath = assertSafeEvidencePath(
    evidenceRoot,
    evidencePath.replace(/\.json$/u, '.junit.xml'),
  );
  const junitTemporaryPath = `${junitPath}.${String(process.pid)}.tmp`;
  if (existsSync(junitTemporaryPath)) {
    throw new Error('Migration JUnit temporary file already exists.');
  }
  const failureCount = commands.some(({ outcome }) => outcome === 'FAIL')
    ? 1
    : 0;
  const junit = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="media-lifecycle-migration-validation" tests="1" failures="${String(
      failureCount,
    )}" time="${(Date.now() - started) / 1000}">`,
    `  <testcase classname="database.migration" name="${expectedOutcome === 'lock_timeout' ? 'bounded-lock-timeout' : 'bounded-upgrade'}"/>`,
    '</testsuite>',
    '',
  ].join('\n');
  writeFileSync(junitTemporaryPath, junit, { mode: 0o600, flag: 'wx' });
  renameSync(junitTemporaryPath, junitPath);
}

function assertNoSymlinkPath(root: string, targetDirectory: string): void {
  let current = root;
  if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
    throw new Error('Migration evidence directory must not contain symlinks.');
  }
  for (const segment of targetDirectory.slice(root.length).split('/')) {
    if (!segment) continue;
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(
        'Migration evidence directory must not contain symlinks.',
      );
    }
  }
}
