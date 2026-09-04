import { ExternalEvidenceMissing } from './media-release-evidence-errors';

export const FINAL_MEDIA_EVIDENCE_VERIFIER_IDENTITY =
  'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-release-evidence.yml@refs/tags/v3.0.0';

export const MEDIA_EVIDENCE_PRODUCER_KEYS = [
  'production-prerequisite-inventory',
  'oci-release',
  'oci-risk-approval',
  'capacity-backup',
  'database-release',
  'live-rehearsal',
] as const;

export type MediaEvidenceProducerKey =
  (typeof MEDIA_EVIDENCE_PRODUCER_KEYS)[number];

export type MediaEvidenceProducerAcceptance =
  | 'HOST_ACCEPTANCE_REQUIRED'
  | 'ACCEPTED';

export interface MediaEvidenceProducer {
  owner: string;
  evidenceTypes: string[];
  acceptance: MediaEvidenceProducerAcceptance;
  issuer: string | null;
  identity: string | null;
  workflowName: string | null;
  workflowRef: string | null;
  workflowRepository: string | null;
  workflowSha: string | null;
  trigger: string | null;
  environment: string;
  collectorCommand: string | null;
  collectorVersion: string | null;
  rawEvidenceSet: string[];
  retentionDays: number;
  freshnessSeconds: number;
  verifier: string;
}

export interface MediaEvidenceProducerPolicy {
  schemaVersion: 1;
  policyId: 'hsk-media-evidence-producers-v1';
  status: MediaEvidenceProducerAcceptance;
  producers: Record<MediaEvidenceProducerKey, MediaEvidenceProducer>;
}

export type AcceptedMediaEvidenceProducer = MediaEvidenceProducer & {
  acceptance: 'ACCEPTED';
  issuer: string;
  identity: string;
  workflowName: string;
  workflowRef: string;
  workflowRepository: string;
  workflowSha: string;
  trigger: string;
  collectorCommand: string;
  collectorVersion: string;
};

export interface MediaEvidenceProducerExecutionContract {
  producerPolicyKey: MediaEvidenceProducerKey;
  collectorCommand: string;
  collectorVersion: string;
  environment: string;
  evidenceTypes: string[];
  rawEvidenceSet: string[];
  freshnessSeconds: number;
  verifier: string;
}

const STABLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/u;
const EXACT_RELEASE_TAG_REF = /^refs\/tags\/v\d+\.\d+\.\d+$/u;
const EXACT_TRIGGER = /^[a-z][a-z0-9_]{0,63}$/u;
const MEDIA_EVIDENCE_REPOSITORY = 'khonghao0109/HSK-3.0-APP';
const FINAL_VERIFIER_WORKFLOW = 'media-release-evidence.yml';
const EXACT_GITHUB_WORKFLOW_IDENTITY =
  /^https:\/\/github\.com\/khonghao0109\/HSK-3\.0-APP\/\.github\/workflows\/([a-z0-9][a-z0-9_-]*\.ya?ml)@(refs\/tags\/v\d+\.\d+\.\d+)$/u;
const EXECUTABLE_PRODUCER_CONTRACTS = {
  'production-prerequisite-inventory': {
    owner: 'release-engineering',
    evidenceTypes: ['production-prerequisite-inventory'],
    environment: 'media-production-release',
    rawEvidenceSet: ['specialized-prerequisite-results'],
    retentionDays: 90,
    freshnessSeconds: 604_800,
    verifier: 'production-prerequisite-inventory-verifier',
  },
  'oci-release': {
    owner: 'release-engineering',
    evidenceTypes: ['oci-signature-sbom-vulnerability-license-attestation'],
    environment: 'media-production-release',
    rawEvidenceSet: [
      'oci-index',
      'spdx-sbom',
      'grype-report',
      'license-report',
    ],
    retentionDays: 90,
    freshnessSeconds: 432_000,
    verifier: 'oci-release-evidence-verifier',
  },
  'oci-risk-approval': {
    owner: 'security-platform',
    evidenceTypes: ['oci-waiver-risk-approval'],
    environment: 'media-production-release',
    rawEvidenceSet: ['waiver-approval-records'],
    retentionDays: 90,
    freshnessSeconds: 432_000,
    verifier: 'oci-waiver-risk-approval-verifier',
  },
  'capacity-backup': {
    owner: 'platform-sre',
    evidenceTypes: ['capacity-backup-restore-rehearsal'],
    environment: 'media-production-release',
    rawEvidenceSet: ['capacity-query', 'backup-restore-log'],
    retentionDays: 90,
    freshnessSeconds: 604_800,
    verifier: 'capacity-backup-evidence-verifier',
  },
  'database-release': {
    owner: 'database-reliability',
    evidenceTypes: ['database-migration-recovery-rehearsal'],
    environment: 'media-production-release',
    rawEvidenceSet: [
      'migration-catalog',
      'recovery-command-logs',
      'schema-drift',
    ],
    retentionDays: 90,
    freshnessSeconds: 604_800,
    verifier: 'database-release-evidence-verifier',
  },
  'live-rehearsal': {
    owner: 'platform-sre',
    evidenceTypes: [
      'signed-s3-provider-rehearsal',
      'signed-clamav-rehearsal',
      'signed-deployed-security-policy-rehearsal',
      'signed-alert-firing-routing-resolution-rehearsal',
      'signed-runtime-replica-discovery-rehearsal',
      'signed-secret-manager-workload-identity-rehearsal',
    ],
    environment: 'media-production-release',
    rawEvidenceSet: [
      'command-provenance',
      'sanitized-command-log',
      's3-observation',
      'clamav-observation',
      'mesh-observation',
      'alert-observation',
      'replica-observation',
      'workload-identity-observation',
    ],
    retentionDays: 90,
    freshnessSeconds: 604_800,
    verifier: 'live-rehearsal-evidence-verifier',
  },
} as const satisfies Record<
  MediaEvidenceProducerKey,
  {
    owner: string;
    evidenceTypes: readonly string[];
    environment: string;
    rawEvidenceSet: readonly string[];
    retentionDays: number;
    freshnessSeconds: number;
    verifier: string;
  }
