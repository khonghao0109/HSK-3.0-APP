import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MAX_SECRET_SCAN_FILE_BYTES,
  SecretScanInputError,
  formatSecretFinding,
  isEligibleSecretScanPath,
  listGitSecretScanPaths,
  scanGitSecretFiles,
  scanSecretFiles,
  scanSecretText,
  type SecretScanAllowlist,
} from './secret-scan';

const emptyAllowlist: SecretScanAllowlist = { version: 1, entries: [] };

void test('detects credential URLs, private keys, provider keys and strong secret assignments', () => {
  const credentialUrl =
    'postgresql://admin:' + 'RealPassword987!' + '@database.internal:5432/app';
  const privateKeyBoundary = '-----BEGIN ' + 'PRIVATE KEY-----';
  const providerKey = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const assignedSecret = 'AbCdef1234567890!' + '@#$long-value';
  const input = [
    `DATABASE_URL=${credentialUrl}`,
    privateKeyBoundary,
    `AWS_ACCESS_KEY_ID=${providerKey}`,
    `token = "${assignedSecret}"`,
  ].join('\n');
  assert.deepEqual(
    scanSecretText('backend/.env', input).map(({ kind, line }) => ({
      kind,
      line,
    })),
    [
      { kind: 'credential_url', line: 1 },
      { kind: 'private_key', line: 2 },
      { kind: 'provider_key', line: 3 },
      { kind: 'secret_assignment', line: 4 },
    ],
  );
});

void test('detects common secret names with high-confidence hex, base64 and base64url values', () => {
  const binarySecret = Buffer.from(
    Array.from({ length: 32 }, (_, index) => (index * 37 + 11) % 256),
  );
  const hexSecret = binarySecret.toString('hex');
  const base64Secret = binarySecret.toString('base64');
  const base64UrlSecret = binarySecret.toString('base64url');
  const input = [
    `MEDIA_SIGNING_SECRET=${hexSecret}`,
    `JWT_SECRET=${base64UrlSecret}`,
    `JWT_SECRETS=${JSON.stringify({ active: base64Secret })}`,
    `refresh_token=${base64Secret}`,
  ].join('\n');

  assert.deepEqual(
    scanSecretText('.env', input).map(({ kind, line }) => ({ kind, line })),
    [
      { kind: 'secret_assignment', line: 1 },
      { kind: 'secret_assignment', line: 2 },
      { kind: 'secret_assignment', line: 3 },
      { kind: 'secret_assignment', line: 4 },
    ],
  );
});

void test('does not report documented fake fixtures and placeholders', () => {
  const input = [
    'DATABASE_URL=postgresql://user:password@localhost:5432/hsk_test',
    'token = "synthetic-secret-token-at-least-32-chars"',
    'password = "<inject-from-secret-manager>"',
    'JWT_SECRETS="{\\"v1\\":\\"change-me-at-least-32-characters\\"}"',
    'MEDIA_SIGNING_SECRET=change-me',
  ].join('\n');
  assert.deepEqual(scanSecretText('backend/.env.example', input), []);
});

void test('does not confuse runtime expressions, password hashes or UUID fencing tokens with credentials', () => {
  const input = [
    ['signingSecret', 'process.env.MEDIA_SIGNING_SECRET,'].join(': '),
    ['processingToken', 'input.initialProcessingToken,'].join(': '),
    'const token = loginRes.body.accessToken as string;',
    'const token = process.env.GRAFANA_API_TOKEN!;',
    'const url = `postgresql://service:${encodedSecret}@localhost/app`;',
    'const ownerUrl = "https://example.com:443/path@owner";',
    "password: '$argon2id$exercise-concurrency-test-hash',",
    "processingToken: '60000000-0000-4000-8000-000000000006',",
  ].join('\n');
  assert.deepEqual(scanSecretText('backend/config.ts', input), []);
});

void test('still flags credential URLs on production-looking hosts even with common usernames', () => {
  const url =
    'postgresql://user:' + 'StrongCredential987!' + '@db.internal:5432/app';
  assert.equal(
    scanSecretText('backend/config.ts', `DATABASE_URL=${url}`)[0]?.kind,
    'credential_url',
  );
});

