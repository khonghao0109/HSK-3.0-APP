import {
  readStableBoundedFileWithinRoot,
  sha256,
} from './media-operations-validation.helpers';
import type { StableFileBoundaryTestHooks } from './media-operations-validation.helpers';
import type { VerifiedMediaProductionPrerequisiteEvidence } from './media-production-prerequisites';
import { assertMediaEvidenceProducerExecution } from '../operations/media-evidence-producer-policy';
import type { MediaEvidenceProducerExecutionContract } from '../operations/media-evidence-producer-policy';
import {
  CallerControlledEvidenceFileViolation,
  InternalVerifierFailure,
} from '../operations/media-release-evidence-errors';

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
const ZERO_SHA256 = /^0{64}$/u;
const OCI_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const STABLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const GITHUB_RUN_ID = /^[1-9][0-9]{0,19}$/u;
const MANIFEST_ID = 'hsk-media-live-production-evidence-v2';
const MAX_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 60_000;
const REQUIRED_CLAMAV_CLEAN_FORMATS = [
  'audio/mpeg',
  'audio/wav',
  'image/jpeg',
  'image/png',
] as const;
const LIVE_ALERT_NAME = 'HskMediaValidationSyntheticPage';
const LIVE_ALERT_OWNER_ROUTE = 'platform-sre';
const WORKLOAD_AUDIENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const WORKLOAD_SUBJECT =
  /^system:serviceaccount:[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?:[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/u;

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

export interface MediaLiveProductionCollectorRun {
  runId: string;
  runAttempt: number;
}

export interface MediaLiveProductionWorkloadIdentity {
  audience: string;
  subject: string;
}

export interface VerifiedMediaLiveProductionRawArtifact {
  id: string;
  prerequisiteId: LiveMediaProductionPrerequisiteId;
  relativePath: string;
  mediaType: 'application/json';
  sizeBytes: number;
  sha256: string;
  bytes: Buffer;
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
  collectorRun: MediaLiveProductionCollectorRun;
  observedAt: string;
  expiresAt: string;
  rawArtifacts: VerifiedMediaLiveProductionRawArtifact[];
  artifacts: VerifiedMediaLiveProductionEvidenceArtifact[];
}

export interface ParseVerifiedMediaLiveProductionEvidenceOptions {
  nowMs?: number;
  expectedBinding: MediaLiveProductionReleaseBinding;
  expectedEnvironment: MediaLiveProductionEnvironmentBinding;
  expectedWorkloadIdentity: MediaLiveProductionWorkloadIdentity;
  expectedProducerExecution: MediaEvidenceProducerExecutionContract;
  expectedCollectorRun?: MediaLiveProductionCollectorRun;
  trustedProducer: MediaLiveProductionEvidenceProducer;
  verifiedSignature: MediaLiveProductionEvidenceProducer & {
    payloadSha256: string;
  };
  stableFileBoundaryTestHooks?: StableFileBoundaryTestHooks;
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
      'producerExecution',
      'collectorRun',
      'binding',
      'environment',
      'observedAt',
      'expiresAt',
      'rawArtifacts',
      'artifacts',
    ],
    'signed live evidence manifest',
  );
  if (root.schemaVersion !== 2 || root.manifestId !== MANIFEST_ID) {
    throw new MediaLiveProductionEvidenceError(
      'Signed live evidence manifest identity is invalid.',
    );
  }
  try {
    assertMediaEvidenceProducerExecution(
      root.producerExecution,
      options.expectedProducerExecution,
    );
  } catch {
    throw new MediaLiveProductionEvidenceError(
      'Signed live producer execution contract does not match the accepted policy.',
    );
  }
  const producer = parseProducer(root.producer, 'manifest.producer');
  assertSameProducer(producer, trustedProducer, 'trusted producer');
  const collectorRun = parseCollectorRun(
    root.collectorRun,
    'manifest.collectorRun',
  );
  const expectedCollectorRun = resolveExpectedCollectorRun(options);
  assertSameCollectorRun(
    collectorRun,
    expectedCollectorRun,
    'expected collector execution; replayed evidence is forbidden',
  );
  const binding = parseReleaseBinding(root.binding, 'manifest.binding');
  assertSameBinding(binding, options.expectedBinding, 'exact release');
  const environment = parseEnvironmentBinding(
    root.environment,
    'manifest.environment',
  );
  const expectedEnvironment = parseExpectedEnvironmentBinding(
    options.expectedEnvironment,
  );
  assertSameEnvironment(
    environment,
    expectedEnvironment,
    'expected production environment',
  );
  const expectedWorkloadIdentity = parseExpectedWorkloadIdentity(
    options.expectedWorkloadIdentity,
  );
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error('Live evidence validation time is invalid.');
  }
  const observedAt = requiredString(root.observedAt, 'manifest.observedAt');
  const expiresAt = requiredString(root.expiresAt, 'manifest.expiresAt');
  assertFreshness(observedAt, expiresAt, nowMs);

  if (
    !Array.isArray(root.rawArtifacts) ||
    root.rawArtifacts.length !== LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS.length
  ) {
    throw new MediaLiveProductionEvidenceError(
      'Live evidence manifest must contain exactly six bounded raw artifacts.',
    );
  }
  const rawReferences = root.rawArtifacts.map((entry, index) =>
    parseRawArtifactReference(entry, index),
  );
  assertCompleteRawArtifactRegistry(rawReferences);
  const rawArtifacts = rawReferences.map((reference) =>
    loadAndVerifyRawArtifact(
      evidenceRoot,
      reference,
      collectorRun,
      expectedWorkloadIdentity,
      options.stableFileBoundaryTestHooks,
    ),
  );
  const rawArtifactsById = new Map(
    rawArtifacts.map((artifact) => [artifact.id, artifact] as const),
  );

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
    const bytes = readStableLiveEvidenceFile(
      evidenceRoot,
      reference.relativePath,
      MEDIA_LIVE_PRODUCTION_EVIDENCE_MAX_ARTIFACT_BYTES,
      `Live evidence artifact ${reference.prerequisiteId}`,
      options.stableFileBoundaryTestHooks,
    );
    if (bytes.length === 0 || sha256(bytes) !== reference.sha256) {
      throw new MediaLiveProductionEvidenceError(
        `${reference.prerequisiteId} live evidence artifact digest does not match.`,
      );
    }
    const raw = parseLiveArtifact(bytes, reference, rawArtifactsById, {
      producer,
      collectorRun,
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
    collectorRun,
    observedAt,
    expiresAt,
    rawArtifacts,
    artifacts,
  };
}

