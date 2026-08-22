import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { readStableBoundedFileWithinRoot } from './media-operations-validation.helpers';

const SHA256 = /^[a-f0-9]{64}$/u;
const OCI_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/u;
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/u;
const SAFE_NAME = /^[a-z][a-z0-9-]{0,63}$/u;
const SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$/u;
const TRUSTED_ISSUER = 'https://token.actions.githubusercontent.com';
const TRUSTED_IDENTITY =
  /^https:\/\/github\.com\/khonghao0109\/HSK-3\.0-APP\/\.github\/workflows\/media-release-evidence\.yml@refs\/tags\/v\d+\.\d+\.\d+$/u;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const MAX_ARRAY_ENTRIES = 100_000;
const MAX_WAIVERS = 1_000;
const GRYPE_DB_MAX_AGE_MS = 120 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export const CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS = {
  syft: {
    name: 'syft',
    version: '1.50.0',
    platform: 'linux-amd64',
    artifactSha256:
      'bf7b29ff57f06da30918266a0e1c2885a8f99784798d1bdb1628886aa015d788',
  },
  grype: {
    name: 'grype',
    version: '0.116.1',
    platform: 'linux-amd64',
    artifactSha256:
      '0122df7b655981abe547ad3d2190d65551dac6a2bfc80b4dc2a989b5d0587458',
  },
} as const;

Object.freeze(CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS.syft);
Object.freeze(CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS.grype);
Object.freeze(CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS);

export const CURRENT_MEDIA_OCI_LICENSE_POLICY_SHA256 =
  'fce3681d6911e1901305d6223fe3b13ca1aa571766d9a99ab4b2031713848a25';

export type MediaOciReleaseEvidenceClassification =
  | 'BLOCKED_EXTERNAL'
  | 'FAIL_INTERNAL';

export class MediaOciReleaseEvidenceError extends Error {
  constructor(
    message: string,
    readonly classification: MediaOciReleaseEvidenceClassification,
  ) {
    super(message);
    this.name = 'MediaOciReleaseEvidenceError';
  }
}

export interface MediaOciImageExpectation {
  name: 'alertmanager' | 'grafana' | 'prometheus';
  repository: string;
  version: string;
  registryTag: string;
  indexDigest: string;
  indexMediaType:
    | 'application/vnd.docker.distribution.manifest.list.v2+json'
    | 'application/vnd.oci.image.index.v1+json';
  platformDigest: string;
  runtimeRef: string;
  source: {
    repository: string;
    tag: string;
    tagObjectSha: string;
    commitSha: string;
    tagSignatureStatus: 'verified' | 'unsigned';
  };
}

export type MediaOciImageExpectations = Record<
  MediaOciImageExpectation['name'],
  MediaOciImageExpectation
>;

export const CURRENT_MEDIA_OCI_IMAGE_EXPECTATIONS = {
  alertmanager: {
    name: 'alertmanager',
    repository: 'quay.io/prometheus/alertmanager',
    version: '0.33.1',
    registryTag: 'v0.33.1',
    indexDigest:
      'sha256:9e082985f56f4c8c9f724e18f2288c6708f472e56a5286b8863d080434ea065d',
    indexMediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
    platformDigest:
      'sha256:a89f8d4520954079275441eecdb71444328bd90633dd4eddfc33b9ed657f349b',
    runtimeRef:
      'quay.io/prometheus/alertmanager@sha256:a89f8d4520954079275441eecdb71444328bd90633dd4eddfc33b9ed657f349b',
    source: {
      repository: 'https://github.com/prometheus/alertmanager',
      tag: 'v0.33.1',
      tagObjectSha: 'baca8cf2c61f50a448ddbf5a04dc4feb9b3d6d26',
      commitSha: '2c8da51e03f3dbbed24f9711ca2d76aab4eef9c5',
      tagSignatureStatus: 'verified',
    },
  },
  grafana: {
    name: 'grafana',
    repository: 'docker.io/grafana/grafana',
    version: '13.1.3',
    registryTag: '13.1.3',
    indexDigest:
      'sha256:ab5cb380e3ff3172d6c8bd2e7cfd31cce977d2881b260e1f5bc089bf0b759b43',
    indexMediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
    platformDigest:
      'sha256:e27e68cfd5795c1bea54950766078a02e84dfa3bafe0a4d0e5382f713dfd8e4e',
    runtimeRef:
      'docker.io/grafana/grafana@sha256:e27e68cfd5795c1bea54950766078a02e84dfa3bafe0a4d0e5382f713dfd8e4e',
    source: {
      repository: 'https://github.com/grafana/grafana',
      tag: 'v13.1.3',
      tagObjectSha: '12cb42922a6c6604e62d5f9ed512fd0d9febf4ec',
      commitSha: '45a27d64b64a82d666b06aa5c5bb3521587edb0d',
      tagSignatureStatus: 'unsigned',
    },
  },
  prometheus: {
    name: 'prometheus',
    repository: 'quay.io/prometheus/prometheus',
    version: '3.13.2',
    registryTag: 'v3.13.2',
    indexDigest:
      'sha256:508729e0e2d18e11fd742a5a5ca70e557b940a93948c3c95fd0123a6fd538b69',
    indexMediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
    platformDigest:
      'sha256:1147c92841726a6fef55fe6124491d6f85480f8de204f7d420304ca5bbd0a8f7',
    runtimeRef:
      'quay.io/prometheus/prometheus@sha256:1147c92841726a6fef55fe6124491d6f85480f8de204f7d420304ca5bbd0a8f7',
    source: {
      repository: 'https://github.com/prometheus/prometheus',
      tag: 'v3.13.2',
      tagObjectSha: 'd08db18ac8e5eb1e30f941446ef954a44f510986',
      commitSha: 'bb5dff00cf8fdfbf5c65e0531aa835fa238a43a2',
      tagSignatureStatus: 'verified',
    },
  },
} as const satisfies MediaOciImageExpectations;

