import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  BOUNDED_MIGRATION_EXIT_CODES,
  BOUNDED_MIGRATION_TIMEOUTS_MS,
  buildBoundedMigrationEnvironment,
  redactBoundedMigrationDiagnostic,
  resolveLocalPrismaCli,
} from './bounded-prisma-migrate-deploy';

export const MEDIA_CLEANUP_AUDIT_MIGRATION =
  '20260813193000_media_cleanup_audit_integrity' as const;

export function buildMediaCleanupAuditResolveInvocation(backendRoot: string): {
  executable: string;
  args: string[];
} {
  return {
    executable: process.execPath,
    args: [
      resolveLocalPrismaCli(),
      'migrate',
      'resolve',
      '--rolled-back',
      MEDIA_CLEANUP_AUDIT_MIGRATION,
      '--schema',
      resolve(backendRoot, 'prisma/schema.prisma'),
    ],
  };
}

export function runBoundedMediaCleanupAuditResolveRolledBack(
  environment: NodeJS.ProcessEnv = process.env,
  backendRoot = process.cwd(),
): number {
  const boundedEnvironment = buildBoundedMigrationEnvironment(environment);
  const invocation = buildMediaCleanupAuditResolveInvocation(backendRoot);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: backendRoot,
    env: boundedEnvironment,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: BOUNDED_MIGRATION_TIMEOUTS_MS.command,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = redactBoundedMigrationDiagnostic(result.stdout ?? '');
  const stderr = redactBoundedMigrationDiagnostic(result.stderr ?? '');
  const timedOut =
    result.error !== undefined &&
    'code' in result.error &&
    result.error.code === 'ETIMEDOUT';

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.error && !timedOut) {
    process.stderr.write(
      `Bounded Prisma migration resolve failed to execute: ${redactBoundedMigrationDiagnostic(
        result.error.message,
      )}\n`,
    );
  }
  if (timedOut) {
    process.stderr.write(
      'Bounded Prisma migration resolve aborted: command deadline exceeded.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.commandTimeout;
  }
  return result.status && result.status > 0 && result.status <= 255
    ? result.status
    : result.status === 0
      ? 0
      : 1;
}

function main(): number {
  if (process.argv.slice(2).length !== 0) {
    process.stderr.write(
      'Bounded Prisma migration resolve accepts no caller-controlled arguments.\n',
    );
    return BOUNDED_MIGRATION_EXIT_CODES.usage;
  }
  try {
    return runBoundedMediaCleanupAuditResolveRolledBack();
  } catch (error: unknown) {
    process.stderr.write(`${redactBoundedMigrationDiagnostic(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}