>;

export function parseMediaEvidenceProducerPolicy(
  input: unknown,
): MediaEvidenceProducerPolicy {
  const root = record(input, 'producer policy');
  exactKeys(
    root,
    ['schemaVersion', 'policyId', 'status', 'producers'],
    'producer policy',
  );
  if (
    root.schemaVersion !== 1 ||
    root.policyId !== 'hsk-media-evidence-producers-v1' ||
    !isAcceptance(root.status)
  ) {
    throw new Error('Media evidence producer policy identity is invalid.');
  }
  const rawProducers = record(root.producers, 'producer policy.producers');
  exactKeys(
    rawProducers,
    [...MEDIA_EVIDENCE_PRODUCER_KEYS],
    'producer policy.producers',
  );
  const producers = Object.fromEntries(
    MEDIA_EVIDENCE_PRODUCER_KEYS.map((key) => [
      key,
      parseProducer(rawProducers[key], `producer policy.producers.${key}`, key),
    ]),
  ) as Record<MediaEvidenceProducerKey, MediaEvidenceProducer>;
  const values = Object.values(producers);
  const derivedStatus = values.every(
    ({ acceptance }) => acceptance === 'ACCEPTED',
  )
    ? 'ACCEPTED'
    : 'HOST_ACCEPTANCE_REQUIRED';
  if (root.status !== derivedStatus) {
    throw new Error(
      'Media evidence producer policy status does not match producer acceptance.',
    );
  }
  return {
    schemaVersion: 1,
    policyId: 'hsk-media-evidence-producers-v1',
    status: derivedStatus,
    producers,
  };
}

export function requireAcceptedMediaEvidenceProducer(
  policy: MediaEvidenceProducerPolicy,
  key: MediaEvidenceProducerKey,
): AcceptedMediaEvidenceProducer {
  requireAcceptedMediaEvidenceProducerPolicy(policy);
  const producer = policy.producers[key];
  if (
    producer.acceptance !== 'ACCEPTED' ||
    !producer.issuer ||
    !producer.identity ||
    !producer.workflowName ||
    !producer.workflowRef ||
    !producer.workflowRepository ||
    !producer.workflowSha ||
    !producer.trigger ||
    !producer.collectorCommand ||
    !producer.collectorVersion
  ) {
    throw new ExternalEvidenceMissing(
      `${key} producer requires protected-host acceptance.`,
    );
  }
  return producer as AcceptedMediaEvidenceProducer;
}

export function requireAcceptedMediaEvidenceProducerPolicy(
  policy: MediaEvidenceProducerPolicy,
): void {
  if (
    policy.status !== 'ACCEPTED' ||
    MEDIA_EVIDENCE_PRODUCER_KEYS.some(
      (key) => policy.producers[key].acceptance !== 'ACCEPTED',
    )
  ) {
    throw new ExternalEvidenceMissing(
      'All media evidence producers require atomic protected-host acceptance.',
    );
  }
}

