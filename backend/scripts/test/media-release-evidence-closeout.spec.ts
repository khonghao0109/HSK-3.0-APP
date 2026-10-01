import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import * as producerPolicy from '../operations/media-evidence-producer-policy';
import * as taxonomy from '../operations/media-release-evidence-errors';

void test('classifies only missing or invalid external evidence as BLOCKED_EXTERNAL', () => {
  for (const error of [
    new taxonomy.ExternalEvidenceMissing('missing'),
    new taxonomy.ExternalEvidenceInvalid('invalid'),
  ]) {
    assert.equal(
      taxonomy.classifyMediaReleaseEvidenceError(error),
      'BLOCKED_EXTERNAL',
    );
  }
  for (const error of [
    new taxonomy.InternalToolFailure('tool'),
    new taxonomy.InternalVerifierFailure('verifier'),
    new taxonomy.InternalRetentionFailure('retention'),
    new Error('unknown'),
  ]) {
    assert.equal(
      taxonomy.classifyMediaReleaseEvidenceError(error),
      'FAIL_INTERNAL',
    );
  }

  for (const message of [
    'Verified evidence payload digest does not match.',
    'Verified evidence issuer is not approved.',
    'Verified evidence identity is not approved.',
    'Verified evidence trust result is stale.',
  ]) {
    assert.throws(
      () =>
        taxonomy.rethrowDetachedEvidenceFailure(new Error(message), 'fixture'),
      (error: unknown) =>
        taxonomy.classifyMediaReleaseEvidenceError(error) ===
        'BLOCKED_EXTERNAL',
    );
  }
  assert.throws(
    () =>
      taxonomy.rethrowDetachedEvidenceFailure(
        new Error('unexpected parser bug'),
        'fixture',
      ),
    (error: unknown) =>
      taxonomy.classifyMediaReleaseEvidenceError(error) === 'FAIL_INTERNAL',
  );
});

void test('keeps Cosign tool and CLI failures internal while invalid signatures remain external', () => {
  const classification = (result: unknown) => {
    try {
      taxonomy.assertCosignVerificationSucceeded(
        result as taxonomy.CosignVerificationResult,
        'fixture',
      );
      return 'PASS';
    } catch (error: unknown) {
      return taxonomy.classifyMediaReleaseEvidenceError(error);
    }
  };

  assert.equal(
    classification({ kind: 'success', status: 0, stdout: '', stderr: '' }),
    'PASS',
  );
  for (const result of [
    { kind: 'missing', stdout: '', stderr: '' },
    { kind: 'timeout', stdout: '', stderr: '' },
    { kind: 'spawn-error', stdout: '', stderr: 'EACCES' },
    { kind: 'signal', signal: 'SIGKILL', stdout: '', stderr: '' },
    {
      kind: 'exit',
      status: 1,
      stdout: '',
      stderr: 'unknown flag: --certificate-github-workflow-sha',
    },
    {
      kind: 'exit',
      status: 1,
      stdout: '',
      stderr:
        'error getting Rekor public keys: Get https://rekor.example: connection refused',
    },
    {
      kind: 'exit',
      status: 1,
      stdout: '',
      stderr: 'initializing TUF client: context deadline exceeded',
    },
    {
      kind: 'exit',
      status: 1,
      stdout: '',
      stderr:
        'unable to verify signature: Get "https://rekor.sigstore.dev/api/v1/log": context deadline exceeded',
    },
    {
      kind: 'exit',
      status: 2,
      stdout: '',
      stderr: 'panic: runtime error: index out of range',
    },
    {
      kind: 'exit',
      status: 1,
      stdout: '',
      stderr: 'unexpected verifier implementation failure',
    },
    {
      kind: 'exit',
      status: 1,
      stdout: '',
      stderr:
        'verifier response parser boundary failed: internal decoder invariant',
    },
  ]) {
    assert.equal(classification(result), 'FAIL_INTERNAL');
  }
  for (const diagnostic of [
    'no matching signatures',
    'certificate identity mismatch',
    'none of the expected identities matched what was in the certificate',
    'none of the expected issuers matched what was in the certificate',
    'certificate workflow ref mismatch',
    'invalid signature when validating ASN.1 encoded signature',
    'payload digest mismatch',
    "invalid character 'H' looking for beginning of value",
    'unexpected end of JSON input',
  ]) {
    assert.equal(
      classification({
        kind: 'exit',
        status: 1,
        stdout: '',
        stderr: diagnostic,
      }),
      'BLOCKED_EXTERNAL',
    );
  }
});

