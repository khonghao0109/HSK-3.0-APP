import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';

import {
  CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS,
  CURRENT_MEDIA_OCI_IMAGE_EXPECTATIONS,
  CURRENT_MEDIA_OCI_LICENSE_POLICY_SHA256,
  MediaOciReleaseEvidenceError,
  assertMediaOciReleaseEvidence,
  parseMediaOciReleaseManifest,
  type MediaOciImageExpectation,
  type MediaOciReleaseEvidenceExpectation,
  type TrustVerifiedMediaOciReleaseManifest,
} from './media-oci-release-evidence';

const NOW = Date.parse('2026-08-22T04:00:00.000Z');
const RELEASE_TAG = 'v3.0.0';
const TRUSTED_ISSUER = 'https://token.actions.githubusercontent.com';
const TRUSTED_IDENTITY =
  'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-release-evidence.yml@refs/tags/v3.0.0';
const BINDING = {
  commit: '1'.repeat(40),
  treeSha: '2'.repeat(40),
  releaseContentDigest: '3'.repeat(64),
  releaseTag: RELEASE_TAG,
};
const COMMITTED_LICENSE_POLICY_BYTES = readFileSync(
  join(__dirname, '../../../ops/observability/media-oci-license-policy.json'),
);
const COMMITTED_TOOLCHAIN = JSON.parse(
  readFileSync(
    join(__dirname, '../../../ops/observability/media-toolchain.json'),
    'utf8',
  ),
) as ToolchainFixture;

type ImageName = MediaOciImageExpectation['name'];

interface FileReferenceFixture {
  path: string;
  sha256: string;
}

interface ToolFixture {
  name: 'syft' | 'grype';
  version: string;
  platform: 'linux-amd64';
  artifactSha256: string;
}

interface ToolchainFixture {
  tools: Record<
    ToolFixture['name'],
    {
      version: string;
      platforms: Array<{
        os: string;
        architecture: string;
        sha256: string;
      }>;
    }
  >;
  images: Record<
    ImageName,
    { attestations: { license: { policySha256: string } } }
  >;
}

interface VulnerabilityFindingFixture {
  id: string;
  severity: 'High' | 'Critical';
  artifact: { name: string; version: string; type: string };
}

interface SpdxFixture {
  spdxVersion: string;
  packages: Array<{ SPDXID: string; name: string; versionInfo: string }>;
}

interface VulnerabilityPolicyFixture {
  schemaVersion: number;
  failOn: string[];
  allowIgnoredMatches: boolean;
}

interface VulnerabilityReportFixture {
  schemaVersion: number;
  scanner: ToolFixture & { status: string };
  database: { builtAt: string; sha256: string };
  subject: {
    imageDigest: string;
    sbomSha256: string;
    policySha256: string;
  };
  matches: VulnerabilityFindingFixture[];
  ignoredMatches: unknown[];
}

interface LicensePolicyFixture {
  schemaVersion: number;
  spdxListVersion: string;
  spdxListSha256: string;
  knownIds: string[];
  denied: string[];
  requireKnown: boolean;
  requireLicense: boolean;
}

interface LicenseReportFixture {
  schemaVersion: number;
  subject: {
    imageDigest: string;
    sbomSha256: string;
    policySha256: string;
  };
  packages: Array<{
    spdxId: string;
    name: string;
    version: string;
    licenses: string[];
  }>;
}

interface ManifestImageFixture {
  name: ImageName;
  repository: string;
  version: string;
  registryTag: string;
  indexDigest: string;
  indexMediaType: string;
  platform: {
    os: string;
    architecture: string;
    digest: string;
    runtimeRef: string;
  };
  source: MediaOciImageExpectation['source'] & {
    metadataRole: string;
  };
  reports: {
    spdx: FileReferenceFixture & { tool: ToolFixture };
    vulnerability: FileReferenceFixture & {
      tool: ToolFixture;
      policy: FileReferenceFixture;
      database: {
        builtAt: string;
        sha256: string;
        maxAgeHours: number;
      };
    };
    license: FileReferenceFixture & { policy: FileReferenceFixture };
  };
  waivers: {
    vulnerabilities: Array<{
      finding: { id: string; package: string; version: string };
      owner: string;
      reason: string;
      expiresAt: string;
    }>;
    licenses: Array<{
      finding: { spdxId: string; licenseId: string };
      owner: string;
      reason: string;
      expiresAt: string;
    }>;
  };
}

