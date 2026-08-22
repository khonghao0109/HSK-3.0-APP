import {
  readStableBoundedFileWithinRoot,
  sha256,
} from './media-operations-validation.helpers';
import type { VerifiedMediaProductionPrerequisiteEvidence } from './media-production-prerequisites';

export class MediaLiveProductionEvidenceError extends Error {}

export const LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS = [
  'media-live-s3-provider',
  'media-live-clamav',
  'media-deployed-proxy-mesh-policy',
  'media-production-alert-delivery',
  'media-backend-replica-discovery',
  'media-secret-manager-workload-identity',
] as const;

export type LiveMediaProductionPrerequisiteId =
  (typeof LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS)[number];

export const LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY = {
  'media-live-s3-provider': {
    evidenceType: 'signed-s3-provider-rehearsal',
    requiredCheckIds: [
      'private-access-policy',
      'tls-transport',
      'encryption-at-rest',
      'versioning-lifecycle',
      'put-head-get-delete',
      'checksum-byte-readback',
      'oversize-stream-rejected',
      'denied-missing-timeout-reset',
      'unknown-put-settled',
    ],
  },
  'media-live-clamav': {
    evidenceType: 'signed-clamav-rehearsal',
    requiredCheckIds: [
      'engine-database-version',
      'clean-formats-accepted',
      'eicar-found',
      'transport-failures-rejected',
      'malformed-oversized-rejected',
      'concurrent-scan-backpressure',
    ],
  },
  'media-deployed-proxy-mesh-policy': {
    evidenceType: 'signed-deployed-security-policy-rehearsal',
    requiredCheckIds: [
      'nginx-policy-deployed',
      'private-no-store-enforced',
      'query-signature-redaction',
      'strict-mtls-enforced',
      'network-policy-deny-by-default',
      'authorized-workload-allowed',
    ],
  },
  'media-production-alert-delivery': {
    evidenceType: 'signed-alert-firing-routing-resolution-rehearsal',
    requiredCheckIds: [
      'production-alert-fired',
      'owner-route-matched',
      'firing-notification-delivered',
      'resolved-notification-delivered',
      'escalation-path-verified',
    ],
  },
  'media-backend-replica-discovery': {
    evidenceType: 'signed-runtime-replica-discovery-rehearsal',
    requiredCheckIds: [
      'minimum-two-ready-replicas',
      'headless-service-discovery',
      'distinct-pod-targets',
      'each-replica-metrics-scrape',
      'replacement-reconverged',
    ],
  },
  'media-secret-manager-workload-identity': {
    evidenceType: 'signed-secret-manager-workload-identity-rehearsal',
    requiredCheckIds: [
      'workload-identity-authenticated',
      'static-credential-absent',
      'secret-manager-read-authorized',
      'short-lived-token',
      'rotation-overlap-rehearsed',
      'provider-audit-event-retained',
    ],
  },
} as const satisfies Record<
  LiveMediaProductionPrerequisiteId,
  { evidenceType: string; requiredCheckIds: readonly string[] }
>;

export const MEDIA_LIVE_PRODUCTION_EVIDENCE_MAX_MANIFEST_BYTES = 1024 * 1024;
export const MEDIA_LIVE_PRODUCTION_EVIDENCE_MAX_ARTIFACT_BYTES = 256 * 1024;

const SHA1 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const OCI_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const STABLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const MANIFEST_ID = 'hsk-media-live-production-evidence-v1';
const MAX_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 60_000;

export interface MediaLiveProductionReleaseBinding {
  gitCommit: string;
  gitTreeSha: string;
  releaseContentDigest: string;
}

export interface MediaLiveProductionEvidenceProducer {
  issuer: string;
  identity: string;
}

export interface MediaLiveProductionEnvironmentBinding {
  clusterIdentitySha256: string;
  namespaceIdentitySha256: string;
  deploymentRevision: string;
  fingerprintSha256: string;
}

export interface VerifiedMediaLiveProductionEvidenceArtifact {
  relativePath: string;
  bytes: Buffer;
  commandProvenanceSha256: string;
  sanitizedLogSha256: string;
  checkEvidenceSha256: Readonly<Record<string, string>>;
  verification: VerifiedMediaProductionPrerequisiteEvidence;
}