void test('classifies TLS certificate rejection as invalid external runbook evidence', () => {
  for (const code of [
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ]) {
    const failure = Object.assign(new Error('TLS certificate rejected.'), {
      code,
    });
    assert.throws(
      () => taxonomy.rethrowProductionRunbookEvidenceFailure(failure),
      (error: unknown) =>
        taxonomy.classifyMediaReleaseEvidenceError(error) ===
        'BLOCKED_EXTERNAL',
    );
  }
  assert.throws(
    () =>
      taxonomy.rethrowProductionRunbookEvidenceFailure(
        Object.assign(new Error('Connection refused.'), {
          code: 'ECONNREFUSED',
        }),
      ),
    (error: unknown) =>
      taxonomy.classifyMediaReleaseEvidenceError(error) === 'BLOCKED_EXTERNAL',
  );
  assert.throws(
    () =>
      taxonomy.rethrowProductionRunbookEvidenceFailure(
        new TypeError('unexpected runbook parser defect'),
      ),
    (error: unknown) =>
      taxonomy.classifyMediaReleaseEvidenceError(error) === 'FAIL_INTERNAL',
  );
});

void test('distinguishes external verification gaps from registry and parser defects', () => {
  assert.throws(
    () =>
      taxonomy.rethrowMissingSpecializedVerification(
        ['BLOCKED_EXTERNAL'],
        'media-oci-supply-chain',
      ),
    (error: unknown) =>
      taxonomy.classifyMediaReleaseEvidenceError(error) === 'BLOCKED_EXTERNAL',
  );
  for (const outcomes of [
    ['PASS'],
    ['FAIL_INTERNAL'],
    ['MISSING'],
    ['BLOCKED_EXTERNAL', 'PASS'],
  ] as const) {
    assert.throws(
      () =>
        taxonomy.rethrowMissingSpecializedVerification(
          outcomes,
          'media-oci-supply-chain',
        ),
      (error: unknown) =>
        taxonomy.classifyMediaReleaseEvidenceError(error) === 'FAIL_INTERNAL',
    );
  }

  assert.throws(
    () =>
      taxonomy.rethrowFinalizedPrerequisiteInventoryFailure(
        new Error(
          'media-oci-supply-chain cannot PASS without its exact specialized verification record.',
        ),
      ),
    (error: unknown) =>
      taxonomy.classifyMediaReleaseEvidenceError(error) === 'BLOCKED_EXTERNAL',
  );
  assert.throws(
    () =>
      taxonomy.rethrowFinalizedPrerequisiteInventoryFailure(
        new TypeError('unexpected final inventory parser defect'),
      ),
    (error: unknown) =>
      taxonomy.classifyMediaReleaseEvidenceError(error) === 'FAIL_INTERNAL',
  );
});

void test('uses a pending exact producer policy instead of the verifier identity', () => {
  const source = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../ops/observability/media-evidence-producers.json',
      ),
      'utf8',
    ),
  ) as unknown;
  const policy = producerPolicy.parseMediaEvidenceProducerPolicy(source);

  assert.equal(policy.status, 'HOST_ACCEPTANCE_REQUIRED');
  assert.equal(Object.keys(policy.producers).length, 6);
  assert.ok(
    Object.values(policy.producers).every(
      ({ acceptance, identity }) =>
        acceptance === 'HOST_ACCEPTANCE_REQUIRED' &&
        identity !== producerPolicy.FINAL_MEDIA_EVIDENCE_VERIFIER_IDENTITY,
    ),
  );
  assert.throws(
    () =>
      producerPolicy.requireAcceptedMediaEvidenceProducer(
        policy,
        'oci-release',
      ),
    (error: unknown) =>
      taxonomy.classifyMediaReleaseEvidenceError(error) === 'BLOCKED_EXTERNAL',
  );
});

