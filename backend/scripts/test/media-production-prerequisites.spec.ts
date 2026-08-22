import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  REQUIRED_MEDIA_PRODUCTION_PREREQUISITE_IDS,
  parseMediaProductionPrerequisiteInventory,
  parseVerifiedExternalPrerequisiteInventoryCandidate,
} from './media-production-prerequisites';
import type {
  RequiredMediaProductionPrerequisiteId,
  VerifiedMediaProductionPrerequisiteEvidence,
} from './media-production-prerequisites';
import {
  LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY,
  LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS,
} from './media-live-production-evidence';

const nowMs = Date.parse('2026-08-22T12:00:00.000Z');
const expectedBinding = {
  gitCommit: 'b'.repeat(40),
  gitTreeSha: 'c'.repeat(40),
  releaseContentDigest: 'd'.repeat(64),
};
const requirementsInventory = parseMediaProductionPrerequisiteInventory(
  sourceInventory(),
  { nowMs, source: 'tracked' },
);

void test('accepts the complete truthful BLOCKED_EXTERNAL inventory', () => {
  const inventory = parseMediaProductionPrerequisiteInventory(
    sourceInventory(),
    { nowMs },
  );
  assert.equal(inventory.prerequisites.length, 11);
  assert.deepEqual(
    inventory.prerequisites.map(({ id }) => id),
    [...REQUIRED_MEDIA_PRODUCTION_PREREQUISITE_IDS],
  );
  assert.ok(
    inventory.prerequisites.every(
      ({ required, boundary, status, evidence, producer, binding }) =>
        required &&
        boundary === 'external' &&
        status === 'BLOCKED_EXTERNAL' &&
        evidence.uri === null &&
        evidence.sha256 === null &&
        producer.issuer === null &&
        producer.identity === null &&
        binding.gitCommit === null &&
        binding.gitTreeSha === null &&
        binding.releaseContentDigest === null,
    ),
  );
});

void test('rejects missing, duplicate and non-mandatory required IDs', () => {
  const missing = sourceInventory();
  missing.prerequisites.pop();
  assert.throws(
    () => parseMediaProductionPrerequisiteInventory(missing, { nowMs }),
    /incomplete/i,
  );

  const duplicate = sourceInventory();
  duplicate.prerequisites[10] = structuredClone(duplicate.prerequisites[0]);
  assert.throws(
    () => parseMediaProductionPrerequisiteInventory(duplicate, { nowMs }),
    /duplicated|incomplete/i,
  );

  const optional = sourceInventory();
  optional.prerequisites[0].required = false;
  assert.throws(
    () => parseMediaProductionPrerequisiteInventory(optional, { nowMs }),
    /mandatory/i,
  );

  const unexpected = sourceInventory();
  unexpected.prerequisites.push({
    ...structuredClone(unexpected.prerequisites[0]),
    id: 'media-unsupported-prerequisite',
  });
  assert.throws(
    () => parseMediaProductionPrerequisiteInventory(unexpected, { nowMs }),
    /unsupported IDs/i,
  );
});

void test('rejects missing or unexpected fields at every contract boundary', () => {
  for (const mutate of [
    (candidate: InventoryFixture) => {
      delete (candidate as unknown as Record<string, unknown>).inventoryId;
    },
    (candidate: InventoryFixture) => {
      (candidate as unknown as Record<string, unknown>).unexpected = true;
    },
    (candidate: InventoryFixture) => {
      delete (candidate.prerequisites[0] as unknown as Record<string, unknown>)
        .owner;
    },
    (candidate: InventoryFixture) => {
      (
        candidate.prerequisites[0].evidence as unknown as Record<
          string,
          unknown
        >
      ).unexpected = true;
    },
    (candidate: InventoryFixture) => {
      delete (
        candidate.prerequisites[0].producer as unknown as Record<
          string,
          unknown
        >
      ).issuer;
    },
    (candidate: InventoryFixture) => {
      delete (
        candidate.prerequisites[0].freshness as unknown as Record<
          string,
          unknown
        >
      ).expiresAt;
    },
    (candidate: InventoryFixture) => {
      delete (
        candidate.prerequisites[0].binding as unknown as Record<string, unknown>
      ).gitTreeSha;
    },
    (candidate: InventoryFixture) => {
      delete (
        candidate.prerequisites[0].failureSemantics as unknown as Record<
          string,
          unknown
        >
      ).validator;
    },
  ]) {
    const candidate = sourceInventory();
    mutate(candidate);
    assert.throws(
      () => parseMediaProductionPrerequisiteInventory(candidate, { nowMs }),
      /field|identity/i,
    );
  }
});