interface ManifestFixture {
  schemaVersion: number;
  kind: string;
  acceptance: {
    semantics: string;
    upstreamPublisherSignature: string;
    upstreamPublisherAttestations: string;
    issuer: string;
    identity: string;
  };
  binding: typeof BINDING;
  images: ManifestImageFixture[];
}

interface ImageReportsFixture {
  spdx: SpdxFixture;
  vulnerabilityPolicy: VulnerabilityPolicyFixture;
  vulnerability: VulnerabilityReportFixture;
  licensePolicy: LicensePolicyFixture;
  license: LicenseReportFixture;
}

interface Fixture {
  root: string;
  manifest: ManifestFixture;
  verified: TrustVerifiedMediaOciReleaseManifest;
  expectation: MediaOciReleaseEvidenceExpectation;
  reportValues: Record<ImageName, ImageReportsFixture>;
}

void test('accepts exact current OCI images and complete signed release evidence', () => {
  withFixture((fixture) => {
    const retained = new Map<string, Buffer>();
    fixture.expectation.retainValidatedReport = (relativePath, bytes) => {
      retained.set(relativePath, bytes);
    };
    const parsed = parseMediaOciReleaseManifest(fixture.verified.value);
    assert.equal(parsed.images.length, 3);

    const summary = assertMediaOciReleaseEvidence(
      fixture.verified,
      fixture.expectation,
    );
    assert.equal(summary.releaseTag, RELEASE_TAG);
    assert.equal(summary.images.length, 3);
    assert.deepEqual(
      summary.images.map(({ name, packageCount }) => ({ name, packageCount })),
      [
        { name: 'alertmanager', packageCount: 1 },
        { name: 'grafana', packageCount: 1 },
        { name: 'prometheus', packageCount: 1 },
      ],
    );
    assert.equal(retained.size, 15);
    for (const [relativePath, bytes] of retained) {
      assert.equal(
        digest(bytes),
        digest(readFileSync(join(fixture.root, relativePath))),
      );
    }
  });
});

void test('pins the committed license policy and exact Linux amd64 evidence tools', () => {
  assert.equal(
    digest(COMMITTED_LICENSE_POLICY_BYTES),
    CURRENT_MEDIA_OCI_LICENSE_POLICY_SHA256,
  );
  assert.deepEqual(CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS, {
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
  });
  const policy = JSON.parse(
    COMMITTED_LICENSE_POLICY_BYTES.toString('utf8'),
  ) as LicensePolicyFixture;
  assert.equal(policy.spdxListVersion, '3.28.0');
  assert.equal(
    policy.spdxListSha256,
    'f728c534d8bd1044fc515a2ddb2292be99559021d830bfa3281be0bcd36302ee',
  );
  assert.equal(policy.knownIds.length, 727);
  assert.deepEqual(policy.denied, ['BUSL-1.1', 'CC-BY-NC-4.0', 'SSPL-1.0']);
  for (const name of ['syft', 'grype'] as const) {
    const manifestTool = COMMITTED_TOOLCHAIN.tools[name];
    const linuxAmd64 = manifestTool.platforms.find(
      ({ os, architecture }) => os === 'linux' && architecture === 'x64',
    );
    assert.ok(linuxAmd64);
    assert.equal(
      manifestTool.version,
      CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS[name].version,
    );
    assert.equal(
      linuxAmd64.sha256,
      CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS[name].artifactSha256,
    );
  }
  assert.ok(
    Object.values(COMMITTED_TOOLCHAIN.images).every(
      ({ attestations }) =>
        attestations.license.policySha256 ===
        CURRENT_MEDIA_OCI_LICENSE_POLICY_SHA256,
    ),
  );
});

void test('rejects any other Syft or Grype artifact pin', () => {
  for (const mutate of [
    (fixture: Fixture) => {
      image(fixture).reports.spdx.tool.artifactSha256 = '9'.repeat(64);
    },
    (fixture: Fixture) => {
      image(fixture).reports.vulnerability.tool.version = '0.116.0';
    },
    (fixture: Fixture) => {
      (
        image(fixture).reports.vulnerability.tool as unknown as {
          platform: string;
        }
      ).platform = 'darwin-arm64';
    },
  ]) {
    withFixture((fixture) => {
      mutate(fixture);
      resign(fixture);
      expectFailure(
        () =>
          assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
        'FAIL_INTERNAL',
        /exact current Linux amd64 (Syft|Grype) artifact pin/i,
      );
    });
  }
});