void test('accepts only exact non-verifier producer identities and rejects wildcard trust', () => {
  const source = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../ops/observability/media-evidence-producers.json',
      ),
      'utf8',
    ),
  ) as {
    status: string;
    producers: Record<string, Record<string, unknown>>;
  };
  source.status = 'ACCEPTED';
  for (const [key, producer] of Object.entries(source.producers)) {
    const workflowName = `media-${key}-collector`;
    Object.assign(producer, {
      acceptance: 'ACCEPTED',
      issuer: 'https://token.actions.githubusercontent.com',
      identity: `https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/${workflowName}.yml@refs/tags/v3.0.0`,
      workflowName,
      workflowRef: 'refs/tags/v3.0.0',
      workflowRepository: 'khonghao0109/HSK-3.0-APP',
      workflowSha: 'a'.repeat(40),
      trigger: 'push',
      collectorCommand: `npm run collect:${key}`,
      collectorVersion: '1.0.0',
    });
  }
  const accepted = producerPolicy.parseMediaEvidenceProducerPolicy(source);
  assert.equal(accepted.status, 'ACCEPTED');
  assert.match(
    producerPolicy.requireAcceptedMediaEvidenceProducer(
      accepted,
      'live-rehearsal',
    ).identity,
    /media-live-rehearsal-collector\.yml/u,
  );
  const liveProducer = producerPolicy.requireAcceptedMediaEvidenceProducer(
    accepted,
    'live-rehearsal',
  );

  const partiallyAccepted = structuredClone(source);
  partiallyAccepted.status = 'HOST_ACCEPTANCE_REQUIRED';
  Object.assign(partiallyAccepted.producers['oci-risk-approval'], {
    acceptance: 'HOST_ACCEPTANCE_REQUIRED',
    issuer: null,
    identity: null,
    workflowName: null,
    workflowRef: null,
    workflowRepository: null,
    workflowSha: null,
    trigger: null,
    collectorCommand: null,
    collectorVersion: null,
  });
  const pending =
    producerPolicy.parseMediaEvidenceProducerPolicy(partiallyAccepted);
  assert.equal(pending.status, 'HOST_ACCEPTANCE_REQUIRED');
  assert.throws(
    () =>
      producerPolicy.requireAcceptedMediaEvidenceProducer(
        pending,
        'oci-release',
      ),
    (error: unknown) =>
      taxonomy.classifyMediaReleaseEvidenceError(error) === 'BLOCKED_EXTERNAL',
    'A waiver-free release must not use one accepted producer while the global producer policy remains pending.',
  );

  const execution = producerPolicy.mediaEvidenceProducerExecutionContract(
    liveProducer,
    'live-rehearsal',
  );
  assert.deepEqual(
    producerPolicy.assertMediaEvidenceProducerExecution(
      structuredClone(execution),
      execution,
    ),
    execution,
  );
  for (const [field, replacement] of [
    ['collectorCommand', 'npm run collect:attacker'],
    ['collectorVersion', '9.9.9'],
    ['environment', 'unprotected'],
    ['freshnessSeconds', 1],
    ['verifier', 'untrusted-verifier'],
  ] as const) {
    const candidate = structuredClone(execution) as unknown as Record<
      string,
      unknown
    >;
    candidate[field] = replacement;
    assert.throws(
      () =>
        producerPolicy.assertMediaEvidenceProducerExecution(
          candidate,
          execution,
        ),
      /producer execution contract/i,
      `Signed producer execution mismatch was accepted for ${field}.`,
    );
  }
  for (const field of ['evidenceTypes', 'rawEvidenceSet'] as const) {
    const candidate = structuredClone(execution) as unknown as Record<
      string,
      unknown
    >;
    candidate[field] = ['attacker-controlled'];
    assert.throws(
      () =>
        producerPolicy.assertMediaEvidenceProducerExecution(
          candidate,
          execution,
        ),
      /producer execution contract/i,
      `Signed producer execution mismatch was accepted for ${field}.`,
    );
  }
  for (const field of [
    'collectorCommand',
    'collectorVersion',
    'environment',
    'verifier',
  ] as const) {
    const candidate = structuredClone(execution) as unknown as Record<
      string,
      unknown
    >;
    candidate[field] = [execution[field]];
    assert.throws(
      () =>
        producerPolicy.assertMediaEvidenceProducerExecution(
          candidate,
          execution,
        ),
      /producer execution contract/i,
      `Signed producer execution type coercion was accepted for ${field}.`,
    );
  }
  for (const field of ['evidenceTypes', 'rawEvidenceSet'] as const) {
    const candidate = structuredClone(execution) as unknown as Record<
      string,
      unknown
    >;
    candidate[field] = execution[field].map((entry) => [entry]);
    assert.throws(
      () =>
        producerPolicy.assertMediaEvidenceProducerExecution(
          candidate,
          execution,
        ),
      /producer execution contract/i,
      `Signed producer execution array coercion was accepted for ${field}.`,
    );
  }
  const coercedFreshness = structuredClone(execution) as unknown as Record<
    string,
    unknown
  >;
  coercedFreshness.freshnessSeconds = String(execution.freshnessSeconds);
  assert.throws(
    () =>
      producerPolicy.assertMediaEvidenceProducerExecution(
        coercedFreshness,
        execution,
      ),
    /producer execution contract/i,
    'Signed producer execution numeric coercion was accepted.',
  );

  const wildcard = structuredClone(source);
  wildcard.producers['live-rehearsal'].workflowRef = 'refs/tags/*';
  assert.throws(
    () => producerPolicy.parseMediaEvidenceProducerPolicy(wildcard),
    /not exact|does not match/u,
  );

  const circular = structuredClone(source);
  circular.producers['live-rehearsal'].identity =
    producerPolicy.FINAL_MEDIA_EVIDENCE_VERIFIER_IDENTITY;
  assert.throws(
    () => producerPolicy.parseMediaEvidenceProducerPolicy(circular),
    /not exact/u,
  );

  const rejected: Array<{
    name: string;
    mutate: (producer: Record<string, unknown>) => void;
  }> = [
    {
      name: 'branch ref',
      mutate: (producer) => {
        producer.workflowRef = 'refs/heads/main';
        producer.identity =
          'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-live-rehearsal-collector.yml@refs/heads/main';
      },
    },
    {
      name: 'wildcard workflow name',
      mutate: (producer) => {
        producer.workflowName = 'media-*';
      },
    },
    {
      name: 'self verifier at another tag',
      mutate: (producer) => {
        producer.workflowName = 'media-release-evidence';
        producer.workflowRef = 'refs/tags/v9.9.9';
        producer.identity =
          'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-release-evidence.yml@refs/tags/v9.9.9';
      },
    },
    {
      name: 'fork repository',
      mutate: (producer) => {
        producer.workflowRepository = 'attacker/HSK-3.0-APP';
        producer.identity =
          'https://github.com/attacker/HSK-3.0-APP/.github/workflows/media-live-rehearsal-collector.yml@refs/tags/v3.0.0';
      },
    },
    {
      name: 'non-semver tag',
      mutate: (producer) => {
        producer.workflowRef = 'refs/tags/release-prod';
        producer.identity =
          'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-live-rehearsal-collector.yml@refs/tags/release-prod';
      },
    },
  ];
  for (const { name, mutate } of rejected) {
    const candidate = structuredClone(source);
    mutate(candidate.producers['live-rehearsal']);
    assert.throws(
      () => producerPolicy.parseMediaEvidenceProducerPolicy(candidate),
      /not exact|does not match/u,
      `Producer policy accepted ${name}.`,
    );
  }

  for (const [field, replacement] of [
    ['environment', 'unprotected'],
    ['freshnessSeconds', 1],
    ['verifier', 'untrusted-verifier'],
    ['evidenceTypes', ['attacker-controlled']],
    ['rawEvidenceSet', ['attacker-controlled']],
  ] as const) {
    const candidate = structuredClone(source);
    candidate.producers['live-rehearsal'][field] = replacement;
    assert.throws(
      () => producerPolicy.parseMediaEvidenceProducerPolicy(candidate),
      /executable verifier contract/i,
      `Accepted policy field ${field} was not aligned to verifier behavior.`,
    );
  }
});

