import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  resolveLocalPrismaCli,
  validateBoundedMigrationTimeouts,
} from '../operations/bounded-prisma-migrate-deploy';
import {
  MEDIA_CLEANUP_AUDIT_MIGRATION,
  buildMediaCleanupAuditResolveInvocation,
} from '../operations/bounded-prisma-migrate-resolve-rolled-back';
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

void test('owns the production Prisma deploy timeout and environment contract', () => {
  const secret = 'caller-controlled-password';
  const environment = buildBoundedMigrationEnvironment({
    DATABASE_URL: `postgresql://operator:${secret}@db.internal:5432/hsk?schema=public&options=-c%20lock_timeout%3D0`,
    PGOPTIONS: '-c lock_timeout=0 -c statement_timeout=0',
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
    packageJson.scripts?.['migrate:resolve:media-cleanup-audit:production'],
    'node dist/scripts/operations/bounded-prisma-migrate-resolve-rolled-back.js',
  );
  assert.doesNotMatch(
    `${packageJson.scripts?.['migrate:deploy:production']} ${packageJson.scripts?.['migrate:resolve:media-cleanup-audit:production']}`,
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
    /c4a772f832cba6b5dd02385727e17153ec1cf672dd3f67ec90da83dba5026252/u,
  );
  assert.ok(
    wrapperSource.indexOf('to_regclass(\'\\"MediaIngestion\\"\')') <
      wrapperSource.indexOf('to_regclass(\'\\"AuditLog\\"\')'),
    'Lock preflight must preserve the migration application lock order.',
  );
  assert.doesNotMatch(wrapperSource, /'migrate',\s*'resolve'|'reset'|'push'/u);
});

void test('owns an exact fixed-argv production resolve command for migration 19', () => {
  assert.equal(
    MEDIA_CLEANUP_AUDIT_MIGRATION,
    '20260813193000_media_cleanup_audit_integrity',
  );
  const invocation = buildMediaCleanupAuditResolveInvocation(process.cwd());
  assert.equal(invocation.executable, process.execPath);
  assert.equal(invocation.args[0], require.resolve('prisma/build/index.js'));
  assert.deepEqual(invocation.args.slice(1), [
    'migrate',
    'resolve',
    '--rolled-back',
    MEDIA_CLEANUP_AUDIT_MIGRATION,
    '--schema',
    resolve(process.cwd(), 'prisma/schema.prisma'),
  ]);
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
  assert.equal(isPrismaFailedMigrationRetryBlock('P3009', 0), false);
  assert.equal(isPrismaFailedMigrationRetryBlock('P3018 P0001', 1), false);
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
  assert.equal(first.migrations.length, 19);
  assert.equal(
    first.migrations[first.migrations.length - 1]?.name,
    MEDIA_MIGRATION_NAMES.auditIntegrity,
  );
  assert.match(first.catalogChecksumSha256, /^[a-f0-9]{64}$/u);
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