void test('rejects any license policy other than the exact committed bytes', () => {
  withFixture((fixture) => {
    image(fixture).reports.license.policy.sha256 = '8'.repeat(64);
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /exact committed OCI license policy/i,
    );
  });
});

void test('rejects wrong repository, OCI digest, or linux/amd64 platform', () => {
  const mutations: Array<(fixture: Fixture) => void> = [
    (fixture) => {
      image(fixture).repository = 'quay.io/attacker/alertmanager';
    },
    (fixture) => {
      image(fixture).indexDigest = `sha256:${'f'.repeat(64)}`;
    },
    (fixture) => {
      image(fixture).platform.architecture = 'arm64';
    },
    (fixture) => {
      image(fixture).platform.digest = `sha256:${'e'.repeat(64)}`;
    },
  ];

  for (const mutate of mutations) {
    withFixture((fixture) => {
      mutate(fixture);
      resign(fixture);
      expectFailure(
        () =>
          assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
        'FAIL_INTERNAL',
        /OCI|platform/i,
      );
    });
  }
});

void test('rejects stale caller image expectations and wrong release binding', () => {
  withFixture((fixture) => {
    fixture.expectation.images.alertmanager.indexDigest = `sha256:${'e'.repeat(64)}`;
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /stale|non-current/i,
    );
  });

  for (const mutate of [
    (fixture: Fixture) => {
      fixture.manifest.binding.commit = '4'.repeat(40);
    },
    (fixture: Fixture) => {
      fixture.manifest.binding.treeSha = '5'.repeat(40);
    },
    (fixture: Fixture) => {
      fixture.manifest.binding.releaseContentDigest = '6'.repeat(64);
    },
  ]) {
    withFixture((fixture) => {
      mutate(fixture);
      resign(fixture);
      expectFailure(
        () =>
          assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
        'FAIL_INTERNAL',
        /release tree/i,
      );
    });
  }
});

void test('requires exact verifier issuer and identity facts', () => {
  for (const mutate of [
    (fixture: Fixture) => {
      fixture.verified.issuer = 'https://issuer.example.com';
    },
    (fixture: Fixture) => {
      fixture.verified.identity =
        'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/other.yml@refs/tags/v3.0.0';
    },
  ]) {
    withFixture((fixture) => {
      mutate(fixture);
      expectFailure(
        () =>
          assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
        'FAIL_INTERNAL',
        /issuer or identity/i,
      );
    });
  }

  withFixture((fixture) => {
    const otherWorkflow =
      'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/other.yml@refs/tags/v3.0.0';
    fixture.expectation.trustedIdentity = otherWorkflow;
    fixture.verified.identity = otherWorkflow;
    fixture.manifest.acceptance.identity = otherWorkflow;
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /broad or unsupported trust identity/i,
    );
  });
});

void test('rejects an empty SPDX SBOM', () => {
  withFixture((fixture) => {
    let retainedCount = 0;
    fixture.expectation.retainValidatedReport = () => {
      retainedCount += 1;
    };
    fixture.reportValues.alertmanager.spdx.packages = [];
    rewriteReport(fixture, 'alertmanager', 'spdx');
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /at least one package/i,
    );
    assert.equal(retainedCount, 0);
  });
});

void test('rejects cross-image reuse of signed OCI report bytes', () => {
  withFixture((fixture) => {
    const alertmanager = fixture.manifest.images.find(
      ({ name }) => name === 'alertmanager',
    );
    const grafana = fixture.manifest.images.find(
      ({ name }) => name === 'grafana',
    );
    assert.ok(alertmanager && grafana);
    grafana.reports.spdx.path = alertmanager.reports.spdx.path;
    grafana.reports.spdx.sha256 = alertmanager.reports.spdx.sha256;
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /distinct signed report bytes/i,
    );
  });
});

