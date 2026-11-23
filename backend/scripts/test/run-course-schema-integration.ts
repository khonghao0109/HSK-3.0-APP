import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';

/**
 * `test:db:course` (ADR-009 C1): proves the course_expand migration on two
 * fresh databases this runner creates and drops itself.
 *
 * 1. `<name>_fresh_verify`: every migration from zero to head.
 * 2. `<name>_upgrade_verify`: migrations up to the one before course_expand,
 *    legacy Level/Lesson rows, then course_expand, then the constraint suite.
 *
 * TEST_DATABASE_URL only supplies the server and credentials; its own
 * database is never touched. Both databases must not exist beforehand.
 */
const COURSE_MIGRATION_SUFFIX = '_course_expand';
const SAFE_DATABASE_NAME = /^[A-Za-z0-9_]+$/;

const { databaseName, testDatabaseUrl } = assertDisposableTestDatabase();
if (!SAFE_DATABASE_NAME.test(databaseName)) {
  throw new Error(`Refusing unsafe database name "${databaseName}"`);
}
const base = databaseName.replace(
  /_(test|e2e|verify|disposable|hardening)$/i,
  '',
);

function urlFor(name: string): string {
  const parsed = new URL(testDatabaseUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    env: env ?? process.env,
  });
  if (result.error)
    throw new Error(`Unable to start ${command}: ${result.error.message}`);
  process.stdout.write(result.stdout ?? '');
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args[0] ?? ''} exited with ${String(result.status)}`,
    );
  }
  return result.stdout ?? '';
}

const psql = (url: string, ...args: string[]) =>
  run('psql', [url, '-v', 'ON_ERROR_STOP=1', ...args]);
const migrate = (url: string, schema: string) =>
  run('npx', ['prisma', 'migrate', 'deploy', '--schema', schema], {
    ...process.env,
    DATABASE_URL: url,
  });

const maintenance = urlFor('postgres');
const created: string[] = [];

function createDatabase(name: string): string {
  const exists = psql(
    maintenance,
    '-tAc',
    `SELECT 1 FROM pg_database WHERE datname = '${name}'`,
  ).trim();
  if (exists === '1') {
    throw new Error(`Database "${name}" already exists; refusing to reuse it`);
  }
  psql(maintenance, '-c', `CREATE DATABASE "${name}"`);
  created.push(name);
  return urlFor(name);
}

function assertAllApplied(url: string, expected: number): void {
  const applied = Number(
    psql(
      url,
      '-tAc',
      'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    ).trim(),
  );
  if (applied !== expected) {
    throw new Error(
      `expected ${expected} applied migrations, found ${applied}`,
    );
  }
  console.log(`ok - ${applied} migrations applied`);
}

const prismaDir = resolve(process.cwd(), 'prisma');
const migrations = readdirSync(join(prismaDir, 'migrations'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const courseMigration = migrations.filter((name) =>
  name.endsWith(COURSE_MIGRATION_SUFFIX),
);
if (courseMigration.length !== 1) {
  throw new Error('expected exactly one course_expand migration');
}
// The upgrade path stops just before course_expand and replays it plus later ones.
const fromCourseExpand = migrations.slice(
  migrations.indexOf(courseMigration[0]),
);

// ADR-009 C2: content:course:backfill on the upgraded database.
const HISTORY_FINGERPRINT = `SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
  SELECT 'p' || row_to_json(x)::text AS t FROM "Progress" x
  UNION ALL SELECT 'a' || row_to_json(x)::text FROM "LessonExerciseAttempt" x
  UNION ALL SELECT 'e' || row_to_json(x)::text FROM "LearningEvent" x
  UNION ALL SELECT 'g' || row_to_json(x)::text FROM "UserGoal" x
  UNION ALL SELECT 'u' || row_to_json(x)::text FROM "User" x) r`;
const COURSE_FINGERPRINT = `SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
  SELECT 'c' || row_to_json(x)::text AS t FROM "Course" x
  UNION ALL SELECT 'u' || row_to_json(x)::text FROM "CourseUnit" x
  UNION ALL SELECT 'e' || row_to_json(x)::text FROM "CourseEnrollment" x
  UNION ALL SELECT 'l' || "id" || ':' || coalesce("courseUnitId"::text, '-') || ':' || "updatedAt" FROM "Lesson" x) r`;

type BackfillSummary = {
  mode: string;
  before: Record<string, number>;
  after: Record<string, number>;
};

function backfill(url: string, dryRun: boolean): BackfillSummary {
  const out = run(
    'npx',
    [
      'ts-node',
      'scripts/content/backfill-course-topic.ts',
      ...(dryRun ? ['--dry-run'] : []),
    ],
    { ...process.env, DATABASE_URL: url },
  );
  const line = out.split('\n').find((l) => l.startsWith('SUMMARY '));
  if (!line) throw new Error('backfill printed no SUMMARY line');
  return JSON.parse(line.slice('SUMMARY '.length)) as BackfillSummary;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
}

function runBackfillSuite(url: string): void {
  psql(url, '-f', resolve('test/database/course-backfill.seed.sql'));
  const scalar = (sql: string) => psql(url, '-tAc', sql).trim();
  const history = scalar(HISTORY_FINGERPRINT);
  const seeded = scalar(COURSE_FINGERPRINT);

  const dry = backfill(url, true);
  check(scalar(COURSE_FINGERPRINT) === seeded, 'dry-run writes nothing');
  const expected = {
    before: { courses: 0, units: 0, lessonsWithoutUnit: 3, enrollments: 0 },
    after: { courses: 1, units: 7, lessonsWithoutUnit: 0, enrollments: 2 },
  };
  check(
    JSON.stringify([dry.before, dry.after]) ===
      JSON.stringify([expected.before, expected.after]),
    `dry-run plans ${JSON.stringify(dry.after)}`,
  );

  const first = backfill(url, false);
  check(
    JSON.stringify([first.before, first.after]) ===
      JSON.stringify([dry.before, dry.after]),
    'apply counts equal dry-run counts',
  );
  psql(url, '-f', resolve('test/database/course-backfill.assert.sql'));

  const applied = scalar(COURSE_FINGERPRINT);
  const second = backfill(url, false);
  check(
    JSON.stringify(second.before) === JSON.stringify(first.after) &&
      JSON.stringify(second.after) === JSON.stringify(first.after) &&
      scalar(COURSE_FINGERPRINT) === applied,
    'second run changes nothing',
  );

  psql(
    url,
    '-c',
    `UPDATE "Course" SET title = 'PO title', "keyTextVisible" = false, status = 'draft' WHERE code = 'HSK3_TOPIC'`,
  );
  backfill(url, false);
  check(
    scalar(
      `SELECT title || '|' || "keyTextVisible" || '|' || status FROM "Course" WHERE code = 'HSK3_TOPIC'`,
    ) === 'PO title|false|draft',
    'edited course title/status/keyTextVisible kept',
  );
  check(
    scalar(HISTORY_FINGERPRINT) === history,
    'Progress/attempt/LearningEvent/UserGoal/User unchanged',
  );
}

const preDir = mkdtempSync(join(tmpdir(), 'hsk-course-c1-'));
try {
  console.log(`Running course schema integration via "${databaseName}"`);

  const fresh = createDatabase(`${base}_course_fresh_verify`);
  migrate(fresh, join(prismaDir, 'schema.prisma'));
  assertAllApplied(fresh, migrations.length);
  // Migration history must match the datamodel. SQL-only CHECKs and the
  // partial unique index are outside Prisma's model and do not show as drift.
  const drift = spawnSync(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-url',
      fresh,
      '--to-schema-datamodel',
      join(prismaDir, 'schema.prisma'),
      '--exit-code',
    ],
    { encoding: 'utf8' },
  );
  if (drift.status !== 0) {
    console.error(drift.stdout, drift.stderr);
    throw new Error(`migrate diff found drift (exit ${String(drift.status)})`);
  }
  console.log(`ok - no drift: ${drift.stdout.trim()}`);

  const upgrade = createDatabase(`${base}_course_upgrade_verify`);
  cpSync(prismaDir, join(preDir, 'prisma'), { recursive: true });
  for (const name of fromCourseExpand) {
    rmSync(join(preDir, 'prisma', 'migrations', name), { recursive: true });
  }
  migrate(upgrade, join(preDir, 'prisma', 'schema.prisma'));
  assertAllApplied(upgrade, migrations.length - fromCourseExpand.length);
  psql(upgrade, '-f', resolve('test/database/course-expand.legacy-seed.sql'));
  migrate(upgrade, join(prismaDir, 'schema.prisma'));
  assertAllApplied(upgrade, migrations.length);
  psql(upgrade, '-f', resolve('test/database/course-expand.integration.sql'));
  runBackfillSuite(upgrade);
  console.log('course schema integration: PASS');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(preDir, { recursive: true, force: true });
  for (const name of created) {
    try {
      psql(maintenance, '-c', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      console.log(`dropped ${name}`);
    } catch (error) {
      console.error(`failed to drop ${name}`, error);
      process.exitCode = 1;
    }
  }
  const leftover = psql(
    maintenance,
    '-tAc',
    `SELECT datname FROM pg_database WHERE datname LIKE '${base}\\_course\\_%'`,
  ).trim();
  if (leftover !== '') {
    console.error(`leftover databases: ${leftover}`);
    process.exitCode = 1;
  } else {
    console.log(`ok - no ${base}_course_* database left`);
  }
}