export function mediaEvidenceProducerCertificateClaims(
  producer: AcceptedMediaEvidenceProducer,
): string[] {
  return [
    '--certificate-github-workflow-name',
    producer.workflowName,
    '--certificate-github-workflow-ref',
    producer.workflowRef,
    '--certificate-github-workflow-repository',
    producer.workflowRepository,
    '--certificate-github-workflow-sha',
    producer.workflowSha,
    '--certificate-github-workflow-trigger',
    producer.trigger,
  ];
}

export function mediaEvidenceProducerExecutionContract(
  producer: AcceptedMediaEvidenceProducer,
  key: MediaEvidenceProducerKey,
): MediaEvidenceProducerExecutionContract {
  return {
    producerPolicyKey: key,
    collectorCommand: producer.collectorCommand,
    collectorVersion: producer.collectorVersion,
    environment: producer.environment,
    evidenceTypes: [...producer.evidenceTypes],
    rawEvidenceSet: [...producer.rawEvidenceSet],
    freshnessSeconds: producer.freshnessSeconds,
    verifier: producer.verifier,
  };
}

export function assertMediaEvidenceProducerExecution(
  input: unknown,
  expected: MediaEvidenceProducerExecutionContract,
): MediaEvidenceProducerExecutionContract {
  try {
    const value = record(input, 'producer execution contract');
    exactKeys(
      value,
      [
        'producerPolicyKey',
        'collectorCommand',
        'collectorVersion',
        'environment',
        'evidenceTypes',
        'rawEvidenceSet',
        'freshnessSeconds',
        'verifier',
      ],
      'producer execution contract',
    );
    if (value.producerPolicyKey !== expected.producerPolicyKey) {
      throw new Error('mismatch');
    }
    const candidate: MediaEvidenceProducerExecutionContract = {
      producerPolicyKey: expected.producerPolicyKey,
      collectorCommand: exactSignedString(value.collectorCommand),
      collectorVersion: exactSignedString(value.collectorVersion),
      environment: exactSignedString(value.environment),
      evidenceTypes: exactSignedStringArray(value.evidenceTypes),
      rawEvidenceSet: exactSignedStringArray(value.rawEvidenceSet),
      freshnessSeconds: positiveInteger(
        value.freshnessSeconds,
        'producer execution contract.freshnessSeconds',
      ),
      verifier: exactSignedString(value.verifier),
    };
    if (
      candidate.collectorCommand !== expected.collectorCommand ||
      candidate.collectorVersion !== expected.collectorVersion ||
      candidate.environment !== expected.environment ||
      JSON.stringify(candidate.evidenceTypes) !==
        JSON.stringify(expected.evidenceTypes) ||
      JSON.stringify(candidate.rawEvidenceSet) !==
        JSON.stringify(expected.rawEvidenceSet) ||
      candidate.freshnessSeconds !== expected.freshnessSeconds ||
      candidate.verifier !== expected.verifier
    ) {
      throw new Error('mismatch');
    }
    return candidate;
  } catch {
    throw new Error(
      'Signed producer execution contract does not match the accepted producer policy.',
    );
  }
}

function exactSignedString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('signed producer execution value must be a string');
  }
  return value;
}

function exactSignedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('signed producer execution value must be a string array');
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error('signed producer execution value must be a string array');
    }
    result.push(entry);
  }
  return result;
}