for (const expectation of Object.values(CURRENT_MEDIA_OCI_IMAGE_EXPECTATIONS)) {
  Object.freeze(expectation.source);
  Object.freeze(expectation);
}
Object.freeze(CURRENT_MEDIA_OCI_IMAGE_EXPECTATIONS);

export interface TrustVerifiedMediaOciReleaseManifest {
  /** Exact bytes already verified by the Sigstore trust layer. */
  bytes: Uint8Array;
  /** JSON value parsed from the same verified bytes by the caller. */
  value: unknown;
  /** Certificate facts returned by the trust verifier, never a signed boolean. */
  issuer: string;
  identity: string;
}

export interface MediaOciReleaseEvidenceExpectation {
  evidenceRoot: string;
  commit: string;
  treeSha: string;
  releaseContentDigest: string;
  trustedIssuer: string;
  trustedIdentity: string;
  images: MediaOciImageExpectations;
  now: Date | number;
  retainValidatedReport?: (relativePath: string, bytes: Buffer) => void;
}

export interface MediaOciReleaseImageEvidenceSummary {
  name: MediaOciImageExpectation['name'];
  indexDigest: string;
  platformDigest: string;
  spdxSha256: string;
  packageCount: number;
  vulnerabilityCount: number;
  waivedVulnerabilityCount: number;
  licensePackageCount: number;
  waivedLicenseFindingCount: number;
  vulnerabilityDatabaseBuiltAt: string;
}

export interface MediaOciReleaseEvidenceSummary {
  manifestSha256: string;
  releaseTag: string;
  images: MediaOciReleaseImageEvidenceSummary[];
}

interface FileReference {
  path: string;
  sha256: string;
}

interface ToolPin {
  name: 'syft' | 'grype';
  version: string;
  platform: 'linux-amd64';
  artifactSha256: string;
}

interface VulnerabilityWaiver {
  finding: { id: string; package: string; version: string };
  owner: string;
  reason: string;
  expiresAt: string;
}

interface LicenseWaiver {
  finding: { spdxId: string; licenseId: string };
  owner: string;
  reason: string;
  expiresAt: string;
}

interface ParsedImageEvidence {
  name: MediaOciImageExpectation['name'];
  repository: string;
  version: string;
  registryTag: string;
  indexDigest: string;
  indexMediaType: string;
  platform: {
    os: 'linux';
    architecture: 'amd64';
    digest: string;
    runtimeRef: string;
  };
  source: MediaOciImageExpectation['source'] & {
    metadataRole: 'observed-release-metadata-not-image-provenance';
  };
  reports: {
    spdx: FileReference & { tool: ToolPin };
    vulnerability: FileReference & {
      tool: ToolPin;
      policy: FileReference;
      database: {
        builtAt: string;
        sha256: string;
        maxAgeHours: 120;
      };
    };
    license: FileReference & { policy: FileReference };
  };
  waivers: {
    vulnerabilities: VulnerabilityWaiver[];
    licenses: LicenseWaiver[];
  };
}

interface ParsedManifest {
  schemaVersion: 1;
  kind: 'hsk-media-oci-release-acceptance';
  acceptance: {
    semantics: 'hsk-release-acceptance-not-upstream-provenance';
    upstreamPublisherSignature: 'absent';
    upstreamPublisherAttestations: 'absent';
    issuer: string;
    identity: string;
  };
  binding: {
    commit: string;
    treeSha: string;
    releaseContentDigest: string;
    releaseTag: string;
  };
  images: ParsedImageEvidence[];
}

interface LoadedJson {
  bytes: Buffer;
  value: unknown;
}

class EvidenceReader {
  private readonly cache = new Map<string, LoadedJson>();
  readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root) || !existsSync(root)) {
      unavailable('OCI release evidence root is absent or not absolute.');
    }
    const resolvedRoot = resolve(root);
    const rootInfo = lstatSync(resolvedRoot);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
      fail('OCI release evidence root must be a real directory.');
    }
    const canonicalRoot = realpathSync(resolvedRoot);
    if (canonicalRoot !== resolvedRoot) {
      fail('OCI release evidence root must not use a symlink alias.');
    }
    this.root = canonicalRoot;
  }

  read(reference: FileReference, label: string): LoadedJson {
    if (!SHA256.test(reference.sha256)) {
      fail(`${label}.sha256 must be a pinned lowercase SHA-256.`);
    }
    const relativePath = safeReportPath(reference.path, `${label}.path`);
    const cached = this.cache.get(relativePath);
    if (cached) {
      assertSha256(cached.bytes, reference.sha256, label);
      return cached;
    }
    const candidate = resolve(this.root, relativePath);
    if (!strictDescendant(this.root, candidate)) {
      fail(`${label}.path escapes the evidence root.`);
    }
    if (!existsSync(candidate)) {
      unavailable(`${label} is absent from the release evidence.`);
    }
    let bytes: Buffer;
    try {
      bytes = readStableBoundedFileWithinRoot(
        this.root,
        relativePath,
        MAX_REPORT_BYTES,
        label,
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message === `${label} is absent.` ||
          (error as NodeJS.ErrnoException).code === 'ENOENT')
      ) {
        unavailable(`${label} is absent from the release evidence.`);
      }
      fail(error instanceof Error ? error.message : `${label} is unsafe.`);
    }
    if (bytes.length === 0) {
      fail(`${label} must be non-empty.`);
    }
    assertSha256(bytes, reference.sha256, label);
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      fail(`${label} is not valid JSON.`);
    }
    const loaded = { bytes, value };
    this.cache.set(relativePath, loaded);
    return loaded;
  }

  validatedFiles(): Array<{ relativePath: string; bytes: Buffer }> {
    return [...this.cache.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relativePath, loaded]) => ({
        relativePath,
        bytes: Buffer.from(loaded.bytes),
      }));
  }
}

/**
 * Validates the semantic and byte-level content of an already trust-verified
 * Option C release-acceptance manifest. Signature verification remains outside
 * this module so absent signed evidence can stay BLOCKED_EXTERNAL in the runner.
 */