interface RawArtifactReference {
  id: string;
  prerequisiteId: LiveMediaProductionPrerequisiteId;
  relativePath: string;
  mediaType: 'application/json';
  sizeBytes: number;
  sha256: string;
}

function parseRawArtifactReference(
  input: unknown,
  index: number,
): RawArtifactReference {
  const path = `manifest.rawArtifacts[${String(index)}]`;
  const value = record(input, path);
  exactKeys(
    value,
    [
      'id',
      'prerequisiteId',
      'relativePath',
      'mediaType',
      'sizeBytes',
      'sha256',
    ],
    path,
  );
  const id = requiredString(value.id, `${path}.id`);
  if (!STABLE_ID.test(id)) {
    throw new MediaLiveProductionEvidenceError(
      `${path}.id must be a stable artifact ID.`,
    );
  }
  const prerequisiteId = requiredString(
    value.prerequisiteId,
    `${path}.prerequisiteId`,
  );
  if (!isLivePrerequisiteId(prerequisiteId)) {
    throw new MediaLiveProductionEvidenceError(
      `${path} has an unsupported live prerequisite ID.`,
    );
  }
  const relativePath = requiredString(
    value.relativePath,
    `${path}.relativePath`,
  );
  assertSafeRelativeJsonPath(relativePath, `${path}.relativePath`);
  if (value.mediaType !== 'application/json') {
    throw new MediaLiveProductionEvidenceError(
      `${path}.mediaType must be application/json.`,
    );
  }
  if (
    typeof value.sizeBytes !== 'number' ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes <= 0 ||
    value.sizeBytes > MEDIA_LIVE_PRODUCTION_EVIDENCE_MAX_ARTIFACT_BYTES
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${path}.sizeBytes is outside the bounded raw evidence limit.`,
    );
  }
  return {
    id,
    prerequisiteId,
    relativePath,
    mediaType: 'application/json',
    sizeBytes: value.sizeBytes,
    sha256: requiredSha256(value.sha256, `${path}.sha256`),
  };
}

function assertCompleteRawArtifactRegistry(
  references: readonly RawArtifactReference[],
): void {
  const identifiers = new Set<string>();
  const prerequisiteIds = new Set<string>();
  const paths = new Set<string>();
  for (const reference of references) {
    if (identifiers.has(reference.id)) {
      throw new MediaLiveProductionEvidenceError(
        `Live raw evidence registry has a duplicate artifact ID: ${reference.id}.`,
      );
    }
    if (prerequisiteIds.has(reference.prerequisiteId)) {
      throw new MediaLiveProductionEvidenceError(
        `Live raw evidence registry has a duplicate prerequisite: ${reference.prerequisiteId}.`,
      );
    }
    if (paths.has(reference.relativePath)) {
      throw new MediaLiveProductionEvidenceError(
        'Live raw evidence artifacts require distinct relative paths.',
      );
    }
    identifiers.add(reference.id);
    prerequisiteIds.add(reference.prerequisiteId);
    paths.add(reference.relativePath);
  }
  const missing = LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS.filter(
    (id) => !prerequisiteIds.has(id),
  );
  if (missing.length > 0) {
    throw new MediaLiveProductionEvidenceError(
      `Live raw evidence registry is incomplete: ${missing.join(', ')}.`,
    );
  }
}

function loadAndVerifyRawArtifact(
  evidenceRoot: string,
  reference: RawArtifactReference,
  collectorRun: MediaLiveProductionCollectorRun,
  expectedWorkloadIdentity: MediaLiveProductionWorkloadIdentity,
  stableFileBoundaryTestHooks?: StableFileBoundaryTestHooks,
): VerifiedMediaLiveProductionRawArtifact {
  const bytes = readStableLiveEvidenceFile(
    evidenceRoot,
    reference.relativePath,
    MEDIA_LIVE_PRODUCTION_EVIDENCE_MAX_ARTIFACT_BYTES,
    `Raw evidence artifact ${reference.id}`,
    stableFileBoundaryTestHooks,
  );
  if (
    bytes.length !== reference.sizeBytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new MediaLiveProductionEvidenceError(
      `Raw evidence artifact ${reference.id} size or digest does not match.`,
    );
  }
  parseRawDomainEvidence(
    bytes,
    reference,
    collectorRun,
    expectedWorkloadIdentity,
  );
  return {
    ...reference,
    bytes,
  };
}

function readStableLiveEvidenceFile(
  evidenceRoot: string,
  relativePath: string,
  maximumBytes: number,
  label: string,
  hooks?: StableFileBoundaryTestHooks,
): Buffer {
  try {
    return readStableBoundedFileWithinRoot(
      evidenceRoot,
      relativePath,
      maximumBytes,
      label,
      hooks,
    );
  } catch (error: unknown) {
    if (error instanceof CallerControlledEvidenceFileViolation) {
      throw new MediaLiveProductionEvidenceError(
        `${label} is absent or unsafe: ${error.message}.`,
      );
    }
    if (error instanceof InternalVerifierFailure) throw error;
    throw new InternalVerifierFailure(
      `${label} stable file verifier failed internally.`,
    );
  }
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
    identifiers.add(reference.prerequisiteId);
    paths.add(reference.relativePath);
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
  rawArtifacts: ReadonlyMap<string, VerifiedMediaLiveProductionRawArtifact>,
  expected: {
    producer: MediaLiveProductionEvidenceProducer;
    collectorRun: MediaLiveProductionCollectorRun;
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
      'collectorRun',
      'commandProvenanceArtifactId',
      'commandProvenanceSha256',
      'sanitizedLogArtifactId',
      'sanitizedLogSha256',
      'checks',
    ],
    path,
  );
  if (
    value.schemaVersion !== 2 ||
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
  assertSameEnvironment(
    environment,
    expected.environment,
    'signed environment',
  );
  const collectorRun = parseCollectorRun(
    value.collectorRun,
    `${path}.collectorRun`,
  );
  assertSameCollectorRun(
    collectorRun,
    expected.collectorRun,
    'signed manifest collector run; replayed evidence is forbidden',
  );

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

  const commandProvenanceSha256 = resolveReferencedRawArtifact(
    rawArtifacts,
    value.commandProvenanceArtifactId,
    value.commandProvenanceSha256,
    reference.prerequisiteId,
    `${path}.commandProvenance`,
  ).sha256;
  const sanitizedLogSha256 = resolveReferencedRawArtifact(
    rawArtifacts,
    value.sanitizedLogArtifactId,
    value.sanitizedLogSha256,
    reference.prerequisiteId,
    `${path}.sanitizedLog`,
  ).sha256;
  if (!Array.isArray(value.checks)) {
    throw new MediaLiveProductionEvidenceError(
      `${path}.checks must be an array.`,
    );
  }
  const checkEvidenceSha256 = parseSemanticChecks(
    value.checks,
    reference.prerequisiteId,
    rawArtifacts,
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
  rawArtifacts: ReadonlyMap<string, VerifiedMediaLiveProductionRawArtifact>,
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
    exactKeys(
      check,
      ['id', 'status', 'evidenceArtifactId', 'evidenceSha256'],
      path,
    );
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
    evidence[id] = resolveReferencedRawArtifact(
      rawArtifacts,
      check.evidenceArtifactId,
      check.evidenceSha256,
      prerequisiteId,
      `${path}.evidence`,
    ).sha256;
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

function resolveReferencedRawArtifact(
  rawArtifacts: ReadonlyMap<string, VerifiedMediaLiveProductionRawArtifact>,
  artifactIdValue: unknown,
  sha256Value: unknown,
  prerequisiteId: LiveMediaProductionPrerequisiteId,
  path: string,
): VerifiedMediaLiveProductionRawArtifact {
  const artifactId = requiredString(artifactIdValue, `${path}ArtifactId`);
  const declaredSha256 = requiredSha256(sha256Value, `${path}Sha256`);
  const artifact = rawArtifacts.get(artifactId);
  if (!artifact) {
    throw new MediaLiveProductionEvidenceError(
      `${path} references missing raw evidence artifact ${artifactId}.`,
    );
  }
  if (
    artifact.prerequisiteId !== prerequisiteId ||
    artifact.sha256 !== declaredSha256
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${path} does not match its referenced raw evidence artifact.`,
    );
  }
  return artifact;
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