export interface VerifiedMediaLiveProductionEvidence {
  manifestSha256: string;
  producer: MediaLiveProductionEvidenceProducer;
  binding: MediaLiveProductionReleaseBinding;
  environment: MediaLiveProductionEnvironmentBinding;
  observedAt: string;
  expiresAt: string;
  artifacts: VerifiedMediaLiveProductionEvidenceArtifact[];
}

export interface ParseVerifiedMediaLiveProductionEvidenceOptions {
  nowMs?: number;
  expectedBinding: MediaLiveProductionReleaseBinding;
  trustedProducer: MediaLiveProductionEvidenceProducer;
  verifiedSignature: MediaLiveProductionEvidenceProducer & {
    payloadSha256: string;
  };
}

/**
 * Computes the environment fingerprint committed by the signed manifest.
 * The NUL-separated domain prefix and field order are part of the V1 contract.
 */
export function computeMediaLiveEnvironmentFingerprint(value: {
  clusterIdentitySha256: string;
  namespaceIdentitySha256: string;
  deploymentRevision: string;
}): string {
  if (
    !SHA256.test(value.clusterIdentitySha256) ||
    !SHA256.test(value.namespaceIdentitySha256) ||
    !OCI_DIGEST.test(value.deploymentRevision)
  ) {
    throw new MediaLiveProductionEvidenceError(
      'Live evidence environment identity is invalid.',
    );
  }
  return sha256(
    Buffer.from(
      [
        'hsk-media-live-environment-v1',
        value.clusterIdentitySha256,
        value.namespaceIdentitySha256,
        value.deploymentRevision,
      ].join('\0'),
      'utf8',
    ),
  );
}

/**
 * Parses a live-rehearsal manifest only after the caller has detached-signature
 * verified these exact bytes. Each semantic result is read from a separately
 * hash-bound, bounded raw JSON artifact; a signed inventory assertion alone is
 * never upgraded to a specialized PASS record.
 */
