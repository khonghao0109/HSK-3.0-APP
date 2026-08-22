import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export const MEDIA_MIGRATION_NAMES = {
  provenance: '20260813120000_media_provenance_provider_hardening',
  lifecycle: '20260813163000_media_lifecycle_telemetry_truthfulness',
  auditIntegrity: '20260813193000_media_cleanup_audit_integrity',
} as const;

export const MEDIA_MIGRATION_TIMEOUTS_MS = {
  lock: 2_000,
  statement: 30_000,
  idleInTransaction: 35_000,
  command: 45_000,
} as const;

export type MigrationFailureKind =
  | 'lock_timeout'
  | 'statement_timeout'
  | 'idle_transaction_timeout'
  | 'domain_preflight'
  | 'connection'
  | 'migration_error';

export type MigrationPreflightCounts = {
  users: number;
  media: number;
  ingestions: number;
  audits: number;
};

export type BoundedChildResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type MigrationSourceCatalog = {
  migrations: Array<{ name: string; checksum: string }>;
  catalogChecksumSha256: string;
};

export type SafeMigrationDatabaseTarget = {
  databaseName: string;
  host: string;
  port: number;
  normalizedIdentity: string;
};

const POSTGRES_URL = /postgres(?:ql)?:\/\/[^\s'"`]+/giu;
const PASSWORD_ASSIGNMENT =
  /\b(password|passwd|pwd|secret|token)\s*[=:]\s*[^\s,;]+/giu;
const USER_INFO = /\/\/[^/@\s:]+:[^/@\s]+@/gu;
const CREDENTIAL_EVIDENCE_KEY =
  /["'](?:databaseUrl|testDatabaseUrl|password|passwd|pwd|secret|token)["']\s*:/iu;

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function readMigrationSourceCatalog(
  migrationRoot: string,
): MigrationSourceCatalog {
  const entries = readdirSync(migrationRoot).sort((left, right) =>
    left.localeCompare(right),
  );
  const lockName = 'migration_lock.toml';
  if (!entries.includes(lockName)) {
    throw new Error('Prisma migration history has no migration_lock.toml.');
  }
  const lockPath = resolve(migrationRoot, lockName);
  const lockStat = lstatSync(lockPath);
  const lock = readFileSync(lockPath, 'utf8');
  if (
    lockStat.isSymbolicLink() ||
    !lockStat.isFile() ||
    !/^provider\s*=\s*"postgresql"\s*$/mu.test(lock)
  ) {
    throw new Error(
      'Prisma migration lock is not an exact PostgreSQL lock file.',
    );
  }

  const migrations: Array<{ name: string; checksum: string }> = [];
  for (const entry of entries) {
    if (entry === lockName) continue;
    const directory = resolve(migrationRoot, entry);
    const directoryStat = lstatSync(directory);
    if (
      !/^\d{14}_[a-z0-9_]+$/u.test(entry) ||
      directoryStat.isSymbolicLink() ||
      !directoryStat.isDirectory()
    ) {
      throw new Error(
        `Unexpected entry in Prisma migration history: ${entry}.`,
      );
    }
    const sqlPath = resolve(directory, 'migration.sql');
    const sqlStat = lstatSync(sqlPath);
    if (sqlStat.isSymbolicLink() || !sqlStat.isFile()) {
      throw new Error(`Migration ${entry} has no regular migration.sql.`);
    }
    migrations.push({ name: entry, checksum: sha256(readFileSync(sqlPath)) });
  }
  return {
    migrations,
    catalogChecksumSha256: sha256(
      migrations.map(({ name, checksum }) => `${name}\0${checksum}\n`).join(''),
    ),
  };
}

export function databaseFingerprint(databaseUrl: string): {
  hostFingerprintSha256: string;
  port: number;
  databaseName: string;
  guardedTestSuffix: boolean;
} {
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const port = Number(parsed.port || '5432');
  return {
    hostFingerprintSha256: sha256(
      `${parsed.hostname.toLowerCase()}:${String(port)}`,
    ),
    port,
    databaseName,
    guardedTestSuffix:
      /(?:^|[_-])(test|e2e|verify|disposable|hardening)(?:[_-]\d+)?$/iu.test(
        databaseName,
      ),
  };
}

export function assertSafeMigrationAuxiliaryDatabase(
  value: string,
  primaryDatabaseUrl: string,
  variableName:
    | 'MEDIA_MIGRATION_SHADOW_DATABASE_URL'
    | 'MEDIA_MIGRATION_ADMIN_DATABASE_URL',
): SafeMigrationDatabaseTarget {
  const target = parseSafeAuxiliaryTarget(value, variableName);
  const primary = parseSafeAuxiliaryTarget(
    primaryDatabaseUrl,
    'MEDIA_MIGRATION_SHADOW_DATABASE_URL',
  );
  if (target.host !== primary.host || target.port !== primary.port) {
    throw new Error(
      `${variableName} must use the guarded test cluster host and port.`,
    );
  }
  if (
    variableName === 'MEDIA_MIGRATION_SHADOW_DATABASE_URL' &&
    target.normalizedIdentity === primary.normalizedIdentity
  ) {
    throw new Error(
      'MEDIA_MIGRATION_SHADOW_DATABASE_URL must use a separate disposable database.',
    );
  }
  return target;
}

function parseSafeAuxiliaryTarget(
  value: string,
  variableName: string,
): SafeMigrationDatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  if (parsed.hash) {
    throw new Error(`${variableName} must not contain a URL fragment.`);
  }
  const schema = parsed.searchParams.getAll('schema');
  if (schema.length > 1 || (schema.length === 1 && schema[0] !== 'public')) {
    throw new Error(`${variableName} schema must be public when specified.`);
  }
  for (const parameter of parsed.searchParams.keys()) {
    if (parameter !== 'schema') {
      throw new Error(`${variableName} contains an unsupported URL parameter.`);
    }
  }
  const host = parsed.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`${variableName} must use an allowlisted loopback host.`);
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    throw new Error(`${variableName} must contain a valid database name.`);
  }
  if (!databaseName || databaseName.includes('/')) {
    throw new Error(`${variableName} must contain exactly one database name.`);
  }
  if (
    !/(?:^|[_-])(test|e2e|verify|disposable|hardening)(?:[_-]\d+)?$/iu.test(
      databaseName,
    )
  ) {
    throw new Error(`${variableName} must use a disposable database name.`);
  }
  const port = Number(parsed.port || '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${variableName} must contain a valid port.`);
  }
  return {
    databaseName,
    host,
    port,
    normalizedIdentity: `${host}:${String(port)}/${databaseName}`,
  };
}