function resolveExpectedCollectorRun(
  options: ParseVerifiedMediaLiveProductionEvidenceOptions,
): MediaLiveProductionCollectorRun {
  const configured = options.expectedCollectorRun;
  const candidate =
    configured ??
    (process.env.MEDIA_OPS_LIVE_COLLECTOR_RUN_ID &&
    process.env.MEDIA_OPS_LIVE_COLLECTOR_RUN_ATTEMPT
      ? {
          runId: process.env.MEDIA_OPS_LIVE_COLLECTOR_RUN_ID,
          runAttempt: Number(process.env.MEDIA_OPS_LIVE_COLLECTOR_RUN_ATTEMPT),
        }
      : undefined);
  if (
    !candidate ||
    !GITHUB_RUN_ID.test(candidate.runId) ||
    !Number.isSafeInteger(candidate.runAttempt) ||
    candidate.runAttempt < 1 ||
    candidate.runAttempt > 10_000
  ) {
    throw new Error(
      'Expected live evidence collector run binding is missing or invalid.',
    );
  }
  return { ...candidate };
}

function parseCollectorRun(
  input: unknown,
  path: string,
): MediaLiveProductionCollectorRun {
  const value = record(input, path);
  exactKeys(value, ['runId', 'runAttempt'], path);
  const runId = requiredString(value.runId, `${path}.runId`);
  if (
    !GITHUB_RUN_ID.test(runId) ||
    typeof value.runAttempt !== 'number' ||
    !Number.isSafeInteger(value.runAttempt) ||
    value.runAttempt < 1 ||
    value.runAttempt > 10_000
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${path} is not a valid immutable collector run binding.`,
    );
  }
  return { runId, runAttempt: value.runAttempt };
}

function assertSameCollectorRun(
  actual: MediaLiveProductionCollectorRun,
  expected: MediaLiveProductionCollectorRun,
  label: string,
): void {
  if (
    actual.runId !== expected.runId ||
    actual.runAttempt !== expected.runAttempt
  ) {
    throw new MediaLiveProductionEvidenceError(
      `Live evidence does not match the ${label}.`,
    );
  }
}

const RAW_EVIDENCE_KINDS = {
  'media-live-s3-provider': 'live-s3-provider',
  'media-live-clamav': 'live-clamav',
  'media-deployed-proxy-mesh-policy': 'deployed-proxy-mesh-policy',
  'media-production-alert-delivery': 'production-alert-delivery',
  'media-backend-replica-discovery': 'backend-replica-discovery',
  'media-secret-manager-workload-identity': 'secret-manager-workload-identity',
} as const satisfies Record<LiveMediaProductionPrerequisiteId, string>;

function parseRawDomainEvidence(
  bytes: Buffer,
  reference: RawArtifactReference,
  expectedCollectorRun: MediaLiveProductionCollectorRun,
  expectedWorkloadIdentity: MediaLiveProductionWorkloadIdentity,
): void {
  const path = `rawEvidence.${reference.id}`;
  const value = parseJsonObject(bytes, path);
  exactKeys(
    value,
    [
      'schemaVersion',
      'evidenceKind',
      'collectorRun',
      'command',
      'sanitizedLog',
      'semantics',
    ],
    path,
  );
  if (
    value.schemaVersion !== 1 ||
    value.evidenceKind !== RAW_EVIDENCE_KINDS[reference.prerequisiteId]
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${reference.prerequisiteId} raw evidence identity is invalid.`,
    );
  }
  const collectorRun = parseCollectorRun(
    value.collectorRun,
    `${path}.collectorRun`,
  );
  assertSameCollectorRun(
    collectorRun,
    expectedCollectorRun,
    'signed manifest collector run; replayed evidence is forbidden',
  );

  const command = record(value.command, `${path}.command`);
  exactKeys(command, ['name', 'version', 'exitCode'], `${path}.command`);
  const commandName = requiredString(command.name, `${path}.command.name`);
  const commandVersion = requiredString(
    command.version,
    `${path}.command.version`,
  );
  if (
    commandName !== `collect-${reference.prerequisiteId}` ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u.test(commandVersion) ||
    command.exitCode !== 0
  ) {
    throw new MediaLiveProductionEvidenceError(
      `${reference.prerequisiteId} raw rehearsal command provenance is invalid.`,
    );
  }

  const sanitizedLog = record(value.sanitizedLog, `${path}.sanitizedLog`);
  exactKeys(
    sanitizedLog,
    ['redacted', 'secretsDetected'],
    `${path}.sanitizedLog`,
  );
  if (sanitizedLog.redacted !== true || sanitizedLog.secretsDetected !== 0) {
    throw new MediaLiveProductionEvidenceError(
      `${reference.prerequisiteId} raw rehearsal log is not safely sanitized.`,
    );
  }

  const semantics = record(value.semantics, `${path}.semantics`);
  switch (reference.prerequisiteId) {
    case 'media-live-s3-provider':
      assertS3Semantics(semantics, path);
      return;
    case 'media-live-clamav':
      assertClamavSemantics(semantics, path);
      return;
    case 'media-deployed-proxy-mesh-policy':
      assertMeshSemantics(semantics, path);
      return;
    case 'media-production-alert-delivery':
      assertAlertSemantics(semantics, path);
      return;
    case 'media-backend-replica-discovery':
      assertReplicaSemantics(semantics, path);
      return;
    case 'media-secret-manager-workload-identity':
      assertWorkloadIdentitySemantics(
        semantics,
        path,
        expectedWorkloadIdentity,
      );
      return;
  }
}

