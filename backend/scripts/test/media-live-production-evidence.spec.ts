import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY,
  LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS,
  MEDIA_LIVE_PRODUCTION_EVIDENCE_MAX_ARTIFACT_BYTES,
  MediaLiveProductionEvidenceError,
  computeMediaLiveEnvironmentFingerprint,
  parseVerifiedMediaLiveProductionEvidence,
} from './media-live-production-evidence';

const nowMs = Date.parse('2026-08-22T12:00:00.000Z');
const binding = {
  gitCommit: 'a'.repeat(40),
  gitTreeSha: 'b'.repeat(40),
  releaseContentDigest: 'c'.repeat(64),
};
const producer = {
  issuer: 'https://token.actions.githubusercontent.com',
  identity:
    'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-release-evidence.yml@refs/tags/v3.0.0',
};
const environment = {
  clusterIdentitySha256: 'd'.repeat(64),
  namespaceIdentitySha256: 'e'.repeat(64),
  deploymentRevision: `sha256:${'f'.repeat(64)}`,
  fingerprintSha256: '',
};
environment.fingerprintSha256 =
  computeMediaLiveEnvironmentFingerprint(environment);
const freshness = {
  observedAt: '2026-08-22T11:00:00.000Z',
  expiresAt: '2026-08-23T11:00:00.000Z',
};

void test('accepts exactly six distinct raw live artifacts and exports per-ID verification records', () => {
  withFixture((fixture) => {
    const result = verify(fixture);
    assert.deepEqual(
      result.artifacts.map(({ verification }) => verification.prerequisiteId),
      [...LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS],
    );
    assert.equal(result.artifacts.length, 6);
    assert.equal(
      new Set(
        result.artifacts.map(({ verification }) => verification.evidenceSha256),
      ).size,
      6,
    );
    assert.equal(
      new Set(result.artifacts.map(({ relativePath }) => relativePath)).size,
      6,
    );
    for (const artifact of result.artifacts) {
      assert.equal(
        artifact.verification.evidenceSha256,
        sha256(artifact.bytes),
      );
      assert.equal(artifact.verification.producerIssuer, producer.issuer);
      assert.equal(artifact.verification.producerIdentity, producer.identity);
      assert.deepEqual(artifact.verification.binding, binding);
    }
  });
});

