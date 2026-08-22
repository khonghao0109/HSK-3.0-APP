import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';

import {
  assertSafeEvidence,
  assertSafeMigrationAuxiliaryDatabase,
  assertExactMigrationOnlyCounts,
  buildPgOptions,
  classifyPrismaTimestampDriftAbort,
  databaseFingerprint,
  MEDIA_MIGRATION_NAMES,
  MEDIA_MIGRATION_TIMEOUTS_MS,
  parseCountRow,
  readMigrationSourceCatalog,
  redactMigrationDiagnostic,
  sha256,
  waitForBoundedChild,
} from './media-lifecycle-migration-validation.helpers';
import {
  BOUNDED_MIGRATION_EXIT_CODES,
  resolveLocalPrismaCli,
} from '../operations/bounded-prisma-migrate-deploy';
import {
  assertDatabaseReleaseEvidence,
  computeReleaseContentDigest as computeSharedReleaseContentDigest,
} from './media-operations-validation.helpers';

type CommandEvidence = {
  id: string;
  commandRef: string;
  outcome: 'PASS';
  exitCode: number;
  durationMs: number;
  logPath: string;
  logSha256: string;
  platform: string;
  role: 'check' | 'auxiliary';
  executable: string;
  executableIdentity: string;
  executableSha256: string;
  toolVersion: string;
  safeArgs: string[];
  cwd: string;
  envKeys: string[];
  startedAt: string;
  completedAt: string;
  gitCommit: string;
  gitTreeSha: string;
  releaseContentDigest: string;
  inputTreeDigest: string;
  expectedAbort?:
    | { exitCode: 3; prismaCode: 'P3018'; sqlstate: 'P0001' }
    | { exitCode: 3; sqlstate: 'P0001'; stage: 'direct-migration' }
    | { exitCode: 75; sqlstate: '55P03'; stage: 'lock-preflight' }
    | { exitCode: 1; prismaCode: 'P3009' }
    | {
        exitCode: 1;
        engineDiagnostic: 'transaction-aborted';
        stage: 'prisma-migrate-deploy';
      };
};

type CommandResult = CommandEvidence & { stdout: string; stderr: string };

type ExpectedCommandAbort =
  | {
      exitCode: number;
      pattern: RegExp;
      expectedAbort: NonNullable<CommandEvidence['expectedAbort']>;
    }
  | {
      label: string;
      classify: (
        exitCode: number,
        diagnostic: string,
      ) => NonNullable<CommandEvidence['expectedAbort']> | undefined;
    };

type ValidationResult = {
  git: { commit: string; treeSha: string };
  releaseContentDigest: string;
  sourceMigrations: Array<{ name: string; checksum: string }>;
  catalog: Array<{ name: string; checksum: string }>;
  benchmark: {
    fixtureRows: number;
    planningTimeMs: number;
    executionTimeMs: number;
  };
  serverVersion: string;
  database: ReturnType<typeof databaseFingerprint>;
};

const repositoryRoot = resolve(process.cwd(), '..');
const backendRoot = resolve(repositoryRoot, 'backend');
const migrationRoot = resolve(backendRoot, 'prisma/migrations');
const schemaPath = resolve(backendRoot, 'prisma/schema.prisma');
const evidenceRoot = resolve(
  backendRoot,
  'test-results/media-lifecycle-migration-validation',
);
const logsRoot = resolve(evidenceRoot, 'logs');
const evidencePath = resolve(evidenceRoot, 'evidence.json');
const junitPath = resolve(evidenceRoot, 'evidence.junit.xml');
const manifestPath = resolve(evidenceRoot, 'log-manifest.json');
const runId = randomUUID();
const disposableJwtKey = `${randomUUID()}${randomUUID()}`;
const disposablePasswordPepper = `${randomUUID()}${randomUUID()}`;
const startedAt = new Date().toISOString();
const started = Date.now();
const commands: CommandEvidence[] = [];
const checks: Record<string, { outcome: 'PASS'; commandId: string }> = {};
const pgOptions = buildPgOptions();
const createdDatabaseNames: string[] = [];
const temporaryRoots: string[] = [];
const activeChildren = new Set<ChildProcess>();
let evidenceBinding = {
  gitCommit: '',
  gitTreeSha: '',
  releaseContentDigest: '',
};

// Invalidate prior PASS summaries before any fallible environment parsing. A
// rerun with a missing/unsafe URL must never leave stale evidence consumable.
prepareEvidenceRoot();
if (process.env.NODE_ENV !== 'test') {
  throw new Error('Media migration release validation requires NODE_ENV=test.');
}
const adminUrl = requiredEnvironment('MEDIA_MIGRATION_ADMIN_DATABASE_URL');
const admin = assertSafeMigrationAuxiliaryDatabase(
  adminUrl,
  adminUrl,
  'MEDIA_MIGRATION_ADMIN_DATABASE_URL',
);
if (admin.databaseName !== 'postgres_test') {
  throw new Error(
    'MEDIA_MIGRATION_ADMIN_DATABASE_URL must target the dedicated postgres_test control database.',
  );
}
const shadowUrl = requiredEnvironment('MEDIA_MIGRATION_SHADOW_DATABASE_URL');
const shadow = assertSafeMigrationAuxiliaryDatabase(
  shadowUrl,
  adminUrl,
  'MEDIA_MIGRATION_SHADOW_DATABASE_URL',
);
const databasePrefix = `hsk_media_${runId.replace(/-/gu, '').slice(0, 12)}`;
const databaseNames = {
  fresh: `${databasePrefix}_fresh_test`,
  upgrade: `${databasePrefix}_upgrade_test`,
  adversarial: `${databasePrefix}_adversarial_test`,
  future: `${databasePrefix}_future_test`,
  integration: `${databasePrefix}_integration_test`,
  concurrency: `${databasePrefix}_concurrency_test`,
  lockAbort: `${databasePrefix}_lock_abort_test`,
  recovery: `${databasePrefix}_recovery_test`,
  e2e: `${databasePrefix}_e2e_test`,
} as const;
const databaseUrls = Object.fromEntries(
  Object.entries(databaseNames).map(([key, name]) => [key, databaseUrl(name)]),
) as Record<keyof typeof databaseNames, string>;