function assertS3Semantics(
  value: Record<string, unknown>,
  parentPath: string,
): void {
  const path = `${parentPath}.semantics`;
  exactKeys(
    value,
    [
      'publicAccessBlocked',
      'tlsVersion',
      'encryption',
      'versioning',
      'lifecycleRules',
      'putStatus',
      'headStatus',
      'getStatus',
      'deleteStatus',
      'checksumMatched',
      'byteReadbackMatched',
      'oversizeRejected',
      'deniedRejected',
      'missingRejected',
      'timeoutRejected',
      'resetRejected',
      'unknownPutSettled',
    ],
    path,
  );
  if (
    value.publicAccessBlocked !== true ||
    !['TLSv1.2', 'TLSv1.3'].includes(String(value.tlsVersion)) ||
    !['aws:kms', 'AES256'].includes(String(value.encryption)) ||
    value.versioning !== 'Enabled' ||
    !isPositiveInteger(value.lifecycleRules) ||
    value.putStatus !== 200 ||
    value.headStatus !== 200 ||
    value.getStatus !== 200 ||
    value.deleteStatus !== 204 ||
    value.checksumMatched !== true ||
    value.byteReadbackMatched !== true ||
    value.oversizeRejected !== true ||
    value.deniedRejected !== true ||
    value.missingRejected !== true ||
    value.timeoutRejected !== true ||
    value.resetRejected !== true ||
    value.unknownPutSettled !== true
  ) {
    invalidDomainSemantics('S3 provider');
  }
}

