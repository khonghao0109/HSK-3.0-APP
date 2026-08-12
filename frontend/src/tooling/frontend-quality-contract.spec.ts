import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = process.cwd();
const repositoryRoot = resolve(frontendRoot, '..');

describe('generated Next.js type artifacts', () => {
  it('keeps type generation deterministic and next-env untracked', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(frontendRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const rootGitignore = readFileSync(
      resolve(repositoryRoot, '.gitignore'),
      'utf8',
    );
    const prettierIgnore = readFileSync(
      resolve(frontendRoot, '.prettierignore'),
      'utf8',
    );
    const tsconfig = JSON.parse(
      readFileSync(resolve(frontendRoot, 'tsconfig.json'), 'utf8'),
    ) as { include: string[] };

    expect(packageJson.scripts.typegen).toBe('next typegen');
    expect(packageJson.scripts.typecheck).toBe(
      'npm run typegen && tsc --noEmit',
    );
    expect(packageJson.scripts['test:generated-types']).toBeDefined();
    expect(rootGitignore).toMatch(/^\/frontend\/next-env\.d\.ts$/mu);
    expect(prettierIgnore).toMatch(/^next-env\.d\.ts$/mu);
    expect(tsconfig.include).toContain('next-env.d.ts');
    expect(() =>
      execFileSync(
        'git',
        ['ls-files', '--error-unmatch', 'frontend/next-env.d.ts'],
        { cwd: repositoryRoot, stdio: 'pipe' },
      ),
    ).toThrow();
  });

  it('keeps unauthenticated RSC redirects on a page route', () => {
    const protectedFiles = [
      'src/app/admin/layout.tsx',
      'src/app/admin/exercises/page.tsx',
      'src/app/admin/exercises/[exerciseId]/page.tsx',
    ];

    for (const file of protectedFiles) {
      const source = readFileSync(resolve(frontendRoot, file), 'utf8');
      expect(source).not.toContain("redirect('/api/session/logout')");
      expect(source).toContain('redirectToSessionLogin');
    }

    const logoutRoute = readFileSync(
      resolve(frontendRoot, 'src/app/api/session/logout/route.ts'),
      'utf8',
    );
    expect(logoutRoute).not.toContain('export async function GET');
    expect(logoutRoute).toContain('export async function POST');
  });
});