export function parseVerifiedMediaLiveProductionEvidence(
  manifestBytes: Buffer,
  evidenceRoot: string,
  options: ParseVerifiedMediaLiveProductionEvidenceOptions,
): VerifiedMediaLiveProductionEvidence {
  assertMediaLiveProductionEvidencePolicy();
  if (
    !Buffer.isBuffer(manifestBytes) ||
    manifestBytes.length === 0 ||
    manifestBytes.length > MEDIA_LIVE_PRODUCTION_EVIDENCE_MAX_MANIFEST_BYTES
  ) {
    throw new MediaLiveProductionEvidenceError(
      'Signed live evidence manifest is empty or oversized.',
    );
  }
  const manifestSha256 = sha256(manifestBytes);
  if (
    !SHA256.test(options.verifiedSignature.payloadSha256) ||
    manifestSha256 !== options.verifiedSignature.payloadSha256
  ) {
    throw new MediaLiveProductionEvidenceError(
      'Signed live evidence manifest digest does not match verification.',
    );
  }

  const trustedProducer = parseProducer(
    options.trustedProducer,
    'trusted live evidence producer',
  );
  const verifiedProducer = parseProducer(
    {
      issuer: options.verifiedSignature.issuer,
      identity: options.verifiedSignature.identity,
    },
    'verified live evidence signature',
  );
  assertSameProducer(verifiedProducer, trustedProducer, 'trusted producer');

  const root = parseJsonObject(manifestBytes, 'signed live evidence manifest');
  exactKeys(
    root,
    [
      'schemaVersion',
      'manifestId',
      'producer',
      'binding',
      'environment',
      'observedAt',
      'expiresAt',
      'artifacts',
    ],
    'signed live evidence manifest',
  );
  if (root.schemaVersion !== 1 || root.manifestId !== MANIFEST_ID) {
    throw new MediaLiveProductionEvidenceError(
      'Signed live evidence manifest identity is invalid.',
    );
  }
  const producer = parseProducer(root.producer, 'manifest.producer');
  assertSameProducer(producer, trustedProducer, 'trusted producer');
  const binding = parseReleaseBinding(root.binding, 'manifest.binding');
  assertSameBinding(binding, options.expectedBinding, 'exact release');
  const environment = parseEnvironmentBinding(
    root.environment,
    'manifest.environment',
  );
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error('Live evidence validation time is invalid.');
  }
  const observedAt = requiredString(root.observedAt, 'manifest.observedAt');
  const expiresAt = requiredString(root.expiresAt, 'manifest.expiresAt');
  assertFreshness(observedAt, expiresAt, nowMs);

  if (
    !Array.isArray(root.artifacts) ||
    root.artifacts.length !== LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS.length
  ) {
    throw new MediaLiveProductionEvidenceError(
      'Live evidence manifest must contain exactly six artifacts.',
    );
  }
  const references = root.artifacts.map((entry, index) =>
    parseArtifactReference(entry, index),
  );
  assertCompleteArtifactRegistry(references);

  const evidenceUris = new Set<string>();
  const artifacts = references.map((reference) => {
    let bytes: Buffer;
    try {
      bytes = readStableBoundedFileWithinRoot(
        evidenceRoot,
        reference.relativePath,
        MEDIA_LIVE_PRODUCTION_EVIDENCE_MAX_ARTIFACT_BYTES,
        `Live evidence artifact ${reference.prerequisiteId}`,
      );
    } catch (error: unknown) {
      throw new MediaLiveProductionEvidenceError(
        `Live evidence artifact ${reference.prerequisiteId} is absent or unsafe: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    if (bytes.length === 0 || sha256(bytes) !== reference.sha256) {
      throw new MediaLiveProductionEvidenceError(
        `${reference.prerequisiteId} live evidence artifact digest does not match.`,
      );
    }
    const raw = parseLiveArtifact(bytes, reference, {
      producer,
      binding,
      environment,
      observedAt,
      expiresAt,
    });
    const evidenceUriKey = new URL(raw.evidenceUri).toString();
    if (evidenceUris.has(evidenceUriKey)) {
      throw new MediaLiveProductionEvidenceError(
        'Live evidence artifacts require a distinct evidence URI.',
      );
    }
    evidenceUris.add(evidenceUriKey);
    return {
      relativePath: reference.relativePath,
      bytes,
      commandProvenanceSha256: raw.commandProvenanceSha256,
      sanitizedLogSha256: raw.sanitizedLogSha256,
      checkEvidenceSha256: raw.checkEvidenceSha256,
      verification: {
        prerequisiteId: reference.prerequisiteId,
        evidenceType: reference.evidenceType,
        evidenceUri: raw.evidenceUri,
        evidenceSha256: reference.sha256,
        producerIssuer: producer.issuer,
        producerIdentity: producer.identity,
        binding: { ...binding },
      },
    } satisfies VerifiedMediaLiveProductionEvidenceArtifact;
  });

  return {
    manifestSha256,
    producer,
    binding,
    environment,
    observedAt,
    expiresAt,
    artifacts,
  };
}

interface ArtifactReference {
  prerequisiteId: LiveMediaProductionPrerequisiteId;
  evidenceType: string;
  relativePath: string;
  sha256: string;
}

function parseArtifactReference(
  input: unknown,
  index: number,
): ArtifactReference {
  const path = `manifest.artifacts[${String(index)}]`;
  const value = record(input, path);
  exactKeys(
    value,
    ['prerequisiteId', 'evidenceType', 'relativePath', 'sha256'],
    path,
  );
  const prerequisiteId = requiredString(
    value.prerequisiteId,
    `${path}.prerequisiteId`,
  );
  if (!isLivePrerequisiteId(prerequisiteId)) {
    throw new MediaLiveProductionEvidenceError(
      `${path} has an unsupported live prerequisite ID.`,
    );
  }
  const policy = LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY[prerequisiteId];
  const evidenceType = requiredString(
    value.evidenceType,
    `${path}.evidenceType`,
  );
  if (evidenceType !== policy.evidenceType) {
    throw new MediaLiveProductionEvidenceError(
      `${prerequisiteId} has the wrong live evidence type.`,
    );
  }
  const relativePath = requiredString(
    value.relativePath,
    `${path}.relativePath`,
  );
  assertSafeRelativeJsonPath(relativePath, `${path}.relativePath`);
  const artifactSha256 = requiredString(value.sha256, `${path}.sha256`);
  if (!SHA256.test(artifactSha256)) {
    throw new MediaLiveProductionEvidenceError(`${path}.sha256 is invalid.`);
  }
  return {
    prerequisiteId,
    evidenceType,
    relativePath,
    sha256: artifactSha256,
  };
}

function assertCompleteArtifactRegistry(
  references: readonly ArtifactReference[],
): void {
  const identifiers = new Set<string>();
  const paths = new Set<string>();
  const digests = new Set<string>();
  for (const reference of references) {
    if (identifiers.has(reference.prerequisiteId)) {
      throw new MediaLiveProductionEvidenceError(
        `Live evidence manifest has a duplicate prerequisite: ${reference.prerequisiteId}.`,
      );
    }
    if (paths.has(reference.relativePath)) {
      throw new MediaLiveProductionEvidenceError(
        'Live evidence artifacts require distinct relative paths.',
      );
    }
    if (digests.has(reference.sha256)) {
      throw new MediaLiveProductionEvidenceError(
        'Live evidence artifacts require distinct raw digests.',
      );
    }
    identifiers.add(reference.prerequisiteId);
    paths.add(reference.relativePath);
    digests.add(reference.sha256);
  }
  const missing = LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS.filter(
    (id) => !identifiers.has(id),
  );
  if (missing.length > 0) {
    throw new MediaLiveProductionEvidenceError(
      `Live evidence registry is incomplete: ${missing.join(', ')}.`,
    );
  }
}

function parseLiveArtifact(
  bytes: Buffer,
  reference: ArtifactReference,
  expected: {
    producer: MediaLiveProductionEvidenceProducer;
    binding: MediaLiveProductionReleaseBinding;
    environment: MediaLiveProductionEnvironmentBinding;
    observedAt: string;
    expiresAt: string;
  },
): {
  evidenceUri: string;
  commandProvenanceSha256: string;
  sanitizedLogSha256: string;
  checkEvidenceSha256: Readonly<Record<string, string>>;
} {
  const path = `artifact.${reference.prerequisiteId}`;
  const value = parseJsonObject(bytes, path);
  exactKeys(
    value,
    [
      'schemaVersion',
      'prerequisiteId',
      'evidenceType',
      'status',
      'evidenceUri',
      'producer',
      'binding',
      'environment',
      'freshness',
      'commandProvenanceSha256',
      'sanitizedLogSha256',
      'checks',
    ],
    path,
  );
  if (
    value.schemaVersion !== 1 ||
    value.prerequisiteId !== reference.prerequisiteId ||
    value.evidenceType !== reference.evidenceType ||
    value.status !== 'PASS'
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${reference.prerequisiteId} raw live evidence identity or PASS status is invalid.`,
    );
  }
  const evidenceUri = assertCredentialFreeProductionHttps(
    requiredString(value.evidenceUri, `${path}.evidenceUri`),
    `${path}.evidenceUri`,
  );
  const producer = parseProducer(value.producer, `${path}.producer`);
  assertSameProducer(producer, expected.producer, 'manifest producer');
  const binding = parseReleaseBinding(value.binding, `${path}.binding`);
  assertSameBinding(binding, expected.binding, 'manifest release binding');
  const environment = parseEnvironmentBinding(
    value.environment,
    `${path}.environment`,
  );
  assertSameEnvironment(environment, expected.environment);

  const freshness = record(value.freshness, `${path}.freshness`);
  exactKeys(freshness, ['observedAt', 'expiresAt'], `${path}.freshness`);
  if (
    freshness.observedAt !== expected.observedAt ||
    freshness.expiresAt !== expected.expiresAt
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${reference.prerequisiteId} freshness does not match the signed manifest.`,
    );
  }

  const commandProvenanceSha256 = requiredSha256(
    value.commandProvenanceSha256,
    `${path}.commandProvenanceSha256`,
  );
  const sanitizedLogSha256 = requiredSha256(
    value.sanitizedLogSha256,
    `${path}.sanitizedLogSha256`,
  );
  if (!Array.isArray(value.checks)) {
    throw new MediaLiveProductionEvidenceError(
      `${path}.checks must be an array.`,
    );
  }
  const checkEvidenceSha256 = parseSemanticChecks(
    value.checks,
    reference.prerequisiteId,
  );
  return {
    evidenceUri,
    commandProvenanceSha256,
    sanitizedLogSha256,
    checkEvidenceSha256,
  };
}

function parseSemanticChecks(
  input: readonly unknown[],
  prerequisiteId: LiveMediaProductionPrerequisiteId,
): Readonly<Record<string, string>> {
  const required = LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY[prerequisiteId]
    .requiredCheckIds as readonly string[];
  if (input.length !== required.length) {
    throw new MediaLiveProductionEvidenceError(
      `${prerequisiteId} must contain every exact semantic check.`,
    );
  }
  const allowed = new Set<string>(required);
  const evidence: Record<string, string> = {};
  for (const [index, entry] of input.entries()) {
    const path = `${prerequisiteId}.checks[${String(index)}]`;
    const check = record(entry, path);
    exactKeys(check, ['id', 'status', 'evidenceSha256'], path);
    const id = requiredString(check.id, `${path}.id`);
    if (!allowed.has(id)) {
      throw new MediaLiveProductionEvidenceError(
        `${prerequisiteId} has an unsupported semantic check: ${id}.`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(evidence, id)) {
      throw new MediaLiveProductionEvidenceError(
        `${prerequisiteId} has a duplicate semantic check: ${id}.`,
      );
    }
    if (check.status !== 'PASS') {
      throw new MediaLiveProductionEvidenceError(
        `${prerequisiteId} semantic check must be PASS: ${id}.`,
      );
    }
    evidence[id] = requiredSha256(
      check.evidenceSha256,
      `${path}.evidenceSha256`,
    );
  }
  const missing = required.filter(
    (id) => !Object.prototype.hasOwnProperty.call(evidence, id),
  );
  if (missing.length > 0) {
    throw new MediaLiveProductionEvidenceError(
      `${prerequisiteId} is missing semantic checks: ${missing.join(', ')}.`,
    );
  }
  return evidence;
}

export function assertMediaLiveProductionEvidencePolicy(): void {
  const policyIds = Object.keys(LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY);
  if (
    policyIds.length !== LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS.length ||
    policyIds.some(
      (id, index) => id !== LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS[index],
    )
  ) {
    throw new Error('Live evidence policy registry is incomplete.');
  }
  for (const id of LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS) {
    const policy = LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY[id];
    if (
      !STABLE_ID.test(policy.evidenceType) ||
      new Set(policy.requiredCheckIds).size !==
        policy.requiredCheckIds.length ||
      policy.requiredCheckIds.some((checkId) => !STABLE_ID.test(checkId))
    ) {
      throw new Error(`Live evidence policy is invalid for ${id}.`);
    }
  }
}

function parseProducer(
  input: unknown,
  path: string,
): MediaLiveProductionEvidenceProducer {
  const value = record(input, path);
  exactKeys(value, ['issuer', 'identity'], path);
  const issuer = assertCredentialFreeProductionHttps(
    requiredString(value.issuer, `${path}.issuer`),
    `${path}.issuer`,
  );
  const identity = requiredString(value.identity, `${path}.identity`);
  assertExactProducerIdentity(identity, `${path}.identity`);
  return { issuer, identity };
}

function parseReleaseBinding(
  input: unknown,
  path: string,
): MediaLiveProductionReleaseBinding {
  const value = record(input, path);
  exactKeys(value, ['gitCommit', 'gitTreeSha', 'releaseContentDigest'], path);
  const gitCommit = requiredString(value.gitCommit, `${path}.gitCommit`);
  const gitTreeSha = requiredString(value.gitTreeSha, `${path}.gitTreeSha`);
  const releaseContentDigest = requiredString(
    value.releaseContentDigest,
    `${path}.releaseContentDigest`,
  );
  if (
    !SHA1.test(gitCommit) ||
    !SHA1.test(gitTreeSha) ||
    !SHA256.test(releaseContentDigest)
  ) {
    throw new MediaLiveProductionEvidenceError(`${path} is invalid.`);
  }
  return { gitCommit, gitTreeSha, releaseContentDigest };
}

function parseEnvironmentBinding(
  input: unknown,
  path: string,
): MediaLiveProductionEnvironmentBinding {
  const value = record(input, path);
  exactKeys(
    value,
    [
      'clusterIdentitySha256',
      'namespaceIdentitySha256',
      'deploymentRevision',
      'fingerprintSha256',
    ],
    path,
  );
  const environment = {
    clusterIdentitySha256: requiredSha256(
      value.clusterIdentitySha256,
      `${path}.clusterIdentitySha256`,
    ),
    namespaceIdentitySha256: requiredSha256(
      value.namespaceIdentitySha256,
      `${path}.namespaceIdentitySha256`,
    ),
    deploymentRevision: requiredString(
      value.deploymentRevision,
      `${path}.deploymentRevision`,
    ),
    fingerprintSha256: requiredSha256(
      value.fingerprintSha256,
      `${path}.fingerprintSha256`,
    ),
  };
  if (!OCI_DIGEST.test(environment.deploymentRevision)) {
    throw new MediaLiveProductionEvidenceError(
      `${path}.deploymentRevision must be an exact SHA-256 digest.`,
    );
  }
  if (
    computeMediaLiveEnvironmentFingerprint(environment) !==
    environment.fingerprintSha256
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${path} has a forged environment fingerprint.`,
    );
  }
  return environment;
}

