import { createHash } from 'node:crypto';
import { createGunzip, gunzipSync } from 'node:zlib';
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { spawnSync } from 'node:child_process';

export type GateStatus = 'PASS' | 'FAIL_INTERNAL' | 'BLOCKED_EXTERNAL';
export type SupportedOs = 'darwin' | 'linux';
export type SupportedArchitecture = 'arm64' | 'x64';
export type ArchiveKind = 'tar.gz' | 'raw';
export type VersionParser =
  | 'alertmanager'
  | 'amtool'
  | 'grafana'
  | 'istioctl'
  | 'kubeconform'
  | 'kubectl'
  | 'nginx'
  | 'prometheus'
  | 'promtool'
  | 'pcre2';
export type FunctionalEvidenceKind =
  | 'amtool-config'
  | 'istio-analyze'
  | 'kubeconform-summary'
  | 'nginx-config'
  | 'promtool-check'
  | 'promtool-test-rules';

export interface VersionProbe {
  args: string[];
  parser: VersionParser;
}

export interface ShaArtifact {
  os: SupportedOs;
  architecture: SupportedArchitecture;
  artifact: string;
  sha256: string;
  archive: ArchiveKind;
  archiveRoot: string;
  executable: string;
  ociImage?: never;
  ociDigest?: never;
}

export interface OciArtifact {
  os: SupportedOs;
  architecture: SupportedArchitecture;
  ociImage: string;
  ociDigest: string;
  executable: string;
  artifact?: never;
  sha256?: never;
  archive?: never;
  archiveRoot?: never;
}

export type ToolArtifact = ShaArtifact | OciArtifact;

export interface ToolDefinition {
  version: string;
  probe: VersionProbe;
  platforms: ToolArtifact[];
}

export interface ToolchainManifest {
  schemaVersion: 2;
  tools: Record<string, ToolDefinition>;
  schemaBundles: Record<string, SchemaBundle>;
}

export interface SchemaFile {
  name: string;
  artifact: string;
  sha256: string;
}

export interface SchemaBundle {
  version: string;
  files: SchemaFile[];
}

export interface ValidatorResult {
  id: string;
  status: GateStatus;
  durationMs: number;
  reason?: string;
  commandIds?: string[];
  artifacts?: Array<{ name: string; version?: string; digest: string }>;
}

export interface CommandEvidence {
  id: string;
  validator: string;
  executable: string;
  exitCode: number;
  durationMs: number;
  logPath: string;
  expectedStop?: boolean;
  signal?: string;
}

export interface ReleaseContentEvidence {
  digest: string;
  pathCount: number;
  gitDirty: boolean;
  gitIndexDirty: boolean;
}

export type ProcessResult =
  | { kind: 'success'; status: 0; stdout: string; stderr: string }
  | {
      kind: 'exit';
      status: number | null;
      stdout: string;
      stderr: string;
    }
  | { kind: 'missing'; stdout: string; stderr: string }
  | { kind: 'timeout'; stdout: string; stderr: string };

const TOOL_VERSION = /^\d+\.\d+(?:\.\d+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const OCI_DIGEST = /^sha256:[a-f0-9]{64}$/;

export function parseToolchainManifest(input: unknown): ToolchainManifest {
  const root = record(input, 'manifest');
  exactKeys(root, ['schemaVersion', 'tools', 'schemaBundles'], 'manifest');
  if (root.schemaVersion !== 2) {
    throw new Error('Manifest schemaVersion must be 2.');
  }
  const rawTools = record(root.tools, 'manifest.tools');
  if (Object.keys(rawTools).length === 0) {
    throw new Error('Manifest tools must not be empty.');
  }

  const tools: Record<string, ToolDefinition> = {};
  for (const [toolName, value] of Object.entries(rawTools)) {
    if (!/^[a-z][a-z0-9-]*$/.test(toolName)) {
      throw new Error(`Manifest tool name is invalid: ${toolName}.`);
    }
    const tool = record(value, `manifest.tools.${toolName}`);
    exactKeys(
      tool,
      ['version', 'probe', 'platforms'],
      `manifest.tools.${toolName}`,
    );
    const version = string(tool.version, `${toolName}.version`);
    if (!TOOL_VERSION.test(version)) {
      throw new Error(`${toolName}.version must be an exact numeric version.`);
    }
    const rawProbe = record(tool.probe, `${toolName}.probe`);
    exactKeys(rawProbe, ['args', 'parser'], `${toolName}.probe`);
    if (
      !Array.isArray(rawProbe.args) ||
      rawProbe.args.length === 0 ||
      !rawProbe.args.every(isNonEmptyString)
    ) {
      throw new Error(
        `${toolName}.probe.args must be a non-empty string array.`,
      );
    }
    const parser = string(rawProbe.parser, `${toolName}.probe.parser`);
    if (!isVersionParser(parser)) {
      throw new Error(`${toolName}.probe.parser is unsupported.`);
    }
    if (!Array.isArray(tool.platforms) || tool.platforms.length === 0) {
      throw new Error(`${toolName}.platforms must not be empty.`);
    }
    const platforms = tool.platforms.map((platform, index) =>
      parseArtifact(platform, `${toolName}.platforms[${index}]`),
    );
    const identities = new Set<string>();
    for (const platform of platforms) {
      const identity = `${platform.os}/${platform.architecture}`;
      if (identities.has(identity)) {
        throw new Error(`${toolName} has duplicate platform ${identity}.`);
      }
      identities.add(identity);
    }
    if (!identities.has('darwin/arm64') || !identities.has('linux/x64')) {
      throw new Error(
        `${toolName} must define the Darwin arm64 and Linux amd64 platform matrix.`,
      );
    }
    tools[toolName] = {
      version,
      probe: { args: [...rawProbe.args] as string[], parser },
      platforms,
    };
  }
  const rawBundles = record(root.schemaBundles, 'manifest.schemaBundles');
  if (Object.keys(rawBundles).length === 0) {
    throw new Error('Manifest schemaBundles must not be empty.');
  }
  const schemaBundles: Record<string, SchemaBundle> = {};
  for (const [bundleName, value] of Object.entries(rawBundles)) {
    if (!/^[a-z][a-z0-9-]*$/u.test(bundleName)) {
      throw new Error(`Manifest schema bundle name is invalid: ${bundleName}.`);
    }
    const bundle = record(value, `manifest.schemaBundles.${bundleName}`);
    exactKeys(bundle, ['version', 'files'], `schema bundle ${bundleName}`);
    const version = string(bundle.version, `${bundleName}.version`);
    if (!TOOL_VERSION.test(version)) {
      throw new Error(
        `${bundleName}.version must be an exact numeric version.`,
      );
    }
    if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
      throw new Error(`${bundleName}.files must not be empty.`);
    }
    const names = new Set<string>();
    const files = bundle.files.map((candidate, index): SchemaFile => {
      const path = `${bundleName}.files[${index}]`;
      const file = record(candidate, path);
      exactKeys(file, ['name', 'artifact', 'sha256'], path);
      const name = string(file.name, `${path}.name`);
      if (!/^[a-z0-9][a-z0-9.-]*\.json$/u.test(name) || name.includes('..')) {
        throw new Error(`${path}.name must be a safe JSON schema filename.`);
      }
      if (names.has(name)) throw new Error(`${bundleName} duplicates ${name}.`);
      names.add(name);
      const artifact = credentialFreeHttpsUrl(
        file.artifact,
        `${path}.artifact`,
      );
      const sha256 = string(file.sha256, `${path}.sha256`);
      if (!SHA256.test(sha256)) {
        throw new Error(`${path}.sha256 must be a pinned SHA-256.`);
      }
      return { name, artifact, sha256 };
    });
    schemaBundles[bundleName] = { version, files };
  }
  return { schemaVersion: 2, tools, schemaBundles };
}

