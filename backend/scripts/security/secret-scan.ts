import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';

export const MAX_SECRET_SCAN_FILES = 10_000;
export const MAX_SECRET_SCAN_FILE_BYTES = 2 * 1024 * 1024;

export type SecretScanFindingKind =
  | 'credential_url'
  | 'private_key'
  | 'provider_key'
  | 'secret_assignment';

export type SecretScanInputErrorReason =
  | 'file_limit_exceeded'
  | 'file_too_large'
  | 'git_inventory_failed'
  | 'invalid_utf8'
  | 'unsafe_path'
  | 'unsupported_binary_content'
  | 'unsupported_file_type';

export class SecretScanInputError extends Error {
  constructor(
    readonly reason: SecretScanInputErrorReason,
    readonly safePath?: string,
  ) {
    super(secretScanInputErrorMessage(reason, safePath));
    this.name = 'SecretScanInputError';
  }
}

export interface SecretScanFinding {
  path: string;
  line: number;
  kind: SecretScanFindingKind;
  fingerprint: string;
}

export interface SecretScanAllowlist {
  version: 1;
  entries: Array<{
    path: string;
    kind: SecretScanFindingKind;
    fingerprint: string;
    reason: string;
  }>;
}

const EXCLUDED_DIRECTORY_PATTERN =
  /(?:^|\/)(?:\.codegraph|\.git|\.next|build|coverage|dist|evidence|node_modules|playwright-report|test-results)(?:\/|$)/u;

const EXCLUDED_BINARY_EXTENSIONS = new Set([
  '.7z',
  '.avif',
  '.bin',
  '.bmp',
  '.bz2',
  '.class',
  '.db',
  '.dylib',
  '.eot',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.o',
  '.otf',
  '.pdf',
  '.png',
  '.so',
  '.sqlite',
  '.sqlite3',
  '.tar',
  '.tif',
  '.tiff',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xz',
  '.zip',
]);

const FINDING_KINDS = new Set<SecretScanFindingKind>([
  'credential_url',
  'private_key',
  'provider_key',
  'secret_assignment',
]);

export function listGitSecretScanPaths(repositoryRoot: string): string[] {
  try {
    const tracked = gitPaths(repositoryRoot, ['ls-files', '-z', '--cached']);
    const intendedUntracked = gitPaths(repositoryRoot, [
      'ls-files',
      '-z',
      '--others',
      '--exclude-standard',
    ]);
    return [...new Set([...tracked, ...intendedUntracked])].sort();
  } catch {
    throw new SecretScanInputError('git_inventory_failed');
  }
}

export function scanGitSecretFiles(
  repositoryRoot: string,
  allowlist: SecretScanAllowlist,
): SecretScanFinding[] {
  validateAllowlist(allowlist);
  let indexEntries: GitIndexEntry[];
  let worktreePaths: string[];
  try {
    indexEntries = gitIndexEntries(repositoryRoot);
    worktreePaths = listGitSecretScanPaths(repositoryRoot);
  } catch (error: unknown) {
    if (error instanceof SecretScanInputError) throw error;
    throw new SecretScanInputError('git_inventory_failed');
  }

  const uniquePaths = new Set([
    ...indexEntries.map(({ path }) => path),
    ...worktreePaths,
  ]);
  if (uniquePaths.size > MAX_SECRET_SCAN_FILES) {
    throw new SecretScanInputError('file_limit_exceeded');
  }

  const indexFindings: SecretScanFinding[] = [];
  for (const entry of indexEntries) {
    assertSafeRepositoryPath(entry.path);
    if (!isEligibleSecretScanPath(entry.path)) continue;
    if (entry.mode !== '100644' && entry.mode !== '100755') {
      throw new SecretScanInputError('unsupported_file_type', entry.path);
    }
    indexFindings.push(
      ...scanSecretBytes(entry.path, readGitIndexBlob(repositoryRoot, entry)),
    );
  }

  const worktreeFindings = scanSecretFiles(
    repositoryRoot,
    worktreePaths,
    allowlist,
  );
  return applyAllowlist(
    deduplicateFindings([...indexFindings, ...worktreeFindings]),
    allowlist,
  );
}