function assertFreshness(
  observedAt: string,
  expiresAt: string,
  nowMs: number,
): void {
  const observed = canonicalTimestamp(observedAt, 'manifest.observedAt');
  const expires = canonicalTimestamp(expiresAt, 'manifest.expiresAt');
  if (
    observed > nowMs + FUTURE_TOLERANCE_MS ||
    expires <= nowMs ||
    expires <= observed ||
    expires - observed > MAX_FRESHNESS_MS ||
    nowMs - observed > MAX_FRESHNESS_MS
  ) {
    throw new MediaLiveProductionEvidenceError(
      'Live evidence is stale or has invalid freshness.',
    );
  }
}

function assertSameProducer(
  actual: MediaLiveProductionEvidenceProducer,
  expected: MediaLiveProductionEvidenceProducer,
  label: string,
): void {
  if (
    actual.issuer !== expected.issuer ||
    actual.identity !== expected.identity
  ) {
    throw new MediaLiveProductionEvidenceError(
      `Live evidence does not match the exact ${label}.`,
    );
  }
}

function assertSameBinding(
  actual: MediaLiveProductionReleaseBinding,
  expected: MediaLiveProductionReleaseBinding,
  label: string,
): void {
  if (
    actual.gitCommit !== expected.gitCommit ||
    actual.gitTreeSha !== expected.gitTreeSha ||
    actual.releaseContentDigest !== expected.releaseContentDigest
  ) {
    throw new MediaLiveProductionEvidenceError(
      `Live evidence does not match the ${label}.`,
    );
  }
}