void test('flags credential userinfo across empty fields, reserved hosts, encodings, addresses and URL suffixes', () => {
  const strong = ['R3al', 'Credential', '987!', '@value'].join('');
  const encoded = encodeURIComponent(strong);
  const candidates = [
    `postgresql://:${encoded}@db.internal:5432/app`,
    ['postgresql://', ':password', '@db.internal:5432/app'].join(''),
    ['postgresql://service', '@db.internal:5432/app'].join(':'),
    `redis://service:${encoded}@localhost:6379/0`,
    `redis://service:${encoded}@cache.test:6379/0`,
    `https://service:${encoded}@example.com/private`,
    `https://service:${encoded}@10.20.30.40/private`,
    `https://service:${encoded}@[2001:db8::10]/private`,
    `https://service:${encoded}@media.internal/private?mode=read#primary`,
  ];

  for (const candidate of candidates) {
    assert.deepEqual(
      scanSecretText('backend/config.ts', `ENDPOINT=${candidate}`).map(
        ({ kind, line }) => ({ kind, line }),
      ),
      [{ kind: 'credential_url', line: 1 }],
      candidate.replace(strong, '[REDACTED]').replace(encoded, '[REDACTED]'),
    );
  }
});

void test('fails closed on malformed credential URL syntax and keeps output secret-free', () => {
  const decodedSecret = ['R3al', 'Malformed', 'Credential', '987!'].join('');
  const encodedSecret = encodeURIComponent(decodedSecret);
  const malformed = [
    `postgresql://service:${encodedSecret}@[2001:db8::10`,
    `postgresql://service:%ZZ${encodedSecret}@db.internal/app`,
    `postgresql://service:${encodedSecret}@`,
    `postgresql://service:${encodedSecret}#fragment@db.internal/app`,
    `postgresql://service:${encodedSecret}?query@db.internal/app`,
    `postgresql://service:${encodedSecret}/path@db.internal/app`,
  ];

  for (const candidate of malformed) {
    const [finding] = scanSecretText(
      'backend/config.ts',
      `DATABASE_URL=${candidate}`,
    );
    assert.equal(finding?.kind, 'credential_url');
    assert.ok(finding);
    const formatted = formatSecretFinding(finding);
    assert.equal(formatted.includes(candidate), false);
    assert.equal(formatted.includes(encodedSecret), false);
    assert.equal(formatted.includes(decodedSecret), false);
  }
});

void test('sanitizes findings and never returns the matched secret value', () => {
  const secret = 'AbCdef1234567890!' + '@#$sensitive-value';
  const [finding] = scanSecretText('backend/config.ts', `token = "${secret}"`);
  assert.ok(finding);
  const formatted = formatSecretFinding(finding);
  assert.equal(formatted.includes(secret), false);
  assert.match(formatted, /backend\/config\.ts:1 \[secret_assignment\]/u);
  assert.match(formatted, /fingerprint=[a-f0-9]{64}$/u);
});