export function selectArtifact(
  tool: ToolDefinition,
  os: string,
  architecture: string,
): ToolArtifact {
  const artifact = tool.platforms.find(
    (candidate) =>
      candidate.os === os && candidate.architecture === architecture,
  );
  if (!artifact) {
    throw new Error(`Unsupported platform: ${os}/${architecture}.`);
  }
  return artifact;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifySha256(bytes: Uint8Array, expected: string): string {
  if (!SHA256.test(expected)) {
    throw new Error('Pinned SHA-256 is malformed.');
  }
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error('Artifact checksum mismatch.');
  }
  return actual;
}

export function assertOciDigest(actual: string, expected: string): void {
  if (!OCI_DIGEST.test(actual) || !OCI_DIGEST.test(expected)) {
    throw new Error('OCI digest is malformed.');
  }
  if (actual !== expected) {
    throw new Error('OCI digest mismatch.');
  }
}

export function assertGzipArchive(bytes: Uint8Array): void {
  if (
    bytes.length < 3 ||
    bytes[0] !== 0x1f ||
    bytes[1] !== 0x8b ||
    bytes[2] !== 0x08
  ) {
    throw new Error('Artifact is not a valid gzip archive header.');
  }
}

export function assertArchiveEntriesSafe(
  entries: readonly string[],
  archiveRoot: string,
): void {
  if (
    !archiveRoot ||
    (archiveRoot !== '.' &&
      (archiveRoot.includes('/') || archiveRoot.includes('\\')))
  ) {
    throw new Error('Unsafe archive root.');
  }
  if (entries.length === 0) {
    throw new Error('Unsafe archive: archive is empty.');
  }
  for (const rawEntry of entries) {
    if (!rawEntry || rawEntry.includes('\0')) {
      throw new Error('Unsafe archive entry.');
    }
    const entry = rawEntry.split('\\').join('/');
    const segments = entry.split('/').filter(Boolean);
    if (
      entry.startsWith('/') ||
      /^[A-Za-z]:/.test(entry) ||
      segments.includes('..') ||
      (archiveRoot !== '.' && segments[0] !== archiveRoot)
    ) {
      throw new Error(`Unsafe archive entry: ${redactDiagnostic(rawEntry)}.`);
    }
  }
}

export function assertArchiveLinksSafe(
  links: ReadonlyArray<{
    type: 'hardlink' | 'symlink';
    name: string;
    target: string;
  }>,
): void {
  if (links.length > 0) {
    throw new Error(
      `Archive link entries are not permitted: ${redactDiagnostic(links[0].name)}.`,
    );
  }
}

export function inspectTarGzipArchive(bytes: Uint8Array): string[] {
  assertGzipArchive(bytes);
  let tar: Buffer;
  try {
    tar = gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 });
  } catch {
    throw new Error('Corrupt gzip archive.');
  }
  return inspectTarBuffer(tar);
}

function inspectTarBuffer(tar: Buffer): string[] {
  const entries: string[] = [];
  let pendingLongName: string | undefined;
  let zeroBlocks = 0;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      continue;
    }
    if (zeroBlocks > 0)
      throw new Error('Tar archive contains data after terminator.');
    const parsed = parseTarHeader(header);
    const paddedSize = Math.ceil(parsed.size / 512) * 512;
    if (offset + paddedSize > tar.length)
      throw new Error('Corrupt truncated tar archive.');
    if (parsed.typeFlag === 'L') {
      pendingLongName = parseGnuLongName(
        tar.subarray(offset, offset + parsed.size),
      );
    } else {
      entries.push(pendingLongName ?? parsed.name);
      pendingLongName = undefined;
    }
    offset += paddedSize;
  }
  if (
    tar.length % 512 !== 0 ||
    zeroBlocks < 2 ||
    pendingLongName !== undefined
  ) {
    throw new Error('Corrupt or unterminated tar archive.');
  }
  return entries;
}