void test('rejects a report changed after its hash was signed', () => {
  withFixture((fixture) => {
    const reportPath = absoluteReportPath(
      fixture,
      image(fixture).reports.vulnerability.path,
    );
    writeFileSync(reportPath, `${readFileSync(reportPath, 'utf8')}\n`, 'utf8');
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /bytes changed after signing/i,
    );
  });
});

void test('rejects scanner crash and a stale Grype database', () => {
  withFixture((fixture) => {
    fixture.reportValues.alertmanager.vulnerability.scanner.status = 'failed';
    rewriteReport(fixture, 'alertmanager', 'vulnerability');
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /successful execution/i,
    );
  });

  withFixture((fixture) => {
    const builtAt = new Date(NOW - 121 * 60 * 60 * 1000).toISOString();
    fixture.reportValues.alertmanager.vulnerability.database.builtAt = builtAt;
    image(fixture).reports.vulnerability.database.builtAt = builtAt;
    rewriteReport(fixture, 'alertmanager', 'vulnerability');
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /stale Grype/i,
    );
  });
});

void test('fails closed on High and Critical findings without an exact waiver', () => {
  for (const severity of ['High', 'Critical'] as const) {
    withFixture((fixture) => {
      fixture.reportValues.alertmanager.vulnerability.matches = [
        vulnerabilityFinding(severity),
      ];
      rewriteReport(fixture, 'alertmanager', 'vulnerability');
      resign(fixture);
      expectFailure(
        () =>
          assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
        'FAIL_INTERNAL',
        new RegExp(`unwaived ${severity}`, 'i'),
      );
    });
  }
});

void test('accepts only an active owner/reason/expiry vulnerability waiver', () => {
  withFixture((fixture) => {
    fixture.reportValues.alertmanager.vulnerability.matches = [
      vulnerabilityFinding('High'),
    ];
    image(fixture).waivers.vulnerabilities = [
      {
        finding: {
          id: 'CVE-2099-0001',
          package: 'alertmanager-pkg',
          version: '0.33.1',
        },
        owner: 'platform-security',
        reason: 'Upstream fix is scheduled before this bounded exception.',
        expiresAt: new Date(NOW + 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    rewriteReport(fixture, 'alertmanager', 'vulnerability');
    resign(fixture);
    const summary = assertMediaOciReleaseEvidence(
      fixture.verified,
      fixture.expectation,
    );
    assert.equal(summary.images[0].waivedVulnerabilityCount, 1);
  });
});

void test('rejects denied and unknown licenses without an exact waiver', () => {
  withFixture((fixture) => {
    fixture.reportValues.alertmanager.license.packages[0].licenses = [
      'BUSL-1.1',
    ];
    rewriteReport(fixture, 'alertmanager', 'license');
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /unwaived denied license/i,
    );
  });

  withFixture((fixture) => {
    fixture.reportValues.alertmanager.license.packages[0].licenses = [
      'LicenseRef-Proprietary',
    ];
    rewriteReport(fixture, 'alertmanager', 'license');
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /unwaived unknown license/i,
    );
  });
});

void test('rejects an expired license waiver and accepts the exact active waiver', () => {
  withFixture((fixture) => {
    addUnknownLicense(fixture, new Date(NOW).toISOString());
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /expired/i,
    );
  });

  withFixture((fixture) => {
    addUnknownLicense(
      fixture,
      new Date(NOW + 24 * 60 * 60 * 1000).toISOString(),
    );
    const summary = assertMediaOciReleaseEvidence(
      fixture.verified,
      fixture.expectation,
    );
    assert.equal(summary.images[0].waivedLicenseFindingCount, 1);
  });
});

void test('rejects source metadata that overstates the provenance boundary', () => {
  withFixture((fixture) => {
    image(fixture).source.metadataRole = 'publisher-provenance';
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /provenance boundary/i,
    );
  });
});

void test('rejects signed boolean claims without semantic evidence', () => {
  withFixture((fixture) => {
    const booleanClaim = { signed: true, passed: true };
    fixture.verified.value = booleanClaim;
    fixture.verified.bytes = Buffer.from(JSON.stringify(booleanClaim));
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /exactly|schema/i,
    );
  });
});