export function scanSecretFiles(
  repositoryRoot: string,
  paths: readonly string[],
  allowlist: SecretScanAllowlist,
): SecretScanFinding[] {
  validateAllowlist(allowlist);
  const uniquePaths = [...new Set(paths)].sort();
  if (uniquePaths.length > MAX_SECRET_SCAN_FILES) {
    throw new SecretScanInputError('file_limit_exceeded');
  }

  const findings: SecretScanFinding[] = [];
  for (const path of uniquePaths) {
    assertSafeRepositoryPath(path);
    if (!isEligibleSecretScanPath(path)) continue;
    const absolutePath = resolve(repositoryRoot, path);
    assertPathIsWithinRepository(repositoryRoot, absolutePath);

    // A cached path can legitimately be absent when the worktree contains a
    // tracked deletion. There are no bytes to inspect in that case.
    if (!existsSync(absolutePath)) continue;

    const linkMetadata = lstatSync(absolutePath);
    if (!linkMetadata.isFile()) {
      throw new SecretScanInputError('unsupported_file_type', path);
    }
    if (statSync(absolutePath).size > MAX_SECRET_SCAN_FILE_BYTES) {
      throw new SecretScanInputError('file_too_large', path);
    }

    findings.push(...scanSecretBytes(path, readFileSync(absolutePath)));
  }
  return applyAllowlist(findings, allowlist);
}

export function scanSecretText(
  path: string,
  content: string,
): SecretScanFinding[] {
  const findings: SecretScanFinding[] = [];
  const lines = content.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (containsPrivateKeyBoundary(line)) {
      findings.push(finding(path, lineNumber, 'private_key', line));
    }
    if (containsCredentialUrl(line)) {
      findings.push(finding(path, lineNumber, 'credential_url', line));
    }
    if (containsProviderKey(line)) {
      findings.push(finding(path, lineNumber, 'provider_key', line));
    }
    if (containsHighConfidenceSecretAssignment(line)) {
      findings.push(finding(path, lineNumber, 'secret_assignment', line));
    }
  }
  return deduplicateFindings(findings);
}

export function formatSecretFinding(finding: SecretScanFinding): string {
  const path = safePathForOutput(finding.path);
  return `${path}:${finding.line} [${finding.kind}] fingerprint=${finding.fingerprint}`;
}

export function formatSecretScanError(error: unknown): string {
  if (error instanceof SecretScanInputError) {
    return `Secret scan: ERROR (${error.message}).`;
  }
  return 'Secret scan: ERROR (scanner execution failed).';
}

export function isEligibleSecretScanPath(path: string): boolean {
  if (
    EXCLUDED_DIRECTORY_PATTERN.test(path) ||
    path.startsWith('backend/scripts/dictionary/raw/') ||
    path.startsWith('backend/scripts/dictionary/parsed/') ||
    path.startsWith('docs/ui_image/')
  ) {
    return false;
  }
  return !EXCLUDED_BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

function containsPrivateKeyBoundary(line: string): boolean {
  return /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u.test(line);
}

function containsCredentialUrl(line: string): boolean {
  const urls = line.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu) ?? [];
  return urls.some((candidate) => {
    const rawCandidate = candidate.replace(/[),.;]+$/u, '');
    if (containsExplicitPlaceholder(rawCandidate)) return false;
    try {
      const parsed = new URL(rawCandidate);
      return (
        parsed.username.length > 0 &&
        parsed.password.length > 0 &&
        !isReservedSyntheticHost(parsed.hostname)
      );
    } catch {
      return false;
    }
  });
}

function isReservedSyntheticHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '[::1]' ||
    normalized === 'example.com' ||
    normalized === 'example.net' ||
    normalized === 'example.org' ||
    normalized.endsWith('.example.com') ||
    normalized.endsWith('.example.net') ||
    normalized.endsWith('.example.org') ||
    normalized.endsWith('.test') ||
    normalized.endsWith('.invalid')
  );
}

