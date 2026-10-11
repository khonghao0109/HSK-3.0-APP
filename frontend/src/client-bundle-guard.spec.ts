// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Zod 4 probes Function("") when it initialises. The production CSP has no
// 'unsafe-eval', so any Zod module reaching a client bundle raises a CSP
// violation on hard load. This guard walks the runtime import graph of every
// 'use client' module and fails if it reaches a zod specifier.

const srcRoot = resolve(process.cwd(), 'src');
const EXTENSIONS = ['.ts', '.tsx'];

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (
      EXTENSIONS.some((ext) => entry.endsWith(ext)) &&
      !entry.endsWith('.d.ts') &&
      !/\.spec\.tsx?$/.test(entry)
    ) {
      files.push(full);
    }
  }
  return files;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isClientModule(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === 'use client') return true;
  }
  return false;
}

// Specifiers that survive TypeScript emit (verbatimModuleSyntax is off, so an
// import whose every specifier is `type` is erased as well).
function runtimeSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      if (clause) {
        if (clause.isTypeOnly) continue;
        const bindings = clause.namedBindings;
        const allNamedAreTypes =
          !clause.name &&
          bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((element) => element.isTypeOnly);
        if (allNamedAreTypes) continue;
      }
      specifiers.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement)) {
      if (
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (
        clause &&
        ts.isNamedExports(clause) &&
        clause.elements.length > 0 &&
        clause.elements.every((element) => element.isTypeOnly)
      ) {
        continue;
      }
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  // Dynamic import('…') and require('…') anywhere in the module.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (
        (isDynamicImport || isRequire) &&
        first &&
        ts.isStringLiteralLike(first)
      ) {
        specifiers.push(first.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return specifiers;
}

function isLocalSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('@/')
  );
}

class UnresolvedImportError extends Error {}

// Local files that exist but are not code: leaf nodes, never walked.
const ASSET_EXTENSIONS = [
  '.css',
  '.scss',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.webp',
  '.woff2',
];
const ASSET = Symbol('asset');

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function resolveLocal(
  fromFile: string,
  specifier: string,
): string | typeof ASSET | null {
  if (!isLocalSpecifier(specifier)) return null;
  const base = specifier.startsWith('@/')
    ? join(srcRoot, specifier.slice(2))
    : resolve(dirname(fromFile), specifier);
  const indexes = EXTENSIONS.map((ext) => join(base, `index${ext}`));
  // Directory specifiers ('.', '..', 'x/', 'x/.', 'x/..') resolve only to the
  // directory index, never to a sibling '<dir>.ts'.
  if (
    specifier === '.' ||
    specifier === '..' ||
    specifier.endsWith('/') ||
    specifier.endsWith('/.') ||
    specifier.endsWith('/..')
  ) {
    return indexes.find(isFile) ?? null;
  }
  if (ASSET_EXTENSIONS.includes(extname(base)) && isFile(base)) return ASSET;
  const candidates = [
    // './x.js' written for ESM resolves to x.ts / x.tsx first.
    ...(base.endsWith('.js')
      ? EXTENSIONS.map((ext) => base.slice(0, -3) + ext)
      : []),
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...indexes,
  ];
  return (
    candidates.find(
      (candidate) =>
        EXTENSIONS.some((ext) => candidate.endsWith(ext)) && isFile(candidate),
    ) ?? null
  );
}

function isZod(specifier: string): boolean {
  return specifier === 'zod' || specifier.startsWith('zod/');
}

const sourceCache = new Map<string, ts.SourceFile>();
function cachedParse(file: string): ts.SourceFile {
  let source = sourceCache.get(file);
  if (!source) {
    source = parse(file);
    sourceCache.set(file, source);
  }
  return source;
}

// Breadth-first search; returns the shortest import chain to zod, if any.
function findZodChain(entry: string): string[] | null {
  const previous = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    for (let at: string | null = file; at !== null; at = previous.get(at)!) {
      chain.unshift(relative(process.cwd(), at));
    }
    return chain;
  };
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of runtimeSpecifiers(cachedParse(file))) {
      if (isZod(specifier)) return [...chainTo(file), specifier];
      const target = resolveLocal(file, specifier);
      if (target === ASSET) continue;
      if (!target && isLocalSpecifier(specifier)) {
        // Fail closed: an unresolved local import could hide a zod path.
        throw new UnresolvedImportError(
          `unresolved import '${specifier}' in ${relative(process.cwd(), file)}`,
        );
      }
      if (target && !previous.has(target)) {
        previous.set(target, file);
        queue.push(target);
      }
    }
  }
  return null;
}