export function assertMediaOciReleaseEvidence(
  verified: TrustVerifiedMediaOciReleaseManifest,
  expectation: MediaOciReleaseEvidenceExpectation,
): MediaOciReleaseEvidenceSummary {
  const nowMs = normalizeNow(expectation.now);
  assertExpectedImagesExact(expectation.images);
  assertBindingExpectation(expectation);
  const parsedBytes = parseVerifiedBytes(verified.bytes);
  if (!isDeepStrictEqual(parsedBytes, verified.value)) {
    fail('Trust-verified manifest bytes and parsed value do not match.');
  }
  if (
    verified.issuer !== expectation.trustedIssuer ||
    verified.identity !== expectation.trustedIdentity
  ) {
    fail('Trust verifier returned an unexpected issuer or identity.');
  }
  const manifest = parseMediaOciReleaseManifest(verified.value);
  if (
    manifest.acceptance.issuer !== verified.issuer ||
    manifest.acceptance.identity !== verified.identity
  ) {
    fail('Signed acceptance identity does not match the trust verifier facts.');
  }
  if (
    manifest.binding.commit !== expectation.commit ||
    manifest.binding.treeSha !== expectation.treeSha ||
    manifest.binding.releaseContentDigest !== expectation.releaseContentDigest
  ) {
    fail('Signed OCI release evidence is bound to another release tree.');
  }
  const releaseTag = tagFromIdentity(expectation.trustedIdentity);
  if (manifest.binding.releaseTag !== releaseTag) {
    fail('Signed OCI release evidence is bound to another release tag.');
  }
  const reader = new EvidenceReader(expectation.evidenceRoot);
  const byName = new Map(manifest.images.map((image) => [image.name, image]));
  if (byName.size !== 3) {
    fail('Signed OCI release evidence must define each image exactly once.');
  }
  const imageReportDigests = new Set<string>();
  for (const image of manifest.images) {
    for (const report of [
      image.reports.spdx,
      image.reports.vulnerability,
      image.reports.license,
    ]) {
      if (imageReportDigests.has(report.sha256)) {
        fail('Each OCI image must have distinct signed report bytes.');
      }
      imageReportDigests.add(report.sha256);
    }
  }
  const summaries = (['alertmanager', 'grafana', 'prometheus'] as const).map(
    (name) => {
      const image = byName.get(name);
      if (!image) fail(`Signed OCI release evidence is missing ${name}.`);
      const expected = expectation.images[name];
      assertImageExpectation(image, expected);
      return validateImageReports(image, expected, reader, nowMs);
    },
  );
  if (expectation.retainValidatedReport) {
    for (const report of reader.validatedFiles()) {
      expectation.retainValidatedReport(report.relativePath, report.bytes);
    }
  }
  return {
    manifestSha256: sha256(verified.bytes),
    releaseTag,
    images: summaries,
  };
}

export function parseMediaOciReleaseManifest(value: unknown): ParsedManifest {
  const root = record(value, 'manifest');
  exactKeys(
    root,
    ['schemaVersion', 'kind', 'acceptance', 'binding', 'images'],
    'manifest',
  );
  if (
    root.schemaVersion !== 1 ||
    root.kind !== 'hsk-media-oci-release-acceptance'
  ) {
    fail('OCI release evidence schema/kind is unsupported.');
  }
  const acceptance = record(root.acceptance, 'manifest.acceptance');
  exactKeys(
    acceptance,
    [
      'semantics',
      'upstreamPublisherSignature',
      'upstreamPublisherAttestations',
      'issuer',
      'identity',
    ],
    'manifest.acceptance',
  );
  if (
    acceptance.semantics !== 'hsk-release-acceptance-not-upstream-provenance' ||
    acceptance.upstreamPublisherSignature !== 'absent' ||
    acceptance.upstreamPublisherAttestations !== 'absent'
  ) {
    fail('OCI release evidence overstates upstream publisher provenance.');
  }
  const issuer = exactString(acceptance.issuer, 'manifest.acceptance.issuer');
  const identity = exactString(
    acceptance.identity,
    'manifest.acceptance.identity',
  );
  if (issuer !== TRUSTED_ISSUER || !TRUSTED_IDENTITY.test(identity)) {
    fail('OCI release evidence contains an unsupported signing identity.');
  }
  const binding = record(root.binding, 'manifest.binding');
  exactKeys(
    binding,
    ['commit', 'treeSha', 'releaseContentDigest', 'releaseTag'],
    'manifest.binding',
  );
  const commit = exactString(binding.commit, 'manifest.binding.commit');
  const treeSha = exactString(binding.treeSha, 'manifest.binding.treeSha');
  const releaseContentDigest = exactString(
    binding.releaseContentDigest,
    'manifest.binding.releaseContentDigest',
  );
  const releaseTag = exactString(
    binding.releaseTag,
    'manifest.binding.releaseTag',
  );
  if (
    !GIT_SHA.test(commit) ||
    !GIT_SHA.test(treeSha) ||
    !SHA256.test(releaseContentDigest) ||
    !RELEASE_TAG.test(releaseTag)
  ) {
    fail('OCI release evidence has malformed release binding values.');
  }
  if (!Array.isArray(root.images) || root.images.length !== 3) {
    fail('OCI release evidence must contain exactly three images.');
  }
  return {
    schemaVersion: 1,
    kind: 'hsk-media-oci-release-acceptance',
    acceptance: {
      semantics: 'hsk-release-acceptance-not-upstream-provenance',
      upstreamPublisherSignature: 'absent',
      upstreamPublisherAttestations: 'absent',
      issuer,
      identity,
    },
    binding: { commit, treeSha, releaseContentDigest, releaseTag },
    images: root.images.map((image, index) => parseImage(image, index)),
  };
}