void test('never upgrades absent or partial evidence to PASS', () => {
  const absent = sourceInventory();
  absent.prerequisites[0].status = 'PASS';
  assert.throws(
    () => parseMediaProductionPrerequisiteInventory(absent, { nowMs }),
    /cannot PASS without complete trusted evidence/i,
  );

  const partial = sourceInventory();
  partial.prerequisites[0].evidence.uri =
    'https://evidence.example.com/media/oci.json';
  assert.throws(
    () => parseMediaProductionPrerequisiteInventory(partial, { nowMs }),
    /partial or unverified/i,
  );
});

void test('rejects invalid IDs, ownership and evidence policy scalars', () => {
  for (const mutate of [
    (item: PrerequisiteFixture) => {
      item.id = 'MEDIA OCI';
    },
    (item: PrerequisiteFixture) => {
      item.owner = 'Platform SRE';
    },
    (item: PrerequisiteFixture) => {
      (item as unknown as Record<string, unknown>).required = 'true';
    },
    (item: PrerequisiteFixture) => {
      item.boundary = 'third-party';
    },
    (item: PrerequisiteFixture) => {
      item.evidence.type = 'signed evidence';
    },
    (item: PrerequisiteFixture) => {
      item.freshness.maxAgeSeconds = 0;
    },
    (item: PrerequisiteFixture) => {
      item.freshness.maxAgeSeconds = 90 * 24 * 60 * 60 + 1;
    },
  ]) {
    const candidate = sourceInventory();
    mutate(candidate.prerequisites[0]);
    assert.throws(
      () => parseMediaProductionPrerequisiteInventory(candidate, { nowMs }),
      /invalid|required|boolean|boundary|evidence|freshness|incomplete/i,
    );
  }
});

void test('tracked inventory can never self-declare PASS evidence', () => {
  const candidate = sourceInventory();
  Object.assign(candidate.prerequisites[0], validPassEvidence());
  const parsedCandidate = parseVerifiedExternalPrerequisiteInventoryCandidate(
    candidate,
    {
      nowMs,
      expectedBinding,
      requirements: requirementsInventory,
    },
  );
  assert.equal(parsedCandidate.prerequisites[0].status, 'PASS');

  assert.throws(
    () =>
      parseMediaProductionPrerequisiteInventory(candidate, {
        nowMs,
        expectedBinding,
      }),
    /tracked.*cannot contain PASS/i,
  );
});

void test('external inventory cannot redefine tracked prerequisite policy', () => {
  for (const mutate of [
    (item: PrerequisiteFixture) => {
      item.owner = 'alternate-owner';
    },
    (item: PrerequisiteFixture) => {
      item.evidence.type = 'alternate-signed-attestation';
    },
    (item: PrerequisiteFixture) => {
      item.freshness.maxAgeSeconds = 120;
    },
    (item: PrerequisiteFixture) => {
      item.boundary = 'internal';
      item.status = 'FAIL_INTERNAL';
      item.failureSemantics.missing = 'FAIL_INTERNAL';
      item.failureSemantics.invalid = 'FAIL_INTERNAL';
      item.failureSemantics.stale = 'FAIL_INTERNAL';
    },
  ]) {
    const candidate = sourceInventory();
    mutate(candidate.prerequisites[0]);
    assert.throws(
      () =>
        parseVerifiedExternalPrerequisiteInventoryCandidate(candidate, {
          nowMs,
          expectedBinding,
          requirements: requirementsInventory,
        }),
      /tracked prerequisite requirements/i,
    );
  }
});

