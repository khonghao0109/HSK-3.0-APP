import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assertExactMigrationOnlyCounts,
  assertSafeMigrationAuxiliaryDatabase,
  assertSafeEvidence,
  assertSafeEvidencePath,
  buildPgOptions,
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