void main().catch((error: unknown) => {
  console.error(redactMigrationDiagnostic(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  let validation: ValidationResult | undefined;
  let primaryError: unknown;
  try {
    validation = await executeValidation();
  } catch (error: unknown) {
    primaryError = error;
  }

  const cleanupErrors = await cleanupTaskResources();
  if (primaryError !== undefined) {
    const cleanupSuffix =
      cleanupErrors.length === 0
        ? ''
        : ` Cleanup also reported: ${cleanupErrors.join('; ')}`;
    throw new Error(
      `${redactMigrationDiagnostic(primaryError)}${cleanupSuffix}`,
    );
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`Task-owned cleanup failed: ${cleanupErrors.join('; ')}`);
  }
  if (!validation)
    throw new Error('Migration release validation produced no result.');

  const finalCommit = scalarCommand(
    'git-commit-final',
    'git',
    ['rev-parse', 'HEAD'],
    backendRoot,
  );
  const finalTree = scalarCommand(
    'git-tree-final',
    'git',
    ['rev-parse', 'HEAD^{tree}'],
    backendRoot,
  );
  const finalReleaseDigest = computeBoundReleaseContentDigest('final');
  if (
    finalCommit !== validation.git.commit ||
    finalTree !== validation.git.treeSha ||
    finalReleaseDigest !== validation.releaseContentDigest
  ) {
    throw new Error(
      'Release content changed while database validation was running.',
    );
  }

  const completedAt = new Date().toISOString();
  const logManifest = {
    schemaVersion: 1,
    runId,
    commands: commands.map(({ id, logPath, logSha256 }) => ({
      id,
      logPath,
      logSha256,
    })),
  };
  writeAtomicJson(manifestPath, logManifest);
  const junit = renderJunit(validation.git);
  writeAtomic(junitPath, junit);
  const latest = validation.sourceMigrations.slice(-2);
  const evidence = {
    schemaVersion: 1,
    runId,
    startedAt,
    completedAt,
    git: validation.git,
    releaseContentDigest: validation.releaseContentDigest,
    database: {
      ...validation.database,
      serverVersion: validation.serverVersion,
    },
    migrations: {
      catalogCount: validation.catalog.length,
      catalogChecksumSha256: catalogChecksum(validation.catalog),
      latestNames: latest.map(({ name }) => name),
      latestChecksums: latest.map(({ checksum }) => checksum),
    },
    checks,
    commands,
    artifacts: {
      junit: { path: 'evidence.junit.xml', sha256: sha256(junit) },
      logManifest: {
        path: 'log-manifest.json',
        sha256: sha256(readFileSync(manifestPath)),
      },
    },
    auxiliary: {
      futureTimestampAbortCommandId: checks.futureTimestampFixture?.commandId,
      boundedMigrationAbortCommandId: checks.boundedMigrationAbort?.commandId,
      auditLifecycleRaceCommandId: checks.auditLifecycleRace?.commandId,
      concurrency: {
        blockedOnLock: true,
        finalAuditCount: 1,
      },
      benchmark: validation.benchmark,
      databaseCount: Object.keys(databaseNames).length,
      shadowDatabaseName: shadow.databaseName,
    },
    outcome: 'pass',
    durationMs: Date.now() - started,
  };
  assertSafeEvidence(evidence);
  writeAtomicJson(evidencePath, evidence);
  assertDatabaseReleaseEvidence(evidence, {
    commit: validation.git.commit,
    treeSha: validation.git.treeSha,
    releaseContentDigest: validation.releaseContentDigest,
    evidenceRoot,
    catalogCount: validation.catalog.length,
    catalogChecksum: catalogChecksum(validation.catalog),
    latestMigrations: latest,
  });
  console.log(
    `PASS: authoritative media migration release evidence ${evidencePath}`,
  );
}

async function executeValidation(): Promise<ValidationResult> {
  const git = {
    commit: scalarCommand(
      'git-commit',
      'git',
      ['rev-parse', 'HEAD'],
      backendRoot,
    ),
    treeSha: scalarCommand(
      'git-tree',
      'git',
      ['rev-parse', 'HEAD^{tree}'],
      backendRoot,
    ),
  };
  const releaseContentDigest = computeBoundReleaseContentDigest('initial');
  evidenceBinding = {
    gitCommit: git.commit,
    gitTreeSha: git.treeSha,
    releaseContentDigest,
  };
  for (const command of commands) bindCommand(command);
  run(
    'production-migration-wrapper-build',
    'npm',
    ['run', 'build'],
    backendRoot,
    { ...baseSubprocessEnvironment(), NODE_ENV: 'test' },
    120_000,
  );
  const sourceMigrations = migrationSources();
  const roots = buildHistoricalMigrationRoots();

  for (const databaseName of Object.values(databaseNames))
    createDatabase(databaseName);

  const freshDeploy = prismaDeploy(
    'fresh-migration-deploy',
    databaseUrls.fresh,
  );
  assertMigrationOnlyDatabase(
    'fresh-migration-only-preflight',
    databaseUrls.fresh,
  );
  checks.freshMigrationDeploy = passCheck(freshDeploy);

  prismaDeploy(
    'upgrade-first17-deploy',
    databaseUrls.upgrade,
    roots.first17SchemaPath,
  );
  psqlFile(
    'upgrade-cleanup-required-fixture',
    databaseUrls.upgrade,
    resolve(
      backendRoot,
      'test/database/media-lifecycle-telemetry-cleanup-upgrade.fixture.sql',
    ),
  );
  psqlFile(
    'upgrade-object-cleaned-fixture',
    databaseUrls.upgrade,
    resolve(
      backendRoot,
      'test/database/media-lifecycle-telemetry-cleaned-upgrade.fixture.sql',
    ),
  );
  const upgradeDeploy = prismaDeploy(
    'upgrade-migration-deploy',
    databaseUrls.upgrade,
  );
  const upgradeProof = verifyPositiveUpgrade(databaseUrls.upgrade);
  checks.upgradeMigrationDeploy = passCheck(
    commandEvidence(
      'upgrade-migration-proof',
      `deploy=${upgradeDeploy.logSha256} proof=${upgradeProof.logSha256}`,
    ),
  );

  prismaDeploy(
    'adversarial-first18-deploy',
    databaseUrls.adversarial,
    roots.first18SchemaPath,
  );
  assertFirst18State('adversarial-first18-preflight', databaseUrls.adversarial);
  psqlFile(
    'adversarial-fixture-setup',
    databaseUrls.adversarial,
    resolve(
      backendRoot,
      'test/database/media-cleanup-audit-integrity-adversarial.fixture.sql',
    ),
  );
  const adversarial = expectedP0001(
    'adversarial-fixture',
    databaseUrls.adversarial,
  );
  assertAtomicRollback(databaseUrls.adversarial, 18, 2);
  checks.adversarialFixture = passCheck(adversarial);

  prismaDeploy(
    'future-first18-deploy',
    databaseUrls.future,
    roots.first18SchemaPath,
  );
  assertFirst18State('future-first18-preflight', databaseUrls.future);
  psqlFile(
    'future-fixture-setup',
    databaseUrls.future,
    resolve(
      backendRoot,
      'test/database/media-cleanup-audit-integrity-future.fixture.sql',
    ),
  );
  const future = expectedP0001('future-timestamp-fixture', databaseUrls.future);
  assertAtomicRollback(databaseUrls.future, 18, 1);
  checks.futureTimestampFixture = passCheck(future);

  prismaDeploy('integration-migration-deploy', databaseUrls.integration);
  assertMigrationOnlyDatabase(
    'integration-migration-only-preflight',
    databaseUrls.integration,
  );
  const integration = psqlFile(
    'media-cleanup-integrity-integration',
    databaseUrls.integration,
    resolve(
      backendRoot,
      'test/database/media-cleanup-audit-integrity.integration.sql',
    ),
  );
  checks.integration = passCheck(integration);

  prismaDeploy('concurrency-migration-deploy', databaseUrls.concurrency);
  assertMigrationOnlyDatabase(
    'concurrency-migration-only-preflight',
    databaseUrls.concurrency,
  );
  const concurrency = await runLockConcurrency(databaseUrls.concurrency);
  checks.concurrency = passCheck(concurrency);
  psqlFile(
    'audit-race-fixture-setup',
    databaseUrls.concurrency,
    resolve(backendRoot, 'test/database/media-cleanup-audit-race.fixture.sql'),
  );
  const race = await runAuditLifecycleRace(databaseUrls.concurrency);
  checks.auditLifecycleRace = passCheck(race);

  const boundedAbort = await runBoundedMigrationLockRehearsal(
    databaseUrls.lockAbort,
    databaseUrls.recovery,
    roots,
  );
  checks.boundedMigrationAbort = passCheck(boundedAbort);

  const status = run(
    'migrate-status',
    'npx',
    ['prisma', 'migrate', 'status'],
    backendRoot,
    environment(databaseUrls.fresh),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
  if (!/Database schema is up to date!/u.test(status.stdout)) {
    throw new Error('Migration status did not report an up-to-date schema.');
  }
  checks.migrateStatus = passCheck(status);

  const catalog = readCatalog(databaseUrls.fresh);
  assertCatalog(catalog, sourceMigrations);
  const checksum = commandEvidence(
    'checksum-audit',
    sourceMigrations
      .map(({ name, checksum }) => `${name}\0${checksum}`)
      .join('\n'),
  );
  checks.checksumAudit = passCheck(checksum);

  const driftHistory = run(
    'drift-history-datamodel',
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-migrations',
      migrationRoot,
      '--to-schema-datamodel',
      schemaPath,
      '--shadow-database-url',
      shadowUrl,
      '--exit-code',
    ],
    backendRoot,
    environment(databaseUrls.fresh),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
  const driftLive = run(
    'drift-live-datamodel',
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-url',
      databaseUrls.fresh,
      '--to-schema-datamodel',
      schemaPath,
      '--exit-code',
    ],
    backendRoot,
    environment(databaseUrls.fresh),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
  checks.drift = passCheck(
    commandEvidence(
      'drift',
      `${driftHistory.logSha256}\n${driftLive.logSha256}`,
    ),
  );

  const benchmark = runBenchmark(databaseUrls.fresh);
  const serverVersion = sqlScalar(
    'server-version',
    databaseUrls.fresh,
    "SELECT regexp_replace(current_setting('server_version'), '\\s.*$', '')",
  );
  if (!/^16\.\d+(?:\.\d+)?$/u.test(serverVersion)) {
    throw new Error('Release validation requires PostgreSQL 16.x.');
  }

  prismaDeploy('e2e-migration-deploy', databaseUrls.e2e);
  assertMigrationOnlyDatabase('e2e-migration-only-preflight', databaseUrls.e2e);
  const fullE2E = run(
    'full-e2e',
    'npm',
    ['run', 'test:e2e', '--', '--runInBand'],
    backendRoot,
    environment(databaseUrls.e2e),
    15 * 60_000,
  );
  checks.fullE2E = passCheck(fullE2E);

  return {
    git,
    releaseContentDigest,
    sourceMigrations,
    catalog,
    benchmark,
    serverVersion,
    database: databaseFingerprint(databaseUrls.fresh),
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function baseSubprocessEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'CI',
    'COLORTERM',
    'FORCE_COLOR',
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LOGNAME',
    'NO_COLOR',
    'PATH',
    'SHELL',
    'TEMP',
    'TERM',
    'TMP',
    'TMPDIR',
    'USER',
  ] as const;
  const environment: NodeJS.ProcessEnv = { TZ: 'UTC' };
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function databaseUrl(databaseName: string): string {
  const value = new URL(adminUrl);
  value.pathname = `/${databaseName}`;
  value.search = '';
  value.searchParams.set('schema', 'public');
  return value.toString();
}

function boundedPrismaUrl(databaseUrl: string): string {
  const value = new URL(databaseUrl);
  value.searchParams.set('options', pgOptions);
  return value.toString();
}

function psqlUrl(prismaUrl: string): string {
  const value = new URL(prismaUrl);
  value.searchParams.delete('schema');
  return value.toString();
}

function environment(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...baseSubprocessEnvironment(),
    NODE_ENV: 'test',
    JWT_SECRETS: JSON.stringify({ 'release-test': disposableJwtKey }),
    JWT_ACTIVE_KID: 'release-test',
    AUTH_PASSWORD_PEPPER: disposablePasswordPepper,
    MEDIA_INGESTION_ENABLED: 'true',
    MEDIA_STORAGE_BUCKET: 'disposable-media-test',
    MEDIA_STORAGE_REGION: 'ap-southeast-1',
    MEDIA_SCANNER_HOST: '127.0.0.1',
    MEDIA_SIGNING_SECRET: disposableJwtKey,
    MEDIA_METRICS_BEARER_TOKEN: disposablePasswordPepper,
    MEDIA_METRICS_HOST: '127.0.0.1',
    MEDIA_METRICS_PORT: '0',
    DATABASE_URL: boundedPrismaUrl(databaseUrl),
    TEST_DATABASE_URL: psqlUrl(databaseUrl),
    PGOPTIONS: pgOptions,
  };
}

function concurrencyEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...environment(databaseUrl),
    PGOPTIONS: [
      '-c lock_timeout=10000ms',
      `-c statement_timeout=${String(MEDIA_MIGRATION_TIMEOUTS_MS.statement)}ms`,
      `-c idle_in_transaction_session_timeout=${String(
        MEDIA_MIGRATION_TIMEOUTS_MS.idleInTransaction,
      )}ms`,
    ].join(' '),
  };
}

function prepareEvidenceRoot(): void {
  mkdirSync(logsRoot, { recursive: true, mode: 0o700 });
  if (
    lstatSync(evidenceRoot).isSymbolicLink() ||
    lstatSync(logsRoot).isSymbolicLink()
  ) {
    throw new Error('Migration evidence roots must not be symbolic links.');
  }
  for (const entry of readdirSync(logsRoot)) {
    if (!/^media-release-[a-z0-9-]+\.log$/u.test(entry)) continue;
    const info = lstatSync(join(logsRoot, entry));
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('Migration evidence log root contains an unsafe entry.');
    }
    rmSync(join(logsRoot, entry));
  }
  for (const artifact of [evidencePath, junitPath, manifestPath]) {
    if (!existsSync(artifact)) continue;
    const info = lstatSync(artifact);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('Migration evidence artifact path is unsafe.');
    }
    rmSync(artifact);
  }
}