void test('keeps the semantic registry complete, exact and discriminated by prerequisite ID', () => {
  assert.deepEqual(Object.keys(LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY), [
    ...LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS,
  ]);
  assert.deepEqual(LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY, {
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
  });
  for (const id of LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS) {
    const policy: {
      evidenceType: string;
      requiredCheckIds: readonly string[];
    } = LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY[id];
    assert.match(policy.evidenceType, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
    assert.ok(policy.requiredCheckIds.length >= 4);
    assert.equal(
      new Set(policy.requiredCheckIds).size,
      policy.requiredCheckIds.length,
    );
  }
});

void test('rejects missing, duplicate or unsupported IDs and a wrong evidence type', () => {
  for (const mutate of [
    (manifest: ManifestFixture) => manifest.artifacts.pop(),
    (manifest: ManifestFixture) => {
      manifest.artifacts[5] = structuredClone(manifest.artifacts[0]);
    },
    (manifest: ManifestFixture) => {
      manifest.artifacts[0].prerequisiteId = 'media-unsupported-live-check';
    },
    (manifest: ManifestFixture) => {
      manifest.artifacts[0].evidenceType = 'signed-generic-assertion';
    },
  ]) {
    withFixture((fixture) => {
      mutate(fixture.manifest);
      refreshManifestTrust(fixture);
      assert.throws(
        () => verify(fixture),
        /exactly six|duplicate|unsupported|evidence type|incomplete/i,
      );
    });
  }
});

void test('rejects missing, extra, duplicate or non-PASS semantic checks', () => {
  for (const mutate of [
    (artifact: RawArtifactFixture) => artifact.checks.pop(),
    (artifact: RawArtifactFixture) =>
      artifact.checks.push({
        id: 'unsupported-check',
        status: 'PASS',
        evidenceSha256: '1'.repeat(64),
      }),
    (artifact: RawArtifactFixture) => {
      artifact.checks[1] = structuredClone(artifact.checks[0]);
    },
    (artifact: RawArtifactFixture) => {
      artifact.checks[0].status = 'FAIL';
    },
  ]) {
    withFixture((fixture) => {
      mutate(fixture.rawArtifacts[0].value);
      rewriteRawArtifact(fixture, 0);
      assert.throws(
        () => verify(fixture),
        /semantic check|duplicate|unsupported|PASS/i,
      );
    });
  }
});

void test('rejects manifest tampering and raw artifact tampering before semantic use', () => {
  withFixture((fixture) => {
    fixture.manifest.environment.deploymentRevision = `sha256:${'1'.repeat(64)}`;
    assert.throws(() => verify(fixture), MediaLiveProductionEvidenceError);
  });

  withFixture((fixture) => {
    fixture.rawArtifacts[0].value.checks[0].evidenceSha256 = '2'.repeat(64);
    writeFileSync(
      join(fixture.root, fixture.rawArtifacts[0].relativePath),
      JSON.stringify(fixture.rawArtifacts[0].value),
    );
    assert.throws(() => verify(fixture), /artifact digest/i);
  });
});

void test('rejects wrong signing identity, release binding, freshness and environment binding', () => {
  withFixture((fixture) => {
    fixture.options.verifiedSignature.identity =
      'https://github.com/example/other/.github/workflows/release.yml@refs/tags/v1';
    assert.throws(() => verify(fixture), /trusted producer/i);
  });
  withFixture((fixture) => {
    fixture.manifest.binding.gitCommit = '1'.repeat(40);
    refreshManifestTrust(fixture);
    assert.throws(() => verify(fixture), /exact release/i);
  });
  withFixture((fixture) => {
    fixture.manifest.expiresAt = '2026-08-22T11:59:59.000Z';
    refreshManifestTrust(fixture);
    assert.throws(() => verify(fixture), /stale|freshness/i);
  });
  withFixture((fixture) => {
    fixture.manifest.observedAt = '2026-08-22T10:30:00.000Z';
    fixture.manifest.expiresAt = '2026-08-23T10:30:00.000Z';
    refreshManifestTrust(fixture);
    assert.throws(() => verify(fixture), /freshness.*signed manifest/i);
  });
  withFixture((fixture) => {
    fixture.manifest.environment.fingerprintSha256 = '3'.repeat(64);
    refreshManifestTrust(fixture);
    assert.throws(() => verify(fixture), /environment fingerprint/i);
  });
  withFixture((fixture) => {
    fixture.rawArtifacts[0].value.environment.deploymentRevision = `sha256:${'4'.repeat(64)}`;
    rewriteRawArtifact(fixture, 0);
    assert.throws(() => verify(fixture), /environment/i);
  });
});

void test('rejects duplicate raw paths, digests and credentialed or duplicate evidence URIs', () => {
  withFixture((fixture) => {
    fixture.manifest.artifacts[1].relativePath =
      fixture.manifest.artifacts[0].relativePath;
    fixture.manifest.artifacts[1].sha256 = fixture.manifest.artifacts[0].sha256;
    refreshManifestTrust(fixture);
    assert.throws(() => verify(fixture), /distinct.*path|distinct.*digest/i);
  });
  withFixture((fixture) => {
    fixture.rawArtifacts[0].value.evidenceUri =
      'https://user:secret@evidence.example.com/live/result.json';
    rewriteRawArtifact(fixture, 0);
    assert.throws(() => verify(fixture), /credential-free production HTTPS/i);
  });
  withFixture((fixture) => {
    fixture.rawArtifacts[1].value.evidenceUri =
      'https://evidence.example.com:443/media/media-live-s3-provider.json';
    rewriteRawArtifact(fixture, 1);
    assert.throws(() => verify(fixture), /distinct evidence URI/i);
  });
});

void test('classifies missing, traversal, symlink, hard-link and oversized raw artifacts as external evidence errors', () => {
  withFixture((fixture) => {
    rmSync(join(fixture.root, fixture.rawArtifacts[0].relativePath));
    assertExternalEvidenceError(() => verify(fixture), /absent or unsafe/i);
  });
  withFixture((fixture) => {
    fixture.manifest.artifacts[0].relativePath = '../outside.json';
    refreshManifestTrust(fixture);
    assertExternalEvidenceError(() => verify(fixture), /path|root|relative/i);
  });
  withFixture((fixture) => {
    const target = join(fixture.root, fixture.rawArtifacts[0].relativePath);
    const alternate = join(fixture.root, 'live', 'alternate.json');
    writeFileSync(alternate, readFileSync(target));
    rmSync(target);
    symlinkSync(alternate, target);
    assertExternalEvidenceError(
      () => verify(fixture),
      /symbolic|regular file|descriptor/i,
    );
  });
  withFixture((fixture) => {
    const target = join(fixture.root, fixture.rawArtifacts[0].relativePath);
    linkSync(target, join(fixture.root, 'live', 'second-link.json'));
    assertExternalEvidenceError(
      () => verify(fixture),
      /single-link regular file/i,
    );
  });
  withFixture((fixture) => {
    const target = join(fixture.root, fixture.rawArtifacts[0].relativePath);
    writeFileSync(
      target,
      Buffer.alloc(MEDIA_LIVE_PRODUCTION_EVIDENCE_MAX_ARTIFACT_BYTES + 1, 0x20),
    );
    assertExternalEvidenceError(
      () => verify(fixture),
      /bounded single-link regular file/i,
    );
  });
});

void test('keeps invalid validator configuration classified as an internal error', () => {
  withFixture((fixture) => {
    fixture.options.nowMs = Number.NaN;
    assert.throws(
      () => verify(fixture),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof MediaLiveProductionEvidenceError) &&
        /validation time is invalid/i.test(error.message),
    );
  });
});