void test('accepts only complete fresh release-bound PASS evidence with an exact per-ID verification', () => {
  const candidate = sourceInventory();
  Object.assign(candidate.prerequisites[0], validPassEvidence());
  const verification = verificationFor(candidate.prerequisites[0]);
  const inventory = parseMediaProductionPrerequisiteInventory(candidate, {
    nowMs,
    expectedBinding,
    source: 'verified-external',
    requirements: requirementsInventory,
    verifiedEvidenceByPrerequisite: new Map([
      [verification.prerequisiteId, verification],
    ]),
  });
  assert.equal(inventory.prerequisites[0].status, 'PASS');

  assert.throws(
    () => parseMediaProductionPrerequisiteInventory(candidate, { nowMs }),
    /exact release|tracked.*cannot contain PASS/i,
  );

  for (const mutate of [
    (item: PrerequisiteFixture) => {
      item.evidence.sha256 = 'not-a-digest';
    },
    (item: PrerequisiteFixture) => {
      item.evidence.uri = 'https://user:secret@evidence.example.com/result';
    },
    (item: PrerequisiteFixture) => {
      item.producer.issuer = 'https://issuer.invalid';
    },
    (item: PrerequisiteFixture) => {
      item.producer.identity = '^.*$';
    },
    (item: PrerequisiteFixture) => {
      item.binding.gitCommit = 'wrong';
    },
    (item: PrerequisiteFixture) => {
      item.binding.gitTreeSha = 'wrong';
    },
    (item: PrerequisiteFixture) => {
      item.binding.releaseContentDigest = 'wrong';
    },
    (item: PrerequisiteFixture) => {
      item.freshness.expiresAt = '2026-08-22T11:59:59.000Z';
    },
    (item: PrerequisiteFixture) => {
      item.freshness.observedAt = '2026-08-22T12:02:00.000Z';
    },
    (item: PrerequisiteFixture) => {
      item.freshness.expiresAt = '2026-09-01T11:00:00.000Z';
    },
  ]) {
    const invalid = sourceInventory();
    Object.assign(invalid.prerequisites[0], validPassEvidence());
    mutate(invalid.prerequisites[0]);
    assert.throws(
      () =>
        parseMediaProductionPrerequisiteInventory(invalid, {
          nowMs,
          expectedBinding,
          source: 'verified-external',
          requirements: requirementsInventory,
          verifiedEvidenceByPrerequisite: new Map([
            [
              invalid.prerequisites[0]
                .id as RequiredMediaProductionPrerequisiteId,
              verificationFor(invalid.prerequisites[0]),
            ],
          ]),
        }),
      /digest|binding|production|producer|stale|freshness/i,
    );
  }
});

void test('rejects cross-ID, type, URI, issuer, identity and binding verification reuse', () => {
  for (const mutate of [
    (record: VerifiedMediaProductionPrerequisiteEvidence) => {
      record.prerequisiteId = 'media-capacity-backup-restore';
    },
    (record: VerifiedMediaProductionPrerequisiteEvidence) => {
      record.evidenceType = 'capacity-backup-restore-attestation';
    },
    (record: VerifiedMediaProductionPrerequisiteEvidence) => {
      record.evidenceUri = 'https://evidence.example.com/media/other.json';
    },
    (record: VerifiedMediaProductionPrerequisiteEvidence) => {
      record.producerIssuer = 'https://issuer.example.com';
    },
    (record: VerifiedMediaProductionPrerequisiteEvidence) => {
      record.producerIdentity =
        'https://github.com/example/hsk/.github/workflows/other.yml@refs/tags/v1.0.0';
    },
    (record: VerifiedMediaProductionPrerequisiteEvidence) => {
      record.binding.gitCommit = 'e'.repeat(40);
    },
    (record: VerifiedMediaProductionPrerequisiteEvidence) => {
      record.binding.gitTreeSha = 'f'.repeat(40);
    },
    (record: VerifiedMediaProductionPrerequisiteEvidence) => {
      record.binding.releaseContentDigest = '1'.repeat(64);
    },
  ]) {
    const candidate = sourceInventory();
    Object.assign(candidate.prerequisites[0], validPassEvidence());
    const verification = verificationFor(candidate.prerequisites[0]);
    mutate(verification);
    assert.throws(
      () =>
        parseMediaProductionPrerequisiteInventory(candidate, {
          nowMs,
          expectedBinding,
          source: 'verified-external',
          requirements: requirementsInventory,
          verifiedEvidenceByPrerequisite: new Map([
            ['media-oci-supply-chain', verification],
          ]),
        }),
      /exact specialized verification record/i,
    );
  }
});