function run(
  commandRef: string,
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  expected?: ExpectedCommandAbort,
): CommandResult {
  const commandStarted = Date.now();
  const commandStartedAt = new Date(commandStarted).toISOString();
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.error) {
    throw new Error(
      `${commandRef} failed to execute: ${redactMigrationDiagnostic(
        result.error.message,
      )}`,
    );
  }
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const actualExit = result.status ?? 1;
  const combined = `${stdout}\n${stderr}`;
  const matchedAbort = expected
    ? 'classify' in expected
      ? expected.classify(actualExit, combined)
      : actualExit === expected.exitCode && expected.pattern.test(combined)
        ? expected.expectedAbort
        : undefined
    : undefined;
  if (expected ? matchedAbort === undefined : actualExit !== 0) {
    throw new Error(
      `${commandRef} failed: ${redactMigrationDiagnostic(combined)}`,
    );
  }
  const normalized = expected
    ? `EXPECTED_ABORT ${String(actualExit)} ${
        'classify' in expected ? expected.label : expected.pattern.source
      }\n${combined}`
    : combined;
  const recorded = recordCommand(
    commandRef,
    normalized,
    Date.now() - commandStarted,
    {
      executable,
      args,
      cwd,
      env,
      exitCode: actualExit,
      startedAt: commandStartedAt,
      completedAt: new Date().toISOString(),
      expectedAbort: matchedAbort,
    },
  );
  return {
    ...recorded,
    stdout: redactMigrationDiagnostic(stdout),
    stderr: redactMigrationDiagnostic(stderr),
  };
}

function recordCommand(
  commandRef: string,
  log: string,
  durationMs: number,
  metadata: {
    executable?: string;
    args?: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    exitCode?: number;
    startedAt?: string;
    completedAt?: string;
    expectedAbort?: CommandEvidence['expectedAbort'];
  } = {},
): CommandResult {
  const id = commandRef;
  if (commands.some((command) => command.id === id)) {
    throw new Error(`Duplicate command evidence ID: ${id}.`);
  }
  const sanitized = redactMigrationDiagnostic(log);
  const logPath = `logs/media-release-${id}.log`;
  writeAtomic(resolve(evidenceRoot, logPath), sanitized);
  const executable = metadata.executable ?? 'internal-evidence';
  const identity = executableMetadata(executable);
  const evidence: CommandEvidence = {
    id,
    commandRef,
    outcome: 'PASS',
    exitCode: metadata.exitCode ?? 0,
    durationMs,
    logPath,
    logSha256: sha256(sanitized),
    platform: `${process.platform}/${process.arch}`,
    role: 'auxiliary',
    executable: basename(executable),
    executableIdentity: identity.path,
    executableSha256: identity.digest,
    toolVersion: identity.version,
    safeArgs: (metadata.args ?? []).map(safeArgument),
    cwd: resolve(metadata.cwd ?? backendRoot),
    envKeys: evidenceEnvironmentKeys(metadata.env ?? {}),
    startedAt: metadata.startedAt ?? new Date().toISOString(),
    completedAt: metadata.completedAt ?? new Date().toISOString(),
    gitCommit: evidenceBinding.gitCommit,
    gitTreeSha: evidenceBinding.gitTreeSha,
    releaseContentDigest: evidenceBinding.releaseContentDigest,
    inputTreeDigest: evidenceBinding.releaseContentDigest,
    ...(metadata.expectedAbort
      ? { expectedAbort: metadata.expectedAbort }
      : {}),
  };
  commands.push(evidence);
  return { ...evidence, stdout: sanitized, stderr: '' };
}

function bindCommand(command: CommandEvidence): void {
  command.gitCommit = evidenceBinding.gitCommit;
  command.gitTreeSha = evidenceBinding.gitTreeSha;
  command.releaseContentDigest = evidenceBinding.releaseContentDigest;
  command.inputTreeDigest = evidenceBinding.releaseContentDigest;
}

function safeArgument(value: string): string {
  const redacted = redactMigrationDiagnostic(value);
  return redacted
    .replace(/\[REDACTED_(?:DATABASE_URL|CREDENTIALS)\]/gu, '[REDACTED]')
    .slice(0, 512);
}

function evidenceEnvironmentKeys(env: NodeJS.ProcessEnv): string[] {
  const allowlist = new Set([
    'DATABASE_URL',
    'MEDIA_INGESTION_ENABLED',
    'MEDIA_METRICS_PORT',
    'NODE_ENV',
    'PGOPTIONS',
    'TEST_DATABASE_URL',
  ]);
  return Object.keys(env)
    .filter((key) => allowlist.has(key))
    .sort((left, right) => left.localeCompare(right));
}

function executableMetadata(executable: string): {
  path: string;
  digest: string;
  version: string;
} {
  if (executable === 'internal-evidence') {
    const source = resolve(
      backendRoot,
      'scripts/test/run-media-lifecycle-migration-release-validation.ts',
    );
    const digest = sha256(readFileSync(source));
    return {
      path: 'internal:database-evidence',
      digest,
      version: 'internal-v1',
    };
  }
  const candidates = executable.includes('/')
    ? [resolve(executable)]
    : (process.env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, executable));
  const path = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (!path) {
    throw new Error(
      `Executable identity is unavailable: ${basename(executable)}.`,
    );
  }
  const digest = sha256(readFileSync(path));
  return { path, digest, version: `sha256:${digest}` };
}

function commandEvidence(commandRef: string, value: string): CommandResult {
  return recordCommand(commandRef, value, 0);
}

function scalarCommand(
  commandRef: string,
  executable: string,
  args: string[],
  cwd: string,
): string {
  const result = run(
    commandRef,
    executable,
    args,
    cwd,
    baseSubprocessEnvironment(),
    5_000,
  );
  const value = result.stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(`${commandRef} returned an invalid Git object ID.`);
  }
  return value;
}