function assertSameEnvironment(
  actual: MediaLiveProductionEnvironmentBinding,
  expected: MediaLiveProductionEnvironmentBinding,
): void {
  if (
    actual.clusterIdentitySha256 !== expected.clusterIdentitySha256 ||
    actual.namespaceIdentitySha256 !== expected.namespaceIdentitySha256 ||
    actual.deploymentRevision !== expected.deploymentRevision ||
    actual.fingerprintSha256 !== expected.fingerprintSha256
  ) {
    throw new MediaLiveProductionEvidenceError(
      'Raw live evidence does not match the signed environment.',
    );
  }
}

function assertSafeRelativeJsonPath(value: string, path: string): void {
  const components = value.split('/');
  if (
    value.length > 512 ||
    value.startsWith('/') ||
    !value.endsWith('.json') ||
    components.some(
      (component) =>
        component === '' ||
        component === '.' ||
        component === '..' ||
        !/^[a-z0-9][a-z0-9._-]*$/u.test(component),
    )
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be a safe relative JSON path under the evidence root.`,
    );
  }
}

function assertCredentialFreeProductionHttps(
  value: string,
  path: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be credential-free production HTTPS.`,
    );
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname.endsWith('.invalid') ||
    ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be credential-free production HTTPS.`,
    );
  }
  return value;
}

function assertExactProducerIdentity(value: string, path: string): void {
  if (/[^\S\r\n]|[\r\n*^$()[\]{}]/u.test(value)) {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be an exact producer identity.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be an exact producer URI.`,
    );
  }
  if (
    !['https:', 'spiffe:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname.endsWith('.invalid') ||
    ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be an exact production producer identity.`,
    );
  }
}

function canonicalTimestamp(value: string, path: string): number {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be a canonical UTC timestamp.`,
    );
  }
  return timestamp;
}

function parseJsonObject(bytes: Buffer, path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) {
      throw new MediaLiveProductionEvidenceError('invalid UTF-8');
    }
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be valid UTF-8 JSON.`,
    );
  }
  return record(parsed, path);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  );
  const expected = [...allowed].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${path} has missing or unexpected fields.`,
    );
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MediaLiveProductionEvidenceError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be a non-empty exact string.`,
    );
  }
  return value;
}

function requiredSha256(value: unknown, path: string): string {
  const digest = requiredString(value, path);
  if (!SHA256.test(digest)) {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be a lowercase SHA-256 digest.`,
    );
  }
  return digest;
}

function isLivePrerequisiteId(
  value: string,
): value is LiveMediaProductionPrerequisiteId {
  return (LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS as readonly string[]).includes(
    value,
  );
}