export async function inspectTarGzipFile(path: string): Promise<string[]> {
  const stream = createReadStream(path).pipe(createGunzip());
  const entries: string[] = [];
  let buffered = Buffer.alloc(0);
  let remainingPayload = 0;
  let collectRemaining = 0;
  let collected: Buffer[] = [];
  let collectingLongName = false;
  let pendingLongName: string | undefined;
  let zeroBlocks = 0;
  for await (const value of stream) {
    buffered = Buffer.concat([buffered, Buffer.from(value as Uint8Array)]);
    while (buffered.length > 0) {
      if (remainingPayload > 0) {
        const consumed = Math.min(remainingPayload, buffered.length);
        if (collectRemaining > 0) {
          const collectedSize = Math.min(collectRemaining, consumed);
          collected.push(buffered.subarray(0, collectedSize));
          collectRemaining -= collectedSize;
        }
        buffered = buffered.subarray(consumed);
        remainingPayload -= consumed;
        if (remainingPayload === 0 && collectingLongName) {
          pendingLongName = parseGnuLongName(Buffer.concat(collected));
          collected = [];
          collectingLongName = false;
        }
        continue;
      }
      if (buffered.length < 512) break;
      const header = buffered.subarray(0, 512);
      buffered = buffered.subarray(512);
      if (header.every((byte) => byte === 0)) {
        zeroBlocks += 1;
        continue;
      }
      if (zeroBlocks > 0)
        throw new Error('Tar archive contains data after terminator.');
      const parsed = parseTarHeader(header);
      if (parsed.typeFlag === 'L') {
        collectingLongName = true;
        collectRemaining = parsed.size;
        collected = [];
      } else {
        entries.push(pendingLongName ?? parsed.name);
        pendingLongName = undefined;
      }
      remainingPayload = Math.ceil(parsed.size / 512) * 512;
    }
  }
  if (
    remainingPayload !== 0 ||
    buffered.length !== 0 ||
    zeroBlocks < 2 ||
    pendingLongName !== undefined ||
    collectingLongName
  ) {
    throw new Error('Corrupt or unterminated tar archive.');
  }
  return entries;
}

function parseGnuLongName(value: Buffer): string {
  const terminator = value.indexOf(0);
  if (terminator < 1 || value.subarray(terminator).some((byte) => byte !== 0)) {
    throw new Error('Invalid GNU long-name tar entry.');
  }
  return value.subarray(0, terminator).toString('utf8');
}

export function assertExecutableFromVerifiedRoot(
  executable: string,
  verifiedRoot: string,
): void {
  const canonicalExecutable = realpathSync(executable);
  const canonicalRoot = realpathSync(verifiedRoot);
  const pathFromRoot = relative(canonicalRoot, canonicalExecutable);
  if (
    pathFromRoot === '' ||
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(
      'Executable is outside the checksum-verified artifact root.',
    );
  }
}

export function assertSafeTemporaryCleanupRoot(
  cleanupRoot: string,
  prefix = 'hsk-media-',
): void {
  const canonicalRoot = realpathSync(cleanupRoot);
  const canonicalTmp = realpathSync(process.env.TMPDIR ?? '/tmp');
  const pathFromTmp = relative(canonicalTmp, canonicalRoot);
  if (
    pathFromTmp === '' ||
    pathFromTmp === '..' ||
    pathFromTmp.startsWith(`..${sep}`) ||
    isAbsolute(pathFromTmp) ||
    pathFromTmp.includes(sep) ||
    !pathFromTmp.startsWith(prefix)
  ) {
    throw new Error(
      'Cleanup root is outside the validated task temporary boundary.',
    );
  }
}

export function assertExtractedTreeSafe(
  root: string,
  cleanupRoot: string,
): void {
  const canonicalCleanup = realpathSync(cleanupRoot);
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error('Extracted archive contains a link or special file.');
    }
    const canonical = realpathSync(path);
    const relativePath = relative(canonicalCleanup, canonical);
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error('Extracted archive path escapes its cleanup root.');
    }
    if (stat.isDirectory()) {
      for (const child of readdirSync(path)) visit(`${path}${sep}${child}`);
    }
  };
  visit(root);
}

