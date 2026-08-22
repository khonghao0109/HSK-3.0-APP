export const REQUIRED_MEDIA_PRODUCTION_PREREQUISITE_IDS = [
  'media-oci-supply-chain',
  'media-capacity-backup-restore',
  'media-production-runbook',
  'media-live-s3-provider',
  'media-live-clamav',
  'media-deployed-proxy-mesh-policy',
  'media-production-alert-delivery',
  'media-backend-replica-discovery',
  'media-secret-manager-workload-identity',
  'media-database-migration-recovery',
  'media-immutable-evidence-attestation',
] as const;

export type RequiredMediaProductionPrerequisiteId =
  (typeof REQUIRED_MEDIA_PRODUCTION_PREREQUISITE_IDS)[number];

export type MediaProductionPrerequisiteBoundary = 'internal' | 'external';
export type MediaProductionPrerequisiteStatus =
  | 'PASS'
  | 'FAIL_INTERNAL'
  | 'BLOCKED_EXTERNAL';

export interface MediaProductionPrerequisite {
  id: string;
  owner: string;
  required: boolean;
  boundary: MediaProductionPrerequisiteBoundary;
  status: MediaProductionPrerequisiteStatus;
  evidence: {
    type: string;
    uri: string | null;
    sha256: string | null;
  };
  producer: {
    issuer: string | null;
    identity: string | null;
  };
  freshness: {
    maxAgeSeconds: number;
    observedAt: string | null;
    expiresAt: string | null;
  };
  binding: {
    gitCommit: string | null;
    gitTreeSha: string | null;
    releaseContentDigest: string | null;
  };
  failureSemantics: {
    missing: 'FAIL_INTERNAL' | 'BLOCKED_EXTERNAL';
    invalid: 'FAIL_INTERNAL' | 'BLOCKED_EXTERNAL';
    stale: 'FAIL_INTERNAL' | 'BLOCKED_EXTERNAL';
    validator: 'FAIL_INTERNAL';
  };
}

export interface MediaProductionPrerequisiteInventory {
  schemaVersion: 1;
  inventoryId: 'hsk-media-production-prerequisites-v1';
  prerequisites: MediaProductionPrerequisite[];
}

export interface VerifiedMediaProductionPrerequisiteEvidence {
  prerequisiteId: RequiredMediaProductionPrerequisiteId;
  evidenceType: string;
  evidenceUri: string;
  evidenceSha256: string;
  producerIssuer: string;
  producerIdentity: string;
  binding: {
    gitCommit: string;
    gitTreeSha: string;
    releaseContentDigest: string;
  };
}

type ExpectedReleaseBinding = {
  gitCommit: string;
  gitTreeSha: string;
  releaseContentDigest: string;
};

type CommonInventoryParseOptions = {
  nowMs?: number;
  expectedBinding?: ExpectedReleaseBinding;
};

type TrackedInventoryOptions = CommonInventoryParseOptions & {
  source?: 'tracked';
};

type VerifiedExternalInventoryOptions = CommonInventoryParseOptions & {
  source: 'verified-external';
  requirements: MediaProductionPrerequisiteInventory;
  verifiedEvidenceByPrerequisite: ReadonlyMap<
    RequiredMediaProductionPrerequisiteId,
    VerifiedMediaProductionPrerequisiteEvidence
  >;
};

const SHA1 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const STABLE_ID = /^media-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const OWNER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const EVIDENCE_TYPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const MAX_FRESHNESS_SECONDS = 90 * 24 * 60 * 60;
const REQUIRED_IDS = new Set<string>(
  REQUIRED_MEDIA_PRODUCTION_PREREQUISITE_IDS,
);