function parseProducer(
  input: unknown,
  path: string,
  key: MediaEvidenceProducerKey,
): MediaEvidenceProducer {
  const value = record(input, path);
  exactKeys(
    value,
    [
      'owner',
      'evidenceTypes',
      'acceptance',
      'issuer',
      'identity',
      'workflowName',
      'workflowRef',
      'workflowRepository',
      'workflowSha',
      'trigger',
      'environment',
      'collectorCommand',
      'collectorVersion',
      'rawEvidenceSet',
      'retentionDays',
      'freshnessSeconds',
      'verifier',
    ],
    path,
  );
  const owner = stableString(value.owner, `${path}.owner`);
  const evidenceTypes = stableStringArray(
    value.evidenceTypes,
    `${path}.evidenceTypes`,
  );
  const rawEvidenceSet = stableStringArray(
    value.rawEvidenceSet,
    `${path}.rawEvidenceSet`,
  );
  const environment = stableString(value.environment, `${path}.environment`);
  const verifier = stableString(value.verifier, `${path}.verifier`);
  if (!isAcceptance(value.acceptance)) {
    throw new Error(`${path}.acceptance is invalid.`);
  }
  const acceptance = value.acceptance;
  const nullable = (field: string): string | null => {
    const candidate = value[field];
    if (candidate === null) return null;
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new Error(`${path}.${field} must be an exact string or null.`);
    }
    return candidate;
  };
  const producer: MediaEvidenceProducer = {
    owner,
    evidenceTypes,
    acceptance,
    issuer: nullable('issuer'),
    identity: nullable('identity'),
    workflowName: nullable('workflowName'),
    workflowRef: nullable('workflowRef'),
    workflowRepository: nullable('workflowRepository'),
    workflowSha: nullable('workflowSha'),
    trigger: nullable('trigger'),
    environment,
    collectorCommand: nullable('collectorCommand'),
    collectorVersion: nullable('collectorVersion'),
    rawEvidenceSet,
    retentionDays: positiveInteger(
      value.retentionDays,
      `${path}.retentionDays`,
    ),
    freshnessSeconds: positiveInteger(
      value.freshnessSeconds,
      `${path}.freshnessSeconds`,
    ),
    verifier,
  };
  const protectedFields = [
    producer.issuer,
    producer.identity,
    producer.workflowName,
    producer.workflowRef,
    producer.workflowRepository,
    producer.workflowSha,
    producer.trigger,
    producer.collectorCommand,
    producer.collectorVersion,
  ];
  assertExecutableProducerContract(producer, key, path);
  if (acceptance === 'HOST_ACCEPTANCE_REQUIRED') {
    if (protectedFields.some((field) => field !== null)) {
      throw new Error(`${path} cannot contain a partially accepted producer.`);
    }
    return producer;
  }
  if (protectedFields.some((field) => field === null)) {
    throw new Error(`${path} accepted producer contract is incomplete.`);
  }
  const identity = EXACT_GITHUB_WORKFLOW_IDENTITY.exec(producer.identity ?? '');
  if (
    producer.issuer !== 'https://token.actions.githubusercontent.com' ||
    !identity ||
    identity[1] === FINAL_VERIFIER_WORKFLOW ||
    producer.identity?.includes('*') ||
    producer.workflowName?.includes('*') ||
    producer.workflowRef?.includes('*') ||
    producer.workflowRepository?.includes('*') ||
    producer.workflowSha?.includes('*') ||
    producer.trigger?.includes('*') ||
    !isExactWorkflowName(producer.workflowName ?? '') ||
    producer.workflowName !== producer.workflowName?.trim() ||
    producer.workflowRepository !== MEDIA_EVIDENCE_REPOSITORY ||
    !EXACT_RELEASE_TAG_REF.test(producer.workflowRef ?? '') ||
    !EXACT_TRIGGER.test(producer.trigger ?? '') ||
    !GIT_SHA.test(producer.workflowSha ?? '') ||
    !EXACT_VERSION.test(producer.collectorVersion ?? '') ||
    !isExactCollectorCommand(producer.collectorCommand ?? '')
  ) {
    throw new Error(`${path} accepted producer trust boundary is not exact.`);
  }
  if (identity[2] !== producer.workflowRef) {
    throw new Error(
      `${path} identity does not match its exact workflow claims.`,
    );
  }
  return producer;
}

function isAcceptance(
  value: unknown,
): value is MediaEvidenceProducerAcceptance {
  return value === 'HOST_ACCEPTANCE_REQUIRED' || value === 'ACCEPTED';
}

function stableString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    throw new Error(`${path} must be a stable identifier.`);
  }
  return value;
}

function stableStringArray(value: unknown, path: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (entry) => typeof entry !== 'string' || !STABLE_ID.test(entry),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${path} must contain unique stable identifiers.`);
  }
  return value.map((entry) => String(entry));
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${path} must be a positive safe integer.`);
  }
  return Number(value);
}

function isExactWorkflowName(value: string): boolean {
  if (value.length === 0 || value.length > 128 || value.includes('*')) {
    return false;
  }
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint > 0x1f && codePoint !== 0x7f;
  });
}

function isExactCollectorCommand(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim() &&
    !value.includes('*') &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint > 0x1f && codePoint !== 0x7f;
    })
  );
}

function assertExecutableProducerContract(
  producer: MediaEvidenceProducer,
  key: MediaEvidenceProducerKey,
  path: string,
): void {
  const expected = EXECUTABLE_PRODUCER_CONTRACTS[key];
  if (
    producer.owner !== expected.owner ||
    producer.environment !== expected.environment ||
    JSON.stringify(producer.evidenceTypes) !==
      JSON.stringify(expected.evidenceTypes) ||
    JSON.stringify(producer.rawEvidenceSet) !==
      JSON.stringify(expected.rawEvidenceSet) ||
    producer.retentionDays !== expected.retentionDays ||
    producer.freshnessSeconds !== expected.freshnessSeconds ||
    producer.verifier !== expected.verifier
  ) {
    throw new Error(`${path} does not match its executable verifier contract.`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(`${path} fields are invalid.`);
  }
}