function parseImage(value: unknown, index: number): ParsedImageEvidence {
  const path = `manifest.images[${index}]`;
  const image = record(value, path);
  exactKeys(
    image,
    [
      'name',
      'repository',
      'version',
      'registryTag',
      'indexDigest',
      'indexMediaType',
      'platform',
      'source',
      'reports',
      'waivers',
    ],
    path,
  );
  const name = exactString(image.name, `${path}.name`);
  if (
    !SAFE_NAME.test(name) ||
    !['alertmanager', 'grafana', 'prometheus'].includes(name)
  ) {
    fail(`${path}.name is unsupported.`);
  }
  const platform = record(image.platform, `${path}.platform`);
  exactKeys(
    platform,
    ['os', 'architecture', 'digest', 'runtimeRef'],
    `${path}.platform`,
  );
  if (platform.os !== 'linux' || platform.architecture !== 'amd64') {
    fail(`${path}.platform must be exactly linux/amd64.`);
  }
  const source = record(image.source, `${path}.source`);
  exactKeys(
    source,
    [
      'repository',
      'tag',
      'tagObjectSha',
      'commitSha',
      'tagSignatureStatus',
      'metadataRole',
    ],
    `${path}.source`,
  );
  if (
    source.metadataRole !== 'observed-release-metadata-not-image-provenance' ||
    !['verified', 'unsigned'].includes(String(source.tagSignatureStatus)) ||
    !GIT_SHA.test(
      exactString(source.tagObjectSha, `${path}.source.tagObjectSha`),
    ) ||
    !GIT_SHA.test(exactString(source.commitSha, `${path}.source.commitSha`))
  ) {
    fail(`${path}.source overstates the image/source provenance boundary.`);
  }
  const reports = record(image.reports, `${path}.reports`);
  exactKeys(reports, ['spdx', 'vulnerability', 'license'], `${path}.reports`);
  const spdx = parseReportWithTool(
    reports.spdx,
    `${path}.reports.spdx`,
    'syft',
  );
  const vulnerability = parseVulnerabilityReference(
    reports.vulnerability,
    `${path}.reports.vulnerability`,
  );
  const license = parseLicenseReference(
    reports.license,
    `${path}.reports.license`,
  );
  const waivers = record(image.waivers, `${path}.waivers`);
  exactKeys(waivers, ['vulnerabilities', 'licenses'], `${path}.waivers`);
  return {
    name: name as ParsedImageEvidence['name'],
    repository: exactString(image.repository, `${path}.repository`),
    version: exactString(image.version, `${path}.version`),
    registryTag: exactString(image.registryTag, `${path}.registryTag`),
    indexDigest: exactString(image.indexDigest, `${path}.indexDigest`),
    indexMediaType: exactString(image.indexMediaType, `${path}.indexMediaType`),
    platform: {
      os: 'linux',
      architecture: 'amd64',
      digest: exactString(platform.digest, `${path}.platform.digest`),
      runtimeRef: exactString(
        platform.runtimeRef,
        `${path}.platform.runtimeRef`,
      ),
    },
    source: {
      repository: exactString(source.repository, `${path}.source.repository`),
      tag: exactString(source.tag, `${path}.source.tag`),
      tagObjectSha: exactString(
        source.tagObjectSha,
        `${path}.source.tagObjectSha`,
      ),
      commitSha: exactString(source.commitSha, `${path}.source.commitSha`),
      tagSignatureStatus: source.tagSignatureStatus as 'verified' | 'unsigned',
      metadataRole: 'observed-release-metadata-not-image-provenance',
    },
    reports: { spdx, vulnerability, license },
    waivers: {
      vulnerabilities: parseVulnerabilityWaivers(
        waivers.vulnerabilities,
        `${path}.waivers.vulnerabilities`,
      ),
      licenses: parseLicenseWaivers(
        waivers.licenses,
        `${path}.waivers.licenses`,
      ),
    },
  };
}

function parseReportWithTool(
  value: unknown,
  path: string,
  expectedTool: ToolPin['name'],
): FileReference & { tool: ToolPin } {
  const report = record(value, path);
  exactKeys(report, ['path', 'sha256', 'tool'], path);
  return {
    ...parseFileReference(report, path),
    tool: parseToolPin(report.tool, `${path}.tool`, expectedTool),
  };
}

function parseVulnerabilityReference(
  value: unknown,
  path: string,
): ParsedImageEvidence['reports']['vulnerability'] {
  const report = record(value, path);
  exactKeys(report, ['path', 'sha256', 'tool', 'policy', 'database'], path);
  const database = record(report.database, `${path}.database`);
  exactKeys(database, ['builtAt', 'sha256', 'maxAgeHours'], `${path}.database`);
  if (database.maxAgeHours !== 120) {
    fail(`${path}.database.maxAgeHours must remain fail-closed at 120 hours.`);
  }
  const databaseSha = exactString(database.sha256, `${path}.database.sha256`);
  if (!SHA256.test(databaseSha)) {
    fail(`${path}.database.sha256 must be pinned.`);
  }
  return {
    ...parseFileReference(report, path),
    tool: parseToolPin(report.tool, `${path}.tool`, 'grype'),
    policy: parseFileReference(report.policy, `${path}.policy`),
    database: {
      builtAt: exactString(database.builtAt, `${path}.database.builtAt`),
      sha256: databaseSha,
      maxAgeHours: 120,
    },
  };
}

function parseLicenseReference(
  value: unknown,
  path: string,
): ParsedImageEvidence['reports']['license'] {
  const report = record(value, path);
  exactKeys(report, ['path', 'sha256', 'policy'], path);
  return {
    ...parseFileReference(report, path),
    policy: parseFileReference(report.policy, `${path}.policy`),
  };
}

function parseFileReference(value: unknown, path: string): FileReference {
  const file = record(value, path);
  const filePath = exactString(file.path, `${path}.path`);
  const digest = exactString(file.sha256, `${path}.sha256`);
  if (!SHA256.test(digest)) fail(`${path}.sha256 must be pinned.`);
  return { path: filePath, sha256: digest };
}