export function parseMediaProductionPrerequisiteInventory(
  input: unknown,
  options: TrackedInventoryOptions | VerifiedExternalInventoryOptions = {},
): MediaProductionPrerequisiteInventory {
  const inventory = parseInventoryCandidate(input, options);
  if (options.source === 'verified-external') {
    assertInventoryMatchesTrackedRequirements(inventory, options.requirements);
  }
  const passing = inventory.prerequisites.filter(
    ({ status }) => status === 'PASS',
  );
  if (passing.length === 0) {
    if (
      options.source === 'verified-external' &&
      options.verifiedEvidenceByPrerequisite.size !== 0
    ) {
      throw new Error(
        'Verified prerequisite evidence has no matching PASS prerequisite.',
      );
    }
    return inventory;
  }
  if (options.source !== 'verified-external') {
    throw new Error(
      'Tracked production prerequisite inventory cannot contain PASS evidence.',
    );
  }
  if (options.verifiedEvidenceByPrerequisite.size !== passing.length) {
    throw new Error(
      'Verified prerequisite evidence must match every PASS prerequisite exactly.',
    );
  }
  const evidenceDigests = new Set<string>();
  for (const prerequisite of passing) {
    const id = prerequisite.id as RequiredMediaProductionPrerequisiteId;
    const verification = options.verifiedEvidenceByPrerequisite.get(id);
    if (
      !verification ||
      verification.prerequisiteId !== id ||
      verification.evidenceType !== prerequisite.evidence.type ||
      verification.evidenceUri !== prerequisite.evidence.uri ||
      verification.evidenceSha256 !== prerequisite.evidence.sha256 ||
      verification.producerIssuer !== prerequisite.producer.issuer ||
      verification.producerIdentity !== prerequisite.producer.identity ||
      verification.binding.gitCommit !== prerequisite.binding.gitCommit ||
      verification.binding.gitTreeSha !== prerequisite.binding.gitTreeSha ||
      verification.binding.releaseContentDigest !==
        prerequisite.binding.releaseContentDigest
    ) {
      throw new Error(
        `${id} cannot PASS without its exact specialized verification record.`,
      );
    }
    if (evidenceDigests.has(verification.evidenceSha256)) {
      throw new Error(
        `${id} cannot reuse another prerequisite's verified evidence digest.`,
      );
    }
    evidenceDigests.add(verification.evidenceSha256);
  }
  for (const id of options.verifiedEvidenceByPrerequisite.keys()) {
    if (!passing.some((prerequisite) => prerequisite.id === id)) {
      throw new Error(
        `Verified prerequisite evidence is unexpected for non-PASS item: ${id}.`,
      );
    }
  }
  return inventory;
}

/**
 * Parses a candidate only after its exact bytes have passed detached-signature
 * verification. A candidate is not release evidence until the primary parser
 * matches every PASS row to a specialized per-prerequisite verification record.
 */
export function parseVerifiedExternalPrerequisiteInventoryCandidate(
  input: unknown,
  options: CommonInventoryParseOptions & {
    expectedBinding: ExpectedReleaseBinding;
    requirements: MediaProductionPrerequisiteInventory;
  },
): MediaProductionPrerequisiteInventory {
  const inventory = parseInventoryCandidate(input, options);
  assertInventoryMatchesTrackedRequirements(inventory, options.requirements);
  return inventory;
}

function assertInventoryMatchesTrackedRequirements(
  inventory: MediaProductionPrerequisiteInventory,
  requirements: MediaProductionPrerequisiteInventory,
): void {
  const requirementsById = new Map(
    requirements.prerequisites.map((prerequisite) => [
      prerequisite.id,
      prerequisite,
    ]),
  );
  for (const prerequisite of inventory.prerequisites) {
    const required = requirementsById.get(prerequisite.id);
    if (
      !required ||
      prerequisite.owner !== required.owner ||
      prerequisite.required !== required.required ||
      prerequisite.boundary !== required.boundary ||
      prerequisite.evidence.type !== required.evidence.type ||
      prerequisite.freshness.maxAgeSeconds !==
        required.freshness.maxAgeSeconds ||
      prerequisite.failureSemantics.missing !==
        required.failureSemantics.missing ||
      prerequisite.failureSemantics.invalid !==
        required.failureSemantics.invalid ||
      prerequisite.failureSemantics.stale !== required.failureSemantics.stale ||
      prerequisite.failureSemantics.validator !==
        required.failureSemantics.validator
    ) {
      throw new Error(
        `${prerequisite.id} does not match the tracked prerequisite requirements.`,
      );
    }
  }
}

