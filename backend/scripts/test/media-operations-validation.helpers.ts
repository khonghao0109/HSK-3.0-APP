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
  | 'cosign'
  | 'grafana'
  | 'istioctl'
  | 'kubeconform'
  | 'kubectl'
  | 'nginx'
  | 'prometheus'
  | 'promtool'
  | 'pcre2'
  | 'syft';
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
  schemaVersion: 3;
  tools: Record<string, ToolDefinition>;
  schemaBundles: Record<string, SchemaBundle>;
  images: Record<string, OciImageDefinition>;
}

export interface OciImagePlatform {
  os: 'linux';
  architecture: 'x64';
  digest: string;
  runtimeRef: string;
}

export interface OciImageDefinition {
  repository: string;
  version: string;
  indexDigest: string;
  platforms: [OciImagePlatform];
  attestations: {
    signature: {
      required: true;
      verifier: 'cosign-keyless';
      issuer: string;
      approvedIdentities: string[];
    };
    sbom: { required: true; format: 'spdx-json' };
  };
}

export interface OciRegistryResolution {
  repository: string;
  indexDigest: string;
  platform: {
    os: string;
    architecture: string;
    digest: string;
  };
}

export type ExecutionProfile = 'reference' | 'release-linux-amd64';

export interface TreeDigestEvidence {
  digest: string;
  pathCount: number;
  paths: string[];
}

export interface DatabaseEvidenceExpectation {
  commit: string;
  treeSha: string;
  releaseContentDigest: string;
  evidenceRoot: string;
  catalogCount: number;
  catalogChecksum: string;
  latestMigrations: Array<{ name: string; checksum: string }>;
  nowMs?: number;
}

export interface DatabaseReleaseEvidenceSummary {
  runId: string;
  evidenceSha256: string;
  database: {
    hostFingerprintSha256: string;
    port: number;
    databaseName: string;
    guardedTestSuffix: true;
    serverVersion: string;
  };
  migrations: {
    catalogCount: number;
    catalogChecksumSha256: string;
    latestNames: string[];
    latestChecksums: string[];
  };
}

export interface CapacityBackupEvidenceExpectation {
  commit: string;
  treeSha: string;
  releaseContentDigest: string;
  nowMs?: number;
}

export interface CapacityBackupEvidenceSummary {
  runId: string;
  clusterFingerprintSha256: string;
  requiredGiB: number;
  capacityGiB: number;
  backupRetentionDays: number;
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
  logSha256: string;
  safeArgs: string[];
  cwd: string;
  startedAt: string;
  completedAt: string;
  platform: string;
  architecture: string;
  inputSha256?: string;
  envKeys: string[];
  executableIdentity: string;
  executableSha256: string;
  toolVersion: string;
  gitCommit: string;
  gitTreeSha: string;
  releaseContentDigest: string;
  inputTreeDigest: string;
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

// Exact concurrent, out-of-scope paths. Do not replace these with a broad glob.
const RELEASE_CONTENT_EXCLUSIONS = new Set([
  'docs/roadmap.md',
  'docs/reports/10-delivery-production-operations-report.md',
  'docs/roadmap_prod.jpg',
  'docs/roadmap_prod_v2.png',
]);

export const MEDIA_OPERATIONS_EVIDENCE_ENV_ALLOWLIST = new Set([
  'LANG',
  'LC_ALL',
  'MEDIA_OBSERVABILITY_RENDER_DIR',
  'MEDIA_OPS_ALLOW_DOWNLOAD',
  'MEDIA_OPS_CAPACITY_BACKUP_EVIDENCE_JSON',
  'MEDIA_OPS_DB_EVIDENCE_JSON',
  'MEDIA_OPS_EVIDENCE_DIR',
  'MEDIA_OPS_TOOL_CACHE',
  'MEDIA_RUNBOOK_URL',
  'NODE_ENV',
  'PATH',
  'SSL_CERT_FILE',
  'TZ',
]);

export function parseToolchainManifest(input: unknown): ToolchainManifest {
  const root = record(input, 'manifest');
  exactKeys(
    root,
    ['schemaVersion', 'tools', 'schemaBundles', 'images'],
    'manifest',
  );
  if (root.schemaVersion !== 3) {
    throw new Error('Manifest schemaVersion must be 3.');
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
  const rawImages = record(root.images, 'manifest.images');
  exactKeys(
    rawImages,
    ['alertmanager', 'grafana', 'prometheus'],
    'manifest.images',
  );
  const images: Record<string, OciImageDefinition> = {};
  for (const [imageName, value] of Object.entries(rawImages)) {
    if (!/^[a-z][a-z0-9-]*$/u.test(imageName)) {
      throw new Error(`Manifest OCI image name is invalid: ${imageName}.`);
    }
    images[imageName] = parseOciImageDefinition(value, imageName);
  }
  return { schemaVersion: 3, tools, schemaBundles, images };
}

export function assertExecutionProfile(
  profile: ExecutionProfile,
  platform: NodeJS.Platform,
  architecture: string,
): void {
  if (profile === 'release-linux-amd64') {
    if (platform !== 'linux' || architecture !== 'x64') {
      throw new Error(
        'The release-linux-amd64 profile requires an actual Linux amd64 host.',
      );
    }
    return;
  }
  if (profile !== 'reference') {
    throw new Error('Unsupported media operations execution profile.');
  }
}

export function assertStartupProbePreserved(
  baseContainer: Record<string, unknown>,
  patchedContainer: Record<string, unknown>,
): void {
  const before = baseContainer.startupProbe;
  const after = patchedContainer.startupProbe;
  if (before === undefined && after !== undefined) {
    throw new Error('Backend patch must not create or replace startupProbe.');
  }
  if (JSON.stringify(stable(before)) !== JSON.stringify(stable(after))) {
    throw new Error('Backend startupProbe contract was not preserved exactly.');
  }
  if (after !== undefined) {
    const probe = record(after, 'startupProbe');
    const handlers = ['exec', 'httpGet', 'tcpSocket', 'grpc'].filter(
      (key) => probe[key] !== undefined,
    );
    if (handlers.length !== 1) {
      throw new Error(
        'Backend startupProbe contract must contain exactly one handler.',
      );
    }
  }
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

export function contentAddressedCacheFilename(
  artifactUrl: string,
  expectedSha256: string,
): string {
  if (!SHA256.test(expectedSha256)) {
    throw new Error('Cache artifact digest must be a pinned SHA-256.');
  }
  const filename = basename(new URL(artifactUrl).pathname);
  if (!filename || filename === '.' || filename === '..') {
    throw new Error('Cache artifact URL has no safe filename.');
  }
  return `${expectedSha256}-${filename}`;
}

export function assertOciDigest(actual: string, expected: string): void {
  if (!OCI_DIGEST.test(actual) || !OCI_DIGEST.test(expected)) {
    throw new Error('OCI digest is malformed.');
  }
  if (actual !== expected) {
    throw new Error('OCI digest mismatch.');
  }
}

export function assertOciRegistryResolution(
  image: OciImageDefinition,
  resolved: OciRegistryResolution,
): void {
  const platform = image.platforms[0];
  if (
    resolved.repository !== image.repository ||
    resolved.indexDigest !== image.indexDigest ||
    resolved.platform.os !== 'linux' ||
    resolved.platform.architecture !== 'x64' ||
    resolved.platform.digest !== platform.digest ||
    platform.runtimeRef !== `${image.repository}@${resolved.platform.digest}`
  ) {
    throw new Error('OCI registry index/platform digest resolution mismatch.');
  }
}

export function resolveVerifiedOciIndex(
  image: OciImageDefinition,
  rawIndex: Uint8Array,
  responseDigest: string | null,
): OciRegistryResolution {
  if (rawIndex.byteLength === 0 || rawIndex.byteLength > 4 * 1024 * 1024) {
    throw new Error('OCI registry index is empty or exceeds the 4 MiB limit.');
  }
  const computed = `sha256:${sha256(rawIndex)}`;
  if (
    computed !== image.indexDigest ||
    (responseDigest !== null && responseDigest !== image.indexDigest)
  ) {
    throw new Error('OCI registry index digest does not match exact bytes.');
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(rawIndex).toString('utf8')) as unknown;
  } catch {
    throw new Error('OCI registry response is not valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('OCI registry response is not an image index.');
  }
  const manifests = (body as Record<string, unknown>).manifests;
  const mediaType = (body as Record<string, unknown>).mediaType;
  if (
    (body as Record<string, unknown>).schemaVersion !== 2 ||
    ![
      'application/vnd.oci.image.index.v1+json',
      'application/vnd.docker.distribution.manifest.list.v2+json',
    ].includes(String(mediaType)) ||
    !Array.isArray(manifests)
  ) {
    throw new Error('OCI registry response is not an image index.');
  }
  const matching = manifests.filter(
    (candidate) =>
      candidate !== null &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).platform !== null &&
      typeof (candidate as Record<string, unknown>).platform === 'object' &&
      !Array.isArray((candidate as Record<string, unknown>).platform) &&
      (
        (candidate as Record<string, unknown>).platform as Record<
          string,
          unknown
        >
      ).os === 'linux' &&
      (
        (candidate as Record<string, unknown>).platform as Record<
          string,
          unknown
        >
      ).architecture === 'amd64',
  );
  if (matching.length !== 1) {
    throw new Error('OCI registry index must have one Linux amd64 child.');
  }
  const childDigest = (matching[0] as Record<string, unknown>).digest;
  if (typeof childDigest !== 'string' || !OCI_DIGEST.test(childDigest)) {
    throw new Error('OCI registry Linux amd64 child digest is invalid.');
  }
  return {
    repository: image.repository,
    indexDigest: computed,
    platform: { os: 'linux', architecture: 'x64', digest: childDigest },
  };
}

export function assertCosignSignaturePayload(
  output: string,
  expectedDigest: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    throw new Error('Cosign signature output is not valid JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Cosign signature output has no verified signatures.');
  }
  const bound = parsed.some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    return (
      nested(value, ['critical', 'image', 'docker-manifest-digest']) ===
      expectedDigest
    );
  });
  if (!OCI_DIGEST.test(expectedDigest) || !bound) {
    throw new Error('Cosign signature does not bind the exact image digest.');
  }
}