void test('bounds evidence paths and keeps absent evidence BLOCKED_EXTERNAL', () => {
  withFixture((fixture) => {
    image(fixture).reports.spdx.path = '../outside.json';
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'FAIL_INTERNAL',
      /safe relative JSON path/i,
    );
  });

  withFixture((fixture) => {
    image(fixture).reports.spdx.path = 'alertmanager/missing.spdx.json';
    resign(fixture);
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'BLOCKED_EXTERNAL',
      /absent/i,
    );
  });
});

void test('keeps absent trust-verified manifest bytes BLOCKED_EXTERNAL', () => {
  withFixture((fixture) => {
    fixture.verified.bytes = new Uint8Array();
    expectFailure(
      () =>
        assertMediaOciReleaseEvidence(fixture.verified, fixture.expectation),
      'BLOCKED_EXTERNAL',
      /manifest is absent/i,
    );
  });
});

function createFixture(): Fixture {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), 'hsk-media-oci-release-evidence-'),
  );
  const root = realpathSync(temporaryRoot);
  const manifestImages: ManifestImageFixture[] = [];
  const reportValues = {} as Record<ImageName, ImageReportsFixture>;

  for (const expected of Object.values(CURRENT_MEDIA_OCI_IMAGE_EXPECTATIONS)) {
    const syft: ToolFixture = {
      ...CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS.syft,
    };
    const grype: ToolFixture = {
      ...CURRENT_MEDIA_OCI_EVIDENCE_TOOL_PINS.grype,
    };
    const spdx: SpdxFixture = {
      spdxVersion: 'SPDX-2.3',
      packages: [
        {
          SPDXID: `SPDXRef-${expected.name}`,
          name: `${expected.name}-pkg`,
          versionInfo: expected.version,
        },
      ],
    };
    const vulnerabilityPolicy: VulnerabilityPolicyFixture = {
      schemaVersion: 1,
      failOn: ['Critical', 'High'],
      allowIgnoredMatches: false,
    };
    const licensePolicy = JSON.parse(
      COMMITTED_LICENSE_POLICY_BYTES.toString('utf8'),
    ) as LicensePolicyFixture;
    const spdxReference = writeJson(
      root,
      `${expected.name}/sbom.spdx.json`,
      spdx,
    );
    const vulnerabilityPolicyReference = writeJson(
      root,
      `${expected.name}/vulnerability-policy.json`,
      vulnerabilityPolicy,
    );
    const licensePolicyReference = writeBytes(
      root,
      `${expected.name}/license-policy.json`,
      COMMITTED_LICENSE_POLICY_BYTES,
    );
    const database = {
      builtAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
      sha256: 'e'.repeat(64),
    };
    const vulnerability: VulnerabilityReportFixture = {
      schemaVersion: 1,
      scanner: { ...grype, status: 'completed' },
      database,
      subject: {
        imageDigest: expected.platformDigest,
        sbomSha256: spdxReference.sha256,
        policySha256: vulnerabilityPolicyReference.sha256,
      },
      matches: [],
      ignoredMatches: [],
    };
    const license: LicenseReportFixture = {
      schemaVersion: 1,
      subject: {
        imageDigest: expected.platformDigest,
        sbomSha256: spdxReference.sha256,
        policySha256: licensePolicyReference.sha256,
      },
      packages: [
        {
          spdxId: `SPDXRef-${expected.name}`,
          name: `${expected.name}-pkg`,
          version: expected.version,
          licenses: ['Apache-2.0'],
        },
      ],
    };
    const vulnerabilityReference = writeJson(
      root,
      `${expected.name}/grype.normalized.json`,
      vulnerability,
    );
    const licenseReference = writeJson(
      root,
      `${expected.name}/license.normalized.json`,
      license,
    );

    reportValues[expected.name] = {
      spdx,
      vulnerabilityPolicy,
      vulnerability,
      licensePolicy,
      license,
    };
    manifestImages.push({
      name: expected.name,
      repository: expected.repository,
      version: expected.version,
      registryTag: expected.registryTag,
      indexDigest: expected.indexDigest,
      indexMediaType: expected.indexMediaType,
      platform: {
        os: 'linux',
        architecture: 'amd64',
        digest: expected.platformDigest,
        runtimeRef: expected.runtimeRef,
      },
      source: {
        ...expected.source,
        metadataRole: 'observed-release-metadata-not-image-provenance',
      },
      reports: {
        spdx: { ...spdxReference, tool: syft },
        vulnerability: {
          ...vulnerabilityReference,
          tool: grype,
          policy: vulnerabilityPolicyReference,
          database: { ...database, maxAgeHours: 120 },
        },
        license: {
          ...licenseReference,
          policy: licensePolicyReference,
        },
      },
      waivers: { vulnerabilities: [], licenses: [] },
    });
  }

  const manifest: ManifestFixture = {
    schemaVersion: 1,
    kind: 'hsk-media-oci-release-acceptance',
    acceptance: {
      semantics: 'hsk-release-acceptance-not-upstream-provenance',
      upstreamPublisherSignature: 'absent',
      upstreamPublisherAttestations: 'absent',
      issuer: TRUSTED_ISSUER,
      identity: TRUSTED_IDENTITY,
    },
    binding: { ...BINDING },
    images: manifestImages,
  };
  const verified: TrustVerifiedMediaOciReleaseManifest = {
    bytes: new Uint8Array(),
    value: manifest,
    issuer: TRUSTED_ISSUER,
    identity: TRUSTED_IDENTITY,
  };
  const expectation: MediaOciReleaseEvidenceExpectation = {
    evidenceRoot: root,
    commit: BINDING.commit,
    treeSha: BINDING.treeSha,
    releaseContentDigest: BINDING.releaseContentDigest,
    trustedIssuer: TRUSTED_ISSUER,
    trustedIdentity: TRUSTED_IDENTITY,
    images: structuredClone(CURRENT_MEDIA_OCI_IMAGE_EXPECTATIONS),
    now: NOW,
  };
  const fixture = { root, manifest, verified, expectation, reportValues };
  resign(fixture);
  return fixture;
}