function assertExternalEvidenceError(
  run: () => unknown,
  message: RegExp,
): void {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof MediaLiveProductionEvidenceError &&
      message.test(error.message),
  );
}

function verify(fixture: EvidenceFixture) {
  const manifestBytes = Buffer.from(JSON.stringify(fixture.manifest));
  return parseVerifiedMediaLiveProductionEvidence(
    manifestBytes,
    fixture.root,
    fixture.options,
  );
}

function withFixture(run: (fixture: EvidenceFixture) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'hsk-media-live-evidence-'));
  mkdirSync(join(root, 'live'), { recursive: true });
  const manifest: ManifestFixture = {
    schemaVersion: 1,
    manifestId: 'hsk-media-live-production-evidence-v1',
    producer: { ...producer },
    binding: { ...binding },
    environment: { ...environment },
    observedAt: freshness.observedAt,
    expiresAt: freshness.expiresAt,
    artifacts: [],
  };
  const rawArtifacts: RawArtifactState[] = [];
  for (const [
    index,
    prerequisiteId,
  ] of LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS.entries()) {
    const policy = LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY[prerequisiteId];
    const relativePath = `live/${prerequisiteId}.json`;
    const value: RawArtifactFixture = {
      schemaVersion: 1,
      prerequisiteId,
      evidenceType: policy.evidenceType,
      status: 'PASS',
      evidenceUri: `https://evidence.example.com/media/${prerequisiteId}.json`,
      producer: { ...producer },
      binding: { ...binding },
      environment: { ...environment },
      freshness: { ...freshness },
      commandProvenanceSha256: String(index + 1).repeat(64),
      sanitizedLogSha256: String(index + 2).repeat(64),
      checks: policy.requiredCheckIds.map((id, checkIndex) => ({
        id,
        status: 'PASS',
        evidenceSha256: ((index + checkIndex + 3) % 10).toString().repeat(64),
      })),
    };
    const bytes = Buffer.from(JSON.stringify(value));
    writeFileSync(join(root, relativePath), bytes);
    rawArtifacts.push({ relativePath, value });
    manifest.artifacts.push({
      prerequisiteId,
      evidenceType: policy.evidenceType,
      relativePath,
      sha256: sha256(bytes),
    });
  }
  const fixture: EvidenceFixture = {
    root,
    manifest,
    rawArtifacts,
    options: {
      nowMs,
      expectedBinding: { ...binding },
      trustedProducer: { ...producer },
      verifiedSignature: {
        payloadSha256: sha256(Buffer.from(JSON.stringify(manifest))),
        ...producer,
      },
    },
  };
  try {
    run(fixture);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function rewriteRawArtifact(fixture: EvidenceFixture, index: number): void {
  const state = fixture.rawArtifacts[index];
  const bytes = Buffer.from(JSON.stringify(state.value));
  writeFileSync(join(fixture.root, state.relativePath), bytes);
  fixture.manifest.artifacts[index].sha256 = sha256(bytes);
  refreshManifestTrust(fixture);
}

function refreshManifestTrust(fixture: EvidenceFixture): void {
  fixture.options.verifiedSignature.payloadSha256 = sha256(
    Buffer.from(JSON.stringify(fixture.manifest)),
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

type BindingFixture = typeof binding;
type ProducerFixture = typeof producer;
type EnvironmentFixture = typeof environment;

type ManifestArtifactFixture = {
  prerequisiteId: string;
  evidenceType: string;
  relativePath: string;
  sha256: string;
};

type ManifestFixture = {
  schemaVersion: number;
  manifestId: string;
  producer: ProducerFixture;
  binding: BindingFixture;
  environment: EnvironmentFixture;
  observedAt: string;
  expiresAt: string;
  artifacts: ManifestArtifactFixture[];
};

type RawArtifactFixture = {
  schemaVersion: number;
  prerequisiteId: string;
  evidenceType: string;
  status: string;
  evidenceUri: string;
  producer: ProducerFixture;
  binding: BindingFixture;
  environment: EnvironmentFixture;
  freshness: typeof freshness;
  commandProvenanceSha256: string;
  sanitizedLogSha256: string;
  checks: Array<{ id: string; status: string; evidenceSha256: string }>;
};

type RawArtifactState = {
  relativePath: string;
  value: RawArtifactFixture;
};

type EvidenceFixture = {
  root: string;
  manifest: ManifestFixture;
  rawArtifacts: RawArtifactState[];
  options: {
    nowMs: number;
    expectedBinding: BindingFixture;
    trustedProducer: ProducerFixture;
    verifiedSignature: ProducerFixture & { payloadSha256: string };
  };
};