export function assertExactMediaNetworkTopology(
  resources: Array<Record<string, unknown>>,
): void {
  const named = (kind: string, name: string): Record<string, unknown> => {
    const value = resources.find(
      (candidate) =>
        candidate.kind === kind &&
        nested(candidate, ['metadata', 'name']) === name,
    );
    if (!value) throw new Error(`Missing topology resource ${kind}/${name}.`);
    return value;
  };
  exactStructure(
    nested(named('NetworkPolicy', 'hsk-backend-media-metrics-private'), [
      'spec',
    ]),
    {
      podSelector: {
        matchLabels: { 'app.kubernetes.io/name': 'hsk-backend' },
      },
      policyTypes: ['Ingress'],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { 'kubernetes.io/metadata.name': 'hsk-edge' },
              },
              podSelector: {
                matchLabels: { 'app.kubernetes.io/name': 'hsk-nginx' },
              },
            },
          ],
          ports: [{ protocol: 'TCP', port: 3000 }],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { 'kubernetes.io/metadata.name': 'monitoring' },
              },
              podSelector: {
                matchLabels: { 'app.kubernetes.io/name': 'prometheus' },
              },
            },
          ],
          ports: [{ protocol: 'TCP', port: 9464 }],
        },
      ],
    },
  );
  exactStructure(
    nested(named('NetworkPolicy', 'hsk-media-alertmanager-private'), ['spec']),
    {
      podSelector: {
        matchLabels: { 'app.kubernetes.io/name': 'hsk-media-alertmanager' },
      },
      policyTypes: ['Ingress'],
      ingress: [
        {
          from: [
            {
              podSelector: {
                matchLabels: { 'app.kubernetes.io/name': 'prometheus' },
              },
            },
          ],
          ports: [{ protocol: 'TCP', port: 9093 }],
        },
      ],
    },
  );
  exactStructure(
    nested(
      named('AuthorizationPolicy', 'hsk-backend-media-metrics-principal'),
      ['spec'],
    ),
    {
      selector: {
        matchLabels: { 'app.kubernetes.io/name': 'hsk-backend' },
      },
      action: 'ALLOW',
      rules: [
        {
          from: [
            {
              source: {
                principals: [
                  'cluster.local/ns/monitoring/sa/hsk-media-prometheus',
                ],
              },
            },
          ],
          to: [
            {
              operation: {
                ports: ['9464'],
                methods: ['GET'],
                paths: ['/metrics'],
              },
            },
          ],
        },
        {
          from: [{ source: { namespaces: ['hsk-edge'] } }],
          to: [{ operation: { ports: ['3000'] } }],
        },
      ],
    },
  );
  exactStructure(
    nested(named('AuthorizationPolicy', 'hsk-media-alertmanager-principal'), [
      'spec',
    ]),
    {
      selector: {
        matchLabels: {
          'app.kubernetes.io/name': 'hsk-media-alertmanager',
        },
      },
      action: 'ALLOW',
      rules: [
        {
          from: [
            {
              source: {
                principals: [
                  'cluster.local/ns/monitoring/sa/hsk-media-prometheus',
                ],
              },
            },
          ],
          to: [{ operation: { ports: ['9093'] } }],
        },
      ],
    },
  );
  exactStructure(
    nested(
      named('PeerAuthentication', 'hsk-backend-media-metrics-strict-mtls'),
      ['spec'],
    ),
    {
      selector: {
        matchLabels: { 'app.kubernetes.io/name': 'hsk-backend' },
      },
      mtls: { mode: 'STRICT' },
    },
  );
  exactStructure(
    nested(named('PeerAuthentication', 'hsk-media-alertmanager-strict-mtls'), [
      'spec',
    ]),
    {
      selector: {
        matchLabels: {
          'app.kubernetes.io/name': 'hsk-media-alertmanager',
        },
      },
      mtls: { mode: 'STRICT' },
    },
  );
}

export function parseExactVersion(
  parser: VersionParser,
  output: string,
): string {
  if (output.length > 16_384) {
    throw new Error('Unrecognized version output.');
  }
  const patterns: Record<VersionParser, RegExp> = {
    alertmanager: /^alertmanager, version (\d+\.\d+\.\d+)(?:\s.*)?$/m,
    amtool: /^amtool, version (\d+\.\d+\.\d+)(?:\s.*)?$/m,
    grafana: /^Version (\d+\.\d+\.\d+)(?:\s.*)?$/m,
    istioctl: /^client version: (\d+\.\d+\.\d+)$/m,
    kubeconform: /^v(\d+\.\d+\.\d+)$/m,
    kubectl: /^Client Version: v(\d+\.\d+\.\d+)$/m,
    nginx: /^nginx version: nginx\/(\d+\.\d+\.\d+)$/m,
    prometheus: /^prometheus, version (\d+\.\d+\.\d+)(?:\s.*)?$/m,
    promtool: /^promtool, version (\d+\.\d+\.\d+)(?:\s.*)?$/m,
    pcre2: /^(\d+\.\d+)$/m,
  };
  const match = patterns[parser].exec(output.trim());
  if (!match || !TOOL_VERSION.test(match[1])) {
    throw new Error('Unrecognized version output.');
  }
  return match[1];
}

export function requireExactVersion(actual: string, expected: string): void {
  if (
    !TOOL_VERSION.test(actual) ||
    !TOOL_VERSION.test(expected) ||
    actual !== expected
  ) {
    throw new Error('Tool version mismatch.');
  }
}

export function assertFunctionalEvidence(
  kind: FunctionalEvidenceKind,
  output: string,
): void {
  if (output.length > 2 * 1024 * 1024) {
    throw new Error('Functional attestation output is oversized.');
  }
  const patterns: Record<FunctionalEvidenceKind, RegExp> = {
    'amtool-config': /(?:SUCCESS|SUCCESS:)/,
    'istio-analyze': /No validation issues found/i,
    'kubeconform-summary':
      /Summary:\s+\d+ resources? found.*Invalid:\s*0.*Errors:\s*0.*Skipped:\s*0/i,
    'nginx-config': /syntax is ok[\s\S]*test is successful/i,
    'promtool-check': /SUCCESS/,
    'promtool-test-rules': /SUCCESS/,
  };
  if (!patterns[kind].test(output)) {
    throw new Error(`Required ${kind} functional attestation is missing.`);
  }
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
    input?: string;
  },
): ProcessResult {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
    input: options.input,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (
    result.error &&
    'code' in result.error &&
    result.error.code === 'ENOENT'
  ) {
    return { kind: 'missing', stdout, stderr };
  }
  if (
    result.error &&
    'code' in result.error &&
    result.error.code === 'ETIMEDOUT'
  ) {
    return { kind: 'timeout', stdout, stderr };
  }
  if (result.status !== 0) {
    return { kind: 'exit', status: result.status, stdout, stderr };
  }
  return { kind: 'success', status: 0, stdout, stderr };
}

export function classifyValidators(results: ValidatorResult[]): {
  exitCode: 0 | 1 | 2;
  results: ValidatorResult[];
} {
  const safeResults = results.map((result) => ({
    ...result,
    reason: result.reason ? redactDiagnostic(result.reason) : undefined,
  }));
  if (safeResults.some(({ status }) => status === 'FAIL_INTERNAL')) {
    return { exitCode: 1, results: safeResults };
  }
  if (safeResults.some(({ status }) => status === 'BLOCKED_EXTERNAL')) {
    return { exitCode: 2, results: safeResults };
  }
  return { exitCode: 0, results: safeResults };
}