function parseToolPin(
  value: unknown,
  path: string,
  expectedName: ToolPin['name'],
): ToolPin {
  const tool = record(value, path);
  exactKeys(tool, ['name', 'version', 'platform', 'artifactSha256'], path);
  const name = exactString(tool.name, `${path}.name`);
  const version = exactString(tool.version, `${path}.version`);
  const platform = exactString(tool.platform, `${path}.platform`);
  const artifactSha256 = exactString(
    tool.artifactSha256,
    `${path}.artifactSha256`,
  );
  const expected = CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS[expectedName];
  if (
    name !== expectedName ||
    version !== expected.version ||
    platform !== expected.platform ||
    artifactSha256 !== expected.artifactSha256
  ) {
    fail(
      `${path} is not the exact current Linux amd64 ${expectedName} artifact pin.`,
    );
  }
  return {
    name: expectedName,
    version,
    platform: 'linux-amd64',
    artifactSha256,
  };
}

function parseVulnerabilityWaivers(
  value: unknown,
  path: string,
): VulnerabilityWaiver[] {
  const waivers = boundedArray(value, path, MAX_WAIVERS);
  return waivers.map((candidate, index) => {
    const waiverPath = `${path}[${index}]`;
    const waiver = record(candidate, waiverPath);
    exactKeys(waiver, ['finding', 'owner', 'reason', 'expiresAt'], waiverPath);
    const finding = record(waiver.finding, `${waiverPath}.finding`);
    exactKeys(finding, ['id', 'package', 'version'], `${waiverPath}.finding`);
    const id = boundedString(finding.id, `${waiverPath}.finding.id`, 200);
    const packageName = boundedString(
      finding.package,
      `${waiverPath}.finding.package`,
      300,
    );
    const version = boundedString(
      finding.version,
      `${waiverPath}.finding.version`,
      200,
    );
    assertExactWaiverFinding(
      [id, packageName, version],
      `${waiverPath}.finding`,
    );
    return {
      finding: {
        id,
        package: packageName,
        version,
      },
      owner: boundedString(waiver.owner, `${waiverPath}.owner`, 200),
      reason: boundedString(waiver.reason, `${waiverPath}.reason`, 2_000),
      expiresAt: exactString(waiver.expiresAt, `${waiverPath}.expiresAt`),
    };
  });
}

function parseLicenseWaivers(value: unknown, path: string): LicenseWaiver[] {
  const waivers = boundedArray(value, path, MAX_WAIVERS);
  return waivers.map((candidate, index) => {
    const waiverPath = `${path}[${index}]`;
    const waiver = record(candidate, waiverPath);
    exactKeys(waiver, ['finding', 'owner', 'reason', 'expiresAt'], waiverPath);
    const finding = record(waiver.finding, `${waiverPath}.finding`);
    exactKeys(finding, ['spdxId', 'licenseId'], `${waiverPath}.finding`);
    const spdxId = boundedString(
      finding.spdxId,
      `${waiverPath}.finding.spdxId`,
      200,
    );
    const licenseId = boundedString(
      finding.licenseId,
      `${waiverPath}.finding.licenseId`,
      200,
    );
    assertExactWaiverFinding([spdxId, licenseId], `${waiverPath}.finding`);
    return {
      finding: {
        spdxId,
        licenseId,
      },
      owner: boundedString(waiver.owner, `${waiverPath}.owner`, 200),
      reason: boundedString(waiver.reason, `${waiverPath}.reason`, 2_000),
      expiresAt: exactString(waiver.expiresAt, `${waiverPath}.expiresAt`),
    };
  });
}

function assertImageExpectation(
  image: ParsedImageEvidence,
  expected: MediaOciImageExpectation,
): void {
  if (
    !OCI_DIGEST.test(image.indexDigest) ||
    !OCI_DIGEST.test(image.platform.digest) ||
    image.repository !== expected.repository ||
    image.version !== expected.version ||
    image.registryTag !== expected.registryTag ||
    image.indexDigest !== expected.indexDigest ||
    image.indexMediaType !== expected.indexMediaType ||
    image.platform.digest !== expected.platformDigest ||
    image.platform.runtimeRef !== expected.runtimeRef ||
    image.platform.runtimeRef !== `${image.repository}@${image.platform.digest}`
  ) {
    fail(
      `${image.name} does not match the exact OCI index/runtime expectation.`,
    );
  }
  if (
    !isDeepStrictEqual(image.source, {
      ...expected.source,
      metadataRole: 'observed-release-metadata-not-image-provenance',
    })
  ) {
    fail(`${image.name} source metadata or truth boundary changed.`);
  }
}

function validateImageReports(
  image: ParsedImageEvidence,
  expected: MediaOciImageExpectation,
  reader: EvidenceReader,
  nowMs: number,
): MediaOciReleaseImageEvidenceSummary {
  if (
    image.reports.license.policy.sha256 !==
    CURRENT_MEDIA_OCI_LICENSE_POLICY_SHA256
  ) {
    fail(`${image.name} does not use the exact committed OCI license policy.`);
  }
  const spdx = reader.read(image.reports.spdx, `${image.name} SPDX report`);
  const spdxPackages = validateSpdxReport(spdx.value, image.name);
  const vulnerabilityPolicy = reader.read(
    image.reports.vulnerability.policy,
    `${image.name} vulnerability policy`,
  );
  validateVulnerabilityPolicy(vulnerabilityPolicy.value, image.name);
  const vulnerability = reader.read(
    image.reports.vulnerability,
    `${image.name} vulnerability report`,
  );
  const vulnerabilitySummary = validateVulnerabilityReport(
    vulnerability.value,
    image,
    expected,
    vulnerabilityPolicy,
    nowMs,
  );
  const licensePolicy = reader.read(
    image.reports.license.policy,
    `${image.name} license policy`,
  );
  const parsedLicensePolicy = validateLicensePolicy(
    licensePolicy.value,
    image.name,
  );
  const license = reader.read(
    image.reports.license,
    `${image.name} license report`,
  );
  const licenseSummary = validateLicenseReport(
    license.value,
    image,
    expected,
    licensePolicy,
    parsedLicensePolicy,
    spdxPackages,
    nowMs,
  );
  return {
    name: image.name,
    indexDigest: image.indexDigest,
    platformDigest: image.platform.digest,
    spdxSha256: image.reports.spdx.sha256,
    packageCount: spdxPackages.size,
    vulnerabilityCount: vulnerabilitySummary.count,
    waivedVulnerabilityCount: vulnerabilitySummary.waived,
    licensePackageCount: licenseSummary.packageCount,
    waivedLicenseFindingCount: licenseSummary.waived,
    vulnerabilityDatabaseBuiltAt: image.reports.vulnerability.database.builtAt,
  };
}