export async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error('Response body limit must be a positive safe integer.');
  }
  const declaredHeader = response.headers.get('content-length');
  if (declaredHeader !== null) {
    if (!/^\d+$/u.test(declaredHeader)) {
      throw new Error('Response Content-Length is malformed.');
    }
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared > maximumBytes) {
      throw new Error('Response body exceeds its bounded limit.');
    }
  }
  if (!response.body) throw new Error('Response body is absent.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('Response body exceeds its bounded limit.');
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks, total);
}

export function extractSpdxAttestationPredicate(
  verificationOutput: string,
  expectedDigest: string,
): Record<string, unknown> {
  if (!OCI_DIGEST.test(expectedDigest)) {
    throw new Error('Expected OCI digest is invalid.');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(verificationOutput);
  } catch {
    throw new Error('Cosign attestation output is not JSON.');
  }
  const entries = Array.isArray(decoded) ? decoded : [decoded];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const payload = (entry as Record<string, unknown>).payload;
    if (typeof payload !== 'string') continue;
    let statement: unknown;
    try {
      statement = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    } catch {
      continue;
    }
    if (!statement || typeof statement !== 'object' || Array.isArray(statement))
      continue;
    const envelope = statement as Record<string, unknown>;
    if (
      envelope.predicateType !== 'https://spdx.dev/Document' ||
      !Array.isArray(envelope.subject)
    ) {
      continue;
    }
    const expectedHex = expectedDigest.slice('sha256:'.length);
    const bound = envelope.subject.some((subject) => {
      if (!subject || typeof subject !== 'object' || Array.isArray(subject))
        return false;
      const digest = (subject as Record<string, unknown>).digest;
      return (
        digest !== null &&
        typeof digest === 'object' &&
        !Array.isArray(digest) &&
        (digest as Record<string, unknown>).sha256 === expectedHex
      );
    });
    const predicate = envelope.predicate;
    if (
      bound &&
      predicate !== null &&
      typeof predicate === 'object' &&
      !Array.isArray(predicate) &&
      /^SPDX-2\./u.test(
        String((predicate as Record<string, unknown>).spdxVersion),
      )
    ) {
      return predicate as Record<string, unknown>;
    }
  }
  throw new Error('Signed SPDX predicate is absent or bound to another image.');
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
    nested(named('NetworkPolicy', 'hsk-media-prometheus-private'), ['spec']),
    {
      podSelector: {
        matchLabels: { 'app.kubernetes.io/name': 'prometheus' },
      },
      policyTypes: ['Ingress', 'Egress'],
      ingress: [
        {
          from: [
            {
              podSelector: {
                matchLabels: { 'app.kubernetes.io/name': 'hsk-media-grafana' },
              },
            },
            {
              podSelector: {
                matchLabels: { 'app.kubernetes.io/name': 'hsk-media-operator' },
              },
            },
          ],
          ports: [{ protocol: 'TCP', port: 9090 }],
        },
      ],
      egress: [
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { 'kubernetes.io/metadata.name': 'hsk' },
              },
              podSelector: {
                matchLabels: { 'app.kubernetes.io/name': 'hsk-backend' },
              },
            },
          ],
          ports: [{ protocol: 'TCP', port: 9464 }],
        },
        {
          to: [
            {
              podSelector: {
                matchLabels: {
                  'app.kubernetes.io/name': 'hsk-media-alertmanager',
                },
              },
            },
          ],
          ports: [{ protocol: 'TCP', port: 9093 }],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': 'kube-system',
                },
              },
              podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
            },
          ],
          ports: [
            { protocol: 'UDP', port: 53 },
            { protocol: 'TCP', port: 53 },
          ],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': 'istio-system',
                },
              },
              podSelector: { matchLabels: { app: 'istiod' } },
            },
          ],
          ports: [{ protocol: 'TCP', port: 15012 }],
        },
      ],
    },
  );
  exactStructure(
    nested(named('NetworkPolicy', 'hsk-media-grafana-private'), ['spec']),
    {
      podSelector: {
        matchLabels: { 'app.kubernetes.io/name': 'hsk-media-grafana' },
      },
      policyTypes: ['Ingress', 'Egress'],
      ingress: [
        {
          from: [
            {
              podSelector: {
                matchLabels: {
                  'app.kubernetes.io/name': 'hsk-media-operator',
                },
              },
            },
          ],
          ports: [{ protocol: 'TCP', port: 3000 }],
        },
      ],
      egress: [
        {
          to: [
            {
              podSelector: {
                matchLabels: { 'app.kubernetes.io/name': 'prometheus' },
              },
            },
          ],
          ports: [{ protocol: 'TCP', port: 9090 }],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': 'kube-system',
                },
              },
              podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
            },
          ],
          ports: [
            { protocol: 'UDP', port: 53 },
            { protocol: 'TCP', port: 53 },
          ],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': 'istio-system',
                },
              },
              podSelector: { matchLabels: { app: 'istiod' } },
            },
          ],
          ports: [{ protocol: 'TCP', port: 15012 }],
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
    nested(named('AuthorizationPolicy', 'hsk-media-prometheus-principal'), [
      'spec',
    ]),
    {
      selector: {
        matchLabels: { 'app.kubernetes.io/name': 'prometheus' },
      },
      action: 'ALLOW',
      rules: [
        {
          from: [
            {
              source: {
                principals: [
                  'cluster.local/ns/monitoring/sa/hsk-media-grafana',
                  'cluster.local/ns/monitoring/sa/hsk-media-operator',
                ],
              },
            },
          ],
          to: [
            {
              operation: {
                ports: ['9090'],
                methods: ['GET', 'POST'],
                paths: [
                  '/-/healthy',
                  '/-/ready',
                  '/api/v1/query',
                  '/api/v1/query_range',
                ],
              },
            },
          ],
        },
      ],
    },
  );
  exactStructure(
    nested(named('AuthorizationPolicy', 'hsk-media-grafana-principal'), [
      'spec',
    ]),
    {
      selector: {
        matchLabels: { 'app.kubernetes.io/name': 'hsk-media-grafana' },
      },
      action: 'ALLOW',
      rules: [
        {
          from: [
            {
              source: {
                principals: [
                  'cluster.local/ns/monitoring/sa/hsk-media-operator',
                ],
              },
            },
          ],
          to: [
            {
              operation: {
                ports: ['3000'],
                methods: ['GET', 'POST', 'DELETE'],
                paths: ['/api/health', '/api/dashboards/*', '/api/ds/*'],
              },
            },
          ],
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
  exactStructure(
    nested(named('PeerAuthentication', 'hsk-media-prometheus-strict-mtls'), [
      'spec',
    ]),
    {
      selector: {
        matchLabels: { 'app.kubernetes.io/name': 'prometheus' },
      },
      mtls: { mode: 'STRICT' },
    },
  );
  exactStructure(
    nested(named('PeerAuthentication', 'hsk-media-grafana-strict-mtls'), [
      'spec',
    ]),
    {
      selector: {
        matchLabels: { 'app.kubernetes.io/name': 'hsk-media-grafana' },
      },
      mtls: { mode: 'STRICT' },
    },
  );
}

export function assertMonitoringSingleReplicaRollout(
  resources: Array<Record<string, unknown>>,
): void {
  for (const name of [
    'hsk-media-prometheus',
    'hsk-media-alertmanager',
    'hsk-media-grafana',
  ]) {
    const deployment = resources.find(
      (candidate) =>
        candidate.kind === 'Deployment' &&
        nested(candidate, ['metadata', 'name']) === name,
    );
    if (
      !deployment ||
      nested(deployment, ['spec', 'replicas']) !== 1 ||
      nested(deployment, ['spec', 'strategy', 'type']) !== 'Recreate'
    ) {
      throw new Error(
        `${name} must use one replica and Recreate for its RWO volume.`,
      );
    }
  }
}

export function assertIstioProbeRewriteContract(
  resources: Array<Record<string, unknown>>,
  backendPatch: Record<string, unknown>,
): void {
  for (const name of [
    'hsk-media-prometheus',
    'hsk-media-alertmanager',
    'hsk-media-grafana',
  ]) {
    const deployment = resources.find(
      (candidate) =>
        candidate.kind === 'Deployment' &&
        nested(candidate, ['metadata', 'name']) === name,
    );
    if (
      !deployment ||
      nested(deployment, [
        'spec',
        'template',
        'metadata',
        'annotations',
        'sidecar.istio.io/inject',
      ]) !== 'true' ||
      nested(deployment, [
        'spec',
        'template',
        'metadata',
        'annotations',
        'sidecar.istio.io/rewriteAppHTTPProbers',
      ]) !== 'true'
    ) {
      throw new Error(
        `${name} must inject Istio and rewrite kubelet HTTP probes.`,
      );
    }
  }
  if (
    nested(backendPatch, [
      'spec',
      'template',
      'metadata',
      'annotations',
      'sidecar.istio.io/inject',
    ]) !== 'true' ||
    nested(backendPatch, [
      'spec',
      'template',
      'metadata',
      'annotations',
      'sidecar.istio.io/rewriteAppHTTPProbers',
    ]) !== 'true'
  ) {
    throw new Error(
      'Backend patch must inject Istio and rewrite kubelet HTTP probes.',
    );
  }
}

export function assertGrafanaPrivateApiOnlyContract(
  resources: Array<Record<string, unknown>>,
): void {
  const named = (kind: string, name: string): Record<string, unknown> => {
    const value = resources.find(
      (candidate) =>
        candidate.kind === kind &&
        nested(candidate, ['metadata', 'name']) === name,
    );
    if (!value) throw new Error(`Missing Grafana contract ${kind}/${name}.`);
    return value;
  };
  const network = nested(named('NetworkPolicy', 'hsk-media-grafana-private'), [
    'spec',
  ]);
  const authorization = nested(
    named('AuthorizationPolicy', 'hsk-media-grafana-principal'),
    ['spec'],
  );
  const serialized = JSON.stringify({ network, authorization });
  for (const required of [
    'hsk-media-operator',
    '/api/health',
    '/api/dashboards/*',
    '/api/ds/*',
  ]) {
    if (!serialized.includes(required)) {
      throw new Error(`Grafana private API contract is missing ${required}.`);
    }
  }
  for (const forbidden of [
    'hsk-operations-access-proxy',
    '"/"',
    '/login',
    '/public/*',
    '/d/*',
    '/api/live/*',
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(
        'Grafana contract must remain private API-only without UI claims.',
      );
    }
  }
}

export function assertGrafanaProvisioningMountContract(
  resources: Array<Record<string, unknown>>,
): void {
  const deployment = resources.find(
    (candidate) =>
      candidate.kind === 'Deployment' &&
      nested(candidate, ['metadata', 'name']) === 'hsk-media-grafana',
  );
  if (!deployment) throw new Error('Grafana Deployment is absent.');
  const containers = nested(deployment, [
    'spec',
    'template',
    'spec',
    'containers',
  ]);
  const container = Array.isArray(containers)
    ? (containers as unknown[]).find(
        (candidate) =>
          candidate !== null &&
          typeof candidate === 'object' &&
          !Array.isArray(candidate) &&
          (candidate as Record<string, unknown>).name === 'grafana',
      )
    : undefined;
  if (!container || typeof container !== 'object' || Array.isArray(container)) {
    throw new Error('Grafana container is absent.');
  }
  const mounts = nested(container, ['volumeMounts']);
  const volumes = nested(deployment, ['spec', 'template', 'spec', 'volumes']);
  const requiredMounts = [
    {
      name: 'provisioning',
      mountPath: '/etc/grafana/provisioning/datasources',
      readOnly: true,
    },
    {
      name: 'dashboard',
      mountPath: '/var/lib/grafana/dashboards/media-dashboard.json',
      subPath: 'media-dashboard.json',
      readOnly: true,
    },
    {
      name: 'dashboard',
      mountPath: '/etc/grafana/provisioning/dashboards/provider.yml',
      subPath: 'provider.yml',
      readOnly: true,
    },
  ];
  if (
    !Array.isArray(mounts) ||
    !requiredMounts.every((required) =>
      mounts.some(
        (mount) =>
          mount !== null &&
          typeof mount === 'object' &&
          !Array.isArray(mount) &&
          JSON.stringify(stable(mount)) === JSON.stringify(stable(required)),
      ),
    ) ||
    !Array.isArray(volumes) ||
    !volumes.some(
      (volume) =>
        nested(volume, ['name']) === 'provisioning' &&
        typeof nested(volume, ['configMap', 'name']) === 'string' &&
        /^hsk-media-grafana-datasource(?:-[a-z0-9]{10})?$/u.test(
          String(nested(volume, ['configMap', 'name'])),
        ),
    ) ||
    !volumes.some(
      (volume) =>
        nested(volume, ['name']) === 'dashboard' &&
        typeof nested(volume, ['configMap', 'name']) === 'string' &&
        /^hsk-media-grafana-dashboard(?:-[a-z0-9]{10})?$/u.test(
          String(nested(volume, ['configMap', 'name'])),
        ),
    )
  ) {
    throw new Error('Grafana provisioning mounts are not exact.');
  }
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
    cosign: /^GitVersion:\s+v(\d+\.\d+\.\d+)$/m,
    grafana: /^Version (\d+\.\d+\.\d+)(?:\s.*)?$/m,
    istioctl: /^client version: (\d+\.\d+\.\d+)$/m,
    kubeconform: /^v(\d+\.\d+\.\d+)$/m,
    kubectl: /^Client Version: v(\d+\.\d+\.\d+)$/m,
    nginx: /^nginx version: nginx\/(\d+\.\d+\.\d+)$/m,
    prometheus: /^prometheus, version (\d+\.\d+\.\d+)(?:\s.*)?$/m,
    promtool: /^promtool, version (\d+\.\d+\.\d+)(?:\s.*)?$/m,
    pcre2: /^(\d+\.\d+)$/m,
    syft: /^Version:\s+(\d+\.\d+\.\d+)$/m,
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
  for (const [commandIndex, command] of commands.entries()) {
    const fieldChecks: Array<readonly [string, boolean]> = [
      ['id', Boolean(command.id)],
      ['validator', Boolean(command.validator)],
      ['executable', /^[a-z0-9][a-z0-9.-]*$/iu.test(command.executable)],
      [
        'exitCode',
        Number.isSafeInteger(command.exitCode) && command.exitCode >= 0,
      ],
      [
        'durationMs',
        Number.isSafeInteger(command.durationMs) && command.durationMs >= 0,
      ],
      [
        'logPath',
        /^logs\/[a-z0-9][a-z0-9.-]*\.log$/iu.test(command.logPath) &&
          !command.logPath.includes('..'),
      ],
      ['logSha256', SHA256.test(command.logSha256)],
      [
        'safeArgs',
        Array.isArray(command.safeArgs) &&
          command.safeArgs.every((value) => typeof value === 'string'),
      ],
      [
        'envKeys',
        Array.isArray(command.envKeys) &&
          command.envKeys.every(
            (value) =>
              /^[A-Z][A-Z0-9_]*$/u.test(value) &&
              MEDIA_OPERATIONS_EVIDENCE_ENV_ALLOWLIST.has(value),
          ),
      ],
      ['cwd', Boolean(command.cwd)],
      ['startedAt', Boolean(command.startedAt)],
      ['completedAt', Boolean(command.completedAt)],
      ['platform', Boolean(command.platform)],
      ['architecture', Boolean(command.architecture)],
      ['executableIdentity', Boolean(command.executableIdentity)],
      ['executableSha256', SHA256.test(command.executableSha256)],
      [
        'toolVersion',
        /^(?:\d+\.\d+(?:\.\d+)?|sha256:[a-f0-9]{64}|internal-v1|unavailable-v1)$/u.test(
          command.toolVersion,
        ),
      ],
      ['gitCommit', /^[a-f0-9]{40}$/u.test(command.gitCommit)],
      ['gitTreeSha', /^[a-f0-9]{40}$/u.test(command.gitTreeSha)],
      ['releaseContentDigest', SHA256.test(command.releaseContentDigest)],
      ['inputTreeDigest', SHA256.test(command.inputTreeDigest)],
      [
        'inputSha256',
        command.inputSha256 === undefined || SHA256.test(command.inputSha256),
      ],
    ];
    const invalidField = fieldChecks.find(([, valid]) => !valid)?.[0];
    if (invalidField) {
      throw new Error(
        `Machine command evidence at index ${String(commandIndex)} has an invalid field: ${invalidField}.`,
      );
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
      command.cwd,
      command.executableIdentity,
      ...command.safeArgs,
      ...command.envKeys,
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
    .filter(({ path }) => !RELEASE_CONTENT_EXCLUSIONS.has(path))
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

export function computeTreeDigest(root: string): TreeDigestEvidence {
  const canonicalRoot = realpathSync(root);
  if (!lstatSync(canonicalRoot).isDirectory()) {
    throw new Error('Rendered release tree root must be a directory.');
  }
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory).sort((left, right) =>
      left.localeCompare(right),
    )) {
      const absolute = join(directory, entry);
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) {
        throw new Error(
          'Rendered release tree must not contain a symbolic link.',
        );
      }
      if (info.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!info.isFile()) {
        throw new Error('Rendered release tree contains a special file.');
      }
      const pathFromRoot = relative(canonicalRoot, absolute);
      if (!isStrictDescendant(pathFromRoot)) {
        throw new Error('Rendered release tree path escaped its root.');
      }
      paths.push(pathFromRoot.split(sep).join('/'));
    }
  };
  visit(canonicalRoot);
  paths.sort((left, right) => left.localeCompare(right));
  const digest = createHash('sha256');
  for (const path of paths) {
    const bytes = readFileSync(join(canonicalRoot, path));
    digest.update(path);
    digest.update('\0');
    digest.update(String(bytes.length));
    digest.update('\0');
    digest.update(bytes);
    digest.update('\0');
  }
  return { digest: digest.digest('hex'), pathCount: paths.length, paths };
}

export function computeMigrationCatalogEvidence(migrationsRoot: string): {
  catalogCount: number;
  catalogChecksum: string;
  entries: Array<{ name: string; checksum: string }>;
} {
  const canonicalRoot = realpathSync(migrationsRoot);
  const rootStat = lstatSync(canonicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Migration catalog root must be a real directory.');
  }
  const entries = readdirSync(canonicalRoot)
    .filter((name) => name !== 'migration_lock.toml')
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      if (!/^[0-9]{14}_[a-z0-9_]+$/u.test(name)) {
        throw new Error(
          `Migration catalog contains an invalid entry: ${name}.`,
        );
      }
      const directory = join(canonicalRoot, name);
      const sql = join(directory, 'migration.sql');
      const directoryStat = lstatSync(directory);
      const sqlStat = lstatSync(sql);
      if (
        directoryStat.isSymbolicLink() ||
        !directoryStat.isDirectory() ||
        sqlStat.isSymbolicLink() ||
        !sqlStat.isFile()
      ) {
        throw new Error('Migration catalog contains a link or special file.');
      }
      return { name, checksum: sha256(readFileSync(sql)) };
    });
  const bytes = Buffer.from(
    entries.map(({ name, checksum }) => `${name}\0${checksum}\n`).join(''),
  );
  return {
    catalogCount: entries.length,
    catalogChecksum: sha256(bytes),
    entries,
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

export function assertDatabaseReleaseEvidence(
  input: unknown,
  expected: DatabaseEvidenceExpectation,
): DatabaseReleaseEvidenceSummary {
  const root = record(input, 'database release evidence');
  exactKeys(
    root,
    [
      'schemaVersion',
      'runId',
      'startedAt',
      'completedAt',
      'git',
      'releaseContentDigest',
      'database',
      'migrations',
      'checks',
      'commands',
      'artifacts',
      'auxiliary',
      'outcome',
      'durationMs',
    ],
    'database release evidence',
  );
  const serialized = JSON.stringify(root);
  if (
    /postgres(?:ql)?:\/\//iu.test(serialized) ||
    /\/\/[^/@\s:]+:[^/@\s]+@/u.test(serialized) ||
    /"(?:databaseUrl|testDatabaseUrl|password|passwd|pwd|username|user|secret|token)"\s*:/iu.test(
      serialized,
    )
  ) {
    throw new Error('Database evidence contains a URL, user or secret field.');
  }
  const git = record(root.git, 'database release evidence.git');
  const database = record(root.database, 'database release evidence.database');
  const migrations = record(
    root.migrations,
    'database release evidence.migrations',
  );
  const artifacts = record(
    root.artifacts,
    'database release evidence.artifacts',
  );
  const auxiliary = record(
    root.auxiliary,
    'database release evidence.auxiliary',
  );
  exactKeys(git, ['commit', 'treeSha'], 'database release evidence.git');
  exactKeys(
    database,
    [
      'hostFingerprintSha256',
      'port',
      'databaseName',
      'guardedTestSuffix',
      'serverVersion',
    ],
    'database release evidence.database',
  );
  exactKeys(
    auxiliary,
    [
      'futureTimestampAbortCommandId',
      'boundedMigrationAbortCommandId',
      'auditLifecycleRaceCommandId',
      'concurrency',
      'benchmark',
      'databaseCount',
      'shadowDatabaseName',
    ],
    'database release evidence.auxiliary',
  );
  const auxiliaryConcurrency = record(
    auxiliary.concurrency,
    'database release evidence.auxiliary.concurrency',
  );
  exactKeys(
    auxiliaryConcurrency,
    ['blockedOnLock', 'finalAuditCount'],
    'database release evidence.auxiliary.concurrency',
  );
  const auxiliaryBenchmark = record(
    auxiliary.benchmark,
    'database release evidence.auxiliary.benchmark',
  );
  exactKeys(
    auxiliaryBenchmark,
    ['fixtureRows', 'planningTimeMs', 'executionTimeMs'],
    'database release evidence.auxiliary.benchmark',
  );
  exactKeys(
    migrations,
    ['catalogCount', 'catalogChecksumSha256', 'latestNames', 'latestChecksums'],
    'database release evidence.migrations',
  );
  exactKeys(
    artifacts,
    ['junit', 'logManifest'],
    'database release evidence.artifacts',
  );
  const startedAt = Date.parse(string(root.startedAt, 'startedAt'));
  const completedAt = Date.parse(string(root.completedAt, 'completedAt'));
  const now = expected.nowMs ?? Date.now();
  if (
    root.schemaVersion !== 1 ||
    root.outcome !== 'pass' ||
    !/^[0-9a-f-]{16,64}$/u.test(string(root.runId, 'runId')) ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(completedAt) ||
    completedAt < startedAt ||
    completedAt > now + 60_000 ||
    now - completedAt > 24 * 60 * 60_000 ||
    git.commit !== expected.commit ||
    git.treeSha !== expected.treeSha ||
    root.releaseContentDigest !== expected.releaseContentDigest
  ) {
    throw new Error('Database evidence is stale or not bound to this release.');
  }
  if (
    !Number.isSafeInteger(root.durationMs) ||
    Number(root.durationMs) <= 0 ||
    auxiliaryConcurrency.blockedOnLock !== true ||
    auxiliaryConcurrency.finalAuditCount !== 1 ||
    !Number.isSafeInteger(auxiliaryBenchmark.fixtureRows) ||
    Number(auxiliaryBenchmark.fixtureRows) < 1_000 ||
    !Number.isFinite(auxiliaryBenchmark.planningTimeMs) ||
    Number(auxiliaryBenchmark.planningTimeMs) < 0 ||
    !Number.isFinite(auxiliaryBenchmark.executionTimeMs) ||
    Number(auxiliaryBenchmark.executionTimeMs) < 0 ||
    !Number.isSafeInteger(auxiliary.databaseCount) ||
    Number(auxiliary.databaseCount) < 8 ||
    auxiliary.shadowDatabaseName !== 'hsk_media_shadow_test'
  ) {
    throw new Error('Database evidence auxiliary results are invalid.');
  }
  if (
    !SHA256.test(String(database.hostFingerprintSha256)) ||
    !Number.isSafeInteger(database.port) ||
    database.guardedTestSuffix !== true ||
    !/^[a-z0-9_]+(?:_test|_ci)$/u.test(String(database.databaseName)) ||
    !/^16\.\d+(?:\.\d+)?$/u.test(String(database.serverVersion))
  ) {
    throw new Error('Database evidence failed the disposable PG16 guard.');
  }
  if (
    migrations.catalogCount !== expected.catalogCount ||
    migrations.catalogChecksumSha256 !== expected.catalogChecksum ||
    !Array.isArray(migrations.latestNames) ||
    !Array.isArray(migrations.latestChecksums) ||
    JSON.stringify(migrations.latestNames) !==
      JSON.stringify(expected.latestMigrations.map(({ name }) => name)) ||
    JSON.stringify(migrations.latestChecksums) !==
      JSON.stringify(expected.latestMigrations.map(({ checksum }) => checksum))
  ) {
    throw new Error('Database evidence migration catalog is not exact.');
  }
  if (!Array.isArray(root.commands) || root.commands.length === 0) {
    throw new Error('Database evidence has no command records.');
  }
  const commands = new Map<string, Record<string, unknown>>();
  const orderedManifestCommands: Array<{
    id: string;
    logPath: string;
    logSha256: string;
  }> = [];
  for (const [index, value] of root.commands.entries()) {
    const command = record(value, `database evidence commands[${index}]`);
    exactKeys(
      command,
      [
        'id',
        'commandRef',
        'platform',
        'logPath',
        'logSha256',
        'exitCode',
        'durationMs',
        'outcome',
        'role',
        'executable',
        'executableIdentity',
        'executableSha256',
        'toolVersion',
        'safeArgs',
        'cwd',
        'envKeys',
        'startedAt',
        'completedAt',
        'gitCommit',
        'gitTreeSha',
        'releaseContentDigest',
        'inputTreeDigest',
        'expectedAbort',
      ],
      `database evidence commands[${index}]`,
    );
    const id = string(command.id, `database evidence commands[${index}].id`);
    const commandRef = string(
      command.commandRef,
      `database evidence commands[${index}].commandRef`,
    );
    const platform = string(
      command.platform,
      `database evidence commands[${index}].platform`,
    );
    const logPath = safeRelativePath(
      string(command.logPath, `database evidence commands[${index}].logPath`),
      `database evidence commands[${index}].logPath`,
    );
    const logSha256 = string(
      command.logSha256,
      `database evidence commands[${index}].logSha256`,
    );
    const role = string(
      command.role,
      `database evidence commands[${index}].role`,
    );
    const commandStartedAt = Date.parse(
      string(
        command.startedAt,
        `database evidence commands[${index}].startedAt`,
      ),
    );
    const commandCompletedAt = Date.parse(
      string(
        command.completedAt,
        `database evidence commands[${index}].completedAt`,
      ),
    );
    const expectedAbort =
      command.expectedAbort === undefined
        ? undefined
        : record(
            command.expectedAbort,
            `database evidence commands[${index}].expectedAbort`,
          );
    if (
      commands.has(id) ||
      command.outcome !== 'PASS' ||
      (expectedAbort === undefined
        ? command.exitCode !== 0
        : command.exitCode !== expectedAbort.exitCode) ||
      !Number.isSafeInteger(command.durationMs) ||
      Number(command.durationMs) < 0 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/ -]{2,160}$/u.test(commandRef) ||
      commandRef.includes('://') ||
      !['darwin/arm64', 'linux/x64'].includes(platform) ||
      !['check', 'auxiliary'].includes(role) ||
      !/^logs\/[A-Za-z0-9][A-Za-z0-9._-]*\.log$/u.test(logPath) ||
      !SHA256.test(logSha256) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(
        string(
          command.executable,
          `database evidence commands[${index}].executable`,
        ),
      ) ||
      !isNonEmptyString(command.executableIdentity) ||
      !SHA256.test(String(command.executableSha256)) ||
      !/^(?:sha256:[a-f0-9]{64}|internal-v1)$/u.test(
        String(command.toolVersion),
      ) ||
      !Array.isArray(command.safeArgs) ||
      !command.safeArgs.every(
        (argument) =>
          typeof argument === 'string' &&
          argument.length <= 512 &&
          redactSensitiveDiagnostic(argument) === argument,
      ) ||
      !isNonEmptyString(command.cwd) ||
      !Array.isArray(command.envKeys) ||
      !command.envKeys.every(
        (key) =>
          typeof key === 'string' &&
          [
            'DATABASE_URL',
            'MEDIA_INGESTION_ENABLED',
            'MEDIA_METRICS_PORT',
            'NODE_ENV',
            'PGOPTIONS',
            'TEST_DATABASE_URL',
          ].includes(key),
      ) ||
      !Number.isFinite(commandStartedAt) ||
      !Number.isFinite(commandCompletedAt) ||
      commandCompletedAt < commandStartedAt ||
      command.gitCommit !== git.commit ||
      command.gitTreeSha !== git.treeSha ||
      command.releaseContentDigest !== root.releaseContentDigest ||
      command.inputTreeDigest !== root.releaseContentDigest
    ) {
      throw new Error('Database evidence command record is invalid.');
    }
    if (expectedAbort !== undefined) {
      exactKeys(
        expectedAbort,
        ['exitCode', 'sqlstate'],
        `database evidence commands[${index}].expectedAbort`,
      );
      if (expectedAbort.exitCode !== 3 || expectedAbort.sqlstate !== 'P0001') {
        throw new Error('Database evidence expected abort is invalid.');
      }
    }
    const logBytes = readBoundEvidenceFile(
      expected.evidenceRoot,
      logPath,
      2 * 1024 * 1024,
    );
    const logText = logBytes.toString('utf8');
    if (
      sha256(logBytes) !== logSha256 ||
      redactSensitiveDiagnostic(logText) !== logText
    ) {
      throw new Error(
        'Database evidence command log is forged or unsanitized.',
      );
    }
    commands.set(id, command);
    orderedManifestCommands.push({ id, logPath, logSha256 });
  }
  const checks = record(root.checks, 'database release evidence.checks');
  const requiredChecks = [
    'freshMigrationDeploy',
    'upgradeMigrationDeploy',
    'adversarialFixture',
    'integration',
    'concurrency',
    'migrateStatus',
    'checksumAudit',
    'drift',
    'fullE2E',
    'futureTimestampFixture',
    'auditLifecycleRace',
    'boundedMigrationAbort',
  ];
  exactKeys(checks, requiredChecks, 'database release evidence.checks');
  const referencedCommands = new Set<string>();
  for (const name of requiredChecks) {
    const check = record(checks[name], `database evidence check ${name}`);
    exactKeys(
      check,
      ['outcome', 'commandId'],
      `database evidence check ${name}`,
    );
    const commandId = string(check.commandId, `${name}.commandId`);
    if (
      check.outcome !== 'PASS' ||
      !commands.has(commandId) ||
      commands.get(commandId)?.role !== 'check'
    ) {
      throw new Error(`Database evidence check is not executable: ${name}.`);
    }
    referencedCommands.add(commandId);
  }
  const auxiliaryBindings = [
    ['futureTimestampFixture', 'futureTimestampAbortCommandId'],
    ['auditLifecycleRace', 'auditLifecycleRaceCommandId'],
    ['boundedMigrationAbort', 'boundedMigrationAbortCommandId'],
  ] as const;
  for (const [checkName, field] of auxiliaryBindings) {
    const check = record(
      checks[checkName],
      `database evidence check ${checkName}`,
    );
    if (auxiliary[field] !== check.commandId) {
      throw new Error(`Database auxiliary binding is invalid: ${field}.`);
    }
  }
  for (const [id, command] of commands) {
    if (command.role === 'check' && !referencedCommands.has(id)) {
      throw new Error('Database check command is not referenced by a check.');
    }
    if (
      command.role === 'auxiliary' &&
      !/^(?:git-|create-|drop-|fresh-migration-only-preflight$|upgrade-(?:first17-|cleanup-required-fixture$|object-cleaned-fixture$|migration-deploy$|positive-backfill-)|adversarial-(?:first18-|fixture-setup$)|future-(?:first18-|fixture-setup$)|atomic-rollback-|integration-migration-|concurrency-(?:migration-|final-count$)|audit-race-(?:fixture-setup$|final-state$|reverse-final-state$)|lock-abort-|migration-catalog$|drift-(?:history-|live-)|benchmark$|server-version$|e2e-migration-)/u.test(
        id,
      )
    ) {
      throw new Error(
        'Database auxiliary command identity is not allowlisted.',
      );
    }
  }
  const junit = databaseEvidenceArtifact(artifacts, 'junit');
  const logManifestArtifact = databaseEvidenceArtifact(
    artifacts,
    'logManifest',
  );
  const junitBytes = readBoundEvidenceFile(
    expected.evidenceRoot,
    junit.path,
    4 * 1024 * 1024,
  );
  const logManifestBytes = readBoundEvidenceFile(
    expected.evidenceRoot,
    logManifestArtifact.path,
    4 * 1024 * 1024,
  );
  if (
    sha256(junitBytes) !== junit.sha256 ||
    sha256(logManifestBytes) !== logManifestArtifact.sha256
  ) {
    throw new Error('Database evidence artifact digest does not match bytes.');
  }
  const junitText = junitBytes.toString('utf8');
  const junitTests = Number(
    /<testsuite\b[^>]*\btests="(\d+)"/u.exec(junitText)?.[1],
  );
  const junitCheckNames = Array.from(
    junitText.matchAll(/<testcase\b[^>]*\bname="([A-Za-z0-9_-]+)"/gu),
    (match) => match[1],
  ).sort((left, right) => left.localeCompare(right));
  const expectedJunitCheckNames = [...requiredChecks].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    !/<testsuite\b[^>]*\bfailures="0"/u.test(junitText) ||
    /<failure\b/u.test(junitText) ||
    redactSensitiveDiagnostic(junitText) !== junitText ||
    junitTests !== requiredChecks.length ||
    JSON.stringify(junitCheckNames) !== JSON.stringify(expectedJunitCheckNames)
  ) {
    throw new Error(
      'Database JUnit artifact does not prove the exact passing check matrix.',
    );
  }
  const logManifest = record(
    JSON.parse(logManifestBytes.toString('utf8')) as unknown,
    'database log manifest',
  );
  exactKeys(
    logManifest,
    ['schemaVersion', 'runId', 'commands'],
    'database log manifest',
  );
  if (
    logManifest.schemaVersion !== 1 ||
    logManifest.runId !== root.runId ||
    JSON.stringify(logManifest.commands) !==
      JSON.stringify(orderedManifestCommands)
  ) {
    throw new Error('Database log manifest is not exactly bound to commands.');
  }
  return {
    runId: String(root.runId),
    evidenceSha256: sha256(Buffer.from(JSON.stringify(root))),
    database: {
      hostFingerprintSha256: String(database.hostFingerprintSha256),
      port: Number(database.port),
      databaseName: String(database.databaseName),
      guardedTestSuffix: true,
      serverVersion: String(database.serverVersion),
    },
    migrations: {
      catalogCount: Number(migrations.catalogCount),
      catalogChecksumSha256: String(migrations.catalogChecksumSha256),
      latestNames: [...(migrations.latestNames as string[])],
      latestChecksums: [...(migrations.latestChecksums as string[])],
    },
  };
}