export function assertCommandEvidenceContract(
  commands: readonly CommandEvidence[],
  results: readonly ValidatorResult[] = [],
): void {
  const resultByValidator = new Map(
    results.map((result) => [result.id, result]),
  );
  const identifiers = new Set<string>();
  for (const command of commands) {
    if (
      !command.id ||
      !command.validator ||
      !/^[a-z0-9][a-z0-9.-]*$/iu.test(command.executable) ||
      !Number.isSafeInteger(command.exitCode) ||
      command.exitCode < 0 ||
      !Number.isSafeInteger(command.durationMs) ||
      command.durationMs < 0 ||
      !/^logs\/[a-z0-9][a-z0-9.-]*\.log$/iu.test(command.logPath) ||
      command.logPath.includes('..')
    ) {
      throw new Error('Machine command evidence has an invalid field.');
    }
    const validatorResult = resultByValidator.get(command.validator);
    if (
      results.length > 0 &&
      !validatorResult &&
      command.validator !== 'evidence'
    ) {
      throw new Error(
        'Machine command evidence references an unknown validator.',
      );
    }
    if (
      command.exitCode !== 0 &&
      (validatorResult?.status === 'PASS' || command.validator === 'evidence')
    ) {
      throw new Error('A PASS validator records a failed command.');
    }
    if (identifiers.has(command.id)) {
      throw new Error('Machine command evidence has a duplicate identifier.');
    }
    identifiers.add(command.id);
    if (
      command.expectedStop === true &&
      (command.exitCode !== 0 ||
        (command.signal !== undefined &&
          !['SIGTERM', 'SIGKILL'].includes(command.signal)))
    ) {
      throw new Error('Intentional runtime stop evidence is inconsistent.');
    }
    if (command.signal && command.expectedStop !== true) {
      throw new Error('Unexpected runtime signal is not classified.');
    }
    for (const value of [
      command.id,
      command.validator,
      command.executable,
      command.logPath,
    ]) {
      if (redactDiagnostic(value) !== value) {
        throw new Error('Machine command evidence contains a secret value.');
      }
    }
  }
}

export function resolveMediaOperationsEvidenceRoot(
  repositoryRoot: string,
  configuredRoot?: string,
): string {
  const canonicalRepository = realpathSync(repositoryRoot);
  const workspaceBackend = resolve(canonicalRepository, 'backend');
  if (
    !existsSync(workspaceBackend) ||
    lstatSync(workspaceBackend).isSymbolicLink() ||
    !lstatSync(workspaceBackend).isDirectory() ||
    realpathSync(workspaceBackend) !== workspaceBackend
  ) {
    throw new Error('Repository backend must be a real directory.');
  }
  const workspaceParentPath = resolve(workspaceBackend, 'test-results');
  if (!existsSync(workspaceParentPath)) {
    mkdirSync(workspaceParentPath, { mode: 0o700 });
  }
  if (
    lstatSync(workspaceParentPath).isSymbolicLink() ||
    !lstatSync(workspaceParentPath).isDirectory()
  ) {
    throw new Error('Workspace evidence parent must be a real directory.');
  }
  const workspaceParent = realpathSync(workspaceParentPath);
  if (workspaceParent !== workspaceParentPath) {
    throw new Error('Workspace evidence parent must not traverse a link.');
  }
  const canonicalTemporaryParent = realpathSync(tmpdir());
  const requested =
    configuredRoot ?? resolve(workspaceParent, 'media-operations');
  if (configuredRoot !== undefined && !isAbsolute(configuredRoot)) {
    throw new Error('MEDIA_OPS_EVIDENCE_DIR must be an absolute path.');
  }
  const rawCandidate = resolve(requested);
  const candidate = join(
    realpathSync(dirname(rawCandidate)),
    basename(rawCandidate),
  );
  const workspaceRelative = relative(workspaceParent, candidate);
  const temporaryRelative = relative(canonicalTemporaryParent, candidate);
  const workspaceOwned =
    isStrictDescendant(workspaceRelative) &&
    /^media-operations(?:[-.][a-z0-9._-]+)?(?:\/|$)/iu.test(
      workspaceRelative.split(sep).join('/'),
    );
  const temporaryOwned =
    isStrictDescendant(temporaryRelative) &&
    !temporaryRelative.includes(sep) &&
    basename(candidate).startsWith('hsk-media-operations-evidence-');
  const approvedParent = workspaceOwned
    ? workspaceParent
    : temporaryOwned
      ? canonicalTemporaryParent
      : undefined;
  if (!approvedParent) {
    throw new Error(
      'MEDIA_OPS_EVIDENCE_DIR is outside an approved task-owned evidence boundary.',
    );
  }
  assertNoSymlinkOrSpecialPath(approvedParent, candidate);
  return candidate;
}

export function invalidateEvidenceSummaries(
  evidenceRoot: string,
  repositoryRoot: string,
): void {
  const approved = resolveMediaOperationsEvidenceRoot(
    repositoryRoot,
    evidenceRoot,
  );
  const canonicalEvidence = realpathSync(evidenceRoot);
  if (canonicalEvidence !== approved) {
    throw new Error(
      'Evidence invalidation root does not match the approved exact target.',
    );
  }
  for (const name of [
    'media-operations-validation.json',
    'media-operations-validation.junit.xml',
  ]) {
    const path = `${canonicalEvidence}${sep}${name}`;
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

export function resetMediaOperationsEvidenceLogs(
  evidenceRoot: string,
  repositoryRoot: string,
): void {
  const approved = resolveMediaOperationsEvidenceRoot(
    repositoryRoot,
    evidenceRoot,
  );
  if (realpathSync(evidenceRoot) !== approved) {
    throw new Error(
      'Evidence log root does not match the approved exact target.',
    );
  }
  const logs = join(approved, 'logs');
  if (existsSync(logs)) {
    const stat = lstatSync(logs);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Evidence logs path must be a real directory.');
    }
    if (realpathSync(logs) !== logs) {
      throw new Error('Evidence logs path resolves through an alias or link.');
    }
  }
  rmSync(logs, { recursive: true, force: true });
}

export function requireCredentialFreeHttpsRunbookUrl(
  value: unknown,
  options: { allowLoopback?: boolean } = {},
): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error('Runbook URL must be a non-empty HTTPS URL.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Runbook URL must be an absolute HTTPS URL.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname.endsWith('.invalid') ||
    value.includes('__MEDIA_RUNBOOK_URL__') ||
    (!options.allowLoopback &&
      ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname))
  ) {
    throw new Error('Runbook URL must be credential-free production HTTPS.');
  }
  return parsed.toString();
}