export function buildPgOptions(timeouts = MEDIA_MIGRATION_TIMEOUTS_MS): string {
  return [
    `-c lock_timeout=${String(timeouts.lock)}ms`,
    `-c statement_timeout=${String(timeouts.statement)}ms`,
    `-c idle_in_transaction_session_timeout=${String(timeouts.idleInTransaction)}ms`,
  ].join(' ');
}

export function assertExactMigrationOnlyCounts(
  counts: MigrationPreflightCounts,
): void {
  const entries = Object.entries(counts) as Array<
    [keyof MigrationPreflightCounts, number]
  >;
  if (
    entries.some(([, value]) => !Number.isSafeInteger(value) || value !== 0)
  ) {
    throw new Error(
      'Media migration validation requires a fresh migration-only disposable database.',
    );
  }
}

export function classifyMigrationFailure(output: string): MigrationFailureKind {
  const normalized = output.toLowerCase();
  if (/\b55p03\b|lock timeout|could not obtain lock/u.test(normalized)) {
    return 'lock_timeout';
  }
  if (/\b57014\b|statement timeout|canceling statement/u.test(normalized)) {
    return 'statement_timeout';
  }
  if (
    /\b25p03\b|idle-in-transaction|idle in transaction session timeout/u.test(
      normalized,
    )
  ) {
    return 'idle_transaction_timeout';
  }
  if (
    /\bp0001\b|error: p3018|migration found|migration requires/u.test(
      normalized,
    )
  ) {
    return 'domain_preflight';
  }
  if (
    /\bp1001\b|connection refused|connection reset|server closed the connection|can't reach database/u.test(
      normalized,
    )
  ) {
    return 'connection';
  }
  return 'migration_error';
}

