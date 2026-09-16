import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import {
  backendLoginSchema,
  backendMeSchema,
} from '@/features/auth/auth-contract';
import {
  backendExerciseDetailSchema,
  backendExerciseListSchema,
} from '@/features/exercises/exercise-contract';
import {
  backendMediaDetailSchema,
  backendMediaListSchema,
  backendMediaMutationSchema,
} from '@/features/media/media-contract';

import type { paths } from './backend-generated-types';

const frontendRoot = process.cwd();
const GENERATED = 'src/lib/api/backend-generated-types.ts';
const SPEC = '../backend/openapi.json';

/** JSON body the backend documents for `status` of `method` on `path`. */
type BackendBody<
  Path extends keyof paths,
  Method extends 'get' | 'post',
  Status extends number,
> = paths[Path][Method] extends {
  responses: {
    [S in Status]: { content: { 'application/json': infer Body } };
  };
}
  ? Body
  : never;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

describe('backend OpenAPI contract', () => {
  it('keeps the generated types in sync with backend/openapi.json', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(frontendRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts['typegen:backend']).toBe(
      `openapi-typescript ${SPEC} --output ${GENERATED}`,
    );

    // Exits non-zero when the committed file differs from a fresh generation.
    expect(() =>
      execFileSync(
        process.execPath,
        [
          resolve(frontendRoot, 'node_modules/openapi-typescript/bin/cli.js'),
          SPEC,
          '--output',
          GENERATED,
          '--check',
        ],
        { cwd: frontendRoot, stdio: 'pipe' },
      ),
    ).not.toThrow();
  });

  it('uses the generated types as types only, without a generated client', () => {
    const packageJson = readFileSync(
      resolve(frontendRoot, 'package.json'),
      'utf8',
    );
    expect(packageJson).not.toContain('openapi-fetch');

    const reference =
      /(?:from|import\()\s*['"][^'"]*backend-generated-types['"]/u;
    const runtimeImports = sourceFiles(resolve(frontendRoot, 'src'))
      .filter((file) => !file.endsWith('backend-generated-types.ts'))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .filter(
            (line) =>
              reference.test(line) && !/^(?:import|export) type /u.test(line),
          )
          .map((line) => `${file}: ${line}`),
      );
    expect(runtimeImports).toEqual([]);
  });

  // Compile-time checks, enforced by `npm run typecheck`: every body the
  // backend documents for a BFF call must be accepted by the Zod schema that
  // parses it. Backend DTO drift (a removed field, a wider enum) fails here.
  it('accepts every documented backend response in the BFF Zod schemas', () => {
    type Login = BackendBody<'/api/v1/auth/login', 'post', 201>;
    expectTypeOf<Login>().not.toBeNever();
    expectTypeOf<Login>().toExtend<z.input<typeof backendLoginSchema>>();

    type Me = BackendBody<'/api/v1/auth/me', 'get', 200>;
    expectTypeOf<Me>().not.toBeNever();
    expectTypeOf<Me>().toExtend<z.input<typeof backendMeSchema>>();

    type ExerciseList = BackendBody<'/api/v1/admin/cms/exercises', 'get', 200>;
    expectTypeOf<ExerciseList>().not.toBeNever();
    expectTypeOf<ExerciseList>().toExtend<
      z.input<typeof backendExerciseListSchema>
    >();

    type ExerciseDetail = BackendBody<
      '/api/v1/admin/cms/exercises/{exerciseId}',
      'get',
      200
    >;
    expectTypeOf<ExerciseDetail>().not.toBeNever();
    expectTypeOf<ExerciseDetail>().toExtend<
      z.input<typeof backendExerciseDetailSchema>
    >();

    type MediaList = BackendBody<'/api/v1/admin/cms/media', 'get', 200>;
    expectTypeOf<MediaList>().not.toBeNever();
    expectTypeOf<MediaList>().toExtend<
      z.input<typeof backendMediaListSchema>
    >();

    type MediaDetail = BackendBody<
      '/api/v1/admin/cms/media/{mediaId}',
      'get',
      200
    >;
    expectTypeOf<MediaDetail>().not.toBeNever();
    expectTypeOf<MediaDetail>().toExtend<
      z.input<typeof backendMediaDetailSchema>
    >();

    type Archive = BackendBody<
      '/api/v1/admin/cms/media/{mediaId}/archive',
      'post',
      201
    >;
    type Quarantine = BackendBody<
      '/api/v1/admin/cms/media/{mediaId}/quarantine',
      'post',
      201
    >;
    expectTypeOf<Archive>().not.toBeNever();
    expectTypeOf<Quarantine>().not.toBeNever();
    expectTypeOf<Archive | Quarantine>().toExtend<
      z.input<typeof backendMediaMutationSchema>
    >();
  });
});