export function assertEveryAlertRunbookUrl(
  documents: readonly unknown[],
  expectedUrl: string,
  options: { allowLoopback?: boolean } = {},
): number {
  const expected = requireCredentialFreeHttpsRunbookUrl(expectedUrl, options);
  let alertCount = 0;
  for (const [documentIndex, document] of documents.entries()) {
    const root = record(document, `alert documents[${documentIndex}]`);
    if (!Array.isArray(root.groups) || root.groups.length === 0) {
      throw new Error('Rendered alert rules must contain non-empty groups.');
    }
    for (const [groupIndex, group] of root.groups.entries()) {
      const groupRecord = record(
        group,
        `alert documents[${documentIndex}].groups[${groupIndex}]`,
      );
      if (!Array.isArray(groupRecord.rules) || groupRecord.rules.length === 0) {
        throw new Error('Rendered alert group must contain non-empty rules.');
      }
      for (const [ruleIndex, rule] of groupRecord.rules.entries()) {
        const ruleRecord = record(
          rule,
          `alert documents[${documentIndex}].groups[${groupIndex}].rules[${ruleIndex}]`,
        );
        if (!('alert' in ruleRecord)) continue;
        if (!isNonEmptyString(ruleRecord.alert)) {
          throw new Error('Alert rule must have a non-empty alert name.');
        }
        const annotations = record(
          ruleRecord.annotations,
          `alert ${ruleRecord.alert}.annotations`,
        );
        const actual = requireCredentialFreeHttpsRunbookUrl(
          annotations.runbook_url,
          options,
        );
        if (actual !== expected) {
          throw new Error(
            `Alert ${ruleRecord.alert} runbook_url does not match the rendered contract.`,
          );
        }
        alertCount += 1;
      }
    }
  }
  if (alertCount === 0) {
    throw new Error('Rendered rule files contain no alerting rules.');
  }
  return alertCount;
}

export function assertPrometheusRuntimeAlertRunbookUrl(
  response: unknown,
  expectedUrl: string,
  options: { allowLoopback?: boolean } = {},
): number {
  const expected = requireCredentialFreeHttpsRunbookUrl(expectedUrl, options);
  const root = record(response, 'Prometheus rules response');
  if (root.status !== 'success') {
    throw new Error('Prometheus rules API did not return success.');
  }
  const data = record(root.data, 'Prometheus rules response.data');
  if (!Array.isArray(data.groups) || data.groups.length === 0) {
    throw new Error('Prometheus rules API returned no rule groups.');
  }
  let alertCount = 0;
  for (const [groupIndex, group] of data.groups.entries()) {
    const groupRecord = record(
      group,
      `Prometheus rules response.data.groups[${groupIndex}]`,
    );
    if (!Array.isArray(groupRecord.rules)) {
      throw new Error('Prometheus runtime rule group has no rules array.');
    }
    for (const [ruleIndex, rule] of groupRecord.rules.entries()) {
      const ruleRecord = record(
        rule,
        `Prometheus runtime rule[${groupIndex}][${ruleIndex}]`,
      );
      if (ruleRecord.type !== 'alerting') continue;
      const annotations = record(
        ruleRecord.annotations,
        `Prometheus runtime alert ${String(ruleRecord.name)} annotations`,
      );
      const actual = requireCredentialFreeHttpsRunbookUrl(
        annotations.runbook_url,
        options,
      );
      if (actual !== expected) {
        throw new Error(
          `Prometheus runtime alert ${String(ruleRecord.name)} has the wrong runbook_url.`,
        );
      }
      alertCount += 1;
    }
  }
  if (alertCount === 0) {
    throw new Error('Prometheus rules API returned no alerting rules.');
  }
  return alertCount;
}

export function computeReleaseContentDigest(
  repositoryRoot: string,
  status: string,
): ReleaseContentEvidence {
  const raw = status.split('\0');
  const entries: Array<{ status: string; path: string }> = [];
  for (let index = 0; index < raw.length; index += 1) {
    const record = raw[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error('Git porcelain status is malformed.');
    }
    const code = record.slice(0, 2);
    entries.push({ status: code, path: record.slice(3) });
    if (/[RC]/u.test(code) && raw[index + 1]) {
      entries.push({ status: 'D ', path: raw[++index] });
    }
  }
  const selected = entries
    .filter(({ path }) =>
      ['backend/', 'docs/', 'ops/'].some((prefix) => path.startsWith(prefix)),
    )
    .filter(({ path }) => !path.startsWith('backend/test-results/'))
    .sort((left, right) => left.path.localeCompare(right.path));
  const digest = createHash('sha256');
  for (const entry of selected) {
    const absolute = resolve(repositoryRoot, entry.path);
    digest.update(entry.status);
    digest.update('\0');
    digest.update(entry.path);
    digest.update('\0');
    if (existsSync(absolute) && statSync(absolute).isFile()) {
      const bytes = readFileSync(absolute);
      digest.update(String(bytes.length));
      digest.update('\0');
      digest.update(bytes);
    } else {
      digest.update('DELETED');
    }
    digest.update('\0');
  }
  return {
    digest: digest.digest('hex'),
    pathCount: selected.length,
    gitDirty: selected.length > 0,
    gitIndexDirty: selected.some(
      ({ status: code }) => code[0] !== ' ' && code[0] !== '?',
    ),
  };
}