function containsProviderKey(line: string): boolean {
  return [
    /\bAKIA[A-Z0-9]{16}\b/u,
    /\bASIA[A-Z0-9]{16}\b/u,
    /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/u,
    /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/u,
    /\bsk_(?:live|prod)_[A-Za-z0-9]{20,255}\b/u,
    /\bAIza[0-9A-Za-z_-]{35}\b/u,
  ].some((pattern) => pattern.test(line));
}

function containsHighConfidenceSecretAssignment(line: string): boolean {
  const assignments = line.matchAll(
    /(?:^|[\s,{;])["']?([A-Za-z_][A-Za-z0-9_.-]{1,127})["']?\s*(?::|=)\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`|([^\s;#]+))/gu,
  );
  for (const assignment of assignments) {
    const key = normalizeSecretKey(assignment[1] ?? '');
    const isQuoted =
      assignment[2] !== undefined ||
      assignment[3] !== undefined ||
      assignment[4] !== undefined;
    const value =
      assignment[2] ?? assignment[3] ?? assignment[4] ?? assignment[5] ?? '';
    const valueForAnalysis = isQuoted ? value : value.replace(/[,}]+$/gu, '');
    if (
      isHighConfidenceSecretKey(key) &&
      (isQuoted || !looksLikeCodeExpression(valueForAnalysis)) &&
      containsHighConfidenceSecretValue(valueForAnalysis)
    ) {
      return true;
    }
  }
  return false;
}

function normalizeSecretKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toUpperCase();
}

function isHighConfidenceSecretKey(key: string): boolean {
  return /(?:^|_)(?:API_KEY|AUTH_TOKEN|BEARER_TOKEN|CLIENT_SECRET|JWT_SECRET|JWT_SECRETS|PASSWORD|PASSWD|PEPPER|PRIVATE_KEY|REFRESH_TOKEN|SECRET|SECRET_ACCESS_KEY|SIGNING_KEY|SIGNING_SECRET|TOKEN|WEBHOOK_SECRET)$/u.test(
    key,
  );
}

function containsHighConfidenceSecretValue(value: string): boolean {
  if (!value || containsExplicitPlaceholder(value)) return false;
  const candidates = new Set<string>([
    value,
    ...(value.match(/[A-Za-z0-9+/_=-]{24,}/gu) ?? []),
  ]);
  for (const candidate of candidates) {
    const normalized = candidate.replace(/^["'`]+|["'`,;}]+$/gu, '');
    if (!normalized || containsExplicitPlaceholder(normalized)) continue;
    if (isKnownNonSecretToken(normalized)) continue;
    if (isHighEntropyHex(normalized)) return true;
    if (isHighEntropyBase64(normalized)) return true;
    if (isComplexOpaqueSecret(normalized)) return true;
  }
  return false;
}

function looksLikeCodeExpression(value: string): boolean {
  return (
    /(?:=>|\?\?|\?\.|\bas\s+[A-Za-z_$]|[()[\]])/u.test(value) ||
    /^!/u.test(value) ||
    /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+!?$/u.test(value)
  );
}

function isKnownNonSecretToken(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    ) || /^(?:\$argon2(?:id|i|d)\$|\$2[aby]\$|\$scrypt\$)/u.test(value)
  );
}

function isHighEntropyHex(value: string): boolean {
  if (!/^(?:[A-Fa-f0-9]{2}){32,}$/u.test(value)) return false;
  return hasByteDiversity(Buffer.from(value, 'hex'));
}

function isHighEntropyBase64(value: string): boolean {
  if (value.length < 32 || value.length % 4 === 1) return false;
  const isBase64 = /^[A-Za-z0-9+/]{32,}={0,2}$/u.test(value);
  const isBase64Url = /^[A-Za-z0-9_-]{32,}$/u.test(value);
  if (!isBase64 && !isBase64Url) return false;

  try {
    const bytes = Buffer.from(value, isBase64Url ? 'base64url' : 'base64');
    if (bytes.length < 24 || !hasByteDiversity(bytes)) return false;
    if (isBase64Url) return bytes.toString('base64url') === value;
    return (
      bytes.toString('base64').replace(/=+$/u, '') === value.replace(/=+$/u, '')
    );
  } catch {
    return false;
  }
}