void test('rejects partial, duplicate-digest and non-PASS verification records', () => {
  const candidate = sourceInventory();
  Object.assign(candidate.prerequisites[0], validPassEvidence());
  Object.assign(
    candidate.prerequisites[1],
    validPassEvidence({
      type: 'signed-capacity-backup-restore-attestation',
      uri: 'https://evidence.example.com/media/capacity.json',
      sha256: 'a'.repeat(64),
    }),
  );
  candidate.prerequisites[1].freshness.maxAgeSeconds = 86400;
  const first = verificationFor(candidate.prerequisites[0]);
  const second = verificationFor(candidate.prerequisites[1]);

  assert.throws(
    () =>
      parseMediaProductionPrerequisiteInventory(candidate, {
        nowMs,
        expectedBinding,
        source: 'verified-external',
        requirements: requirementsInventory,
        verifiedEvidenceByPrerequisite: new Map([
          [first.prerequisiteId, first],
        ]),
      }),
    /every PASS prerequisite exactly/i,
  );
  assert.throws(
    () =>
      parseMediaProductionPrerequisiteInventory(candidate, {
        nowMs,
        expectedBinding,
        source: 'verified-external',
        requirements: requirementsInventory,
        verifiedEvidenceByPrerequisite: new Map([
          [first.prerequisiteId, first],
          [second.prerequisiteId, second],
        ]),
      }),
    /reuse another prerequisite's verified evidence digest/i,
  );

  const blocked = sourceInventory();
  assert.throws(
    () =>
      parseMediaProductionPrerequisiteInventory(blocked, {
        nowMs,
        expectedBinding,
        source: 'verified-external',
        requirements: requirementsInventory,
        verifiedEvidenceByPrerequisite: new Map([
          [first.prerequisiteId, first],
        ]),
      }),
    /no matching PASS prerequisite/i,
  );

  candidate.prerequisites[1].evidence.sha256 = '2'.repeat(64);
  const distinctSecond = verificationFor(candidate.prerequisites[1]);
  const inventory = parseMediaProductionPrerequisiteInventory(candidate, {
    nowMs,
    expectedBinding,
    source: 'verified-external',
    requirements: requirementsInventory,
    verifiedEvidenceByPrerequisite: new Map([
      [first.prerequisiteId, first],
      [distinctSecond.prerequisiteId, distinctSecond],
    ]),
  });
  assert.deepEqual(
    inventory.prerequisites
      .filter(({ status }) => status === 'PASS')
      .map(({ id }) => id),
    ['media-oci-supply-chain', 'media-capacity-backup-restore'],
  );
});

void test('finalizes all six live prerequisites from distinct specialized verification records', () => {
  const candidate = sourceInventory();
  const verifications = new Map<
    RequiredMediaProductionPrerequisiteId,
    VerifiedMediaProductionPrerequisiteEvidence
  >();
  for (const [
    index,
    prerequisiteId,
  ] of LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS.entries()) {
    const prerequisite = candidate.prerequisites.find(
      ({ id }) => id === prerequisiteId,
    );
    assert.ok(prerequisite);
    Object.assign(
      prerequisite,
      validPassEvidence({
        type: LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY[prerequisiteId]
          .evidenceType,
        uri: `https://evidence.example.com/media/${prerequisiteId}.json`,
        sha256: String(index + 1).repeat(64),
      }),
    );
    const verification = verificationFor(prerequisite);
    verifications.set(verification.prerequisiteId, verification);
  }

  const inventory = parseMediaProductionPrerequisiteInventory(candidate, {
    nowMs,
    expectedBinding,
    source: 'verified-external',
    requirements: requirementsInventory,
    verifiedEvidenceByPrerequisite: verifications,
  });
  assert.deepEqual(
    inventory.prerequisites
      .filter(({ status }) => status === 'PASS')
      .map(({ id }) => id),
    [...LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS],
  );
});

void test('enforces fail-closed boundary and status semantics', () => {
  const wrongFailure = sourceInventory();
  wrongFailure.prerequisites[0].failureSemantics.missing = 'FAIL_INTERNAL';
  assert.throws(
    () => parseMediaProductionPrerequisiteInventory(wrongFailure, { nowMs }),
    /fail-closed/i,
  );

  const wrongBoundary = sourceInventory();
  wrongBoundary.prerequisites[0].boundary = 'internal';
  assert.throws(
    () => parseMediaProductionPrerequisiteInventory(wrongBoundary, { nowMs }),
    /fail-closed|trust boundary/i,
  );

  const wrongStatus = sourceInventory();
  wrongStatus.prerequisites[0].status = 'UNKNOWN';
  assert.throws(
    () => parseMediaProductionPrerequisiteInventory(wrongStatus, { nowMs }),
    /status/i,
  );
});