void test('applies an explicit path/kind/fingerprint allowlist with a reason', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-secret-scan-'));
  try {
    mkdirSync(join(root, 'backend'));
    const path = 'backend/fixture.ts';
    const fixtureSecret = 'AbCdef1234567890!' + '@#$fixture-value';
    writeFileSync(join(root, path), `token = "${fixtureSecret}"\n`, 'utf8');
    const [finding] = scanSecretFiles(root, [path], emptyAllowlist);
    assert.ok(finding);
    assert.deepEqual(
      scanSecretFiles(root, [path], {
        version: 1,
        entries: [
          {
            path,
            kind: finding.kind,
            fingerprint: finding.fingerprint,
            reason: 'Synthetic scanner regression fixture.',
          },
        ],
      }),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('discovers a force-tracked ignored .env and scans its common secret assignments', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-secret-scan-git-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), '.env\n', 'utf8');
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(root, '.github', 'workflows', 'release.yml'),
      'name: release\n',
      'utf8',
    );
    const secret = Buffer.from(
      Array.from({ length: 32 }, (_, index) => (index * 29 + 7) % 256),
    ).toString('base64url');
    writeFileSync(
      join(root, '.env'),
      [`MEDIA_SIGNING_SECRET=${secret}`, `JWT_SECRET=${secret}`].join('\n'),
      'utf8',
    );
    execFileSync('git', ['add', '.gitignore'], { cwd: root });
    execFileSync('git', ['add', '--force', '.env'], { cwd: root });

    const paths = listGitSecretScanPaths(root);
    assert.ok(paths.includes('.env'));
    assert.ok(paths.includes('.github/workflows/release.yml'));
    assert.deepEqual(
      scanSecretFiles(root, paths, emptyAllowlist).map(
        ({ path, kind, line }) => ({
          path,
          kind,
          line,
        }),
      ),
      [
        { path: '.env', kind: 'secret_assignment', line: 1 },
        { path: '.env', kind: 'secret_assignment', line: 2 },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('scans staged index bytes even when the tracked worktree copy is clean', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-secret-scan-index-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), '.env\n', 'utf8');
    const stagedSecret = Buffer.from(
      Array.from({ length: 32 }, (_, index) => (index * 31 + 13) % 256),
    ).toString('base64url');
    writeFileSync(
      join(root, '.env'),
      `MEDIA_SIGNING_SECRET=${stagedSecret}\n`,
      'utf8',
    );
    execFileSync('git', ['add', '.gitignore'], { cwd: root });
    execFileSync('git', ['add', '--force', '.env'], { cwd: root });

    // A worktree-only implementation would false-green after this overwrite.
    writeFileSync(
      join(root, '.env'),
      'MEDIA_SIGNING_SECRET=change-me\n',
      'utf8',
    );

    assert.deepEqual(
      scanGitSecretFiles(root, emptyAllowlist).map(({ path, kind, line }) => ({
        path,
        kind,
        line,
      })),
      [{ path: '.env', kind: 'secret_assignment', line: 1 }],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('does not follow tracked symlinks while scanning repository bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-secret-scan-symlink-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    mkdirSync(join(root, 'ignored'));
    writeFileSync(join(root, '.gitignore'), 'ignored/\n', 'utf8');
    const secret = Buffer.from(
      Array.from({ length: 32 }, (_, index) => (index * 43 + 17) % 256),
    ).toString('base64url');
    writeFileSync(
      join(root, 'ignored', 'outside-inventory.env'),
      `MEDIA_SIGNING_SECRET=${secret}\n`,
      'utf8',
    );
    symlinkSync('ignored/outside-inventory.env', join(root, 'tracked-link'));
    execFileSync('git', ['add', '.gitignore', 'tracked-link'], { cwd: root });

    assert.deepEqual(scanGitSecretFiles(root, emptyAllowlist), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('fails closed instead of silently skipping oversized or NUL text/config files', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-secret-scan-input-'));
  try {
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(root, '.env'),
      Buffer.alloc(MAX_SECRET_SCAN_FILE_BYTES + 1, 0x61),
    );
    writeFileSync(
      join(root, '.github', 'workflows', 'release.yml'),
      Buffer.from([0x41, 0, 0x42]),
    );

    assert.throws(
      () => scanSecretFiles(root, ['.env'], emptyAllowlist),
      (error: unknown) =>
        error instanceof SecretScanInputError &&
        error.reason === 'file_too_large' &&
        error.safePath === '.env',
    );
    assert.throws(
      () =>
        scanSecretFiles(
          root,
          ['.github/workflows/release.yml'],
          emptyAllowlist,
        ),
      (error: unknown) =>
        error instanceof SecretScanInputError &&
        error.reason === 'unsupported_binary_content' &&
        error.safePath === '.github/workflows/release.yml',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('rejects undocumented/malformed allowlist entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-secret-scan-'));
  try {
    assert.throws(
      () =>
        scanSecretFiles(root, [], {
          version: 1,
          entries: [
            {
              path: 'backend/fixture.ts',
              kind: 'secret_assignment',
              fingerprint: '00000000',
              reason: '',
            },
          ],
        }),
      /allowlist is invalid/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('includes hidden source/config paths and excludes only explicit generated, evidence, binary and dataset paths', () => {
  for (const path of [
    '.git/index',
    'frontend/.next/server/app.js',
    'backend/node_modules/pkg/index.js',
    'backend/dist/main.js',
    'backend/coverage/result.json',
    'backend/evidence/result.json',
    'backend/scripts/dictionary/raw/cedict_ts.u8',
    'backend/scripts/dictionary/parsed/words.json',
    'docs/ui_image/example.png',
  ]) {
    assert.equal(isEligibleSecretScanPath(path), false, path);
  }
  assert.equal(isEligibleSecretScanPath('.env'), true);
  assert.equal(isEligibleSecretScanPath('backend/.env.production'), true);
  assert.equal(isEligibleSecretScanPath('.github/workflows/release.yml'), true);
  assert.equal(isEligibleSecretScanPath('backend/src/main.ts'), true);
  assert.equal(isEligibleSecretScanPath('ops/nginx/media-security.conf'), true);
});