function withFixture(run: (fixture: Fixture) => void): void {
  const fixture = createFixture();
  try {
    run(fixture);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

function image(
  fixture: Fixture,
  name: ImageName = 'alertmanager',
): ManifestImageFixture {
  const selected = fixture.manifest.images.find(
    (candidate) => candidate.name === name,
  );
  assert.ok(selected);
  return selected;
}

function resign(fixture: Fixture): void {
  fixture.verified.value = structuredClone(fixture.manifest);
  fixture.verified.bytes = Buffer.from(JSON.stringify(fixture.manifest));
}

function writeJson(
  root: string,
  relativePath: string,
  value: unknown,
): FileReferenceFixture {
  return writeBytes(root, relativePath, Buffer.from(JSON.stringify(value)));
}

function writeBytes(
  root: string,
  relativePath: string,
  bytes: Uint8Array,
): FileReferenceFixture {
  const absolutePath = join(root, relativePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, bytes);
  return { path: relativePath, sha256: digest(bytes) };
}

function rewriteReport(
  fixture: Fixture,
  name: ImageName,
  report: 'spdx' | 'vulnerability' | 'license',
): void {
  const manifestReport = image(fixture, name).reports[report];
  const reference = writeJson(
    fixture.root,
    manifestReport.path,
    fixture.reportValues[name][report],
  );
  manifestReport.sha256 = reference.sha256;
}

function addUnknownLicense(fixture: Fixture, expiresAt: string): void {
  fixture.reportValues.alertmanager.license.packages[0].licenses = [
    'LicenseRef-Proprietary',
  ];
  image(fixture).waivers.licenses = [
    {
      finding: {
        spdxId: 'SPDXRef-alertmanager',
        licenseId: 'LicenseRef-Proprietary',
      },
      owner: 'platform-security',
      reason: 'Legal review is bounded to this exact package finding.',
      expiresAt,
    },
  ];
  rewriteReport(fixture, 'alertmanager', 'license');
  resign(fixture);
}

function vulnerabilityFinding(
  severity: 'High' | 'Critical',
): VulnerabilityFindingFixture {
  return {
    id: 'CVE-2099-0001',
    severity,
    artifact: {
      name: 'alertmanager-pkg',
      version: '0.33.1',
      type: 'apk',
    },
  };
}

function absoluteReportPath(fixture: Fixture, path: string): string {
  return join(fixture.root, path);
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectFailure(
  run: () => unknown,
  classification: 'BLOCKED_EXTERNAL' | 'FAIL_INTERNAL',
  message: RegExp,
): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof MediaOciReleaseEvidenceError);
    assert.equal(error.classification, classification);
    assert.match(error.message, message);
    return true;
  });
}