function validateSpdxReport(
  value: unknown,
  imageName: string,
): Map<string, { name: string; version: string }> {
  const document = record(value, `${imageName} SPDX report`);
  const version = exactString(
    document.spdxVersion,
    `${imageName} SPDX report.spdxVersion`,
  );
  if (!/^SPDX-2\.\d+$/u.test(version)) {
    fail(`${imageName} SPDX report version is unsupported.`);
  }
  const packages = boundedArray(
    document.packages,
    `${imageName} SPDX report.packages`,
    MAX_ARRAY_ENTRIES,
  );
  if (packages.length === 0) {
    fail(`${imageName} SPDX report must contain at least one package.`);
  }
  const parsed = new Map<string, { name: string; version: string }>();
  for (const [index, candidate] of packages.entries()) {
    const path = `${imageName} SPDX report.packages[${index}]`;
    const pkg = record(candidate, path);
    const spdxId = boundedString(pkg.SPDXID, `${path}.SPDXID`, 200);
    const name = boundedString(pkg.name, `${path}.name`, 500);
    const packageVersion = boundedString(
      pkg.versionInfo,
      `${path}.versionInfo`,
      300,
    );
    if (!/^SPDXRef-[A-Za-z0-9.-]+$/u.test(spdxId) || parsed.has(spdxId)) {
      fail(`${path}.SPDXID must be unique and well formed.`);
    }
    parsed.set(spdxId, { name, version: packageVersion });
  }
  return parsed;
}

function validateVulnerabilityPolicy(value: unknown, imageName: string): void {
  const path = `${imageName} vulnerability policy`;
  const policy = record(value, path);
  exactKeys(policy, ['schemaVersion', 'failOn', 'allowIgnoredMatches'], path);
  if (
    policy.schemaVersion !== 1 ||
    !isDeepStrictEqual(policy.failOn, ['Critical', 'High']) ||
    policy.allowIgnoredMatches !== false
  ) {
    fail(`${path} must fail on Critical/High without scanner-side ignores.`);
  }
}

function validateVulnerabilityReport(
  value: unknown,
  image: ParsedImageEvidence,
  expected: MediaOciImageExpectation,
  policy: LoadedJson,
  nowMs: number,
): { count: number; waived: number } {
  const path = `${image.name} vulnerability report`;
  const report = record(value, path);
  exactKeys(
    report,
    [
      'schemaVersion',
      'scanner',
      'database',
      'subject',
      'matches',
      'ignoredMatches',
    ],
    path,
  );
  if (report.schemaVersion !== 1) fail(`${path}.schemaVersion is unsupported.`);
  assertToolExecution(
    report.scanner,
    `${path}.scanner`,
    image.reports.vulnerability.tool,
  );
  const database = record(report.database, `${path}.database`);
  exactKeys(database, ['builtAt', 'sha256'], `${path}.database`);
  const builtAt = exactString(database.builtAt, `${path}.database.builtAt`);
  const databaseSha = exactString(database.sha256, `${path}.database.sha256`);
  if (
    builtAt !== image.reports.vulnerability.database.builtAt ||
    databaseSha !== image.reports.vulnerability.database.sha256
  ) {
    fail(`${path} does not match its pinned Grype database identity.`);
  }
  const builtAtMs = exactTimestamp(builtAt, `${path}.database.builtAt`);
  if (
    builtAtMs > nowMs + CLOCK_SKEW_MS ||
    nowMs - builtAtMs > GRYPE_DB_MAX_AGE_MS
  ) {
    fail(`${path} uses a future or stale Grype vulnerability database.`);
  }
  const subject = record(report.subject, `${path}.subject`);
  exactKeys(
    subject,
    ['imageDigest', 'sbomSha256', 'policySha256'],
    `${path}.subject`,
  );
  if (
    subject.imageDigest !== expected.platformDigest ||
    subject.sbomSha256 !== image.reports.spdx.sha256 ||
    subject.policySha256 !== sha256(policy.bytes)
  ) {
    fail(`${path} is bound to another image, SBOM, or vulnerability policy.`);
  }
  const ignored = boundedArray(
    report.ignoredMatches,
    `${path}.ignoredMatches`,
    MAX_ARRAY_ENTRIES,
  );
  if (ignored.length > 0) {
    fail(`${path} must not hide findings through Grype ignore rules.`);
  }
  const matches = boundedArray(
    report.matches,
    `${path}.matches`,
    MAX_ARRAY_ENTRIES,
  );
  const waivers = new Map<string, VulnerabilityWaiver>();
  for (const waiver of image.waivers.vulnerabilities) {
    assertActiveWaiver(waiver, nowMs, `${image.name} vulnerability waiver`);
    const key = vulnerabilityFindingKey(waiver.finding);
    if (waivers.has(key))
      fail(`${image.name} has duplicate vulnerability waivers.`);
    waivers.set(key, waiver);
  }
  const used = new Set<string>();
  let waived = 0;
  for (const [index, candidate] of matches.entries()) {
    const matchPath = `${path}.matches[${index}]`;
    const match = record(candidate, matchPath);
    exactKeys(match, ['id', 'severity', 'artifact'], matchPath);
    const id = boundedString(match.id, `${matchPath}.id`, 200);
    const severity = exactString(match.severity, `${matchPath}.severity`);
    if (
      !['Unknown', 'Negligible', 'Low', 'Medium', 'High', 'Critical'].includes(
        severity,
      )
    ) {
      fail(`${matchPath}.severity is unsupported.`);
    }
    const artifact = record(match.artifact, `${matchPath}.artifact`);
    exactKeys(artifact, ['name', 'version', 'type'], `${matchPath}.artifact`);
    const finding = {
      id,
      package: boundedString(artifact.name, `${matchPath}.artifact.name`, 300),
      version: boundedString(
        artifact.version,
        `${matchPath}.artifact.version`,
        200,
      ),
    };
    boundedString(artifact.type, `${matchPath}.artifact.type`, 100);
    if (severity === 'High' || severity === 'Critical') {
      const key = vulnerabilityFindingKey(finding);
      if (!waivers.has(key)) {
        fail(`${image.name} has an unwaived ${severity} vulnerability: ${id}.`);
      }
      used.add(key);
      waived += 1;
    }
  }
  if (used.size !== waivers.size) {
    fail(`${image.name} contains stale or non-matching vulnerability waivers.`);
  }
  return { count: matches.length, waived };
}