function parseInventoryCandidate(
  input: unknown,
  options: CommonInventoryParseOptions,
): MediaProductionPrerequisiteInventory {
  const root = record(input, 'inventory');
  exactKeys(
    root,
    ['schemaVersion', 'inventoryId', 'prerequisites'],
    'inventory',
  );
  if (
    root.schemaVersion !== 1 ||
    root.inventoryId !== 'hsk-media-production-prerequisites-v1'
  ) {
    throw new Error(
      'Media production prerequisite inventory identity is invalid.',
    );
  }
  if (!Array.isArray(root.prerequisites)) {
    throw new Error('Media production prerequisites must be an array.');
  }

  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error(
      'Media production prerequisite validation time is invalid.',
    );
  }
  const prerequisites = root.prerequisites.map((value, index) =>
    parsePrerequisite(value, index, nowMs, options),
  );
  const identifiers = new Set<string>();
  for (const prerequisite of prerequisites) {
    if (identifiers.has(prerequisite.id)) {
      throw new Error(
        `Media production prerequisite is duplicated: ${prerequisite.id}.`,
      );
    }
    identifiers.add(prerequisite.id);
  }
  const missing = REQUIRED_MEDIA_PRODUCTION_PREREQUISITE_IDS.filter(
    (id) => !identifiers.has(id),
  );
  if (missing.length > 0) {
    throw new Error(
      `Media production prerequisite inventory is incomplete: ${missing.join(', ')}.`,
    );
  }
  const unexpected = [...identifiers].filter((id) => !REQUIRED_IDS.has(id));
  if (unexpected.length > 0) {
    throw new Error(
      `Media production prerequisite inventory has unsupported IDs: ${unexpected.join(', ')}.`,
    );
  }

  return {
    schemaVersion: 1,
    inventoryId: 'hsk-media-production-prerequisites-v1',
    prerequisites,
  };
}