export function assertCapacityBackupEvidence(
  input: unknown,
  expected: CapacityBackupEvidenceExpectation,
): CapacityBackupEvidenceSummary {
  const root = record(input, 'capacity and backup evidence');
  exactKeys(
    root,
    [
      'schemaVersion',
      'runId',
      'measuredAt',
      'git',
      'releaseContentDigest',
      'clusterFingerprintSha256',
      'prometheus',
      'backup',
      'outcome',
    ],
    'capacity and backup evidence',
  );
  const serialized = JSON.stringify(root);
  if (
    /database_url|postgres(?:ql)?:\/\/|password|username|\buser\b|secret|token|credential|https?:\/\//iu.test(
      serialized,
    )
  ) {
    throw new Error('Capacity and backup evidence contains sensitive fields.');
  }
  const git = record(root.git, 'capacity and backup evidence.git');
  const prometheus = record(
    root.prometheus,
    'capacity and backup evidence.prometheus',
  );
  const backup = record(root.backup, 'capacity and backup evidence.backup');
  exactKeys(git, ['commit', 'treeSha'], 'capacity and backup evidence.git');
  exactKeys(
    prometheus,
    [
      'pvcBound',
      'capacityGiB',
      'usedGiB',
      'compressedIngestGiBPerDay',
      'projectedRequiredGiB',
      'storageClassExpansionAllowed',
    ],
    'capacity and backup evidence.prometheus',
  );
  exactKeys(
    backup,
    [
      'encrypted',
      'retentionDays',
      'latestSnapshotAt',
      'restoreRehearsedAt',
      'restoreSucceeded',
      'restoreDurationSeconds',
    ],
    'capacity and backup evidence.backup',
  );
  const measuredAt = Date.parse(string(root.measuredAt, 'measuredAt'));
  const snapshotAt = Date.parse(
    string(backup.latestSnapshotAt, 'latestSnapshotAt'),
  );
  const restoredAt = Date.parse(
    string(backup.restoreRehearsedAt, 'restoreRehearsedAt'),
  );
  const now = expected.nowMs ?? Date.now();
  const runId = string(root.runId, 'runId');
  if (
    root.schemaVersion !== 1 ||
    root.outcome !== 'pass' ||
    !/^[0-9a-f-]{16,64}$/u.test(runId) ||
    !SHA256.test(String(root.clusterFingerprintSha256)) ||
    !Number.isFinite(measuredAt) ||
    measuredAt > now + 60_000 ||
    now - measuredAt > 24 * 60 * 60_000 ||
    git.commit !== expected.commit ||
    git.treeSha !== expected.treeSha ||
    root.releaseContentDigest !== expected.releaseContentDigest
  ) {
    throw new Error(
      'Capacity and backup evidence is stale or not release-bound.',
    );
  }
  const capacityGiB = finiteNumber(prometheus.capacityGiB, 'capacityGiB');
  const usedGiB = finiteNumber(prometheus.usedGiB, 'usedGiB');
  const ingestGiBPerDay = finiteNumber(
    prometheus.compressedIngestGiBPerDay,
    'compressedIngestGiBPerDay',
  );
  const projectedRequiredGiB = finiteNumber(
    prometheus.projectedRequiredGiB,
    'projectedRequiredGiB',
  );
  const expectedRequiredGiB = ingestGiBPerDay * 32 * 1.25;
  if (
    prometheus.pvcBound !== true ||
    prometheus.storageClassExpansionAllowed !== true ||
    capacityGiB < 50 ||
    usedGiB < 0 ||
    usedGiB > capacityGiB * 0.8 ||
    ingestGiBPerDay <= 0 ||
    Math.abs(projectedRequiredGiB - expectedRequiredGiB) > 0.001 ||
    projectedRequiredGiB > capacityGiB * 0.8
  ) {
    throw new Error('Prometheus 32-day capacity evidence exceeds its budget.');
  }
  const retentionDays = finiteNumber(backup.retentionDays, 'retentionDays');
  const restoreDurationSeconds = finiteNumber(
    backup.restoreDurationSeconds,
    'restoreDurationSeconds',
  );
  if (
    backup.encrypted !== true ||
    backup.restoreSucceeded !== true ||
    retentionDays < 32 ||
    restoreDurationSeconds <= 0 ||
    !Number.isFinite(snapshotAt) ||
    snapshotAt > now + 60_000 ||
    now - snapshotAt > 24 * 60 * 60_000 ||
    !Number.isFinite(restoredAt) ||
    restoredAt > now + 60_000 ||
    now - restoredAt > 90 * 24 * 60 * 60_000
  ) {
    throw new Error('Encrypted backup and restore evidence is not current.');
  }
  return {
    runId,
    clusterFingerprintSha256: String(root.clusterFingerprintSha256),
    requiredGiB: projectedRequiredGiB,
    capacityGiB,
    backupRetentionDays: retentionDays,
  };
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function databaseEvidenceArtifact(
  artifacts: Record<string, unknown>,
  name: 'junit' | 'logManifest',
): { path: string; sha256: string } {
  const artifact = record(
    artifacts[name],
    `database release evidence.artifacts.${name}`,
  );
  exactKeys(artifact, ['path', 'sha256'], `database artifact ${name}`);
  const path = safeRelativePath(
    string(artifact.path, `database artifact ${name}.path`),
    `database artifact ${name}.path`,
  );
  const expectedPath =
    name === 'junit' ? 'evidence.junit.xml' : 'log-manifest.json';
  if (path !== expectedPath) {
    throw new Error(`Database evidence artifact path is invalid: ${name}.`);
  }
  const digest = string(artifact.sha256, `database artifact ${name}.sha256`);
  if (!SHA256.test(digest)) {
    throw new Error(`Database evidence artifact digest is invalid: ${name}.`);
  }
  return { path, sha256: digest };
}