function createDatabase(databaseName: string): void {
  if (!/^hsk_media_[a-f0-9]{12}_[a-z0-9_]+_test$/u.test(databaseName)) {
    throw new Error('Generated database name escaped the task-owned policy.');
  }
  assertDatabaseAbsent(databaseName);
  const commandRef = `create-${databaseName}`;
  const commandStarted = Date.now();
  const result = spawnSync(
    'createdb',
    [
      `--maintenance-db=${psqlUrl(adminUrl)}`,
      '--template=template0',
      databaseName,
    ],
    {
      cwd: backendRoot,
      env: { ...baseSubprocessEnvironment(), PGOPTIONS: pgOptions },
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `${commandRef} failed: ${redactMigrationDiagnostic(
        result.error?.message ??
          `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      )}`,
    );
  }
  createdDatabaseNames.push(databaseName);
  recordCommand(
    commandRef,
    `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    Date.now() - commandStarted,
  );
}

function assertDatabaseAbsent(databaseName: string): void {
  if (!/^hsk_media_[a-f0-9]{12}_[a-z0-9_]+_test$/u.test(databaseName)) {
    throw new Error('Database absence check received an unsafe name.');
  }
  const result = spawnSync(
    'psql',
    [
      psqlUrl(adminUrl),
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `SELECT COUNT(*) FROM pg_database WHERE datname = '${databaseName}'`,
    ],
    {
      cwd: backendRoot,
      env: { ...baseSubprocessEnvironment(), PGOPTIONS: pgOptions },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  if (result.status !== 0 || result.stdout.trim() !== '0') {
    throw new Error(
      'Release validation database already exists or cannot be checked.',
    );
  }
}

function prismaDeploy(
  commandRef: string,
  databaseUrl: string,
  customSchema = schemaPath,
): CommandResult {
  if (customSchema === schemaPath) {
    return run(
      commandRef,
      'npm',
      ['run', 'migrate:deploy:production'],
      backendRoot,
      environment(databaseUrl),
      MEDIA_MIGRATION_TIMEOUTS_MS.command + 5_000,
    );
  }
  return run(
    commandRef,
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', customSchema],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
}

function psqlFile(
  commandRef: string,
  databaseUrl: string,
  file: string,
): CommandResult {
  return run(
    commandRef,
    'psql',
    [psqlUrl(databaseUrl), '-X', '-v', 'ON_ERROR_STOP=1', '-f', file],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
}

function expectedP0001(commandRef: string, databaseUrl: string): CommandResult {
  return run(
    commandRef,
    'psql',
    [
      psqlUrl(databaseUrl),
      '-X',
      '--set=VERBOSITY=verbose',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      resolve(
        migrationRoot,
        MEDIA_MIGRATION_NAMES.auditIntegrity,
        'migration.sql',
      ),
    ],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
    {
      exitCode: 3,
      pattern: /P0001.*malformed immutable audit/isu,
      expectedAbort: {
        exitCode: 3,
        sqlstate: 'P0001',
        stage: 'direct-migration',
      },
    },
  );
}

function assertAtomicRollback(
  databaseUrl: string,
  appliedMigrations: number,
  auditRows: number,
): void {
  const value = sqlScalar(
    `atomic-rollback-${basename(new URL(databaseUrl).pathname)}`,
    databaseUrl,
    `
      SELECT
        (SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL)::text || '|' ||
        (SELECT COUNT(*) FROM pg_proc WHERE proname IN (
          'hsk_is_valid_media_cleanup_audit',
          'hsk_is_valid_current_media_cleanup_audit',
          'hsk_guard_media_cleanup_audit',
          'hsk_require_media_cleanup_audit'
        ))::text || '|' ||
        (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN (
          'AuditLog_media_cleanup_integrity',
          'MediaIngestion_cleanup_audit_required'
        ))::text || '|' ||
        (SELECT COUNT(*) FROM "AuditLog")::text
    `,
  );
  if (value !== `${String(appliedMigrations)}|0|0|${String(auditRows)}`) {
    throw new Error('Negative migration did not roll back atomically.');
  }
}

function sqlScalar(
  commandRef: string,
  databaseUrl: string,
  sql: string,
): string {
  const result = run(
    commandRef,
    'psql',
    [
      psqlUrl(databaseUrl),
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    backendRoot,
    environment(databaseUrl),
    15_000,
  );
  const value = result.stdout.trim();
  if (!value || value.includes('\n')) {
    throw new Error(`${commandRef} did not return one scalar row.`);
  }
  return value;
}

function readCatalog(databaseUrl: string, commandRef = 'migration-catalog') {
  const result = run(
    commandRef,
    'psql',
    [
      psqlUrl(databaseUrl),
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `
      SELECT string_agg(migration_name || ':' || checksum, E'\\n' ORDER BY migration_name)
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `,
    ],
    backendRoot,
    environment(databaseUrl),
    15_000,
  );
  const output = result.stdout.trim();
  if (!output) throw new Error(`${commandRef} returned an empty catalog.`);
  return output.split('\n').map((line) => {
    const separator = line.indexOf(':');
    return {
      name: line.slice(0, separator),
      checksum: line.slice(separator + 1),
    };
  });
}

function migrationSources(): Array<{ name: string; checksum: string }> {
  return readMigrationSourceCatalog(migrationRoot).migrations;
}

function catalogChecksum(
  migrations: Array<{ name: string; checksum: string }>,
): string {
  const ordered = [...migrations].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  return sha256(
    ordered.map(({ name, checksum }) => `${name}\0${checksum}\n`).join(''),
  );
}

function assertCatalog(
  catalog: Array<{ name: string; checksum: string }>,
  source: Array<{ name: string; checksum: string }>,
): void {
  if (catalog.length !== 19 || source.length !== 19) {
    throw new Error(
      'Migration catalog must contain exactly 19 applied migrations.',
    );
  }
  for (const [index, migration] of source.entries()) {
    const row = catalog[index];
    if (row?.name !== migration.name || row.checksum !== migration.checksum) {
      throw new Error(`Migration checksum mismatch for ${migration.name}.`);
    }
  }
}

function assertMigrationOnlyDatabase(
  commandRef: string,
  databaseUrl: string,
): void {
  const counts = parseCountRow(
    sqlScalar(
      commandRef,
      databaseUrl,
      `SELECT
        (SELECT COUNT(*) FROM "User")::text || '|' ||
        (SELECT COUNT(*) FROM "Media")::text || '|' ||
        (SELECT COUNT(*) FROM "MediaIngestion")::text || '|' ||
        (SELECT COUNT(*) FROM "AuditLog")::text`,
    ),
  );
  assertExactMigrationOnlyCounts(counts);
}

function assertFirst18State(commandRef: string, databaseUrl: string): void {
  const value = sqlScalar(
    commandRef,
    databaseUrl,
    `SELECT
      (SELECT COUNT(*) FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' ||
      (SELECT COUNT(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='MediaIngestion'
         AND column_name='cleanupRequiredAt')::text`,
  );
  if (value !== '18|1') {
    throw new Error(
      'Negative migration fixture requires exact migration18 state.',
    );
  }
}

function verifyPositiveUpgrade(databaseUrl: string): CommandResult {
  const value = sqlScalar(
    'upgrade-positive-backfill-state',
    databaseUrl,
    `SELECT
      COUNT(*)::text || '|' ||
      bool_and(ingestion."cleanupRequiredAt" = (
        SELECT MIN(audit."createdAt")
        FROM "AuditLog" audit
        WHERE audit."targetId" = ingestion.id::text
          AND audit."afterSummary" ->> 'status' = 'cleanup_required'
      ))::text || '|' ||
      bool_and(clock_timestamp() - ingestion."cleanupRequiredAt" > INTERVAL '1 hour')::text || '|' ||
      (SELECT tgenabled FROM pg_trigger
       WHERE tgname='MediaIngestion_lifecycle_guard' AND NOT tgisinternal)::text || '|' ||
      (SELECT COUNT(*) FROM pg_proc
       WHERE proname='hsk_is_valid_current_media_cleanup_audit')::text
    FROM "MediaIngestion" ingestion
    WHERE ingestion."idempotencyKeyHash" IN (repeat('2', 64), repeat('5', 64))`,
  );
  if (value !== '2|true|true|O|1' && value !== '2|t|t|O|1') {
    throw new Error(
      'Legacy cleanup timestamp backfill was not preserved exactly.',
    );
  }
  return commandEvidence('upgrade-positive-backfill-proof', value);
}

function buildHistoricalMigrationRoots(): {
  first17SchemaPath: string;
  first18SchemaPath: string;
} {
  return {
    first17SchemaPath: buildHistoricalMigrationRoot(
      'first17',
      new Set([
        MEDIA_MIGRATION_NAMES.lifecycle,
        MEDIA_MIGRATION_NAMES.auditIntegrity,
      ]),
    ),
    first18SchemaPath: buildHistoricalMigrationRoot(
      'first18',
      new Set([MEDIA_MIGRATION_NAMES.auditIntegrity]),
    ),
  };
}

function buildHistoricalMigrationRoot(
  label: 'first17' | 'first18',
  excluded: ReadonlySet<string>,
): string {
  const temporary = mkdtempSync(join(tmpdir(), `hsk-media-${label}-`));
  temporaryRoots.push(temporary);
  const migrations = resolve(temporary, 'migrations');
  mkdirSync(migrations, { mode: 0o700 });
  cpSync(schemaPath, resolve(temporary, 'schema.prisma'));
  cpSync(
    resolve(migrationRoot, 'migration_lock.toml'),
    resolve(migrations, 'migration_lock.toml'),
  );
  for (const entry of readdirSync(migrationRoot)) {
    if (entry === 'migration_lock.toml' || excluded.has(entry)) {
      continue;
    }
    const source = resolve(migrationRoot, entry);
    if (statSync(source).isDirectory()) {
      cpSync(source, resolve(migrations, entry), { recursive: true });
    }
  }
  return resolve(temporary, 'schema.prisma');
}

async function runBoundedMigrationLockRehearsal(
  databaseUrl: string,
  recoveryDatabaseUrl: string,
  roots: { first17SchemaPath: string; first18SchemaPath: string },
): Promise<CommandResult> {
  const startedCommand = Date.now();
  prismaDeploy(
    'lock-abort-first18-deploy',
    databaseUrl,
    roots.first18SchemaPath,
  );
  assertFirst18State('lock-abort-first18-preflight', databaseUrl);
  const holder = spawnTracked(
    databaseUrl,
    `
    SET application_name='media_release_migration_lock_holder';
    BEGIN;
    LOCK TABLE "AuditLog" IN ACCESS EXCLUSIVE MODE;
    SELECT pg_sleep(8);
    COMMIT;
  `,
  );
  await waitUntil(
    () =>
      probeScalar(
        databaseUrl,
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
         WHERE application_name='media_release_migration_lock_holder'
           AND wait_event='PgSleep')`,
      ) === 't',
    'Bounded migration lock holder did not reach its barrier.',
  );
  const attempt = spawnBoundedPrismaDeploy(databaseUrl);
  const attemptResult = await awaitTracked(
    attempt,
    MEDIA_MIGRATION_TIMEOUTS_MS.command + 5_000,
  );
  const attemptOutput = `${attemptResult.stdout}\n${attemptResult.stderr}`;
  if (
    attemptResult.exitCode !== BOUNDED_MIGRATION_EXIT_CODES.lockTimeout ||
    !/\b55P03\b/iu.test(attemptOutput) ||
    !/Bounded Prisma migration deploy aborted: database lock timeout/iu.test(
      attemptOutput,
    )
  ) {
    throw new Error(
      `Bounded migration did not abort on exact lock timeout: ${redactMigrationDiagnostic(
        attemptOutput,
      )}`,
    );
  }
  const lockAttemptEvidence = recordCommand(
    'lock-abort-bounded-deploy-attempt',
    attemptOutput,
    attemptResult.durationMs,
    {
      executable: 'npm',
      args: ['run', 'migrate:deploy:production'],
      cwd: backendRoot,
      env: environment(databaseUrl),
      exitCode: BOUNDED_MIGRATION_EXIT_CODES.lockTimeout,
      startedAt: attemptResult.startedAt,
      completedAt: attemptResult.completedAt,
      expectedAbort: {
        exitCode: 75,
        sqlstate: '55P03',
        stage: 'lock-preflight',
      },
    },
  );
  const holderResult = await awaitTracked(holder, 12_000);
  if (holderResult.exitCode !== 0) {
    throw new Error('Bounded migration lock holder did not commit cleanly.');
  }
  const beforeRecovery = readCatalog(
    databaseUrl,
    'lock-abort-catalog-after-abort',
  );
  if (beforeRecovery.length !== 18) {
    throw new Error(
      'Lock-timeout migration attempt did not roll back atomically.',
    );
  }
  const atomicState = sqlScalar(
    'lock-abort-atomic-state',
    databaseUrl,
    `SELECT
      (SELECT COUNT(*) FROM pg_proc WHERE proname IN (
        'hsk_is_valid_media_cleanup_audit',
        'hsk_is_valid_current_media_cleanup_audit',
        'hsk_guard_media_cleanup_audit',
        'hsk_require_media_cleanup_audit'
      ))::text || '|' ||
      (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN (
        'AuditLog_media_cleanup_integrity',
        'MediaIngestion_cleanup_audit_required'
      ))::text`,
  );
  if (atomicState !== '0|0') {
    throw new Error(
      'Lock-timeout migration19 left partial functions or triggers.',
    );
  }
  const lockAttemptRows = sqlScalar(
    'lock-abort-no-failed-row',
    databaseUrl,
    `SELECT COUNT(*) FROM "_prisma_migrations"
     WHERE migration_name='${MEDIA_MIGRATION_NAMES.auditIntegrity}'`,
  );
  if (lockAttemptRows !== '0') {
    throw new Error(
      'Bounded lock preflight must not create a failed migration row.',
    );
  }
  const recovery = prismaDeploy('lock-abort-recovery-deploy', databaseUrl);
  const afterRecovery = readCatalog(
    databaseUrl,
    'lock-abort-catalog-after-recovery',
  );
  assertCatalog(afterRecovery, migrationSources());
  const lockFinalState = assertResolvedMigrationState(
    'lock-abort-final-state',
    databaseUrl,
    0,
    1,
  );

  prismaDeploy(
    'lock-abort-recovery-first18-deploy',
    recoveryDatabaseUrl,
    roots.first18SchemaPath,
  );
  assertFirst18State(
    'lock-abort-recovery-first18-preflight',
    recoveryDatabaseUrl,
  );
  const driftFixture = psqlFile(
    'lock-abort-recovery-timestamp-drift-fixture',
    recoveryDatabaseUrl,
    resolve(
      backendRoot,
      'test/database/media-cleanup-audit-integrity-timestamp-drift.fixture.sql',
    ),
  );
  const driftPreflight = assertTimestampDriftFixture(recoveryDatabaseUrl);
  const failedDeploy = expectedPrismaTimestampDrift(
    'lock-abort-recovery-failed-deploy',
    recoveryDatabaseUrl,
  );
  const exactDriftAbort = expectedDirectTimestampDrift(
    'lock-abort-recovery-direct-p0001',
    recoveryDatabaseUrl,
  );
  assertAtomicRollback(recoveryDatabaseUrl, 18, 1);
  const driftFailedState = assertFailedMigrationRow(
    'lock-abort-recovery-failed-row',
    recoveryDatabaseUrl,
  );
  const blockedRetry = expectedPrismaFailedRowBlock(recoveryDatabaseUrl);
  const reconcile = psqlFile(
    'lock-abort-recovery-reconcile',
    recoveryDatabaseUrl,
    resolve(
      backendRoot,
      'test/database/media-cleanup-audit-integrity-timestamp-drift-reconcile.fixture.sql',
    ),
  );
  const reconciledState = assertTimestampDriftReconciled(recoveryDatabaseUrl);
  assertResolvePreconditions(
    'lock-abort-recovery-resolve-preconditions',
    recoveryDatabaseUrl,
    true,
  );
  const driftResolve = prismaResolveRolledBack(
    'lock-abort-recovery-resolve-rolled-back',
    recoveryDatabaseUrl,
  );
  const driftResolvedState = assertResolvedMigrationState(
    'lock-abort-recovery-resolved-state',
    recoveryDatabaseUrl,
    1,
    0,
  );
  const driftRecovery = prismaDeploy(
    'lock-abort-recovery-forward-deploy',
    recoveryDatabaseUrl,
  );
  const recoveryStatus = migrationStatus(
    'lock-abort-recovery-migrate-status',
    recoveryDatabaseUrl,
  );
  const recoveryCatalog = readCatalog(
    recoveryDatabaseUrl,
    'lock-abort-recovery-final-catalog',
  );
  assertCatalog(recoveryCatalog, migrationSources());
  const driftFinalState = assertResolvedMigrationState(
    'lock-abort-recovery-final-state',
    recoveryDatabaseUrl,
    1,
    1,
  );
  const recoveryDrift = runRecoveryDrift(recoveryDatabaseUrl);
  return recordCommand(
    'bounded-migration-abort',
    [
      `current_migration=19 sqlstate=55P03 exit=${String(
        BOUNDED_MIGRATION_EXIT_CODES.lockTimeout,
      )} duration_ms=${String(attemptResult.durationMs)} output_sha256=${lockAttemptEvidence.logSha256} atomic_catalog=18 functions=0 triggers=0`,
      `lock_preflight_rows=${lockAttemptRows} resolve=not-required`,
      `lock_recovery_catalog=19 recovery_log=${recovery.logSha256} final=${lockFinalState}`,
      `timestamp_drift_preflight=${driftPreflight} fixture_log=${driftFixture.logSha256}`,
      `failed_deploy=${failedDeploy.logSha256} direct_p0001=${exactDriftAbort.logSha256} failed_row=${driftFailedState} blocked_retry=${blockedRetry.logSha256} blocked_retry_duration_ms=${String(
        blockedRetry.durationMs,
      )}`,
      `reconcile=${reconcile.logSha256} reconciled=${reconciledState} resolve=${driftResolve.logSha256} resolved=${driftResolvedState}`,
      `forward=${driftRecovery.logSha256} status=${recoveryStatus.logSha256} final=${driftFinalState} drift=${recoveryDrift}`,
    ].join('\n'),
    Date.now() - startedCommand,
    {
      startedAt: new Date(startedCommand).toISOString(),
      completedAt: new Date().toISOString(),
    },
  );
}

function spawnBoundedPrismaDeploy(databaseUrl: string): ChildProcess {
  return trackChild(
    spawn('npm', ['run', 'migrate:deploy:production'], {
      cwd: backendRoot,
      env: environment(databaseUrl),
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

function expectedPrismaTimestampDrift(
  commandRef: string,
  databaseUrl: string,
): CommandResult {
  return run(
    commandRef,
    'npm',
    ['run', 'migrate:deploy:production'],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command + 5_000,
    {
      label: 'exact-prisma-timestamp-drift-abort',
      classify: classifyPrismaTimestampDriftAbort,
    },
  );
}

function expectedDirectTimestampDrift(
  commandRef: string,
  databaseUrl: string,
): CommandResult {
  return run(
    commandRef,
    'psql',
    [
      psqlUrl(databaseUrl),
      '-X',
      '--set=VERBOSITY=verbose',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      resolve(
        migrationRoot,
        MEDIA_MIGRATION_NAMES.auditIntegrity,
        'migration.sql',
      ),
    ],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
    {
      exitCode: 3,
      pattern:
        /P0001.*Media cleanup lifecycle lacks an exact authoritative audit timestamp/isu,
      expectedAbort: {
        exitCode: 3,
        sqlstate: 'P0001',
        stage: 'direct-migration',
      },
    },
  );
}

function expectedPrismaFailedRowBlock(databaseUrl: string): CommandResult {
  return run(
    'lock-abort-recovery-p3009-retry',
    'npm',
    ['run', 'migrate:deploy:production'],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command + 5_000,
    {
      exitCode: 1,
      pattern: /\bP3009\b/iu,
      expectedAbort: { exitCode: 1, prismaCode: 'P3009' },
    },
  );
}

function prismaResolveRolledBack(
  commandRef: string,
  databaseUrl: string,
): CommandResult {
  return run(
    commandRef,
    'npm',
    ['run', 'migrate:resolve:media-cleanup-audit:production'],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command + 5_000,
  );
}

function assertFailedMigrationRow(
  commandRef: string,
  databaseUrl: string,
): string {
  const checksum = migrationSources().find(
    ({ name }) => name === MEDIA_MIGRATION_NAMES.auditIntegrity,
  )?.checksum;
  if (!checksum) throw new Error('Migration 19 source checksum is absent.');
  const value = sqlScalar(
    commandRef,
    databaseUrl,
    `SELECT
      COUNT(*)::text || '|' ||
      COALESCE(bool_and(checksum='${checksum}'), false)::text || '|' ||
      COALESCE(bool_and(finished_at IS NULL), false)::text || '|' ||
      COALESCE(bool_and(rolled_back_at IS NULL), false)::text || '|' ||
      COALESCE(bool_and(started_at IS NOT NULL), false)::text || '|' ||
      COALESCE(bool_and(logs IS NULL OR length(logs) > 0), false)::text || '|' ||
      COALESCE(bool_and(logs IS NOT NULL), false)::text
    FROM "_prisma_migrations"
    WHERE migration_name='${MEDIA_MIGRATION_NAMES.auditIntegrity}'`,
  );
  if (
    value !== '1|true|true|true|true|true|false' &&
    value !== '1|true|true|true|true|true|true' &&
    value !== '1|t|t|t|t|t|f' &&
    value !== '1|t|t|t|t|t|t'
  ) {
    throw new Error(
      'Prisma failed migration row is absent or has unsafe retained-log state.',
    );
  }
  return value;
}

function assertResolvePreconditions(
  commandRef: string,
  databaseUrl: string,
  requiresExactAudit: boolean,
): void {
  const value = sqlScalar(
    commandRef,
    databaseUrl,
    `SELECT
      (SELECT COUNT(*) FROM "_prisma_migrations"
       WHERE migration_name='${MEDIA_MIGRATION_NAMES.auditIntegrity}'
         AND finished_at IS NULL AND rolled_back_at IS NULL)::text || '|' ||
      (SELECT COUNT(*) FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' ||
      (SELECT COUNT(*) FROM pg_proc WHERE proname IN (
        'hsk_is_valid_media_cleanup_audit',
        'hsk_is_valid_current_media_cleanup_audit',
        'hsk_guard_media_cleanup_audit',
        'hsk_require_media_cleanup_audit'
      ))::text || '|' ||
      (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN (
        'AuditLog_media_cleanup_integrity',
        'MediaIngestion_cleanup_audit_required'
      ))::text || '|' ||
      (SELECT COUNT(*) FROM "MediaIngestion" ingestion
       WHERE ingestion."idempotencyKeyHash"=repeat('2', 64)
         AND EXISTS (
           SELECT 1 FROM "AuditLog" audit
           WHERE audit."targetType"='media_ingestion'
             AND audit."targetId"=ingestion.id::text
             AND audit."createdAt"=ingestion."cleanupRequiredAt"
             AND audit."afterSummary" ->> 'status'='cleanup_required'
         ))::text`,
  );
  const expected = requiresExactAudit ? '1|18|0|0|1' : '1|18|0|0|0';
  if (value !== expected) {
    throw new Error('Migration resolve preconditions are not satisfied.');
  }
}

function assertResolvedMigrationState(
  commandRef: string,
  databaseUrl: string,
  rolledBackRows: number,
  successfulRows: number,
): string {
  const value = sqlScalar(
    commandRef,
    databaseUrl,
    `SELECT
      COUNT(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text || '|' ||
      COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text
    FROM "_prisma_migrations"
    WHERE migration_name='${MEDIA_MIGRATION_NAMES.auditIntegrity}'`,
  );
  if (value !== `${String(rolledBackRows)}|${String(successfulRows)}`) {
    throw new Error('Prisma migration resolve/deploy state is invalid.');
  }
  return value;
}

function assertTimestampDriftFixture(databaseUrl: string): string {
  const value = sqlScalar(
    'lock-abort-recovery-timestamp-drift-preflight',
    databaseUrl,
    `SELECT
      COUNT(*)::text || '|' ||
      COALESCE(bool_and(
        audit.action='media.ingestion_cleanup_failed'
        AND audit."targetType"='media_ingestion'
        AND audit."targetId"=ingestion.id::text
        AND audit."afterSummary" ->> 'ingestionId'=ingestion.id::text
        AND audit."afterSummary" ->> 'status'='cleanup_required'
        AND audit."afterSummary" ->> 'failureCode'='OBJECT_CLEANUP_REQUIRED'
        AND audit."createdAt" >= ingestion."cleanupRequiredAt"
        AND audit."createdAt" <= clock_timestamp()::timestamp(3)
      ), false)::text || '|' ||
      COALESCE(bool_and(audit."createdAt" <> ingestion."cleanupRequiredAt"), false)::text
    FROM "MediaIngestion" ingestion
    JOIN "AuditLog" audit ON audit."targetId"=ingestion.id::text
    WHERE ingestion."idempotencyKeyHash"=repeat('2', 64)`,
  );
  if (value !== '1|true|true' && value !== '1|t|t') {
    throw new Error('Timestamp-drift fixture is malformed or not exact.');
  }
  return value;
}

function assertTimestampDriftReconciled(databaseUrl: string): string {
  const value = sqlScalar(
    'lock-abort-recovery-reconciled-state',
    databaseUrl,
    `SELECT
      COUNT(*)::text || '|' ||
      COUNT(*) FILTER (
        WHERE audit."createdAt"=ingestion."cleanupRequiredAt"
          AND audit.action='media.ingestion_failed'
      )::text || '|' ||
      COUNT(*) FILTER (
        WHERE audit."createdAt"<>ingestion."cleanupRequiredAt"
          AND audit.action='media.ingestion_cleanup_failed'
      )::text
    FROM "MediaIngestion" ingestion
    JOIN "AuditLog" audit ON audit."targetId"=ingestion.id::text
    WHERE ingestion."idempotencyKeyHash"=repeat('2', 64)`,
  );
  if (value !== '2|1|1') {
    throw new Error('Forward timestamp-drift reconciliation is not exact.');
  }
  return value;
}

function migrationStatus(
  commandRef: string,
  databaseUrl: string,
): CommandResult {
  const result = run(
    commandRef,
    process.execPath,
    [resolveLocalPrismaCli(), 'migrate', 'status', '--schema', schemaPath],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
  if (!/Database schema is up to date!/u.test(result.stdout)) {
    throw new Error('Recovered migration status is not up to date.');
  }
  return result;
}

function runRecoveryDrift(databaseUrl: string): string {
  const history = run(
    'lock-abort-recovery-drift-history',
    process.execPath,
    [
      resolveLocalPrismaCli(),
      'migrate',
      'diff',
      '--from-migrations',
      migrationRoot,
      '--to-schema-datamodel',
      schemaPath,
      '--shadow-database-url',
      shadowUrl,
      '--exit-code',
    ],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
  const live = run(
    'lock-abort-recovery-drift-live',
    process.execPath,
    [
      resolveLocalPrismaCli(),
      'migrate',
      'diff',
      '--from-url',
      databaseUrl,
      '--to-schema-datamodel',
      schemaPath,
      '--exit-code',
    ],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
  return `${history.logSha256}:${live.logSha256}`;
}

function spawnTracked(databaseUrl: string, sql: string): ChildProcess {
  return trackChild(
    spawn(
      'psql',
      [
        psqlUrl(databaseUrl),
        '-X',
        '--set=VERBOSITY=verbose',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        sql,
      ],
      {
        cwd: backendRoot,
        env: concurrencyEnvironment(databaseUrl),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  );
}

function trackChild(child: ChildProcess): ChildProcess {
  activeChildren.add(child);
  return child;
}

async function awaitTracked(child: ChildProcess, timeoutMs: number) {
  try {
    return await waitForBoundedChild(child, timeoutMs);
  } finally {
    activeChildren.delete(child);
  }
}

function probeScalar(databaseUrl: string, sql: string): string {
  const result = spawnSync(
    'psql',
    [
      psqlUrl(databaseUrl),
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    {
      cwd: backendRoot,
      env: environment(databaseUrl),
      encoding: 'utf8',
      timeout: 5_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Lock probe failed: ${redactMigrationDiagnostic(
        `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      )}`,
    );
  }
  return (result.stdout ?? '').trim();
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(message);
}

async function runLockConcurrency(databaseUrl: string): Promise<CommandResult> {
  const startedCommand = Date.now();
  const first = spawnTracked(
    databaseUrl,
    `
        SET application_name='media_release_lock_holder';
        BEGIN;
        LOCK TABLE "MediaIngestion" IN SHARE ROW EXCLUSIVE MODE;
        LOCK TABLE "AuditLog" IN SHARE ROW EXCLUSIVE MODE;
        SELECT pg_sleep(3);
        COMMIT;
      `,
  );
  await waitUntil(
    () =>
      probeScalar(
        databaseUrl,
        `SELECT COUNT(*) FROM pg_locks locks
         JOIN pg_class relation ON relation.oid=locks.relation
         JOIN pg_stat_activity activity ON activity.pid=locks.pid
         WHERE activity.application_name='media_release_lock_holder'
           AND locks.mode='ShareRowExclusiveLock' AND locks.granted
           AND relation.relname IN ('MediaIngestion', 'AuditLog')`,
      ) === '2',
    'Migration lock holder did not acquire both exact table locks.',
  );

  const second = spawnTracked(
    databaseUrl,
    `
        SET application_name='media_release_audit_writer';
        BEGIN;
        INSERT INTO "AuditLog" (action, "targetType", "afterSummary")
        VALUES ('synthetic.concurrent_audit', 'test', '{}'::jsonb);
        COMMIT;
      `,
  );
  const secondPid = second.pid;
  if (!secondPid) throw new Error('Concurrency audit writer did not start.');
  await waitUntil(
    () =>
      probeScalar(
        databaseUrl,
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
         WHERE application_name='media_release_audit_writer'
           AND wait_event_type='Lock')`,
      ) === 't',
    'Concurrent AuditLog writer was not observed waiting on a lock.',
  );
  const [firstResult, secondResult] = await Promise.all([
    awaitTracked(first, 10_000),
    awaitTracked(second, 10_000),
  ]);
  if (firstResult.exitCode !== 0 || secondResult.exitCode !== 0) {
    throw new Error('Concurrency rehearsal transactions did not both commit.');
  }
  const count = sqlScalar(
    'concurrency-final-count',
    databaseUrl,
    `SELECT COUNT(*) FROM "AuditLog" WHERE action='synthetic.concurrent_audit'`,
  );
  if (count !== '1')
    throw new Error('Concurrency rehearsal final state is invalid.');
  return recordCommand(
    'concurrency',
    `holder_locks=2 writer_wait_event_type=Lock writer_pid_present=${String(
      secondPid > 0,
    )} final_audit_count=1\n${firstResult.stdout}\n${secondResult.stdout}`,
    Date.now() - startedCommand,
  );
}

function runBenchmark(databaseUrl: string) {
  const fixtureRows = 1_000;
  const result = run(
    'benchmark',
    'psql',
    [
      psqlUrl(databaseUrl),
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `BEGIN;
      WITH actor AS (
        INSERT INTO "User" (email, password, role, status, "createdAt", "updatedAt")
        VALUES ('media-release-benchmark@example.test', 'synthetic-value', 'admin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      ), source AS (
        INSERT INTO "DataSource" (
          code, name, version, "referenceUrl", license, attribution,
          "contentHash", "createdById", "createdAt", "updatedAt"
        )
        SELECT 'MEDIA_RELEASE_BENCHMARK', 'Synthetic release benchmark', '2026.08',
          'https://example.test/media-release-benchmark', 'Synthetic fixture',
          'Synthetic attribution', repeat('1', 64), actor.id, CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP FROM actor RETURNING id, "createdById"
      ), ingestion AS (
        INSERT INTO "MediaIngestion" (
          "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint",
          status, "originalFilename", "declaredMimeType", size, "storageProvider",
          "processingToken", "attemptCount", "failureCode", "startedAt", "updatedAt"
        )
        SELECT "createdById", id, repeat('3', 64), repeat('4', 64), 'failed',
          'benchmark.png', 'image/png', 8, 'memory-test',
          'f8000000-0000-4000-8000-00000000008f', 1, 'STORAGE_WRITE_FAILED',
          CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP
        FROM source RETURNING id, "actorId", "startedAt"
      )
      INSERT INTO "AuditLog" (
        "actorId", action, "targetType", "targetId", "afterSummary", "createdAt"
      )
      SELECT ingestion."actorId", 'media.ingestion_failed', 'media_ingestion',
        ingestion.id::text,
        jsonb_build_object('ingestionId', ingestion.id, 'status', 'failed',
          'failureCode', 'STORAGE_WRITE_FAILED'), CURRENT_TIMESTAMP
      FROM ingestion;
      INSERT INTO "AuditLog" (
        action, "targetType", "targetId", "afterSummary", "createdAt"
      )
      SELECT 'synthetic.unrelated', 'unrelated_type', series::text,
        '{}'::jsonb, CURRENT_TIMESTAMP
      FROM generate_series(1, ${String(fixtureRows)}) series;
      ANALYZE "AuditLog";
      SET LOCAL enable_seqscan=off;
      EXPLAIN (ANALYZE, FORMAT JSON)
      SELECT EXISTS (
        SELECT 1
        FROM "AuditLog" audit
        JOIN "MediaIngestion" ingestion
          ON audit."targetId"=ingestion.id::text
        WHERE ingestion."idempotencyKeyHash"=repeat('3', 64)
          AND audit."targetType"='media_ingestion'
          AND audit."createdAt" >= ingestion."startedAt"
      );
      ROLLBACK;`,
    ],
    backendRoot,
    environment(databaseUrl),
    MEDIA_MIGRATION_TIMEOUTS_MS.command,
  );
  const start = result.stdout.indexOf('[\n  {');
  const end = result.stdout.lastIndexOf('\nROLLBACK');
  if (start < 0 || end <= start) {
    throw new Error('Representative benchmark returned invalid JSON evidence.');
  }
  const plan = JSON.parse(result.stdout.slice(start, end)) as Array<{
    Plan?: unknown;
    'Planning Time': number;
    'Execution Time': number;
  }>;
  const planningTimeMs = plan[0]?.['Planning Time'];
  const executionTimeMs = plan[0]?.['Execution Time'];
  const serializedPlan = JSON.stringify(plan[0]?.Plan ?? null);
  if (
    typeof planningTimeMs !== 'number' ||
    typeof executionTimeMs !== 'number' ||
    executionTimeMs > 5_000 ||
    !serializedPlan.includes('AuditLog_targetType_targetId_createdAt_idx')
  ) {
    throw new Error(
      'Representative exact-audit lookup missed its index or budget.',
    );
  }
  return { fixtureRows, planningTimeMs, executionTimeMs };
}

async function runAuditLifecycleRace(
  databaseUrl: string,
): Promise<CommandResult> {
  const startedCommand = Date.now();
  const audit = spawnTracked(
    databaseUrl,
    `
        SET application_name='media_release_audit_first';
        BEGIN;
        INSERT INTO "AuditLog" (
          "actorId", action, "targetType", "targetId", "afterSummary"
        )
        SELECT "actorId", 'media.ingestion_failed', 'media_ingestion', id::text,
          jsonb_build_object(
            'ingestionId', id,
            'status', 'failed',
            'failureCode', 'STORAGE_WRITE_FAILED'
          )
        FROM "MediaIngestion"
        WHERE "idempotencyKeyHash" = repeat('9', 64);
        SELECT pg_sleep(3);
        COMMIT;
      `,
  );
  await waitUntil(
    () =>
      probeScalar(
        databaseUrl,
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
         WHERE application_name='media_release_audit_first'
           AND wait_event='PgSleep')`,
      ) === 't',
    'Audit-first transaction did not reach its post-insert barrier.',
  );
  const update = spawnTracked(
    databaseUrl,
    `
        SET application_name='media_release_update_second';
        UPDATE "MediaIngestion"
        SET status='processing',
            "processingToken"='f5000000-0000-4000-8000-00000000005f',
            "failureCode"=NULL
        WHERE "idempotencyKeyHash" = repeat('9', 64)
      `,
  );
  await waitUntil(
    () =>
      probeScalar(
        databaseUrl,
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
         WHERE application_name='media_release_update_second'
           AND wait_event_type='Lock')`,
      ) === 't',
    'Audit-first lifecycle update did not wait on the parent row.',
  );
  const [auditResult, updateResult] = await Promise.all([
    awaitTracked(audit, 10_000),
    awaitTracked(update, 10_000),
  ]);
  if (auditResult.exitCode !== 0 || updateResult.exitCode !== 0) {
    throw new Error('Audit lifecycle race transactions did not both commit.');
  }
  const final = sqlScalar(
    'audit-race-final-state',
    databaseUrl,
    `
      SELECT status || '|' || COALESCE("failureCode", 'NULL') || '|' ||
        (SELECT COUNT(*) FROM "AuditLog" audit
          WHERE audit.action='media.ingestion_failed'
            AND audit."targetId"=ingestion.id::text)::text
      FROM "MediaIngestion" ingestion
      WHERE "idempotencyKeyHash"=repeat('9', 64)
    `,
  );
  if (final !== 'processing|NULL|1') {
    throw new Error('Audit lifecycle race final state violated serialization.');
  }

  const lifecycle = spawnTracked(
    databaseUrl,
    `
    SET application_name='media_release_lifecycle_first';
    BEGIN;
    UPDATE "MediaIngestion"
    SET status='processing',
        "processingToken"='f7000000-0000-4000-8000-00000000007f',
        "failureCode"=NULL
    WHERE "idempotencyKeyHash"=repeat('6', 64);
    SELECT pg_sleep(3);
    COMMIT;
  `,
  );
  await waitUntil(
    () =>
      probeScalar(
        databaseUrl,
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
         WHERE application_name='media_release_lifecycle_first'
           AND wait_event='PgSleep')`,
      ) === 't',
    'Lifecycle-first transaction did not reach its post-update barrier.',
  );
  const staleAudit = spawnTracked(
    databaseUrl,
    `
    SET application_name='media_release_stale_audit_second';
    INSERT INTO "AuditLog" (
      "actorId", action, "targetType", "targetId", "afterSummary"
    )
    SELECT "actorId", 'media.ingestion_failed', 'media_ingestion', id::text,
      jsonb_build_object(
        'ingestionId', id,
        'status', 'failed',
        'failureCode', 'STORAGE_WRITE_FAILED'
      )
    FROM "MediaIngestion"
    WHERE "idempotencyKeyHash"=repeat('6', 64)
  `,
  );
  await waitUntil(
    () =>
      probeScalar(
        databaseUrl,
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
         WHERE application_name='media_release_stale_audit_second'
           AND wait_event_type='Lock')`,
      ) === 't',
    'Lifecycle-first stale audit did not wait on the parent row.',
  );
  const [lifecycleResult, staleAuditResult] = await Promise.all([
    awaitTracked(lifecycle, 10_000),
    awaitTracked(staleAudit, 10_000),
  ]);
  const staleOutput = `${staleAuditResult.stdout}\n${staleAuditResult.stderr}`;
  if (
    lifecycleResult.exitCode !== 0 ||
    staleAuditResult.exitCode === 0 ||
    !/23514|AuditLog_media_cleanup_integrity/iu.test(staleOutput)
  ) {
    throw new Error(
      'Lifecycle-first stale audit was not rejected by the domain invariant.',
    );
  }
  const reverseFinal = sqlScalar(
    'audit-race-reverse-final-state',
    databaseUrl,
    `SELECT status || '|' || COALESCE("failureCode", 'NULL') || '|' ||
      (SELECT COUNT(*) FROM "AuditLog" audit
       WHERE audit.action='media.ingestion_failed'
         AND audit."targetId"=ingestion.id::text)::text
     FROM "MediaIngestion" ingestion
     WHERE "idempotencyKeyHash"=repeat('6', 64)`,
  );
  if (reverseFinal !== 'processing|NULL|0') {
    throw new Error('Lifecycle-first race left a stale immutable audit.');
  }
  return recordCommand(
    'audit-lifecycle-race',
    [
      'audit_first_update_second=blocked_then_both_committed final=processing|NULL|1',
      'lifecycle_first_audit_second=blocked_then_domain_rejected sqlstate=23514 final=processing|NULL|0',
    ].join('\n'),
    Date.now() - startedCommand,
  );
}

function passCheck(result: CommandResult) {
  const command = commands.find(({ id }) => id === result.id);
  if (!command) throw new Error(`Check command is absent: ${result.id}.`);
  if (command.role === 'check') {
    throw new Error(`Check command was reused: ${result.id}.`);
  }
  command.role = 'check';
  return { outcome: 'PASS' as const, commandId: result.id };
}

function computeBoundReleaseContentDigest(label: 'initial' | 'final'): string {
  const status = run(
    `git-status-binding-${label}`,
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    repositoryRoot,
    baseSubprocessEnvironment(),
    5_000,
  );
  return computeSharedReleaseContentDigest(repositoryRoot, status.stdout)
    .digest;
}

function renderJunit(git: { commit: string; treeSha: string }): string {
  const names = Object.keys(checks).sort((left, right) =>
    left.localeCompare(right),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="media-lifecycle-migration-release-validation" tests="${String(
      names.length,
    )}" failures="0">`,
    '  <properties>',
    `    <property name="runId" value="${runId}"/>`,
    `    <property name="commit" value="${git.commit}"/>`,
    `    <property name="treeSha" value="${git.treeSha}"/>`,
    '  </properties>',
    ...names.map(
      (name) => `  <testcase classname="database.release" name="${name}"/>`,
    ),
    '</testsuite>',
    '',
  ].join('\n');
}