function assertClamavSemantics(
  value: Record<string, unknown>,
  parentPath: string,
): void {
  const path = `${parentPath}.semantics`;
  exactKeys(
    value,
    [
      'engineVersion',
      'databaseVersion',
      'cleanFormatsAccepted',
      'eicarFound',
      'transportFailuresRejected',
      'malformedRejected',
      'oversizedRejected',
      'concurrencyLimit',
      'backpressureObserved',
    ],
    path,
  );
  const cleanFormats = value.cleanFormatsAccepted;
  if (
    !isVersionString(value.engineVersion) ||
    !isVersionString(value.databaseVersion) ||
    !Array.isArray(cleanFormats) ||
    cleanFormats.length !== REQUIRED_CLAMAV_CLEAN_FORMATS.length ||
    cleanFormats.some((format) => !isExactNonEmptyString(format)) ||
    new Set(cleanFormats).size !== cleanFormats.length ||
    REQUIRED_CLAMAV_CLEAN_FORMATS.some(
      (requiredFormat) => !cleanFormats.includes(requiredFormat),
    ) ||
    value.eicarFound !== true ||
    value.transportFailuresRejected !== true ||
    value.malformedRejected !== true ||
    value.oversizedRejected !== true ||
    !isPositiveInteger(value.concurrencyLimit) ||
    value.backpressureObserved !== true
  ) {
    invalidDomainSemantics('ClamAV');
  }
}