interface ParsedLicensePolicy {
  knownIds: Set<string>;
  denied: Set<string>;
}

function validateLicensePolicy(
  value: unknown,
  imageName: string,
): ParsedLicensePolicy {
  const path = `${imageName} license policy`;
  const policy = record(value, path);
  exactKeys(
    policy,
    [
      'schemaVersion',
      'spdxListVersion',
      'spdxListSha256',
      'knownIds',
      'denied',
      'requireKnown',
      'requireLicense',
    ],
    path,
  );
  const spdxListVersion = exactString(
    policy.spdxListVersion,
    `${path}.spdxListVersion`,
  );
  const spdxListSha = exactString(
    policy.spdxListSha256,
    `${path}.spdxListSha256`,
  );
  if (
    policy.schemaVersion !== 1 ||
    !EXACT_VERSION.test(spdxListVersion) ||
    !SHA256.test(spdxListSha) ||
    policy.requireKnown !== true ||
    policy.requireLicense !== true
  ) {
    fail(`${path} is not a pinned fail-closed SPDX license policy.`);
  }
  const knownIds = licenseIdSet(policy.knownIds, `${path}.knownIds`, false);
  const denied = licenseIdSet(policy.denied, `${path}.denied`, true);
  if (knownIds.size === 0) fail(`${path}.knownIds must not be empty.`);
  for (const id of denied) {
    if (!knownIds.has(id))
      fail(`${path} contains a non-SPDX license ID: ${id}.`);
  }
  return { knownIds, denied };
}

function validateLicenseReport(
  value: unknown,
  image: ParsedImageEvidence,
  expected: MediaOciImageExpectation,
  policyFile: LoadedJson,
  policy: ParsedLicensePolicy,
  spdxPackages: Map<string, { name: string; version: string }>,
  nowMs: number,
): { packageCount: number; waived: number } {
  const path = `${image.name} license report`;
  const report = record(value, path);
  exactKeys(report, ['schemaVersion', 'subject', 'packages'], path);
  if (report.schemaVersion !== 1) fail(`${path}.schemaVersion is unsupported.`);
  const subject = record(report.subject, `${path}.subject`);
  exactKeys(
    subject,
    ['imageDigest', 'sbomSha256', 'policySha256'],
    `${path}.subject`,
  );
  if (
    subject.imageDigest !== expected.platformDigest ||
    subject.sbomSha256 !== image.reports.spdx.sha256 ||
    subject.policySha256 !== sha256(policyFile.bytes)
  ) {
    fail(`${path} is bound to another image, SBOM, or license policy.`);
  }
  const packages = boundedArray(
    report.packages,
    `${path}.packages`,
    MAX_ARRAY_ENTRIES,
  );
  if (packages.length === 0) fail(`${path}.packages must not be empty.`);
  const waivers = new Map<string, LicenseWaiver>();
  for (const waiver of image.waivers.licenses) {
    assertActiveWaiver(waiver, nowMs, `${image.name} license waiver`);
    const key = licenseFindingKey(waiver.finding);
    if (waivers.has(key)) fail(`${image.name} has duplicate license waivers.`);
    waivers.set(key, waiver);
  }
  const usedWaivers = new Set<string>();
  const observedPackages = new Set<string>();
  let waived = 0;
  for (const [index, candidate] of packages.entries()) {
    const packagePath = `${path}.packages[${index}]`;
    const pkg = record(candidate, packagePath);
    exactKeys(pkg, ['spdxId', 'name', 'version', 'licenses'], packagePath);
    const spdxId = boundedString(pkg.spdxId, `${packagePath}.spdxId`, 200);
    const expectedPackage = spdxPackages.get(spdxId);
    if (!expectedPackage || observedPackages.has(spdxId)) {
      fail(
        `${packagePath} is missing from SPDX or duplicates an SPDX package.`,
      );
    }
    const name = boundedString(pkg.name, `${packagePath}.name`, 500);
    const packageVersion = boundedString(
      pkg.version,
      `${packagePath}.version`,
      300,
    );
    if (
      name !== expectedPackage.name ||
      packageVersion !== expectedPackage.version
    ) {
      fail(`${packagePath} does not match the exact SPDX package identity.`);
    }
    observedPackages.add(spdxId);
    const licenses = boundedArray(
      pkg.licenses,
      `${packagePath}.licenses`,
      200,
    ).map((license, licenseIndex) =>
      boundedString(license, `${packagePath}.licenses[${licenseIndex}]`, 200),
    );
    const evaluated = licenses.length === 0 ? ['NOASSERTION'] : licenses;
    for (const licenseId of new Set(evaluated)) {
      const known = policy.knownIds.has(licenseId);
      const denied = policy.denied.has(licenseId);
      if (!known || denied) {
        const key = licenseFindingKey({ spdxId, licenseId });
        if (!waivers.has(key)) {
          const category = !known ? 'unknown' : 'denied';
          fail(
            `${image.name} has an unwaived ${category} license: ${licenseId}.`,
          );
        }
        usedWaivers.add(key);
        waived += 1;
      }
    }
  }
  if (observedPackages.size !== spdxPackages.size) {
    fail(`${path} does not cover every SPDX package.`);
  }
  if (usedWaivers.size !== waivers.size) {
    fail(`${image.name} contains stale or non-matching license waivers.`);
  }
  return { packageCount: packages.length, waived };
}