export function redactMigrationDiagnostic(value: unknown): string {
  return String(value)
    .replace(POSTGRES_URL, '[REDACTED_DATABASE_URL]')
    .replace(USER_INFO, '//[REDACTED_CREDENTIALS]@')
    .replace(PASSWORD_ASSIGNMENT, '$1=[REDACTED]');
}

export function waitForBoundedChild(
  child: ChildProcess,
  timeoutMs: number,
  maximumOutputBytes = 2 * 1024 * 1024,
): Promise<BoundedChildResult> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Child process timeout must be a positive integer.');
  }
  if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes <= 0) {
    throw new Error('Child process output limit must be a positive integer.');
  }

  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  let outputBytes = 0;
  let timedOut = false;
  let outputExceeded = false;
  let forceKill: NodeJS.Timeout | undefined;

  const append = (
    stream: 'stdout' | 'stderr',
    chunk: Buffer | string,
  ): void => {
    const value = chunk.toString();
    outputBytes += Buffer.byteLength(value);
    if (outputBytes > maximumOutputBytes) {
      outputExceeded = true;
      child.kill('SIGTERM');
      return;
    }
    if (stream === 'stdout') stdout += value;
    else stderr += value;
  };

  if (!child.stdout || !child.stderr) {
    throw new Error('Child process must expose piped stdout and stderr.');
  }
  child.stdout.on('data', (chunk: Buffer | string) => append('stdout', chunk));
  child.stderr.on('data', (chunk: Buffer | string) => append('stderr', chunk));

  return new Promise<BoundedChildResult>((resolveChild, rejectChild) => {
    let settled = false;
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (timedOut) {
        rejectChild(new Error('Child process exceeded its bounded deadline.'));
        return;
      }
      if (outputExceeded) {
        rejectChild(
          new Error('Child process exceeded its bounded output limit.'),
        );
        return;
      }
      resolveChild({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 1_000);
      forceKill.unref();
    }, timeoutMs);
    timeout.unref();

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      rejectChild(
        new Error(
          `Child process failed to start: ${redactMigrationDiagnostic(error.message)}`,
        ),
      );
    });
    child.once('close', finish);
    if (child.exitCode !== null) queueMicrotask(() => finish(child.exitCode));
  });
}

export function parseCountRow(value: string): MigrationPreflightCounts {
  const fields = value.trim().split('|').map(Number);
  if (
    fields.length !== 4 ||
    fields.some((field) => !Number.isSafeInteger(field) || field < 0)
  ) {
    throw new Error('Migration preflight returned an invalid count-only row.');
  }
  return {
    users: fields[0],
    media: fields[1],
    ingestions: fields[2],
    audits: fields[3],
  };
}

export function parseLockRow(value: string): {
  granted: number;
  waiting: number;
} {
  const fields = value.trim().split('|').map(Number);
  if (
    fields.length !== 2 ||
    fields.some((field) => !Number.isSafeInteger(field) || field < 0)
  ) {
    throw new Error('Migration lock inspection returned an invalid count row.');
  }
  return { granted: fields[0], waiting: fields[1] };
}

export function assertSafeEvidence(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (
    /postgres(?:ql)?:\/\//iu.test(serialized) ||
    CREDENTIAL_EVIDENCE_KEY.test(serialized) ||
    /\/\/[^/@\s:]+:[^/@\s]+@/u.test(serialized)
  ) {
    throw new Error('Migration evidence contains credential-bearing material.');
  }
}

export function assertSafeEvidencePath(
  evidenceRoot: string,
  candidatePath: string,
): string {
  const root = resolve(evidenceRoot);
  const candidate = resolve(candidatePath);
  const child = relative(root, candidate);
  if (
    child.length === 0 ||
    child.startsWith('..') ||
    isAbsolute(child) ||
    child.includes('/') ||
    !/^[a-z0-9][a-z0-9._-]*\.(?:json|xml)$/iu.test(child)
  ) {
    throw new Error(
      'Migration evidence path must be a JSON or XML file inside its task-owned test-results directory.',
    );
  }
  return candidate;
}
