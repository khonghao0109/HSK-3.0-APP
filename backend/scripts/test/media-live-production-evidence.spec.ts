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
import {
  InternalVerifierFailure,
  classifyMediaReleaseEvidenceError,
} from '../operations/media-release-evidence-errors';

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
const collectorRun = {
  runId: '1234567890',
  runAttempt: 2,
};
const workloadIdentity = {
  audience: 'hsk-media-backend',
  subject: 'system:serviceaccount:production:media-backend',
};
const producerExecution = {
  producerPolicyKey: 'live-rehearsal' as const,
  collectorCommand: 'npm run collect:live-rehearsal',
  collectorVersion: '1.0.0',
  environment: 'media-production-release',
  evidenceTypes: LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS.map(
    (id) => LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY[id].evidenceType,
  ),
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
  freshnessSeconds: 604_800,
  verifier: 'live-rehearsal-evidence-verifier',
};

void test('accepts exactly six distinct raw live artifacts and exports per-ID verification records', () => {
  withFixture((fixture) => {
    const result = verify(fixture);
    assert.deepEqual(
      result.artifacts.map(({ verification }) => verification.prerequisiteId),
      [...LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS],
    );
    assert.equal(result.artifacts.length, 6);
    assert.deepEqual(result.collectorRun, collectorRun);
    assert.equal(result.rawArtifacts.length, 6);
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
      assert.equal(
        new Set(Object.values(artifact.checkEvidenceSha256)).size,
        1,
      );
    }
    for (const rawArtifact of result.rawArtifacts) {
      assert.equal(rawArtifact.sha256, sha256(rawArtifact.bytes));
      assert.equal(rawArtifact.sizeBytes, rawArtifact.bytes.length);
      assert.equal(rawArtifact.mediaType, 'application/json');
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
        evidenceArtifactId: artifact.checks[0].evidenceArtifactId,
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
  withFixture((fixture) => {
    const attackerSelectedEnvironment = {
      clusterIdentitySha256: '1'.repeat(64),
      namespaceIdentitySha256: '2'.repeat(64),
      deploymentRevision: `sha256:${'3'.repeat(64)}`,
      fingerprintSha256: '',
    };
    attackerSelectedEnvironment.fingerprintSha256 =
      computeMediaLiveEnvironmentFingerprint(attackerSelectedEnvironment);
    fixture.manifest.environment = attackerSelectedEnvironment;
    for (const [index, artifact] of fixture.rawArtifacts.entries()) {
      artifact.value.environment = { ...attackerSelectedEnvironment };
      rewriteRawArtifact(fixture, index);
    }
    assert.throws(() => verify(fixture), /expected production environment/i);
  });
});

void test('rejects duplicate summary paths and credentialed or duplicate evidence URIs', () => {
  withFixture((fixture) => {
    fixture.manifest.artifacts[1].relativePath =
      fixture.manifest.artifacts[0].relativePath;
    fixture.manifest.artifacts[1].sha256 = fixture.manifest.artifacts[0].sha256;
    refreshManifestTrust(fixture);
    assert.throws(() => verify(fixture), /distinct.*path/i);
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

void test('rejects missing, mismatched, zero-digest and unbounded referenced raw evidence', () => {
  withFixture((fixture) => {
    rmSync(join(fixture.root, fixture.rawEvidenceArtifacts[0].relativePath));
    assertExternalEvidenceError(
      () => verify(fixture),
      /raw evidence.*absent|absent.*raw evidence/i,
    );
  });
  withFixture((fixture) => {
    writeFileSync(
      join(fixture.root, fixture.rawEvidenceArtifacts[0].relativePath),
      Buffer.from('{"tampered":true}'),
    );
    assertExternalEvidenceError(() => verify(fixture), /raw evidence.*digest/i);
  });
  withFixture((fixture) => {
    fixture.manifest.rawArtifacts[0].sha256 = '0'.repeat(64);
    refreshManifestTrust(fixture);
    assertExternalEvidenceError(() => verify(fixture), /zero digest/i);
  });
  withFixture((fixture) => {
    fixture.rawArtifacts[0].value.checks[0].evidenceArtifactId =
      'missing-raw-artifact';
    rewriteRawArtifact(fixture, 0);
    assertExternalEvidenceError(
      () => verify(fixture),
      /references missing raw evidence/i,
    );
  });
  withFixture((fixture) => {
    fixture.rawArtifacts[0].value.checks[0].evidenceSha256 = '9'.repeat(64);
    rewriteRawArtifact(fixture, 0);
    assertExternalEvidenceError(
      () => verify(fixture),
      /does not match.*referenced raw evidence/i,
    );
  });
  withFixture((fixture) => {
    fixture.manifest.rawArtifacts[0].relativePath = '../raw-evidence.json';
    refreshManifestTrust(fixture);
    assertExternalEvidenceError(
      () => verify(fixture),
      /safe relative JSON path/i,
    );
  });
  withFixture((fixture) => {
    const target = join(
      fixture.root,
      fixture.rawEvidenceArtifacts[0].relativePath,
    );
    writeFileSync(
      target,
      Buffer.alloc(MEDIA_LIVE_PRODUCTION_EVIDENCE_MAX_ARTIFACT_BYTES + 1, 0x20),
    );
    assertExternalEvidenceError(
      () => verify(fixture),
      /raw evidence.*bounded|bounded.*raw evidence/i,
    );
  });
});

void test('binds the package and every raw artifact to the expected collector run', () => {
  withFixture((fixture) => {
    fixture.manifest.collectorRun.runId = '1234567891';
    refreshManifestTrust(fixture);
    assertExternalEvidenceError(() => verify(fixture), /collector run|replay/i);
  });
  withFixture((fixture) => {
    fixture.rawEvidenceArtifacts[0].value.collectorRun.runAttempt = 3;
    rewriteRawEvidenceArtifact(fixture, 0);
    assertExternalEvidenceError(() => verify(fixture), /collector run|replay/i);
  });
});

void test('rejects PASS when any of the six raw domain semantic shapes is not proven', () => {
  const mutations: Array<(semantics: Record<string, unknown>) => void> = [
    (semantics) => {
      semantics.checksumMatched = false;
    },
    (semantics) => {
      semantics.eicarFound = false;
    },
    (semantics) => {
      semantics.mtlsMode = 'PERMISSIVE';
    },
    (semantics) => {
      semantics.resolvedNotificationReceipt = '';
    },
    (semantics) => {
      semantics.readyReplicas = 1;
    },
    (semantics) => {
      semantics.staticCredentialsPresent = true;
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    withFixture((fixture) => {
      mutate(fixture.rawEvidenceArtifacts[index].value.semantics);
      rewriteRawEvidenceArtifact(fixture, index);
      assertExternalEvidenceError(
        () => verify(fixture),
        /semantic|rehearsal|evidence/i,
      );
    });
  }
});

void test('rejects live semantic values that do not match the production rehearsal contract', () => {
  const mutations: Array<{
    prerequisiteIndex: number;
    mutate: (semantics: Record<string, unknown>) => void;
  }> = [
    {
      prerequisiteIndex: 1,
      mutate: (semantics) => {
        semantics.cleanFormatsAccepted = [
          'audio/mpeg',
          'image/jpeg',
          'image/png',
        ];
      },
    },
    {
      prerequisiteIndex: 3,
      mutate: (semantics) => {
        semantics.ownerRoute = 'security-platform';
      },
    },
    {
      prerequisiteIndex: 3,
      mutate: (semantics) => {
        semantics.resolvedNotificationReceipt =
          semantics.firingNotificationReceipt;
      },
    },
    {
      prerequisiteIndex: 5,
      mutate: (semantics) => {
        semantics.audience = 'another-service';
      },
    },
    {
      prerequisiteIndex: 5,
      mutate: (semantics) => {
        semantics.subject = 'system:serviceaccount:production:another-service';
      },
    },
  ];

  for (const { prerequisiteIndex, mutate } of mutations) {
    withFixture((fixture) => {
      mutate(fixture.rawEvidenceArtifacts[prerequisiteIndex].value.semantics);
      rewriteRawEvidenceArtifact(fixture, prerequisiteIndex);
      assertExternalEvidenceError(
        () => verify(fixture),
        /semantic|rehearsal|evidence/i,
      );
    });
  }
});

void test('allows one verified raw artifact to prove multiple explicitly mapped checks', () => {
  withFixture((fixture) => {
    const summary = fixture.rawArtifacts[0].value;
    assert.ok(summary.checks.length > 1);
    assert.equal(
      new Set(
        summary.checks.map(({ evidenceArtifactId }) => evidenceArtifactId),
      ).size,
      1,
    );
    const result = verify(fixture);
    assert.equal(
      new Set(Object.values(result.artifacts[0].checkEvidenceSha256)).size,
      1,
    );
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

void test('preserves stable-read runtime faults as typed internal failures', () => {
  for (const code of ['EIO', 'EMFILE', 'ENOMEM']) {
    withFixture((fixture) => {
      fixture.options.stableFileBoundaryTestHooks = {
        beforeDescriptorOpen: () => {
          throw Object.assign(new Error(`${code} fixture`), { code });
        },
      };
      assert.throws(
        () => verify(fixture),
        (error: unknown) =>
          error instanceof InternalVerifierFailure &&
          classifyMediaReleaseEvidenceError(error) === 'FAIL_INTERNAL',
        `${code} must remain an internal verifier failure`,
      );
    });
  }

  withFixture((fixture) => {
    fixture.options.stableFileBoundaryTestHooks = {
      afterDescriptorOpen: () => {
        throw new Error('proc descriptor boundary unavailable');
      },
    };
    assert.throws(
      () => verify(fixture),
      (error: unknown) =>
        error instanceof InternalVerifierFailure &&
        classifyMediaReleaseEvidenceError(error) === 'FAIL_INTERNAL',
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
  withFixture((fixture) => {
    fixture.options.expectedEnvironment.clusterIdentitySha256 = 'invalid';
    assert.throws(
      () => verify(fixture),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof MediaLiveProductionEvidenceError) &&
        /expected production environment.*invalid/i.test(error.message),
    );
  });
  withFixture((fixture) => {
    fixture.options.expectedWorkloadIdentity.audience = '*';
    assert.throws(
      () => verify(fixture),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof MediaLiveProductionEvidenceError) &&
        /expected workload identity.*invalid/i.test(error.message),
    );
  });
});

void test('binds workload audience and subject to independent verifier inputs', () => {
  withFixture((fixture) => {
    fixture.options.expectedWorkloadIdentity.audience = 'another-audience';
    assertExternalEvidenceError(() => verify(fixture), /workload identity/i);
  });
  withFixture((fixture) => {
    fixture.options.expectedWorkloadIdentity.subject =
      'system:serviceaccount:hsk:another-backend';
    assertExternalEvidenceError(() => verify(fixture), /workload identity/i);
  });
});

void test('requires the signed live producer execution contract', () => {
  withFixture((fixture) => {
    fixture.manifest.producerExecution.collectorVersion = '9.9.9';
    refreshManifestTrust(fixture);
    assertExternalEvidenceError(() => verify(fixture), /producer execution/i);
  });
});

void test('rejects hash-shaped PASS assertions that have no bounded raw evidence bytes', () => {
  withFixture((fixture) => {
    const artifact = fixture.rawArtifacts[0].value;
    artifact.commandProvenanceSha256 = '0'.repeat(64);
    artifact.sanitizedLogSha256 = '0'.repeat(64);
    for (const check of artifact.checks) {
      check.evidenceSha256 = '0'.repeat(64);
    }
    rewriteRawArtifact(fixture, 0);

    assert.throws(
      () => verify(fixture),
      /zero digest|raw evidence|referenced evidence/i,
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
  mkdirSync(join(root, 'live', 'raw'), { recursive: true });
  const manifest: ManifestFixture = {
    schemaVersion: 2,
    manifestId: 'hsk-media-live-production-evidence-v2',
    producer: { ...producer },
    producerExecution: structuredClone(producerExecution),
    collectorRun: { ...collectorRun },
    binding: { ...binding },
    environment: { ...environment },
    observedAt: freshness.observedAt,
    expiresAt: freshness.expiresAt,
    rawArtifacts: [],
    artifacts: [],
  };
  const rawArtifacts: RawArtifactState[] = [];
  const rawEvidenceArtifacts: RawEvidenceArtifactState[] = [];
  for (const prerequisiteId of LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS) {
    const policy = LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY[prerequisiteId];
    const rawEvidenceId = `${prerequisiteId}-raw`;
    const rawEvidenceRelativePath = `live/raw/${prerequisiteId}.json`;
    const rawEvidenceValue = rawDomainEvidence(prerequisiteId);
    const rawEvidenceBytes = Buffer.from(JSON.stringify(rawEvidenceValue));
    const rawEvidenceSha256 = sha256(rawEvidenceBytes);
    writeFileSync(join(root, rawEvidenceRelativePath), rawEvidenceBytes);
    rawEvidenceArtifacts.push({
      id: rawEvidenceId,
      prerequisiteId,
      relativePath: rawEvidenceRelativePath,
      value: rawEvidenceValue,
    });
    manifest.rawArtifacts.push({
      id: rawEvidenceId,
      prerequisiteId,
      relativePath: rawEvidenceRelativePath,
      mediaType: 'application/json',
      sizeBytes: rawEvidenceBytes.length,
      sha256: rawEvidenceSha256,
    });

    const relativePath = `live/${prerequisiteId}.json`;
    const value: RawArtifactFixture = {
      schemaVersion: 2,
      prerequisiteId,
      evidenceType: policy.evidenceType,
      status: 'PASS',
      evidenceUri: `https://evidence.example.com/media/${prerequisiteId}.json`,
      producer: { ...producer },
      binding: { ...binding },
      environment: { ...environment },
      freshness: { ...freshness },
      collectorRun: { ...collectorRun },
      commandProvenanceArtifactId: rawEvidenceId,
      commandProvenanceSha256: rawEvidenceSha256,
      sanitizedLogArtifactId: rawEvidenceId,
      sanitizedLogSha256: rawEvidenceSha256,
      checks: policy.requiredCheckIds.map((id) => ({
        id,
        status: 'PASS',
        evidenceArtifactId: rawEvidenceId,
        evidenceSha256: rawEvidenceSha256,
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
    rawEvidenceArtifacts,
    options: {
      nowMs,
      expectedBinding: { ...binding },
      expectedEnvironment: { ...environment },
      expectedWorkloadIdentity: { ...workloadIdentity },
      expectedProducerExecution: structuredClone(producerExecution),
      expectedCollectorRun: { ...collectorRun },
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

function rewriteRawEvidenceArtifact(
  fixture: EvidenceFixture,
  index: number,
): void {
  const state = fixture.rawEvidenceArtifacts[index];
  const bytes = Buffer.from(JSON.stringify(state.value));
  writeFileSync(join(fixture.root, state.relativePath), bytes);
  const digest = sha256(bytes);
  const reference = fixture.manifest.rawArtifacts[index];
  reference.sha256 = digest;
  reference.sizeBytes = bytes.length;

  const summary = fixture.rawArtifacts[index].value;
  summary.commandProvenanceSha256 = digest;
  summary.sanitizedLogSha256 = digest;
  for (const check of summary.checks) {
    check.evidenceSha256 = digest;
  }
  rewriteRawArtifact(fixture, index);
}

function rawDomainEvidence(prerequisiteId: string): RawEvidenceFixture {
  const common = {
    schemaVersion: 1,
    evidenceKind: prerequisiteId.replace(/^media-/u, ''),
    collectorRun: { ...collectorRun },
    command: {
      name: `collect-${prerequisiteId}`,
      version: '1.0.0',
      exitCode: 0,
    },
    sanitizedLog: {
      redacted: true,
      secretsDetected: 0,
    },
  };
  switch (prerequisiteId) {
    case 'media-live-s3-provider':
      return {
        ...common,
        semantics: {
          publicAccessBlocked: true,
          tlsVersion: 'TLSv1.3',
          encryption: 'aws:kms',
          versioning: 'Enabled',
          lifecycleRules: 1,
          putStatus: 200,
          headStatus: 200,
          getStatus: 200,
          deleteStatus: 204,
          checksumMatched: true,
          byteReadbackMatched: true,
          oversizeRejected: true,
          deniedRejected: true,
          missingRejected: true,
          timeoutRejected: true,
          resetRejected: true,
          unknownPutSettled: true,
        },
      };
    case 'media-live-clamav':
      return {
        ...common,
        semantics: {
          engineVersion: '1.4.2',
          databaseVersion: '20260822',
          cleanFormatsAccepted: [
            'audio/mpeg',
            'audio/wav',
            'image/jpeg',
            'image/png',
          ],
          eicarFound: true,
          transportFailuresRejected: true,
          malformedRejected: true,
          oversizedRejected: true,
          concurrencyLimit: 4,
          backpressureObserved: true,
        },
      };
    case 'media-deployed-proxy-mesh-policy':
      return {
        ...common,
        semantics: {
          nginxPolicyRevision: `sha256:${'1'.repeat(64)}`,
          privateNoStoreEnforced: true,
          querySignatureRedacted: true,
          mtlsMode: 'STRICT',
          networkPolicyDefaultDeny: true,
          authorizedWorkloadAllowed: true,
        },
      };
    case 'media-production-alert-delivery':
      return {
        ...common,
        semantics: {
          alertName: 'HskMediaValidationSyntheticPage',
          firingObserved: true,
          ownerRoute: 'platform-sre',
          firingNotificationReceipt: 'receipt-firing-123',
          resolvedNotificationReceipt: 'receipt-resolved-123',
          escalationReceipt: 'receipt-escalation-123',
        },
      };
    case 'media-backend-replica-discovery':
      return {
        ...common,
        semantics: {
          readyReplicas: 2,
          headlessServiceEndpoints: 2,
          distinctPodTargets: 2,
          scrapedReplicaTargets: 2,
          replacementReconverged: true,
        },
      };
    case 'media-secret-manager-workload-identity':
      return {
        ...common,
        semantics: {
          issuer: 'https://identity.example.com',
          audience: 'hsk-media-backend',
          subject: 'system:serviceaccount:production:media-backend',
          staticCredentialsPresent: false,
          secretReadAuthorized: true,
          tokenTtlSeconds: 900,
          rotationOverlapVerified: true,
          auditEventId: 'audit-event-123',
        },
      };
    default:
      throw new Error(`Unsupported fixture prerequisite: ${prerequisiteId}.`);
  }
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
type CollectorRunFixture = typeof collectorRun;

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
  producerExecution: typeof producerExecution;
  collectorRun: CollectorRunFixture;
  binding: BindingFixture;
  environment: EnvironmentFixture;
  observedAt: string;
  expiresAt: string;
  rawArtifacts: ManifestRawArtifactFixture[];
  artifacts: ManifestArtifactFixture[];
};

type ManifestRawArtifactFixture = {
  id: string;
  prerequisiteId: string;
  relativePath: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
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
  collectorRun: CollectorRunFixture;
  commandProvenanceArtifactId: string;
  commandProvenanceSha256: string;
  sanitizedLogArtifactId: string;
  sanitizedLogSha256: string;
  checks: Array<{
    id: string;
    status: string;
    evidenceArtifactId: string;
    evidenceSha256: string;
  }>;
};

type RawEvidenceFixture = {
  schemaVersion: number;
  evidenceKind: string;
  collectorRun: CollectorRunFixture;
  command: {
    name: string;
    version: string;
    exitCode: number;
  };
  sanitizedLog: {
    redacted: boolean;
    secretsDetected: number;
  };
  semantics: Record<string, unknown>;
};

type RawArtifactState = {
  relativePath: string;
  value: RawArtifactFixture;
};

type RawEvidenceArtifactState = {
  id: string;
  prerequisiteId: string;
  relativePath: string;
  value: RawEvidenceFixture;
};

type EvidenceFixture = {
  root: string;
  manifest: ManifestFixture;
  rawArtifacts: RawArtifactState[];
  rawEvidenceArtifacts: RawEvidenceArtifactState[];
  options: {
    nowMs: number;
    expectedBinding: BindingFixture;
    expectedEnvironment: EnvironmentFixture;
    expectedWorkloadIdentity: {
      audience: string;
      subject: string;
    };
    expectedProducerExecution: typeof producerExecution;
    expectedCollectorRun: CollectorRunFixture;
    trustedProducer: ProducerFixture;
    verifiedSignature: ProducerFixture & { payloadSha256: string };
    stableFileBoundaryTestHooks?: {
      beforeDescriptorOpen?: () => void;
      afterDescriptorOpen?: () => void;
    };
  };
};