describe('client bundle guard', () => {
  it('detects type-only imports and exports as erased', () => {
    const source = ts.createSourceFile(
      'sample.ts',
      [
        "import type { A } from './a';",
        "import { type B, type C } from './b';",
        "import { type D, e } from './d';",
        "import './side-effect';",
        "export type { F } from './f';",
        "export { type G } from './g';",
        "export { h } from './h';",
        "export * from './star';",
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );
    expect(runtimeSpecifiers(source)).toEqual([
      './d',
      './side-effect',
      './h',
      './star',
    ]);
  });

  it('collects dynamic import() and require() specifiers', () => {
    const source = ts.createSourceFile(
      'sample.ts',
      [
        'async function load() {',
        "  await import('./lazy');",
        "  const z = require('zod');",
        '  return z;',
        '}',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );
    expect(runtimeSpecifiers(source)).toEqual(['./lazy', 'zod']);
  });

  describe('local resolution', () => {
    const withTree = (
      files: Record<string, string>,
      run: (root: string) => void,
    ): void => {
      const root = mkdtempSync(join(tmpdir(), 'bundle-guard-'));
      try {
        for (const [name, body] of Object.entries(files)) {
          const full = join(root, name);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, body);
        }
        run(root);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };

    it('treats an existing .css import as a leaf', () => {
      withTree(
        {
          'entry.tsx': "'use client';\nimport './styles.css';\n",
          'styles.css': '.a { color: red; }\n',
        },
        (root) => {
          expect(findZodChain(join(root, 'entry.tsx'))).toBeNull();
        },
      );
    });

    it("follows '..' to the parent index and reports the zod chain", () => {
      withTree(
        {
          'index.ts':
            "import { z } from 'zod';\nexport const s = z.string();\n",
          'sub/entry.tsx':
            "'use client';\nimport { s } from '..';\nexport { s };\n",
        },
        (root) => {
          expect(findZodChain(join(root, 'sub/entry.tsx'))).toEqual([
            relative(process.cwd(), join(root, 'sub/entry.tsx')),
            relative(process.cwd(), join(root, 'index.ts')),
            'zod',
          ]);
        },
      );
    });

    it("follows '.' to the directory index and reports the zod chain", () => {
      withTree(
        {
          'sub/index.ts':
            "import { z } from 'zod';\nexport const s = z.string();\n",
          'sub/entry.tsx':
            "'use client';\nimport { s } from '.';\nexport { s };\n",
        },
        (root) => {
          expect(findZodChain(join(root, 'sub/entry.tsx'))).toEqual([
            relative(process.cwd(), join(root, 'sub/entry.tsx')),
            relative(process.cwd(), join(root, 'sub/index.ts')),
            'zod',
          ]);
        },
      );
    });

    it("resolves '../' to the directory index, not a sibling '<dir>.ts'", () => {
      withTree(
        {
          'pkg.ts': 'export const s = 1;\n',
          'pkg/index.ts':
            "import { z } from 'zod';\nexport const s = z.string();\n",
          'pkg/sub/entry.tsx':
            "'use client';\nimport { s } from '../';\nexport { s };\n",
        },
        (root) => {
          expect(findZodChain(join(root, 'pkg/sub/entry.tsx'))).toEqual([
            relative(process.cwd(), join(root, 'pkg/sub/entry.tsx')),
            relative(process.cwd(), join(root, 'pkg/index.ts')),
            'zod',
          ]);
        },
      );
    });

    it("resolves './x.js' to x.ts and reports the zod chain", () => {
      withTree(
        {
          'x.ts': "import { z } from 'zod';\nexport const s = z.string();\n",
          'entry.tsx':
            "'use client';\nimport { s } from './x.js';\nexport { s };\n",
        },
        (root) => {
          expect(findZodChain(join(root, 'entry.tsx'))).toEqual([
            relative(process.cwd(), join(root, 'entry.tsx')),
            relative(process.cwd(), join(root, 'x.ts')),
            'zod',
          ]);
        },
      );
    });
  });

  it("keeps zod out of every 'use client' module's import graph", () => {
    const clientModules = listSourceFiles(srcRoot).filter((file) =>
      isClientModule(cachedParse(file)),
    );
    expect(clientModules.length).toBeGreaterThan(0);

    const offenders = clientModules
      .map((file) => {
        try {
          return findZodChain(file);
        } catch (error) {
          if (error instanceof UnresolvedImportError) {
            return [relative(process.cwd(), file), error.message];
          }
          throw error;
        }
      })
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.join(' -> '));

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
