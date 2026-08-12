import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(frontendRoot, '..');
const nextEnvPath = resolve(frontendRoot, 'next-env.d.ts');
const repositoryRelativePath = 'frontend/next-env.d.ts';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function assertCommandSucceeds(command, args, cwd, message) {
  const result = spawnSync(command, args, { cwd, stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(message);
  }
}

assertCommandSucceeds(
  'git',
  ['check-ignore', '--quiet', repositoryRelativePath],
  repositoryRoot,
  'next-env.d.ts must be ignored by Git.',
);

const trackedResult = spawnSync(
  'git',
  ['ls-files', '--error-unmatch', repositoryRelativePath],
  { cwd: repositoryRoot, stdio: 'pipe' },
);
if (trackedResult.status === 0) {
  throw new Error('next-env.d.ts must not be tracked by Git.');
}

rmSync(nextEnvPath, { force: true });
execFileSync(npmCommand, ['run', 'typecheck'], {
  cwd: frontendRoot,
  stdio: 'inherit',
});

if (!existsSync(nextEnvPath)) {
  throw new Error('typecheck did not regenerate next-env.d.ts.');
}

const worktreeDiff = spawnSync(
  'git',
  ['diff', '--quiet', '--', repositoryRelativePath],
  { cwd: repositoryRoot, stdio: 'pipe' },
);
if (worktreeDiff.status !== 0) {
  throw new Error('Generated next-env.d.ts dirtied the Git worktree.');
}

console.log('Generated Next.js type artifact contract: PASS');