function assertMeshSemantics(
  value: Record<string, unknown>,
  parentPath: string,
): void {
  const path = `${parentPath}.semantics`;
  exactKeys(
    value,
    [
      'nginxPolicyRevision',
      'privateNoStoreEnforced',
      'querySignatureRedacted',
      'mtlsMode',
      'networkPolicyDefaultDeny',
      'authorizedWorkloadAllowed',
    ],
    path,
  );
  if (
    typeof value.nginxPolicyRevision !== 'string' ||
    !OCI_DIGEST.test(value.nginxPolicyRevision) ||
    value.privateNoStoreEnforced !== true ||
    value.querySignatureRedacted !== true ||
    value.mtlsMode !== 'STRICT' ||
    value.networkPolicyDefaultDeny !== true ||
    value.authorizedWorkloadAllowed !== true
  ) {
    invalidDomainSemantics('deployed proxy and mesh policy');
  }
}

function assertAlertSemantics(
  value: Record<string, unknown>,
  parentPath: string,
): void {
  const path = `${parentPath}.semantics`;
  exactKeys(
    value,
    [
      'alertName',
      'firingObserved',
      'ownerRoute',
      'firingNotificationReceipt',
      'resolvedNotificationReceipt',
      'escalationReceipt',
    ],
    path,
  );
  const receipts = [
    value.firingNotificationReceipt,
    value.resolvedNotificationReceipt,
    value.escalationReceipt,
  ];
  if (
    value.alertName !== LIVE_ALERT_NAME ||
    value.firingObserved !== true ||
    value.ownerRoute !== LIVE_ALERT_OWNER_ROUTE ||
    receipts.some((receipt) => !isExactNonEmptyString(receipt)) ||
    new Set(receipts).size !== receipts.length
  ) {
    invalidDomainSemantics('production alert delivery');
  }
}