void test('runner verifies external inventory before parsing and has specialized verification for every pre-attestation prerequisite', () => {
  const runner = readFileSync(
    resolve(process.cwd(), 'scripts/test/run-media-operations-validation.ts'),
    'utf8',
  );
  const helpers = readFileSync(
    resolve(
      process.cwd(),
      'scripts/test/media-operations-validation.helpers.ts',
    ),
    'utf8',
  );
  for (const environmentKey of [
    'MEDIA_OPS_PRODUCTION_PREREQUISITE_EVIDENCE_JSON',
    'MEDIA_OPS_PRODUCTION_PREREQUISITE_EVIDENCE_BUNDLE',
    'MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_JSON',
    'MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_BUNDLE',
    'MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_ROOT',
  ]) {
    assert.match(helpers, new RegExp(`'${environmentKey}'`, 'u'));
    assert.match(runner, new RegExp(environmentKey, 'u'));
  }
  assert.doesNotMatch(runner, /verifiedProductionEvidenceDigests/u);

  const trustStart = runner.indexOf(
    'async function validateProductionPrerequisiteInventoryTrust',
  );
  const trustEnd = runner.indexOf(
    'function finalizeProductionPrerequisiteEvidence',
    trustStart,
  );
  const trustFunction = runner.slice(trustStart, trustEnd);
  assert.ok(trustStart >= 0 && trustEnd > trustStart);
  assert.ok(
    trustFunction.indexOf('verifyThenParseJsonEvidence(') <
      trustFunction.indexOf(
        'parseVerifiedExternalPrerequisiteInventoryCandidate(',
      ),
  );
  assert.match(
    trustFunction,
    /--certificate-identity[\s\S]*RELEASE_EVIDENCE_IDENTITY/u,
  );
  for (const verifiedSnapshot of [
    'verifiedManifestPath',
    'verifiedPayloadPath',
    'verifiedEvidencePath',
  ]) {
    assert.match(
      runner,
      new RegExp(`writeFileSync\\(${verifiedSnapshot}`, 'u'),
    );
    assert.match(
      runner,
      new RegExp(`'verify-blob',[\\s\\S]*${verifiedSnapshot}`, 'u'),
    );
  }
  assert.match(
    runner,
    /readStableBoundedFileWithinRoot\([\s\S]*dirname\(resolvedPath\)[\s\S]*basename\(resolvedPath\)/u,
  );
  assert.match(
    helpers,
    /openSync\([\s\S]*O_NOFOLLOW[\s\S]*readFileSync\(descriptor\)/u,
  );

  for (const prerequisiteId of [
    'media-oci-supply-chain',
    'media-capacity-backup-restore',
    'media-production-runbook',
    'media-database-migration-recovery',
  ]) {
    assert.match(
      runner,
      new RegExp(
        `registerVerifiedProductionPrerequisiteEvidence\\(\\s*'${prerequisiteId}'`,
        'u',
      ),
    );
  }
  assert.deepEqual(Object.keys(LIVE_MEDIA_PRODUCTION_EVIDENCE_POLICY), [
    ...LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS,
  ]);
  assert.match(
    runner,
    /for \(const \{ bytes, verification \} of verified\.artifacts\)[\s\S]*registerVerifiedProductionPrerequisiteEvidence\([\s\S]*verification\.prerequisiteId/u,
  );
  assert.match(
    runner,
    /prerequisite\.freshness\.observedAt !== verified\.observedAt[\s\S]*prerequisite\.freshness\.expiresAt !== verified\.expiresAt/u,
  );
  assert.match(
    runner,
    /LIVE_MEDIA_PRODUCTION_PREREQUISITE_IDS[\s\S]*Live production evidence verifier registry is incomplete/u,
  );
  assert.match(
    runner,
    /REQUIRED_MEDIA_PRODUCTION_PREREQUISITE_IDS\.filter\([\s\S]*media-immutable-evidence-attestation[\s\S]*Specialized production evidence verifier registry does not cover every pre-attestation prerequisite/u,
  );
  assert.doesNotMatch(
    runner,
    /registerVerifiedProductionPrerequisiteEvidence\(\s*'media-immutable-evidence-attestation'/u,
  );

  const liveStart = runner.indexOf(
    'async function validateLiveProductionEvidence',
  );
  const liveEnd = runner.indexOf(
    'function finalizeProductionPrerequisiteEvidence',
    liveStart,
  );
  const liveFunction = runner.slice(liveStart, liveEnd);
  const typedExternalConversion = liveFunction.indexOf(
    'error instanceof MediaLiveProductionEvidenceError',
  );
  assert.ok(liveStart >= 0 && liveEnd > liveStart);
  assert.ok(typedExternalConversion > 0);
  assert.ok(
    liveFunction.indexOf("acquireTool(manifest, 'cosign')") <
      liveFunction.indexOf(
        'let trusted: Awaited<ReturnType<typeof verifyThenParseJsonEvidence>>',
      ),
  );
  for (const internalOperation of [
    "retainTrustedEvidence('live-rehearsals/manifest.json'",
    'registerVerifiedProductionPrerequisiteEvidence(',
  ]) {
    assert.ok(
      liveFunction.indexOf(internalOperation) > typedExternalConversion,
      `${internalOperation} must execute outside external-input conversion catches.`,
    );
  }
  assert.doesNotMatch(
    liveFunction.slice(
      liveFunction.indexOf(
        "retainTrustedEvidence('live-rehearsals/manifest.json'",
      ),
    ),
    /catch \(error: unknown\)/u,
  );
});

function sourceInventory(): InventoryFixture {
  return JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../ops/observability/media-production-prerequisites.json',
      ),
      'utf8',
    ),
  ) as InventoryFixture;
}

function validPassEvidence(
  evidence: PrerequisiteFixture['evidence'] = {
    type: 'oci-signature-sbom-vulnerability-license-attestation',
    uri: 'https://evidence.example.com/media/oci.json',
    sha256: 'a'.repeat(64),
  },
): Partial<PrerequisiteFixture> {
  return {
    status: 'PASS',
    evidence,
    producer: {
      issuer: 'https://token.actions.githubusercontent.com',
      identity:
        'https://github.com/example/hsk/.github/workflows/media.yml@refs/tags/v1.0.0',
    },
    freshness: {
      maxAgeSeconds: 604800,
      observedAt: '2026-08-22T11:00:00.000Z',
      expiresAt: '2026-08-23T11:00:00.000Z',
    },
    binding: {
      ...expectedBinding,
    },
  };
}

function verificationFor(
  prerequisite: PrerequisiteFixture,
): VerifiedMediaProductionPrerequisiteEvidence {
  assert.equal(prerequisite.status, 'PASS');
  assert.ok(prerequisite.evidence.uri);
  assert.ok(prerequisite.evidence.sha256);
  assert.ok(prerequisite.producer.issuer);
  assert.ok(prerequisite.producer.identity);
  assert.ok(prerequisite.binding.gitCommit);
  assert.ok(prerequisite.binding.gitTreeSha);
  assert.ok(prerequisite.binding.releaseContentDigest);
  return {
    prerequisiteId: prerequisite.id as RequiredMediaProductionPrerequisiteId,
    evidenceType: prerequisite.evidence.type,
    evidenceUri: prerequisite.evidence.uri,
    evidenceSha256: prerequisite.evidence.sha256,
    producerIssuer: prerequisite.producer.issuer,
    producerIdentity: prerequisite.producer.identity,
    binding: {
      gitCommit: prerequisite.binding.gitCommit,
      gitTreeSha: prerequisite.binding.gitTreeSha,
      releaseContentDigest: prerequisite.binding.releaseContentDigest,
    },
  };
}

type InventoryFixture = {
  schemaVersion: number;
  inventoryId: string;
  prerequisites: PrerequisiteFixture[];
};

type PrerequisiteFixture = {
  id: string;
  owner: string;
  required: boolean;
  boundary: string;
  status: string;
  evidence: { type: string; uri: string | null; sha256: string | null };
  producer: { issuer: string | null; identity: string | null };
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
    missing: string;
    invalid: string;
    stale: string;
    validator: string;
  };
};