void test('uses protected live environment inputs and keeps profile defects internal', () => {
  const runner = readFileSync(
    resolve(__dirname, 'run-media-operations-validation.ts'),
    'utf8',
  );
  const internalWrapper = runner.slice(
    runner.indexOf('const internal ='),
    runner.indexOf('const releaseOnly ='),
  );
  assert.match(internalWrapper, /assertExecutionProfile/u);
  assert.doesNotMatch(
    internalWrapper,
    /new ExternalBlock/u,
    'Unsupported execution profiles are verifier defects, not external evidence gaps.',
  );

  const expectedEnvironmentLoader = runner.slice(
    runner.indexOf('function loadExpectedLiveProductionEnvironment'),
    runner.indexOf('async function validateLiveProductionEvidence'),
  );
  for (const input of [
    'MEDIA_OPS_LIVE_EXPECTED_CLUSTER_IDENTITY_SHA256',
    'MEDIA_OPS_LIVE_EXPECTED_NAMESPACE_IDENTITY_SHA256',
    'MEDIA_OPS_LIVE_EXPECTED_DEPLOYMENT_REVISION',
    'MEDIA_OPS_LIVE_EXPECTED_WORKLOAD_AUDIENCE',
    'MEDIA_OPS_LIVE_EXPECTED_WORKLOAD_SUBJECT',
  ]) {
    assert.match(expectedEnvironmentLoader, new RegExp(input, 'u'));
  }
  assert.match(
    expectedEnvironmentLoader,
    /computeMediaLiveEnvironmentFingerprint/u,
  );
  assert.match(expectedEnvironmentLoader, /new ExternalEvidenceMissing/u);
  assert.match(expectedEnvironmentLoader, /new ExternalEvidenceInvalid/u);
  assert.match(expectedEnvironmentLoader, /new InternalVerifierFailure/u);
  assert.doesNotMatch(
    expectedEnvironmentLoader,
    /trusted\.value|manifest\.environment/u,
  );
  const liveParserCall = runner.slice(
    runner.indexOf('parseVerifiedMediaLiveProductionEvidence('),
    runner.indexOf(
      "retainTrustedEvidence(\n      'live-rehearsals/manifest.json'",
    ),
  );
  assert.match(liveParserCall, /expectedEnvironment/u);
  assert.match(liveParserCall, /expectedWorkloadIdentity/u);

  assert.match(
    runner,
    /id: 'release-content-head-binding'[\s\S]*assertReleaseContentMatchesHeadForProfile\(\s*executionProfile,\s*initialReleaseContent/u,
    'The executable release runner must gate attestation on exact-HEAD release content.',
  );
  assert.match(
    runner,
    /id: 'producer-policy-release-acceptance'[\s\S]*requireAcceptedMediaEvidenceProducerPolicy\(\s*loadMediaEvidenceProducerPolicy\(\)/u,
    'The executable release runner must require global producer acceptance even without OCI waivers.',
  );
});

void test('keeps OCI supply-chain freshness aligned to the five-day verifier contract', () => {
  const inventory = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../ops/observability/media-production-prerequisites.json',
      ),
      'utf8',
    ),
  ) as {
    prerequisites: Array<{
      id: string;
      freshness: { maxAgeSeconds: number };
    }>;
  };
  const oci = inventory.prerequisites.find(
    ({ id }) => id === 'media-oci-supply-chain',
  );
  assert.ok(oci);
  assert.equal(oci.freshness.maxAgeSeconds, 432_000);
});