function assertReplicaSemantics(
  value: Record<string, unknown>,
  parentPath: string,
): void {
  const path = `${parentPath}.semantics`;
  exactKeys(
    value,
    [
      'readyReplicas',
      'headlessServiceEndpoints',
      'distinctPodTargets',
      'scrapedReplicaTargets',
      'replacementReconverged',
    ],
    path,
  );
  if (
    !isIntegerAtLeast(value.readyReplicas, 2) ||
    !isIntegerAtLeast(value.headlessServiceEndpoints, 2) ||
    !isIntegerAtLeast(value.distinctPodTargets, 2) ||
    !isIntegerAtLeast(value.scrapedReplicaTargets, 2) ||
    value.replacementReconverged !== true
  ) {
    invalidDomainSemantics('backend replica discovery');
  }
}

function assertWorkloadIdentitySemantics(
  value: Record<string, unknown>,
  parentPath: string,
  expected: MediaLiveProductionWorkloadIdentity,
): void {
  const path = `${parentPath}.semantics`;
  exactKeys(
    value,
    [
      'issuer',
      'audience',
      'subject',
      'staticCredentialsPresent',
      'secretReadAuthorized',
      'tokenTtlSeconds',
      'rotationOverlapVerified',
      'auditEventId',
    ],
    path,
  );
  if (
    !isCredentialFreeProductionHttps(value.issuer) ||
    value.audience !== expected.audience ||
    value.subject !== expected.subject ||
    value.staticCredentialsPresent !== false ||
    value.secretReadAuthorized !== true ||
    !isIntegerAtLeast(value.tokenTtlSeconds, 1) ||
    value.tokenTtlSeconds > 3600 ||
    value.rotationOverlapVerified !== true ||
    !isExactNonEmptyString(value.auditEventId)
  ) {
    invalidDomainSemantics('secret-manager workload identity');
  }
}

function parseExpectedWorkloadIdentity(
  input: MediaLiveProductionWorkloadIdentity,
): MediaLiveProductionWorkloadIdentity {
  if (
    !input ||
    !WORKLOAD_AUDIENCE.test(input.audience) ||
    !WORKLOAD_SUBJECT.test(input.subject)
  ) {
    throw new Error('Expected workload identity configuration is invalid.');
  }
  return { audience: input.audience, subject: input.subject };
}

function invalidDomainSemantics(domain: string): never {
  throw new MediaLiveProductionEvidenceError(
    `${domain} raw rehearsal semantic evidence is incomplete or invalid.`,
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
}

function isIntegerAtLeast(value: unknown, minimum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
  );
}

function isVersionString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u.test(value)
  );
}

function isExactNonEmptyString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value
  );
}

function isCredentialFreeProductionHttps(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      !parsed.hostname.endsWith('.invalid') &&
      !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    );
  } catch {
    return false;
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

function parseExpectedEnvironmentBinding(
  input: unknown,
): MediaLiveProductionEnvironmentBinding {
  try {
    return parseEnvironmentBinding(input, 'expected production environment');
  } catch {
    throw new Error(
      'Expected production environment configuration is invalid.',
    );
  }
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
  label: string,
): void {
  if (
    actual.clusterIdentitySha256 !== expected.clusterIdentitySha256 ||
    actual.namespaceIdentitySha256 !== expected.namespaceIdentitySha256 ||
    actual.deploymentRevision !== expected.deploymentRevision ||
    actual.fingerprintSha256 !== expected.fingerprintSha256
  ) {
    throw new MediaLiveProductionEvidenceError(
      `Raw live evidence does not match the ${label}.`,
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
  if (!SHA256.test(digest) || ZERO_SHA256.test(digest)) {
    throw new MediaLiveProductionEvidenceError(
      `${path} must be a nonzero lowercase SHA-256 digest; a zero digest cannot prove raw evidence.`,
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