function writeAtomicJson(path: string, value: unknown): void {
  assertSafeEvidence(value);
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeAtomic(path: string, value: string): void {
  const canonicalRoot = realpathSync(evidenceRoot);
  const targetDirectory = realpathSync(dirname(path));
  const child = relative(canonicalRoot, targetDirectory);
  if (child.startsWith('..') || isAbsolute(child)) {
    throw new Error('Evidence artifact escaped its task-owned root.');
  }
  const temporary = `${path}.${String(process.pid)}.tmp`;
  if (existsSync(temporary)) throw new Error('Evidence temporary path exists.');
  writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

async function cleanupTaskResources(): Promise<string[]> {
  const errors: string[] = [];
  for (const child of activeChildren) {
    child.kill('SIGTERM');
  }
  if (activeChildren.size > 0) {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  for (const child of activeChildren) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  activeChildren.clear();

  if (process.env.MEDIA_MIGRATION_RETAIN_DATABASES !== 'true') {
    for (const databaseName of [...createdDatabaseNames].reverse()) {
      if (!/^hsk_media_[a-f0-9]{12}_[a-z0-9_]+_test$/u.test(databaseName)) {
        errors.push('refused unsafe generated database cleanup target');
        continue;
      }
      try {
        const commandRef = `drop-${databaseName}`;
        const commandStarted = Date.now();
        const result = spawnSync(
          'dropdb',
          [`--maintenance-db=${psqlUrl(adminUrl)}`, databaseName],
          {
            cwd: backendRoot,
            env: { ...baseSubprocessEnvironment(), PGOPTIONS: pgOptions },
            encoding: 'utf8',
            timeout: 15_000,
          },
        );
        if (result.error || result.status !== 0) {
          throw new Error(
            result.error?.message ??
              `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
          );
        }
        recordCommand(
          commandRef,
          `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
          Date.now() - commandStarted,
        );
      } catch (error: unknown) {
        errors.push(redactMigrationDiagnostic(error));
      }
    }
  }

  for (const temporary of temporaryRoots.reverse()) {
    const expectedPrefix = resolve(tmpdir(), 'hsk-media-first');
    if (
      !resolve(temporary).startsWith(expectedPrefix) ||
      !existsSync(temporary) ||
      lstatSync(temporary).isSymbolicLink()
    ) {
      errors.push('refused unsafe temporary migration root cleanup target');
      continue;
    }
    try {
      rmSync(temporary, { recursive: true });
    } catch (error: unknown) {
      errors.push(redactMigrationDiagnostic(error));
    }
  }
  return errors;
}