void test('rechecks the protected tag and commit immediately before the release runner', () => {
  const workflow = readFileSync(
    resolve(process.cwd(), '../.github/workflows/media-release-evidence.yml'),
    'utf8',
  );
  const sourceHeadStart = workflow.indexOf(
    'name: Verify release content still matches exact HEAD',
  );
  const releaseGateStart = workflow.indexOf(
    'name: Run Linux amd64 release validator',
  );
  assert.ok(sourceHeadStart >= 0 && releaseGateStart > sourceHeadStart);
  const immediateHeadGate = workflow.slice(sourceHeadStart, releaseGateStart);
  assert.match(
    immediateHeadGate,
    /test "\$\(git rev-parse HEAD\)" = "\$\{GITHUB_SHA\}"/u,
  );
  assert.match(
    immediateHeadGate,
    /test "\$\(git rev-parse "\$\{GITHUB_REF\}\^\{commit\}"\)" = "\$\{GITHUB_SHA\}"/u,
  );

  const releaseGate = workflow.slice(releaseGateStart);
  assert.match(
    releaseGate,
    /MEDIA_OPS_EXPECTED_RELEASE_COMMIT: \$\{\{ github\.sha \}\}/u,
  );
  assert.match(
    releaseGate,
    /MEDIA_OPS_EXPECTED_RELEASE_TAG_REF: \$\{\{ github\.ref \}\}/u,
  );

  const runner = readFileSync(
    resolve(process.cwd(), 'scripts/test/run-media-operations-validation.ts'),
    'utf8',
  );
  assert.match(
    runner,
    /resolveProtectedReleaseHeadExpectation\([\s\S]*MEDIA_OPS_EXPECTED_RELEASE_COMMIT[\s\S]*MEDIA_OPS_EXPECTED_RELEASE_TAG_REF[\s\S]*RELEASE_EVIDENCE_WORKFLOW_REF/u,
  );
  assert.equal(
    Array.from(runner.matchAll(/assertProtectedReleaseHeadMatches\(/gu)).length,
    2,
    'The runner must bind both its initial source read and final evidence publication to the protected commit and tag.',
  );
  assert.match(
    runner,
    /initial protected release tag[\s\S]*assertProtectedReleaseHeadMatches[\s\S]*const beforeTree/u,
  );
  assert.match(
    runner,
    /final protected release tag[\s\S]*assertProtectedReleaseHeadMatches[\s\S]*const tree/u,
  );
});