export function assertReleaseContentStable(
  before: ReleaseContentEvidence,
  after: ReleaseContentEvidence,
): void {
  if (
    before.digest !== after.digest ||
    before.pathCount !== after.pathCount ||
    before.gitDirty !== after.gitDirty ||
    before.gitIndexDirty !== after.gitIndexDirty
  ) {
    throw new Error('Release content changed while validation was running.');
  }
}

export function assertReleaseHeadStable(before: string, after: string): void {
  const commit = /^[a-f0-9]{40}$/u;
  if (!commit.test(before) || !commit.test(after) || before !== after) {
    throw new Error('Git HEAD changed while validation was running.');
  }
}

export function renderValidatorJUnit(
  results: readonly ValidatorResult[],
): string {
  const failures = results.filter(
    ({ status }) => status === 'FAIL_INTERNAL',
  ).length;
  const skipped = results.filter(
    ({ status }) => status === 'BLOCKED_EXTERNAL',
  ).length;
  const cases = results
    .map((result) => {
      const name = xml(result.id);
      const time = (result.durationMs / 1_000).toFixed(3);
      if (result.status === 'FAIL_INTERNAL') {
        return `  <testcase name="${name}" time="${time}"><failure message="${xml(result.reason ?? 'Internal failure')}"/></testcase>`;
      }
      if (result.status === 'BLOCKED_EXTERNAL') {
        return `  <testcase name="${name}" time="${time}"><skipped message="${xml(result.reason ?? 'External prerequisite unavailable')}"/></testcase>`;
      }
      return `  <testcase name="${name}" time="${time}"/>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="media-operations" tests="${results.length}" failures="${failures}" skipped="${skipped}">\n${cases}\n</testsuite>\n`;
}

export function assertGrafanaQueryResult(result: unknown, refId: string): void {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`Grafana datasource query ${refId} has no result object.`);
  }
  const record = result as Record<string, unknown>;
  if (record.error || record.status !== 200 || !Array.isArray(record.frames)) {
    throw new Error(
      `Grafana datasource query ${refId} did not return status 200.`,
    );
  }
  const hasMetricValue = record.frames.some((frame) => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame))
      return false;
    const frameRecord = frame as Record<string, unknown>;
    if (
      !frameRecord.schema ||
      typeof frameRecord.schema !== 'object' ||
      Array.isArray(frameRecord.schema) ||
      !frameRecord.data ||
      typeof frameRecord.data !== 'object' ||
      Array.isArray(frameRecord.data)
    ) {
      return false;
    }
    const fields = (frameRecord.schema as Record<string, unknown>).fields;
    const values = (frameRecord.data as Record<string, unknown>).values;
    if (!Array.isArray(fields) || !Array.isArray(values)) return false;
    return fields.some((field, index) => {
      if (!field || typeof field !== 'object' || Array.isArray(field)) {
        return false;
      }
      const type = (field as Record<string, unknown>).type;
      const series: unknown = (values as unknown[])[index];
      return (
        type !== 'time' &&
        Array.isArray(series) &&
        series.some((value) => value !== null && value !== undefined)
      );
    });
  });
  if (!hasMetricValue) {
    throw new Error(
      `Grafana datasource query ${refId} has no metric datapoint.`,
    );
  }
}

export function assertGrafanaNoDataResult(
  result: unknown,
  refId: string,
): void {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`Grafana no-data query ${refId} has no result object.`);
  }
  const record = result as Record<string, unknown>;
  if (record.error || record.status !== 200 || !Array.isArray(record.frames)) {
    throw new Error(
      `Grafana no-data query ${refId} did not return status 200.`,
    );
  }
  const containsValue = record.frames.some((frame) => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame))
      return false;
    const data = (frame as Record<string, unknown>).data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const values = (data as Record<string, unknown>).values;
    return (
      Array.isArray(values) &&
      values.some(
        (series) =>
          Array.isArray(series) &&
          series.some((value) => value !== null && value !== undefined),
      )
    );
  });
  if (containsValue) {
    throw new Error(
      `Grafana no-data query ${refId} unexpectedly returned data.`,
    );
  }
}

export function redactDiagnostic(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(
      /\b(token|access_token|refresh_token|password|secret|client_secret|api_key|private_key|session|cookie|signature|authorization|(?:jwt|media|aws|auth)[a-z0-9_]*_(?:secret|secrets|token|tokens|key|keys))=(?:"[^"]*"|'[^']*'|[^\s&]+)/gi,
      '$1=[REDACTED]',
    )
    .replace(
      /"(token|access_token|refresh_token|password|secret|client_secret|api_key|private_key|session|cookie|signature|authorization|(?:jwt|media|aws|auth)[a-z0-9_]*_(?:secret|secrets|token|tokens|key|keys))"\s*:\s*"[^"]*"/gi,
      '"$1":"[REDACTED]"',
    )
    .replace(/\bauthorization\s*:\s*[^\r\n]+/gi, 'authorization: [REDACTED]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .slice(0, 1_024);
}