function parsePrerequisite(
  input: unknown,
  index: number,
  nowMs: number,
  options: {
    expectedBinding?: ExpectedReleaseBinding;
  },
): MediaProductionPrerequisite {
  const path = `inventory.prerequisites[${String(index)}]`;
  const value = record(input, path);
  exactKeys(
    value,
    [
      'id',
      'owner',
      'required',
      'boundary',
      'status',
      'evidence',
      'producer',
      'freshness',
      'binding',
      'failureSemantics',
    ],
    path,
  );
  const id = requiredString(value.id, `${path}.id`);
  const owner = requiredString(value.owner, `${path}.owner`);
  if (!STABLE_ID.test(id) || !OWNER.test(owner)) {
    throw new Error(`${path} has an invalid stable ID or owner.`);
  }
  if (typeof value.required !== 'boolean') {
    throw new Error(`${path}.required must be boolean.`);
  }
  if (REQUIRED_IDS.has(id) && value.required !== true) {
    throw new Error(`${id} is a mandatory production prerequisite.`);
  }
  if (value.boundary !== 'internal' && value.boundary !== 'external') {
    throw new Error(`${path}.boundary is invalid.`);
  }
  if (
    value.status !== 'PASS' &&
    value.status !== 'FAIL_INTERNAL' &&
    value.status !== 'BLOCKED_EXTERNAL'
  ) {
    throw new Error(`${path}.status is invalid.`);
  }

  const evidence = record(value.evidence, `${path}.evidence`);
  exactKeys(evidence, ['type', 'uri', 'sha256'], `${path}.evidence`);
  const evidenceType = requiredString(evidence.type, `${path}.evidence.type`);
  if (!EVIDENCE_TYPE.test(evidenceType)) {
    throw new Error(`${path}.evidence.type is invalid.`);
  }
  const evidenceUri = nullableString(evidence.uri, `${path}.evidence.uri`);
  const evidenceSha256 = nullableString(
    evidence.sha256,
    `${path}.evidence.sha256`,
  );

  const producer = record(value.producer, `${path}.producer`);
  exactKeys(producer, ['issuer', 'identity'], `${path}.producer`);
  const producerIssuer = nullableString(
    producer.issuer,
    `${path}.producer.issuer`,
  );
  const producerIdentity = nullableString(
    producer.identity,
    `${path}.producer.identity`,
  );

  const freshness = record(value.freshness, `${path}.freshness`);
  exactKeys(
    freshness,
    ['maxAgeSeconds', 'observedAt', 'expiresAt'],
    `${path}.freshness`,
  );
  if (
    !Number.isSafeInteger(freshness.maxAgeSeconds) ||
    Number(freshness.maxAgeSeconds) < 60 ||
    Number(freshness.maxAgeSeconds) > MAX_FRESHNESS_SECONDS
  ) {
    throw new Error(`${path}.freshness.maxAgeSeconds is invalid.`);
  }
  const observedAt = nullableString(
    freshness.observedAt,
    `${path}.freshness.observedAt`,
  );
  const expiresAt = nullableString(
    freshness.expiresAt,
    `${path}.freshness.expiresAt`,
  );

  const binding = record(value.binding, `${path}.binding`);
  exactKeys(
    binding,
    ['gitCommit', 'gitTreeSha', 'releaseContentDigest'],
    `${path}.binding`,
  );
  const gitCommit = nullableString(
    binding.gitCommit,
    `${path}.binding.gitCommit`,
  );
  const gitTreeSha = nullableString(
    binding.gitTreeSha,
    `${path}.binding.gitTreeSha`,
  );
  const releaseContentDigest = nullableString(
    binding.releaseContentDigest,
    `${path}.binding.releaseContentDigest`,
  );

  const failure = record(value.failureSemantics, `${path}.failureSemantics`);
  exactKeys(
    failure,
    ['missing', 'invalid', 'stale', 'validator'],
    `${path}.failureSemantics`,
  );
  assertFailureSemantics(failure, value.boundary, path);

  const evidenceValues = [
    evidenceUri,
    evidenceSha256,
    producerIssuer,
    producerIdentity,
    observedAt,
    expiresAt,
    gitCommit,
    gitTreeSha,
    releaseContentDigest,
  ];
  const hasNoEvidence = evidenceValues.every((candidate) => candidate === null);
  const hasCompleteEvidence = evidenceValues.every(
    (candidate) => candidate !== null,
  );
  if (value.status === 'PASS') {
    if (!hasCompleteEvidence) {
      throw new Error(`${id} cannot PASS without complete trusted evidence.`);
    }
    assertTrustedEvidence(
      {
        uri: evidenceUri as string,
        sha256: evidenceSha256 as string,
        issuer: producerIssuer as string,
        identity: producerIdentity as string,
        observedAt: observedAt as string,
        expiresAt: expiresAt as string,
        gitCommit: gitCommit as string,
        gitTreeSha: gitTreeSha as string,
        releaseContentDigest: releaseContentDigest as string,
        maxAgeSeconds: Number(freshness.maxAgeSeconds),
      },
      nowMs,
      id,
    );
    if (
      !options.expectedBinding ||
      gitCommit !== options.expectedBinding.gitCommit ||
      gitTreeSha !== options.expectedBinding.gitTreeSha ||
      releaseContentDigest !== options.expectedBinding.releaseContentDigest
    ) {
      throw new Error(`${id} is not bound to the exact release under review.`);
    }
  } else {
    if (!hasNoEvidence) {
      throw new Error(
        `${id} has partial or unverified evidence and cannot publish a non-PASS status.`,
      );
    }
    if (
      (value.status === 'BLOCKED_EXTERNAL' && value.boundary !== 'external') ||
      (value.status === 'FAIL_INTERNAL' && value.boundary !== 'internal')
    ) {
      throw new Error(`${id} status does not match its trust boundary.`);
    }
  }

  return {
    id,
    owner,
    required: value.required,
    boundary: value.boundary,
    status: value.status,
    evidence: {
      type: evidenceType,
      uri: evidenceUri,
      sha256: evidenceSha256,
    },
    producer: { issuer: producerIssuer, identity: producerIdentity },
    freshness: {
      maxAgeSeconds: Number(freshness.maxAgeSeconds),
      observedAt,
      expiresAt,
    },
    binding: { gitCommit, gitTreeSha, releaseContentDigest },
    failureSemantics: {
      missing: failure.missing as 'FAIL_INTERNAL' | 'BLOCKED_EXTERNAL',
      invalid: failure.invalid as 'FAIL_INTERNAL' | 'BLOCKED_EXTERNAL',
      stale: failure.stale as 'FAIL_INTERNAL' | 'BLOCKED_EXTERNAL',
      validator: 'FAIL_INTERNAL',
    },
  };
}