function assertToolExecution(
  value: unknown,
  path: string,
  expected: ToolPin,
): void {
  const scanner = record(value, path);
  exactKeys(
    scanner,
    ['name', 'version', 'platform', 'artifactSha256', 'status'],
    path,
  );
  if (
    scanner.name !== expected.name ||
    scanner.version !== expected.version ||
    scanner.platform !== expected.platform ||
    scanner.artifactSha256 !== expected.artifactSha256 ||
    scanner.status !== 'completed'
  ) {
    fail(`${path} is not a successful execution of the pinned tool.`);
  }
}

function assertActiveWaiver(
  waiver: { owner: string; reason: string; expiresAt: string },
  nowMs: number,
  path: string,
): void {
  if (waiver.owner.includes('*') || waiver.reason.trim().length === 0) {
    fail(`${path} must have an exact owner and non-empty reason.`);
  }
  const expiry = exactTimestamp(waiver.expiresAt, `${path}.expiresAt`);
  if (expiry <= nowMs) fail(`${path} is expired.`);
}

function assertExactWaiverFinding(
  values: readonly string[],
  path: string,
): void {
  if (values.some((value) => value.includes('*'))) {
    fail(`${path} must bind one exact finding without wildcards.`);
  }
}

function assertExpectedImagesExact(images: MediaOciImageExpectations): void {
  if (!isDeepStrictEqual(images, CURRENT_MEDIA_OCI_IMAGE_EXPECTATIONS)) {
    fail('Caller supplied stale or non-current OCI image expectations.');
  }
}

function assertBindingExpectation(
  expectation: MediaOciReleaseEvidenceExpectation,
): void {
  if (
    !GIT_SHA.test(expectation.commit) ||
    !GIT_SHA.test(expectation.treeSha) ||
    !SHA256.test(expectation.releaseContentDigest)
  ) {
    fail('Caller supplied malformed release binding expectations.');
  }
  if (
    expectation.trustedIssuer !== TRUSTED_ISSUER ||
    !TRUSTED_IDENTITY.test(expectation.trustedIdentity)
  ) {
    fail('Caller supplied a broad or unsupported trust identity.');
  }
}

function parseVerifiedBytes(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    unavailable('Trust-verified OCI release manifest is absent.');
  }
  if (bytes.byteLength > MAX_MANIFEST_BYTES) {
    fail('Trust-verified OCI release manifest exceeds 1 MiB.');
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    fail('Trust-verified OCI release manifest is not valid JSON.');
  }
}

function tagFromIdentity(identity: string): string {
  const marker = '@refs/tags/';
  const index = identity.lastIndexOf(marker);
  if (index < 0) fail('Trusted identity is not bound to a release tag.');
  const tag = identity.slice(index + marker.length);
  if (!RELEASE_TAG.test(tag))
    fail('Trusted identity release tag is malformed.');
  return tag;
}

function safeReportPath(value: string, path: string): string {
  const candidate = exactString(value, path);
  if (
    candidate.length > 240 ||
    isAbsolute(candidate) ||
    candidate.includes('\\') ||
    candidate.includes('\0') ||
    candidate.includes('//') ||
    !candidate.endsWith('.json')
  ) {
    fail(`${path} must be a safe relative JSON path.`);
  }
  const components = candidate.split('/');
  if (
    components.some(
      (component) =>
        component === '' ||
        component === '.' ||
        component === '..' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(component),
    )
  ) {
    fail(`${path} must be a safe relative JSON path.`);
  }
  return candidate;
}

function strictDescendant(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot !== '' &&
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

function licenseIdSet(
  value: unknown,
  path: string,
  allowEmpty: boolean,
): Set<string> {
  const values = boundedArray(value, path, 10_000).map((candidate, index) => {
    const id = exactString(candidate, `${path}[${index}]`);
    if (
      !SPDX_ID.test(id) ||
      id === 'NONE' ||
      id === 'NOASSERTION' ||
      id.startsWith('LicenseRef-') ||
      id.startsWith('DocumentRef-')
    ) {
      fail(`${path}[${index}] is not a normalized SPDX ID.`);
    }
    return id;
  });
  const result = new Set(values);
  if (result.size !== values.length) fail(`${path} contains duplicate IDs.`);
  if (!allowEmpty && result.size === 0) fail(`${path} must not be empty.`);
  return result;
}

function vulnerabilityFindingKey(finding: {
  id: string;
  package: string;
  version: string;
}): string {
  return `${finding.id}\0${finding.package}\0${finding.version}`;
}

function licenseFindingKey(finding: {
  spdxId: string;
  licenseId: string;
}): string {
  return `${finding.spdxId}\0${finding.licenseId}`;
}

function exactTimestamp(value: string, path: string): number {
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(`${path} must be an exact UTC ISO-8601 timestamp.`);
  }
  return milliseconds;
}

function normalizeNow(value: Date | number): number {
  const milliseconds = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    fail('OCI release evidence expectation has an invalid current time.');
  }
  return milliseconds;
}

function assertSha256(
  bytes: Uint8Array,
  expected: string,
  label: string,
): void {
  if (sha256(bytes) !== expected) fail(`${label} bytes changed after signing.`);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!isDeepStrictEqual(actual, wanted)) {
    fail(`${path} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactString(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    fail(`${path} must be a non-empty exact string.`);
  }
  return value;
}

function boundedString(value: unknown, path: string, maximum: number): string {
  const result = exactString(value, path);
  if (result.length > maximum || result.includes('\0')) {
    fail(`${path} exceeds its bounded string contract.`);
  }
  return result;
}

function boundedArray(
  value: unknown,
  path: string,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(`${path} must be an array with at most ${maximum} entries.`);
  }
  return value;
}

function fail(message: string): never {
  throw new MediaOciReleaseEvidenceError(message, 'FAIL_INTERNAL');
}

function unavailable(message: string): never {
  throw new MediaOciReleaseEvidenceError(message, 'BLOCKED_EXTERNAL');
}