function xml(value: string): string {
  return redactDiagnostic(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function parseArtifact(input: unknown, path: string): ToolArtifact {
  const artifact = record(input, path);
  const os = string(artifact.os, `${path}.os`);
  const architecture = string(artifact.architecture, `${path}.architecture`);
  if (os !== 'darwin' && os !== 'linux') {
    throw new Error(`${path}.os is unsupported.`);
  }
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`${path}.architecture is unsupported.`);
  }
  const executable = safeRelativePath(
    string(artifact.executable, `${path}.executable`),
    `${path}.executable`,
  );
  const hasSha = 'sha256' in artifact || 'artifact' in artifact;
  const hasOci = 'ociDigest' in artifact || 'ociImage' in artifact;
  if (hasSha === hasOci) {
    throw new Error(
      `${path} requires exactly one sha256 artifact or OCI digest.`,
    );
  }
  if (hasOci) {
    exactKeys(
      artifact,
      ['os', 'architecture', 'ociImage', 'ociDigest', 'executable'],
      path,
    );
    const ociImage = string(artifact.ociImage, `${path}.ociImage`);
    const ociDigest = string(artifact.ociDigest, `${path}.ociDigest`);
    if (!OCI_DIGEST.test(ociDigest) || !/^[-a-z0-9./]+$/.test(ociImage)) {
      throw new Error(`${path} has an invalid OCI image or digest.`);
    }
    return { os, architecture, ociImage, ociDigest, executable };
  }
  exactKeys(
    artifact,
    [
      'os',
      'architecture',
      'artifact',
      'sha256',
      'archive',
      'archiveRoot',
      'executable',
    ],
    path,
  );
  const url = string(artifact.artifact, `${path}.artifact`);
  const digest = string(artifact.sha256, `${path}.sha256`);
  const archive = string(artifact.archive, `${path}.archive`);
  const archiveRoot = string(artifact.archiveRoot, `${path}.archiveRoot`);
  credentialFreeHttpsUrl(url, `${path}.artifact`);
  if (!SHA256.test(digest)) {
    throw new Error(
      `${path}.sha256 must be 64 lowercase hexadecimal characters.`,
    );
  }
  if (archive !== 'tar.gz' && archive !== 'raw') {
    throw new Error(`${path}.archive is unsupported.`);
  }
  if (archive === 'tar.gz') {
    safeRelativePath(archiveRoot, `${path}.archiveRoot`);
  } else if (archiveRoot !== '.') {
    throw new Error(`${path}.archiveRoot must be '.' for raw artifacts.`);
  }
  return {
    os,
    architecture,
    artifact: url,
    sha256: digest,
    archive,
    archiveRoot,
    executable,
  };
}

function credentialFreeHttpsUrl(value: unknown, path: string): string {
  const url = string(value, path);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`${path} must be an HTTPS URL.`);
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error(`${path} must be a credential-free HTTPS URL.`);
  }
  return url;
}

function exactKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const expected = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !expected.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `${path} contains unsupported fields: ${unknown.join(', ')}.`,
    );
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (!isNonEmptyString(value)) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.trim() === value
  );
}

function safeRelativePath(value: string, path: string): string {
  const normalized = value.split('\\').join('/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').includes('..') ||
    normalized.includes('\0')
  ) {
    throw new Error(`${path} must be a safe relative path.`);
  }
  return value;
}

function isStrictDescendant(pathFromParent: string): boolean {
  return (
    pathFromParent !== '' &&
    pathFromParent !== '..' &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

function assertNoSymlinkOrSpecialPath(
  approvedParent: string,
  candidate: string,
): void {
  if (!existsSync(approvedParent)) {
    throw new Error('Approved evidence parent does not exist.');
  }
  const parentStat = lstatSync(approvedParent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error('Approved evidence parent is not a real directory.');
  }
  const canonicalParent = realpathSync(approvedParent);
  if (canonicalParent !== approvedParent) {
    throw new Error('Approved evidence parent contains a symlink alias.');
  }
  const pathFromParent = relative(approvedParent, candidate);
  if (!isStrictDescendant(pathFromParent)) {
    throw new Error('Evidence path is not a strict task-owned descendant.');
  }
  let cursor = approvedParent;
  const components = pathFromParent.split(sep);
  for (const [index, component] of components.entries()) {
    cursor = join(cursor, component);
    if (!existsSync(cursor)) continue;
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error('Evidence path must not traverse a symbolic link.');
    }
    const final = index === components.length - 1;
    if ((!final && !stat.isDirectory()) || (final && !stat.isDirectory())) {
      throw new Error('Evidence path contains a non-directory component.');
    }
    const canonical = realpathSync(cursor);
    if (canonical !== cursor) {
      throw new Error('Evidence path resolves through an alias or link.');
    }
  }
}

function isVersionParser(value: string): value is VersionParser {
  return [
    'alertmanager',
    'amtool',
    'grafana',
    'istioctl',
    'kubeconform',
    'kubectl',
    'nginx',
    'prometheus',
    'promtool',
    'pcre2',
  ].includes(value);
}

function tarString(value: Uint8Array): string {
  const zero = value.indexOf(0);
  return Buffer.from(zero >= 0 ? value.subarray(0, zero) : value).toString(
    'utf8',
  );
}

function nested(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current))
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function exactStructure(actual: unknown, expected: unknown): void {
  if (JSON.stringify(stable(actual)) !== JSON.stringify(stable(expected))) {
    throw new Error(
      'Network or identity topology is broader than the exact contract.',
    );
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]),
  );
}

function parseTarHeader(header: Buffer): {
  name: string;
  size: number;
  typeFlag: string;
} {
  const expectedText = tarString(header.subarray(148, 156)).trim();
  if (!/^[0-7]+$/u.test(expectedText)) throw new Error('Corrupt tar checksum.');
  const checksumHeader = Buffer.from(header);
  checksumHeader.fill(0x20, 148, 156);
  const actual = checksumHeader.reduce((sum, byte) => sum + byte, 0);
  if (actual !== Number.parseInt(expectedText, 8))
    throw new Error('Tar header checksum mismatch.');
  const name = tarString(header.subarray(0, 100));
  const prefix = tarString(header.subarray(345, 500));
  const fullName = prefix ? `${prefix}/${name}` : name;
  const sizeText = tarString(header.subarray(124, 136)).trim();
  if (!/^[0-7]*$/u.test(sizeText)) throw new Error('Corrupt tar size header.');
  const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error('Corrupt tar size.');
  const typeFlag = String.fromCharCode(header[156] ?? 0);
  if (typeFlag === '1' || typeFlag === '2')
    throw new Error('Archive link entries are not permitted.');
  if (!['\0', '0', '5', 'L'].includes(typeFlag))
    throw new Error(`Unsupported tar entry type ${typeFlag.charCodeAt(0)}.`);
  return { name: fullName, size, typeFlag };
}