function readBoundEvidenceFile(
  evidenceRoot: string,
  relativePath: string,
  maximumBytes: number,
): Buffer {
  if (!isAbsolute(evidenceRoot) || !existsSync(evidenceRoot)) {
    throw new Error(
      'Database evidence root must be an existing absolute path.',
    );
  }
  const rootStat = lstatSync(evidenceRoot);
  const canonicalRoot = realpathSync(evidenceRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Database evidence root must be a real directory.');
  }
  const candidate = resolve(canonicalRoot, relativePath);
  if (!isStrictDescendant(relative(canonicalRoot, candidate))) {
    throw new Error('Database evidence artifact escapes its evidence root.');
  }
  let cursor = canonicalRoot;
  for (const component of relative(canonicalRoot, candidate).split(sep)) {
    cursor = join(cursor, component);
    if (!existsSync(cursor) || lstatSync(cursor).isSymbolicLink()) {
      throw new Error(
        'Database evidence artifact is absent or traverses a link.',
      );
    }
  }
  const stat = lstatSync(candidate);
  if (!stat.isFile() || stat.size > maximumBytes) {
    throw new Error(
      'Database evidence artifact is not a bounded regular file.',
    );
  }
  return readFileSync(candidate);
}

export function renderValidatorJUnit(
  results: readonly ValidatorResult[],
  metadata: {
    runId?: string;
    commit?: string;
    treeSha?: string;
    releaseProfile?: boolean;
  } = {},
): string {
  const failures = results.filter(
    ({ status }) =>
      status === 'FAIL_INTERNAL' ||
      (metadata.releaseProfile === true && status === 'BLOCKED_EXTERNAL'),
  ).length;
  const skipped = results.filter(
    ({ status }) =>
      status === 'BLOCKED_EXTERNAL' && metadata.releaseProfile !== true,
  ).length;
  const cases = results
    .map((result) => {
      const name = xml(result.id);
      const time = (result.durationMs / 1_000).toFixed(3);
      if (result.status === 'FAIL_INTERNAL') {
        return `  <testcase name="${name}" time="${time}"><failure message="${xml(result.reason ?? 'Internal failure')}"/></testcase>`;
      }
      if (result.status === 'BLOCKED_EXTERNAL') {
        if (metadata.releaseProfile === true) {
          return `  <testcase name="${name}" time="${time}"><failure message="${xml(result.reason ?? 'Release prerequisite blocked externally')}"/></testcase>`;
        }
        return `  <testcase name="${name}" time="${time}"><skipped message="${xml(result.reason ?? 'External prerequisite unavailable')}"/></testcase>`;
      }
      return `  <testcase name="${name}" time="${time}"/>`;
    })
    .join('\n');
  const properties = Object.entries({
    runId: metadata.runId,
    commit: metadata.commit,
    treeSha: metadata.treeSha,
  })
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(
      ([name, value]) =>
        `    <property name="${xml(name)}" value="${xml(value)}"/>`,
    )
    .join('\n');
  const propertyBlock = properties
    ? `\n  <properties>\n${properties}\n  </properties>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="media-operations" tests="${results.length}" failures="${failures}" skipped="${skipped}">${propertyBlock}\n${cases}\n</testsuite>\n`;
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

export interface GrafanaDashboardTargetContract {
  refId: string;
  expr: string;
}

export function assertGrafanaDashboardTargetContract(
  sourceDashboard: unknown,
  importedDashboard: unknown,
  datasourceUid: string,
): GrafanaDashboardTargetContract[] {
  if (!/^[a-z][a-z0-9-]{2,63}$/u.test(datasourceUid)) {
    throw new Error('Grafana datasource UID is not a stable identifier.');
  }
  const sourceTargets = grafanaDashboardTargets(
    sourceDashboard,
    datasourceUid,
    'source',
  );
  const importedTargets = grafanaDashboardTargets(
    importedDashboard,
    datasourceUid,
    'readback',
  );
  if (JSON.stringify(importedTargets) !== JSON.stringify(sourceTargets)) {
    throw new Error(
      'Grafana imported readback target contract differs from source.',
    );
  }
  return importedTargets;
}

function grafanaDashboardTargets(
  dashboardInput: unknown,
  datasourceUid: string,
  origin: 'source' | 'readback',
): GrafanaDashboardTargetContract[] {
  const dashboard = record(dashboardInput, `Grafana ${origin} dashboard`);
  if (!Array.isArray(dashboard.panels) || dashboard.panels.length === 0) {
    throw new Error(`Grafana ${origin} dashboard has no panels.`);
  }
  const targets: GrafanaDashboardTargetContract[] = [];
  const refIds = new Set<string>();
  for (const [panelIndex, panelInput] of dashboard.panels.entries()) {
    const panel = record(
      panelInput,
      `Grafana ${origin} dashboard panel ${panelIndex}`,
    );
    const datasource = record(
      panel.datasource,
      `Grafana ${origin} dashboard panel ${panelIndex} datasource`,
    );
    exactKeys(
      datasource,
      ['type', 'uid'],
      `Grafana ${origin} dashboard panel ${panelIndex} datasource`,
    );
    if (datasource.type !== 'prometheus' || datasource.uid !== datasourceUid) {
      throw new Error(
        `Grafana ${origin} panel does not use the exact provisioned datasource.`,
      );
    }
    if (!Array.isArray(panel.targets) || panel.targets.length === 0) {
      throw new Error(
        `Grafana ${origin} dashboard panel has no query targets.`,
      );
    }
    for (const [targetIndex, targetInput] of panel.targets.entries()) {
      const target = record(
        targetInput,
        `Grafana ${origin} target ${panelIndex}:${targetIndex}`,
      );
      const refId = string(
        target.refId,
        `Grafana ${origin} target ${panelIndex}:${targetIndex}.refId`,
      );
      const expr = string(
        target.expr,
        `Grafana ${origin} target ${panelIndex}:${targetIndex}.expr`,
      );
      if (!/^[A-Z][A-Z0-9_]{2,63}$/u.test(refId)) {
        throw new Error(
          'Grafana target refId must be a stable uppercase identifier.',
        );
      }
      if (refIds.has(refId)) {
        throw new Error(`Duplicate Grafana target refId: ${refId}.`);
      }
      if (!expr.trim() || expr.length > 4_096) {
        throw new Error(`Grafana target ${refId} has an invalid expression.`);
      }
      refIds.add(refId);
      targets.push({ refId, expr });
    }
  }
  return targets;
}

export function redactDiagnostic(value: string): string {
  return redactSensitiveDiagnostic(value).slice(0, 1_024);
}

function redactSensitiveDiagnostic(value: string): string {
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
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
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

function parseOciImageDefinition(
  input: unknown,
  imageName: string,
): OciImageDefinition {
  const path = `manifest.images.${imageName}`;
  const image = record(input, path);
  exactKeys(
    image,
    ['repository', 'version', 'indexDigest', 'platforms', 'attestations'],
    path,
  );
  const repository = string(image.repository, `${path}.repository`);
  const repositories: Record<string, string> = {
    alertmanager: 'quay.io/prometheus/alertmanager',
    grafana: 'docker.io/grafana/grafana',
    prometheus: 'quay.io/prometheus/prometheus',
  };
  if (
    !/^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9][a-z0-9._/-]*$/u.test(repository) ||
    repository.includes('..') ||
    repositories[imageName] !== repository
  ) {
    throw new Error(`${path}.repository is not an exact OCI repository.`);
  }
  const version = string(image.version, `${path}.version`);
  if (!TOOL_VERSION.test(version)) {
    throw new Error(`${path}.version must be an exact numeric version.`);
  }
  const indexDigest = string(image.indexDigest, `${path}.indexDigest`);
  if (!OCI_DIGEST.test(indexDigest)) {
    throw new Error(`${path}.indexDigest must be an exact OCI digest.`);
  }
  if (!Array.isArray(image.platforms) || image.platforms.length !== 1) {
    throw new Error(`${path} must define exactly one Linux amd64 platform.`);
  }
  const platformPath = `${path}.platforms[0]`;
  const rawPlatform = record(image.platforms[0], platformPath);
  exactKeys(
    rawPlatform,
    ['os', 'architecture', 'digest', 'runtimeRef'],
    platformPath,
  );
  if (rawPlatform.os !== 'linux' || rawPlatform.architecture !== 'x64') {
    throw new Error(`${path} must define exactly the Linux amd64 platform.`);
  }
  const digest = string(rawPlatform.digest, `${platformPath}.digest`);
  const runtimeRef = string(
    rawPlatform.runtimeRef,
    `${platformPath}.runtimeRef`,
  );
  if (!OCI_DIGEST.test(digest) || runtimeRef !== `${repository}@${digest}`) {
    throw new Error(`${path} has a mismatched OCI runtime digest/reference.`);
  }
  const attestations = record(image.attestations, `${path}.attestations`);
  exactKeys(attestations, ['signature', 'sbom'], `${path}.attestations`);
  const signature = record(
    attestations.signature,
    `${path}.attestations.signature`,
  );
  exactKeys(
    signature,
    ['required', 'verifier', 'issuer', 'approvedIdentities'],
    `${path}.attestations.signature`,
  );
  if (signature.required !== true || signature.verifier !== 'cosign-keyless') {
    throw new Error(
      `${path} requires a fail-closed cosign signature attestation.`,
    );
  }
  const issuer = string(
    signature.issuer,
    `${path}.attestations.signature.issuer`,
  );
  if (issuer !== 'https://token.actions.githubusercontent.com') {
    throw new Error(`${path} uses an unapproved exact OIDC issuer.`);
  }
  if (
    !Array.isArray(signature.approvedIdentities) ||
    !signature.approvedIdentities.every(
      (identity) =>
        typeof identity === 'string' &&
        /^https:\/\/github\.com\/khonghao0109\/HSK-3\.0-APP\/\.github\/workflows\/[a-z0-9][a-z0-9_-]*\.ya?ml@refs\/tags\/v\d+\.\d+\.\d+$/u.test(
          identity,
        ),
    )
  ) {
    throw new Error(
      `${path} contains a broad or unapproved workflow identity.`,
    );
  }
  const approvedIdentities = signature.approvedIdentities as unknown[];
  const sbom = record(attestations.sbom, `${path}.attestations.sbom`);
  exactKeys(sbom, ['required', 'format'], `${path}.attestations.sbom`);
  if (sbom.required !== true || sbom.format !== 'spdx-json') {
    throw new Error(
      `${path} requires a fail-closed SPDX JSON SBOM attestation.`,
    );
  }
  return {
    repository,
    version,
    indexDigest,
    platforms: [{ os: 'linux', architecture: 'x64', digest, runtimeRef }],
    attestations: {
      signature: {
        required: true,
        verifier: 'cosign-keyless',
        issuer,
        approvedIdentities: approvedIdentities.map((identity) =>
          String(identity),
        ),
      },
      sbom: { required: true, format: 'spdx-json' },
    },
  };
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
    'cosign',
    'grafana',
    'istioctl',
    'kubeconform',
    'kubectl',
    'nginx',
    'prometheus',
    'promtool',
    'pcre2',
    'syft',
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