function hasByteDiversity(bytes: Buffer): boolean {
  if (bytes.length === 0) return false;
  const frequencies = new Map<number, number>();
  for (const byte of bytes) {
    frequencies.set(byte, (frequencies.get(byte) ?? 0) + 1);
  }
  const maximumFrequency = Math.max(...frequencies.values());
  return frequencies.size >= 8 && maximumFrequency / bytes.length <= 0.5;
}

function isComplexOpaqueSecret(value: string): boolean {
  if (value.length < 24 || value.length > 4096 || /\s/u.test(value)) {
    return false;
  }
  const classes = [/[A-Z]/u, /[a-z]/u, /[0-9]/u, /[^A-Za-z0-9]/u].filter(
    (pattern) => pattern.test(value),
  ).length;
  return classes >= 3 && new Set(value).size >= 10;
}

function containsExplicitPlaceholder(value: string): boolean {
  if (/\$\{|\{\{|<[^>]+>/u.test(value)) return true;
  const normalized = value
    .toLowerCase()
    .replace(/\\(["'])/gu, '$1')
    .replace(/^["'`]+|["'`,;}]+$/gu, '');
  return /(?:^|["'{:=,])(?:change[-_]?me(?:[-_][a-z0-9_-]+)*|dummy(?:[-_][a-z0-9_-]+)*|example(?:[-_][a-z0-9_-]+)*|fake(?:[-_][a-z0-9_-]+)*|placeholder(?:[-_][a-z0-9_-]+)*|previous[-_]secret[-_]manager[-_]value|redacted(?:[-_][a-z0-9_-]+)*|synthetic(?:[-_][a-z0-9_-]+)*|test(?:[-_][a-z0-9_-]+)*|your[-_][a-z0-9_-]+)(?:["'},]|$)/u.test(
    normalized,
  );
}

function finding(
  path: string,
  line: number,
  kind: SecretScanFindingKind,
  source: string,
): SecretScanFinding {
  return {
    path,
    line,
    kind,
    fingerprint: stableFindingFingerprint(kind, source),
  };
}

function stableFindingFingerprint(
  kind: SecretScanFindingKind,
  source: string,
): string {
  return createHash('sha256')
    .update('hsk-secret-scan-v1\0', 'utf8')
    .update(kind, 'utf8')
    .update('\0', 'utf8')
    .update(source, 'utf8')
    .digest('hex');
}

function deduplicateFindings(
  findings: SecretScanFinding[],
): SecretScanFinding[] {
  return findings.filter(
    (finding, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.path === finding.path &&
          candidate.line === finding.line &&
          candidate.kind === finding.kind &&
          candidate.fingerprint === finding.fingerprint,
      ) === index,
  );
}

function applyAllowlist(
  findings: readonly SecretScanFinding[],
  allowlist: SecretScanAllowlist,
): SecretScanFinding[] {
  const allowed = new Set(
    allowlist.entries.map(
      ({ path, kind, fingerprint }) => `${path}\0${kind}\0${fingerprint}`,
    ),
  );
  return findings.filter(
    ({ path, kind, fingerprint }) =>
      !allowed.has(`${path}\0${kind}\0${fingerprint}`),
  );
}

function scanSecretBytes(path: string, bytes: Buffer): SecretScanFinding[] {
  if (bytes.length > MAX_SECRET_SCAN_FILE_BYTES) {
    throw new SecretScanInputError('file_too_large', path);
  }
  if (bytes.includes(0)) {
    throw new SecretScanInputError('unsupported_binary_content', path);
  }
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return scanSecretText(path, content);
  } catch (error: unknown) {
    if (error instanceof SecretScanInputError) throw error;
    throw new SecretScanInputError('invalid_utf8', path);
  }
}

function validateAllowlist(allowlist: SecretScanAllowlist): void {
  if (allowlist.version !== 1 || !Array.isArray(allowlist.entries)) {
    throw new Error('Secret scan allowlist is invalid.');
  }
  for (const entry of allowlist.entries) {
    if (
      !isSafeRepositoryPath(entry.path) ||
      !FINDING_KINDS.has(entry.kind) ||
      !entry.reason.trim() ||
      !/^[a-f0-9]{64}$/u.test(entry.fingerprint)
    ) {
      throw new Error('Secret scan allowlist is invalid.');
    }
  }
}

function gitPaths(repositoryRoot: string, args: readonly string[]): string[] {
  const output = execFileSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(output);
  return decoded.split('\0').filter((path) => path.length > 0);
}

type GitIndexEntry = {
  mode: string;
  objectId: string;
  path: string;
};

function gitIndexEntries(repositoryRoot: string): GitIndexEntry[] {
  const output = execFileSync('git', ['ls-files', '-z', '--stage'], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(output);
  return decoded
    .split('\0')
    .filter((record) => record.length > 0)
    .map((record) => {
      const match = /^(\d{6}) ([a-f0-9]{40,64}) ([0-3])\t([\s\S]+)$/u.exec(
        record,
      );
      if (!match || match[3] !== '0') {
        throw new SecretScanInputError('git_inventory_failed');
      }
      return {
        mode: match[1] ?? '',
        objectId: match[2] ?? '',
        path: match[4] ?? '',
      };
    });
}

function readGitIndexBlob(
  repositoryRoot: string,
  entry: GitIndexEntry,
): Buffer {
  try {
    const sizeText = execFileSync('git', ['cat-file', '-s', entry.objectId], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 1024,
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new SecretScanInputError('git_inventory_failed');
    }
    if (size > MAX_SECRET_SCAN_FILE_BYTES) {
      throw new SecretScanInputError('file_too_large', entry.path);
    }
    return execFileSync('git', ['cat-file', 'blob', entry.objectId], {
      cwd: repositoryRoot,
      encoding: 'buffer',
      maxBuffer: MAX_SECRET_SCAN_FILE_BYTES + 1024,
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    if (error instanceof SecretScanInputError) throw error;
    throw new SecretScanInputError('git_inventory_failed');
  }
}

function assertSafeRepositoryPath(path: string): void {
  if (!isSafeRepositoryPath(path)) {
    throw new SecretScanInputError('unsafe_path');
  }
}

function isSafeRepositoryPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    !hasControlCharacter(path) &&
    !path.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function assertPathIsWithinRepository(
  repositoryRoot: string,
  absolutePath: string,
): void {
  const relativePath = relative(resolve(repositoryRoot), absolutePath);
  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new SecretScanInputError('unsafe_path');
  }
}

function safePathForOutput(path: string): string {
  if (isSafeRepositoryPath(path)) return path;
  const fingerprint = createHash('sha256').update(path, 'utf8').digest('hex');
  return `[unsafe-path:${fingerprint.slice(0, 12)}]`;
}

function secretScanInputErrorMessage(
  reason: SecretScanInputErrorReason,
  safePath?: string,
): string {
  const pathSuffix = safePath ? `: ${safePath}` : '';
  switch (reason) {
    case 'file_limit_exceeded':
      return 'file inventory exceeds the configured limit';
    case 'file_too_large':
      return `eligible text file exceeds the configured size limit${pathSuffix}`;
    case 'git_inventory_failed':
      return 'Git file inventory failed';
    case 'invalid_utf8':
      return `eligible text file is not valid UTF-8${pathSuffix}`;
    case 'unsafe_path':
      return 'Git file inventory contains an unsafe path';
    case 'unsupported_binary_content':
      return `eligible text file contains binary data${pathSuffix}`;
    case 'unsupported_file_type':
      return `eligible path is not a regular file${pathSuffix}`;
  }
}