function assertFailureSemantics(
  failure: Record<string, unknown>,
  boundary: MediaProductionPrerequisiteBoundary,
  path: string,
): void {
  const boundaryFailure =
    boundary === 'external' ? 'BLOCKED_EXTERNAL' : 'FAIL_INTERNAL';
  if (
    failure.missing !== boundaryFailure ||
    failure.invalid !== boundaryFailure ||
    failure.stale !== boundaryFailure ||
    failure.validator !== 'FAIL_INTERNAL'
  ) {
    throw new Error(`${path}.failureSemantics is not fail-closed.`);
  }
}

function assertTrustedEvidence(
  value: {
    uri: string;
    sha256: string;
    issuer: string;
    identity: string;
    observedAt: string;
    expiresAt: string;
    gitCommit: string;
    gitTreeSha: string;
    releaseContentDigest: string;
    maxAgeSeconds: number;
  },
  nowMs: number,
  id: string,
): void {
  assertCredentialFreeProductionHttps(value.uri, `${id}.evidence.uri`);
  assertCredentialFreeProductionHttps(value.issuer, `${id}.producer.issuer`);
  assertProducerIdentity(value.identity, `${id}.producer.identity`);
  if (
    !SHA256.test(value.sha256) ||
    !SHA1.test(value.gitCommit) ||
    !SHA1.test(value.gitTreeSha) ||
    !SHA256.test(value.releaseContentDigest)
  ) {
    throw new Error(`${id} evidence digest or release binding is invalid.`);
  }
  const observedAt = canonicalTimestamp(value.observedAt, `${id}.observedAt`);
  const expiresAt = canonicalTimestamp(value.expiresAt, `${id}.expiresAt`);
  if (
    observedAt > nowMs + 60_000 ||
    expiresAt <= nowMs ||
    expiresAt <= observedAt ||
    expiresAt - observedAt > value.maxAgeSeconds * 1_000
  ) {
    throw new Error(`${id} evidence is stale or has invalid freshness.`);
  }
}

function assertCredentialFreeProductionHttps(
  value: string,
  path: string,
): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${path} must be a production HTTPS URI.`);
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
    throw new Error(`${path} must be credential-free production HTTPS.`);
  }
}

function assertProducerIdentity(value: string, path: string): void {
  if (/[\s*^$()[\]{}]/u.test(value)) {
    throw new Error(`${path} must be an exact producer identity.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${path} must be an exact producer URI.`);
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
    throw new Error(`${path} must be an exact production producer identity.`);
  }
}

function canonicalTimestamp(value: string, path: string): number {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(`${path} must be a canonical UTC timestamp.`);
  }
  return timestamp;
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
    throw new Error(`${path} has missing or unexpected fields.`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error(`${path} must be a non-empty exact string.`);
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return requiredString(value, path);
}
