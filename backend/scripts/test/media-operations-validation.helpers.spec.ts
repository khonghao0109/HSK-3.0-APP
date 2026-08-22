import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign as signBytes,
  verify as verifySignature,
} from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  assertArchiveEntriesSafe,
  assertArchiveLinksSafe,
  assertCommandEvidenceContract,
  assertCosignSignaturePayload,
  assertDatabaseReleaseEvidence,
  assertCapacityBackupEvidence,
  assertProductionRunbookResponse,
  assertExecutionProfile,
  assertExecutableFromVerifiedRoot,
  assertExactMediaNetworkTopology,
  assertStartupProbePreserved,
  assertEveryAlertRunbookUrl,
  assertSafeTemporaryCleanupRoot,
  assertReleaseContentStable,
  assertReleaseHeadStable,
  assertFunctionalEvidence,
  assertGrafanaQueryResult,
  assertGrafanaNoDataResult,
  assertGrafanaDashboardTargetContract,
  assertGrafanaPrivateApiOnlyContract,
  assertGrafanaProvisioningMountContract,
  assertPrometheusRuntimeAlertRunbookUrl,
  assertGzipArchive,
  assertMonitoringSingleReplicaRollout,
  assertIstioProbeRewriteContract,
  inspectTarGzipArchive,
  invalidateEvidenceSummaries,
  isPostGateAttestationReady,
  MEDIA_OPERATIONS_EVIDENCE_ENV_ALLOWLIST,
  resetMediaOperationsEvidenceLogs,
  resolveMediaOperationsEvidenceRoot,
  assertOciDigest,
  assertOciRegistryResolution,
  resolveVerifiedOciIndex,
  extractSpdxAttestationPredicate,
  classifyValidators,
  computeReleaseContentDigest,
  computeGlobalGitState,
  computeMigrationCatalogEvidence,
  computeTreeDigest,
  contentAddressedCacheFilename,
  parseExactVersion,
  requireExactVersion,
  requireCredentialFreeHttpsRunbookUrl,
  readBoundedResponseBody,
  parseToolchainManifest,
  verifyThenParseJsonEvidence,
  redactDiagnostic,
  renderValidatorJUnit,
  runProcess,
  selectArtifact,
  sha256,
  verifySha256,
  readStableBoundedFileWithinRoot,
  waitForGrafanaMetricDatapoint,
  writeStableExclusiveFileWithinRoot,
} from './media-operations-validation.helpers';

const requireModule = createRequire(__filename);
const yaml = requireModule('js-yaml') as { loadAll(source: string): unknown[] };

const validOciAttestations = {
  releaseAcceptance: {
    required: true,
    model: 'hsk-release-acceptance',
    verifier: 'cosign-keyless-blob',
    issuer: 'https://token.actions.githubusercontent.com',
    approvedIdentities: [
      'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-release-evidence.yml@refs/tags/v3.0.0',
    ],
  },
  upstreamPublisherSignature: { status: 'absent' },
  sbom: { required: true, format: 'spdx-json', minimumPackages: 1 },
  vulnerability: {
    required: true,
    format: 'grype-json',
    scanner: 'grype',
    failOn: ['Critical', 'High'],
    maxDatabaseAgeHours: 120,
  },
  license: {
    required: true,
    format: 'hsk-license-json',
    policyPath: 'ops/observability/media-oci-license-policy.json',
    policySha256:
      'fce3681d6911e1901305d6223fe3b13ca1aa571766d9a99ab4b2031713848a25',
  },
};

const validManifest = {
  schemaVersion: 3,
  tools: {
    promtool: {
      version: '3.13.2',
      probe: { args: ['--version'], parser: 'promtool' },
      platforms: [
        {
          os: 'darwin',
          architecture: 'arm64',
          artifact: 'https://example.invalid/prometheus.tar.gz',
          sha256: 'a'.repeat(64),
          archive: 'tar.gz',
          archiveRoot: 'prometheus-3.13.2.darwin-arm64',
          executable: 'promtool',
        },
        {
          os: 'linux',
          architecture: 'x64',
          artifact: 'https://example.invalid/prometheus-linux.tar.gz',
          sha256: 'b'.repeat(64),
          archive: 'tar.gz',
          archiveRoot: 'prometheus-3.13.2.linux-amd64',
          executable: 'promtool',
        },
      ],
    },
  },
  schemaBundles: {
    'kubernetes-core': {
      version: '1.33.3',
      files: [
        {
          name: 'deployment-apps-v1.json',
          artifact: 'https://example.invalid/schemas/deployment-apps-v1.json',
          sha256: 'c'.repeat(64),
        },
      ],
    },
  },
  images: {
    alertmanager: {
      repository: 'quay.io/prometheus/alertmanager',
      version: '0.33.1',
      indexDigest: `sha256:${'1'.repeat(64)}`,
      platforms: [
        {
          os: 'linux',
          architecture: 'x64',
          digest: `sha256:${'2'.repeat(64)}`,
          runtimeRef: `quay.io/prometheus/alertmanager@sha256:${'2'.repeat(64)}`,
        },
      ],
      attestations: structuredClone(validOciAttestations),
    },
    grafana: {
      repository: 'docker.io/grafana/grafana',
      version: '13.1.3',
      indexDigest: `sha256:${'3'.repeat(64)}`,
      platforms: [
        {
          os: 'linux',
          architecture: 'x64',
          digest: `sha256:${'4'.repeat(64)}`,
          runtimeRef: `docker.io/grafana/grafana@sha256:${'4'.repeat(64)}`,
        },
      ],
      attestations: structuredClone(validOciAttestations),
    },
    prometheus: {
      repository: 'quay.io/prometheus/prometheus',
      version: '3.13.2',
      indexDigest: `sha256:${'d'.repeat(64)}`,
      platforms: [
        {
          os: 'linux',
          architecture: 'x64',
          digest: `sha256:${'e'.repeat(64)}`,
          runtimeRef: `quay.io/prometheus/prometheus@sha256:${'e'.repeat(64)}`,
        },
      ],
      attestations: structuredClone(validOciAttestations),
    },
  },
};

void test('parses a fully typed manifest and selects Darwin arm64 or Linux amd64', () => {
  const manifest = parseToolchainManifest(validManifest);
  assert.equal(
    selectArtifact(manifest.tools.promtool, 'darwin', 'arm64').sha256,
    'a'.repeat(64),
  );
  assert.equal(
    selectArtifact(manifest.tools.promtool, 'linux', 'x64').sha256,
    'b'.repeat(64),
  );
  assert.equal(
    manifest.images.prometheus.platforms[0]?.runtimeRef,
    `quay.io/prometheus/prometheus@sha256:${'e'.repeat(64)}`,
  );
});

void test('rejects mutable or mismatched OCI runtime image identities', () => {
  for (const mutate of [
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.indexDigest = 'sha256:not-a-digest';
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.repository = 'evil.example/prometheus';
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.platforms[0].digest = `sha256:${'f'.repeat(64)}`;
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.platforms[0].runtimeRef =
        'quay.io/prometheus/prometheus:latest';
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.platforms[0].architecture = 'arm64';
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.attestations.releaseAcceptance.required = false;
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.attestations.releaseAcceptance.approvedIdentities =
        ['^.*$'];
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.attestations.releaseAcceptance.approvedIdentities =
        ['^abc$'];
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.attestations.releaseAcceptance.approvedIdentities =
        [];
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.attestations.upstreamPublisherSignature.status =
        'verified';
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.attestations.vulnerability.failOn = [
        'Critical',
      ];
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.attestations.license.policySha256 =
        'not-a-digest';
    },
  ]) {
    const candidate = structuredClone(validManifest);
    mutate(candidate);
    assert.throws(
      () => parseToolchainManifest(candidate),
      /OCI|digest|linux amd64|attestation|signature|identity|vulnerability|license|policy/i,
    );
  }
});

void test('fails closed on fake registry index or linux-amd64 child digest', () => {
  const image = parseToolchainManifest(validManifest).images.prometheus;
  const resolution = {
    repository: image.repository,
    indexDigest: image.indexDigest,
    platform: {
      os: 'linux',
      architecture: 'x64',
      digest: image.platforms[0].digest,
    },
  };
  assert.doesNotThrow(() => assertOciRegistryResolution(image, resolution));
  assert.throws(
    () =>
      assertOciRegistryResolution(image, {
        ...resolution,
        indexDigest: `sha256:${'1'.repeat(64)}`,
      }),
    /OCI registry.*mismatch/i,
  );
  assert.throws(
    () =>
      assertOciRegistryResolution(image, {
        ...resolution,
        platform: {
          ...resolution.platform,
          digest: `sha256:${'2'.repeat(64)}`,
        },
      }),
    /OCI registry.*mismatch/i,
  );
});

void test('hashes exact OCI index bytes and validates an optional registry digest header', () => {
  const image = structuredClone(
    parseToolchainManifest(validManifest).images.prometheus,
  );
  const body = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: [
        {
          digest: image.platforms[0].digest,
          platform: { os: 'linux', architecture: 'amd64' },
        },
      ],
    }),
  );
  image.indexDigest = `sha256:${sha256(body)}`;
  assert.equal(
    resolveVerifiedOciIndex(image, body, null).platform.digest,
    image.platforms[0].digest,
  );
  assert.equal(
    resolveVerifiedOciIndex(image, body, image.indexDigest).indexDigest,
    image.indexDigest,
  );
  assert.throws(
    () =>
      resolveVerifiedOciIndex(
        image,
        Buffer.concat([body, Buffer.from(' ')]),
        image.indexDigest,
      ),
    /exact bytes/i,
  );
  assert.throws(
    () => resolveVerifiedOciIndex(image, body, `sha256:${'f'.repeat(64)}`),
    /exact bytes/i,
  );
});

void test('streams bounded registry bodies when Content-Length is missing or false', async () => {
  const body = 'bounded-body';
  assert.equal(
    (
      await readBoundedResponseBody(
        new Response(body, { headers: {} }),
        Buffer.byteLength(body),
      )
    ).toString('utf8'),
    body,
  );
  await assert.rejects(
    readBoundedResponseBody(new Response('oversized', { headers: {} }), 4),
    /exceeds its bounded limit/i,
  );
  await assert.rejects(
    readBoundedResponseBody(
      new Response('short', { headers: { 'Content-Length': '999' } }),
      16,
    ),
    /exceeds its bounded limit/i,
  );
  await assert.rejects(
    readBoundedResponseBody(
      new Response('short', { headers: { 'Content-Length': 'unknown' } }),
      16,
    ),
    /malformed/i,
  );
});

void test('accepts only a signed SPDX predicate bound to the exact image digest', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const statement = {
    predicateType: 'https://spdx.dev/Document',
    subject: [{ digest: { sha256: 'a'.repeat(64) } }],
    predicate: { spdxVersion: 'SPDX-2.3', packages: [] },
  };
  const output = JSON.stringify([
    { payload: Buffer.from(JSON.stringify(statement)).toString('base64') },
  ]);
  assert.equal(
    extractSpdxAttestationPredicate(output, digest).spdxVersion,
    'SPDX-2.3',
  );
  const forged = structuredClone(statement);
  forged.subject[0].digest.sha256 = 'b'.repeat(64);
  assert.throws(
    () =>
      extractSpdxAttestationPredicate(
        JSON.stringify([
          { payload: Buffer.from(JSON.stringify(forged)).toString('base64') },
        ]),
        digest,
      ),
    /bound to another image/i,
  );
});

void test('requires semantic cosign JSON binding instead of a digest substring', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const valid = JSON.stringify([
    {
      critical: {
        image: { 'docker-manifest-digest': digest },
      },
    },
  ]);
  assert.doesNotThrow(() => assertCosignSignaturePayload(valid, digest));
  assert.throws(
    () =>
      assertCosignSignaturePayload(
        JSON.stringify([{ note: `untrusted substring ${digest}` }]),
        digest,
      ),
    /does not bind/i,
  );
  assert.throws(
    () => assertCosignSignaturePayload('not-json', digest),
    /valid JSON/i,
  );
});

void test('release execution profile cannot be inferred from a Darwin host', () => {
  assert.doesNotThrow(() =>
    assertExecutionProfile('reference', 'darwin', 'arm64'),
  );
  assert.doesNotThrow(() =>
    assertExecutionProfile('release-linux-amd64', 'linux', 'x64'),
  );
  assert.throws(
    () => assertExecutionProfile('release-linux-amd64', 'darwin', 'arm64'),
    /requires an actual Linux amd64 host/i,
  );
  assert.throws(
    () => assertExecutionProfile('release-linux-amd64', 'linux', 'arm64'),
    /requires an actual Linux amd64 host/i,
  );
});

void test('backend patch preserves exactly one pre-existing startup probe handler', () => {
  for (const handler of [
    { httpGet: { path: '/startup', port: 3000 } },
    { exec: { command: ['node', 'startup.js'] } },
    { tcpSocket: { port: 3000 } },
  ]) {
    const base = { startupProbe: handler };
    const patched = { startupProbe: structuredClone(handler) };
    assert.doesNotThrow(() => assertStartupProbePreserved(base, patched));
    assert.throws(
      () =>
        assertStartupProbePreserved(base, {
          startupProbe: { ...handler, tcpSocket: { port: 9464 } },
        }),
      /startupProbe contract/i,
    );
  }
  assert.doesNotThrow(() => assertStartupProbePreserved({}, {}));
  assert.throws(
    () =>
      assertStartupProbePreserved(
        {},
        { startupProbe: { tcpSocket: { port: 9464 } } },
      ),
    /must not create or replace startupProbe/i,
  );
});

void test('rejects incomplete manifests and unsupported platforms', () => {
  const incomplete = structuredClone(validManifest);
  delete (incomplete.tools.promtool.platforms[0] as { sha256?: string }).sha256;
  assert.throws(() => parseToolchainManifest(incomplete), /sha256|digest/i);
  const manifest = parseToolchainManifest(validManifest);
  assert.throws(
    () => selectArtifact(manifest.tools.promtool, 'freebsd', 'x64'),
    /unsupported platform/i,
  );
  const onePlatform = structuredClone(validManifest);
  onePlatform.tools.promtool.platforms.pop();
  assert.throws(
    () => parseToolchainManifest(onePlatform),
    /Darwin arm64.*Linux amd64/i,
  );
  const emptyProbe = structuredClone(validManifest);
  emptyProbe.tools.promtool.probe.args = [];
  assert.throws(() => parseToolchainManifest(emptyProbe), /probe.args/i);
  const traversalSchema = structuredClone(validManifest);
  traversalSchema.schemaBundles['kubernetes-core'].files[0].name =
    '../deployment.json';
  assert.throws(
    () => parseToolchainManifest(traversalSchema),
    /schema filename/i,
  );
  const mutableSchemaUrl = structuredClone(validManifest);
  mutableSchemaUrl.schemaBundles['kubernetes-core'].files[0].artifact +=
    '?ref=main';
  assert.throws(
    () => parseToolchainManifest(mutableSchemaUrl),
    /credential-free HTTPS/i,
  );
});

void test('rejects checksum mismatch and corrupt gzip before extraction', () => {
  const bytes = Buffer.from('not an archive');
  assert.throws(
    () => verifySha256(bytes, '0'.repeat(64)),
    /checksum mismatch/i,
  );
  assert.throws(() => assertGzipArchive(bytes), /gzip/i);
  assert.equal(sha256(bytes).length, 64);
});

void test('derives immutable cache identity from digest and safe artifact name', () => {
  assert.equal(
    contentAddressedCacheFilename(
      'https://downloads.example.test/tool.tar.gz',
      'a'.repeat(64),
    ),
    `${'a'.repeat(64)}-tool.tar.gz`,
  );
  assert.throws(
    () =>
      contentAddressedCacheFilename(
        'https://downloads.example.test/tool',
        'not-a-digest',
      ),
    /pinned SHA-256/i,
  );
});

void test('requires exact OCI digest equality', () => {
  const digest = `sha256:${'c'.repeat(64)}`;
  assert.doesNotThrow(() => assertOciDigest(digest, digest));
  assert.throws(
    () => assertOciDigest(`sha256:${'d'.repeat(64)}`, digest),
    /digest mismatch/i,
  );
});

void test('parses exact cosign, Grype and Syft versions', () => {
  assert.equal(
    parseExactVersion('grype', 'Application: grype\nVersion:    0.116.1'),
    '0.116.1',
  );
  assert.equal(
    parseExactVersion(
      'cosign',
      'GitVersion:    v3.0.6\nGitCommit: abc\nPlatform: darwin/arm64',
    ),
    '3.0.6',
  );
  assert.equal(
    parseExactVersion('syft', 'Application: syft\nVersion:    1.50.0'),
    '1.50.0',
  );
});

void test('rejects archive traversal and absolute paths', () => {
  assert.doesNotThrow(() =>
    assertArchiveEntriesSafe(['tool-1.0/', 'tool-1.0/bin/tool'], 'tool-1.0'),
  );
  for (const entry of [
    '../outside',
    'tool-1.0/../../outside',
    '/absolute/path',
    'tool-1.0\\..\\outside',
  ]) {
    assert.throws(
      () => assertArchiveEntriesSafe([entry], 'tool-1.0'),
      /unsafe archive/i,
    );
  }
});

void test('rejects symlink and hardlink archive entries before extraction', () => {
  assert.doesNotThrow(() => assertArchiveLinksSafe([]));
  for (const type of ['symlink', 'hardlink'] as const) {
    assert.throws(
      () =>
        assertArchiveLinksSafe([
          { type, name: 'tool-1.0/bin/tool', target: '../../outside' },
        ]),
      /archive link/i,
    );
  }
});

void test('validates tar checksum, termination and rejects PAX or special files', () => {
  assert.deepEqual(inspectTarGzipArchive(tarGzip('tool/bin/tool', '0')), [
    'tool/bin/tool',
  ]);
  for (const type of ['1', '2', '3', '4', '6', 'x', 'g', 'K'] as const) {
    assert.throws(
      () => inspectTarGzipArchive(tarGzip('tool/unsafe', type)),
      /archive link|unsupported tar entry/i,
    );
  }
  const invalidChecksum = tarGzip('tool/bin/tool', '0', true, false);
  assert.throws(() => inspectTarGzipArchive(invalidChecksum), /checksum/i);
  assert.throws(
    () => inspectTarGzipArchive(tarGzip('tool/bin/tool', '0', false, true)),
    /unterminated/i,
  );
});

void test('parses exact versions instead of substring matches', () => {
  assert.equal(
    parseExactVersion('promtool', 'promtool, version 3.13.2\n'),
    '3.13.2',
  );
  assert.equal(
    parseExactVersion('nginx', 'nginx version: nginx/1.30.4\n'),
    '1.30.4',
  );
  assert.throws(
    () => parseExactVersion('promtool', 'fake 99.3.13.2-not-real'),
    /unrecognized version output/i,
  );
  assert.notEqual(parseExactVersion('grafana', 'Version 13.1.30'), '13.1.3');
  assert.throws(
    () => requireExactVersion('3.13.20', '3.13.2'),
    /version mismatch/i,
  );
});

void test('rejects an in-root fake binary that only prints the pinned version', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-version-only-fake-'));
  try {
    const fake = join(root, 'promtool');
    writeFileSync(fake, '#!/bin/sh\necho "promtool, version 3.13.2"\n', {
      mode: 0o700,
    });
    assertExecutableFromVerifiedRoot(fake, root);
    const probe = runProcess(fake, ['test', 'rules', 'rules.yml'], {
      timeoutMs: 5_000,
    });
    assert.equal(probe.kind, 'success');
    assert.throws(
      () =>
        assertFunctionalEvidence(
          'promtool-test-rules',
          `${probe.stdout}\n${probe.stderr}`,
        ),
      /functional attestation/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.doesNotThrow(() =>
    assertFunctionalEvidence('promtool-test-rules', 'Unit Testing: SUCCESS\n'),
  );
});

void test('rejects a fake binary outside the checksum-verified extraction root', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-verified-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'hsk-fake-tool-'));
  try {
    mkdirSync(join(root, 'bin'));
    const trusted = join(root, 'bin', 'promtool');
    const fake = join(outside, 'promtool');
    writeFileSync(trusted, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    writeFileSync(fake, '#!/bin/sh\necho "promtool, version 3.13.2"\n', {
      mode: 0o700,
    });
    assert.doesNotThrow(() =>
      assertExecutableFromVerifiedRoot(
        realpathSync(trusted),
        realpathSync(root),
      ),
    );
    assert.throws(
      () =>
        assertExecutableFromVerifiedRoot(
          realpathSync(fake),
          realpathSync(root),
        ),
      /verified artifact root/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

void test('cleanup boundary accepts only the exact task mkdtemp root', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-media-raw-'));
  const archiveRootDot = root;
  try {
    assert.doesNotThrow(() => assertSafeTemporaryCleanupRoot(archiveRootDot));
    assert.throws(
      () => assertSafeTemporaryCleanupRoot(tmpdir()),
      /temporary boundary/i,
    );
    mkdirSync(join(root, 'nested'));
    assert.throws(
      () => assertSafeTemporaryCleanupRoot(join(root, 'nested')),
      /temporary boundary/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('network topology rejects extra ingress and broader identity', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      '../ops/observability/media-metrics-private-network.yml',
    ),
    'utf8',
  );
  const resources = yaml
    .loadAll(source)
    .filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    );
  assert.doesNotThrow(() => assertExactMediaNetworkTopology(resources));

  const broadenedNetwork = structuredClone(resources);
  const network = broadenedNetwork.find(
    (resource) =>
      resource.kind === 'NetworkPolicy' &&
      (resource.metadata as { name?: string }).name ===
        'hsk-backend-media-metrics-private',
  ) as { spec: { ingress: unknown[] } };
  network.spec.ingress.push({
    from: [],
    ports: [{ protocol: 'TCP', port: 9464 }],
  });
  assert.throws(
    () => assertExactMediaNetworkTopology(broadenedNetwork),
    /broader than the exact contract/i,
  );

  const broadenedIdentity = structuredClone(resources);
  const authorization = broadenedIdentity.find(
    (resource) =>
      resource.kind === 'AuthorizationPolicy' &&
      (resource.metadata as { name?: string }).name ===
        'hsk-backend-media-metrics-principal',
  ) as {
    spec: {
      rules: Array<{ from: Array<{ source: Record<string, unknown> }> }>;
    };
  };
  authorization.spec.rules[0].from[0].source.namespaces = ['monitoring'];
  assert.throws(
    () => assertExactMediaNetworkTopology(broadenedIdentity),
    /broader than the exact contract/i,
  );

  const mutations: Array<{
    kind: string;
    name: string;
    mutate: (spec: Record<string, unknown>) => void;
  }> = [
    {
      kind: 'NetworkPolicy',
      name: 'hsk-backend-media-metrics-private',
      mutate: (spec) => {
        spec.policyTypes = ['Ingress', 'Egress'];
      },
    },
    {
      kind: 'NetworkPolicy',
      name: 'hsk-media-alertmanager-private',
      mutate: (spec) => {
        spec.podSelector = {};
      },
    },
    {
      kind: 'AuthorizationPolicy',
      name: 'hsk-backend-media-metrics-principal',
      mutate: (spec) => {
        spec.action = 'AUDIT';
      },
    },
    {
      kind: 'AuthorizationPolicy',
      name: 'hsk-media-alertmanager-principal',
      mutate: (spec) => {
        spec.selector = {};
      },
    },
    {
      kind: 'PeerAuthentication',
      name: 'hsk-backend-media-metrics-strict-mtls',
      mutate: (spec) => {
        spec.mtls = { mode: 'PERMISSIVE' };
      },
    },
    {
      kind: 'PeerAuthentication',
      name: 'hsk-media-alertmanager-strict-mtls',
      mutate: (spec) => {
        spec.selector = {};
      },
    },
    {
      kind: 'NetworkPolicy',
      name: 'hsk-media-prometheus-private',
      mutate: (spec) => {
        (spec.ingress as unknown[]).push({ from: [], ports: [{ port: 9090 }] });
      },
    },
    {
      kind: 'AuthorizationPolicy',
      name: 'hsk-media-prometheus-principal',
      mutate: (spec) => {
        spec.action = 'AUDIT';
      },
    },
    {
      kind: 'PeerAuthentication',
      name: 'hsk-media-prometheus-strict-mtls',
      mutate: (spec) => {
        spec.mtls = { mode: 'PERMISSIVE' };
      },
    },
    {
      kind: 'NetworkPolicy',
      name: 'hsk-media-grafana-private',
      mutate: (spec) => {
        spec.ingress = [{ from: [] }];
      },
    },
    {
      kind: 'AuthorizationPolicy',
      name: 'hsk-media-grafana-principal',
      mutate: (spec) => {
        spec.selector = {};
      },
    },
    {
      kind: 'PeerAuthentication',
      name: 'hsk-media-grafana-strict-mtls',
      mutate: (spec) => {
        spec.mtls = { mode: 'PERMISSIVE' };
      },
    },
  ];
  for (const mutation of mutations) {
    const mutated = structuredClone(resources);
    const resource = mutated.find(
      (candidate) =>
        candidate.kind === mutation.kind &&
        (candidate.metadata as { name?: string }).name === mutation.name,
    );
    assert.ok(resource);
    mutation.mutate(resource.spec as Record<string, unknown>);
    assert.throws(
      () => assertExactMediaNetworkTopology(mutated),
      /broader than the exact contract/i,
    );
  }
});

void test('requires Recreate for every single-replica RWO monitoring workload', () => {
  const resources = yaml
    .loadAll(
      readFileSync(
        resolve(
          process.cwd(),
          '../ops/observability/media-metrics-private-network.yml',
        ),
        'utf8',
      ),
    )
    .filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    );
  assert.doesNotThrow(() => assertMonitoringSingleReplicaRollout(resources));
  for (const name of [
    'hsk-media-prometheus',
    'hsk-media-alertmanager',
    'hsk-media-grafana',
  ]) {
    const mutated = structuredClone(resources);
    const deployment = mutated.find(
      (candidate) =>
        candidate.kind === 'Deployment' &&
        (candidate.metadata as { name?: string }).name === name,
    );
    assert.ok(deployment);
    (deployment.spec as Record<string, unknown>).strategy = {
      type: 'RollingUpdate',
    };
    assert.throws(
      () => assertMonitoringSingleReplicaRollout(mutated),
      /one replica and Recreate/i,
    );
  }
});

void test('rewrites every kubelet HTTP probe before enforcing STRICT mTLS', () => {
  const resources = yaml
    .loadAll(
      readFileSync(
        resolve(
          process.cwd(),
          '../ops/observability/media-metrics-private-network.yml',
        ),
        'utf8',
      ),
    )
    .filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    );
  const patch = yaml.loadAll(
    readFileSync(
      resolve(
        process.cwd(),
        '../ops/observability/media-backend-deployment.patch.yml',
      ),
      'utf8',
    ),
  )[0] as Record<string, unknown>;
  assert.doesNotThrow(() => assertIstioProbeRewriteContract(resources, patch));
  for (const name of [
    'hsk-media-prometheus',
    'hsk-media-alertmanager',
    'hsk-media-grafana',
  ]) {
    const mutated = structuredClone(resources);
    const deployment = mutated.find(
      (candidate) =>
        candidate.kind === 'Deployment' &&
        (candidate.metadata as { name?: string }).name === name,
    );
    assert.ok(deployment);
    const annotations = (
      deployment.spec as {
        template: { metadata: { annotations: Record<string, string> } };
      }
    ).template.metadata.annotations;
    delete annotations['sidecar.istio.io/rewriteAppHTTPProbers'];
    assert.throws(
      () => assertIstioProbeRewriteContract(mutated, patch),
      /rewrite kubelet HTTP probes/i,
    );
  }
  const unsafePatch = structuredClone(patch);
  const patchAnnotations = (
    unsafePatch.spec as {
      template: { metadata: { annotations: Record<string, string> } };
    }
  ).template.metadata.annotations;
  delete patchAnnotations['sidecar.istio.io/rewriteAppHTTPProbers'];
  assert.throws(
    () => assertIstioProbeRewriteContract(resources, unsafePatch),
    /Backend patch.*rewrite kubelet HTTP probes/i,
  );
});

void test('keeps Grafana on one declared private API-only operator path', () => {
  const resources = yaml
    .loadAll(
      readFileSync(
        resolve(
          process.cwd(),
          '../ops/observability/media-metrics-private-network.yml',
        ),
        'utf8',
      ),
    )
    .filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    );
  assert.doesNotThrow(() => assertGrafanaPrivateApiOnlyContract(resources));
  const mutated = structuredClone(resources);
  const authorization = mutated.find(
    (candidate) =>
      candidate.kind === 'AuthorizationPolicy' &&
      (candidate.metadata as { name?: string }).name ===
        'hsk-media-grafana-principal',
  );
  assert.ok(authorization);
  const rules = (authorization.spec as { rules: unknown[] }).rules;
  const operation = (
    rules[0] as { to: Array<{ operation: { paths: string[] } }> }
  ).to[0].operation;
  operation.paths.push('/d/*');
  assert.throws(
    () => assertGrafanaPrivateApiOnlyContract(mutated),
    /private API-only/i,
  );
});

void test('requires exact Grafana datasource, dashboard and provider mounts', () => {
  const resources = yaml
    .loadAll(
      readFileSync(
        resolve(
          process.cwd(),
          '../ops/observability/media-metrics-private-network.yml',
        ),
        'utf8',
      ),
    )
    .filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    );
  assert.doesNotThrow(() => assertGrafanaProvisioningMountContract(resources));
  const mutated = structuredClone(resources);
  const deployment = mutated.find(
    (candidate) =>
      candidate.kind === 'Deployment' &&
      (candidate.metadata as { name?: string }).name === 'hsk-media-grafana',
  );
  assert.ok(deployment);
  const container = (
    deployment.spec as {
      template: { spec: { containers: Array<{ volumeMounts: unknown[] }> } };
    }
  ).template.spec.containers[0];
  container.volumeMounts = container.volumeMounts.filter(
    (mount) =>
      (mount as { mountPath?: string }).mountPath !==
      '/etc/grafana/provisioning/dashboards/provider.yml',
  );
  assert.throws(
    () => assertGrafanaProvisioningMountContract(mutated),
    /provisioning mounts are not exact/i,
  );
});

void test('fails a command that exceeds its bounded timeout', () => {
  const result = runProcess(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 10_000)'],
    { timeoutMs: 25 },
  );
  assert.equal(result.kind, 'timeout');
});

void test('keeps validator outcomes independent and fail-closed', () => {
  const result = classifyValidators([
    { id: 'prometheus', status: 'PASS', durationMs: 1 },
    {
      id: 'grafana',
      status: 'BLOCKED_EXTERNAL',
      durationMs: 1,
      reason: 'tool unavailable',
    },
    {
      id: 'kubernetes',
      status: 'FAIL_INTERNAL',
      durationMs: 1,
      reason: 'invalid topology',
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.results.length, 3);
  assert.deepEqual(
    result.results.map(({ status }) => status),
    ['PASS', 'BLOCKED_EXTERNAL', 'FAIL_INTERNAL'],
  );
});

void test('allows only the immutable artifact attestation to remain for the post-gate job', () => {
  const immutable = {
    id: 'production-prerequisite/media-immutable-evidence-attestation',
    status: 'BLOCKED_EXTERNAL' as const,
    durationMs: 1,
  };
  assert.equal(
    isPostGateAttestationReady([
      { id: 'internal', status: 'PASS', durationMs: 1 },
      immutable,
    ]),
    true,
  );
  assert.equal(isPostGateAttestationReady([immutable, immutable]), false);
  assert.equal(
    isPostGateAttestationReady([
      immutable,
      { id: 'external', status: 'BLOCKED_EXTERNAL', durationMs: 1 },
    ]),
    false,
  );
  assert.equal(
    isPostGateAttestationReady([
      immutable,
      { id: 'internal', status: 'FAIL_INTERNAL', durationMs: 1 },
    ]),
    false,
  );
});

void test('sanitizes URL credentials, query secrets and authorization values', () => {
  const unsafe =
    'https://alice:password@example.test/path?token=token-value&access_token=access-value&refresh_token=refresh-value&password=password-value Authorization=Bearer-value secret=secret-value MEDIA_SIGNING_SECRET="media-value" AWS_SECRET_ACCESS_KEY=aws-value JWT_SECRETS=jwt-value client_secret=client-value api_key=api-value private_key=private-value session=session-value cookie=cookie-value {"authorization":"json-value"}';
  const safe = redactDiagnostic(unsafe);
  for (const leaked of [
    'alice',
    ':password@',
    'token-value',
    'access-value',
    'refresh-value',
    'password-value',
    'Bearer-value',
    'secret-value',
    'media-value',
    'aws-value',
    'jwt-value',
    'json-value',
    'client-value',
    'api-value',
    'private-value',
    'session-value',
    'cookie-value',
  ]) {
    assert.equal(safe.includes(leaked), false, `leaked ${leaked}`);
  }
});

void test('validates per-command machine evidence and intentional runtime stops', () => {
  const command = {
    id: 'grafana-disposable-runtime/001/grafana-runtime',
    validator: 'grafana-disposable-runtime',
    executable: 'grafana',
    exitCode: 0,
    durationMs: 321,
    logPath: 'logs/001-grafana-runtime.log',
    logSha256: 'a'.repeat(64),
    safeArgs: ['server'],
    cwd: '/safe/workspace/backend',
    startedAt: '2026-08-13T00:00:00.000Z',
    completedAt: '2026-08-13T00:00:00.321Z',
    platform: 'darwin',
    architecture: 'arm64',
    envKeys: ['PATH'],
    executableIdentity: '/verified/grafana',
    executableSha256: 'b'.repeat(64),
    toolVersion: '13.1.3',
    gitCommit: 'c'.repeat(40),
    gitTreeSha: 'd'.repeat(40),
    releaseContentDigest: 'e'.repeat(64),
    inputTreeDigest: 'f'.repeat(64),
    expectedStop: true,
    signal: 'SIGTERM',
  };
  assert.doesNotThrow(() => assertCommandEvidenceContract([command]));
  assert.throws(
    () => assertCommandEvidenceContract([{ ...command, exitCode: 128 }]),
    /failed command|intentional runtime stop/i,
  );
  assert.throws(
    () =>
      assertCommandEvidenceContract(
        [
          {
            ...command,
            expectedStop: undefined,
            signal: undefined,
            exitCode: 1,
          },
        ],
        [
          {
            id: 'grafana-disposable-runtime',
            status: 'PASS',
            durationMs: 1,
          },
        ],
      ),
    /PASS validator records a failed command/i,
  );
  assert.doesNotThrow(() =>
    assertCommandEvidenceContract(
      [
        {
          ...command,
          validator: 'production-runbook-url',
          id: 'production-runbook-url/001/http-probe',
          executable: 'http-probe',
          expectedStop: undefined,
          signal: undefined,
          exitCode: 1,
        },
      ],
      [
        {
          id: 'production-runbook-url',
          status: 'BLOCKED_EXTERNAL',
          durationMs: 1,
        },
      ],
    ),
  );
  assert.doesNotThrow(() =>
    assertCommandEvidenceContract(
      [
        {
          ...command,
          validator: 'evidence',
          id: 'evidence/001/git',
          executable: 'git',
          expectedStop: undefined,
          signal: undefined,
        },
      ],
      [
        {
          id: 'grafana-disposable-runtime',
          status: 'PASS',
          durationMs: 1,
        },
      ],
    ),
  );
  assert.throws(
    () => assertCommandEvidenceContract([command, { ...command }]),
    /duplicate identifier/i,
  );
  assert.throws(
    () =>
      assertCommandEvidenceContract([
        { ...command, logPath: '../outside.log' },
      ]),
    /invalid field/i,
  );
  assert.throws(
    () =>
      assertCommandEvidenceContract([
        { ...command, executableSha256: 'unresolved' },
      ]),
    /invalid field/i,
  );
  assert.throws(
    () =>
      assertCommandEvidenceContract([{ ...command, toolVersion: 'latest' }]),
    /invalid field/i,
  );
  assert.throws(
    () =>
      assertCommandEvidenceContract([{ ...command, gitTreeSha: 'not-a-tree' }]),
    /invalid field/i,
  );
  assert.throws(
    () =>
      assertCommandEvidenceContract([
        { ...command, inputTreeDigest: 'not-a-digest' },
      ]),
    /invalid field/i,
  );
  assert.throws(
    () =>
      assertCommandEvidenceContract([
        { ...command, envKeys: ['UNRELATED_ENV'] },
      ]),
    /invalid field/i,
  );
});

void test('renders sanitized JUnit without leaking validator diagnostics', () => {
  const report = renderValidatorJUnit([
    {
      id: 'production-runbook-url',
      status: 'FAIL_INTERNAL',
      durationMs: 12,
      reason: 'token=do-not-leak & <invalid>',
    },
  ]);
  assert.match(report, /tests="1" failures="1" skipped="0"/u);
  assert.equal(report.includes('do-not-leak'), false);
  assert.equal(report.includes('&lt;invalid&gt;'), true);
  assert.equal(report.includes('&amp;'), true);
  const release = renderValidatorJUnit(
    [
      {
        id: 'oci',
        status: 'BLOCKED_EXTERNAL',
        durationMs: 1,
        reason: 'attestation unavailable',
      },
    ],
    {
      runId: 'run-123',
      commit: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      releaseProfile: true,
    },
  );
  assert.match(release, /failures="1" skipped="0"/u);
  assert.match(release, /name="runId" value="run-123"/u);
});

void test('invalidates only the exact prior machine evidence summaries', () => {
  const repository = mkdtempSync(join(tmpdir(), 'hsk-media-repository-'));
  const evidenceParent = join(repository, 'backend/test-results');
  const root = join(evidenceParent, 'media-operations-test');
  const outside = mkdtempSync(join(tmpdir(), 'hsk-media-outside-'));
  try {
    mkdirSync(root, { recursive: true });
    const json = join(root, 'media-operations-validation.json');
    const junit = join(root, 'media-operations-validation.junit.xml');
    const retained = join(root, 'retained.log');
    writeFileSync(json, '{"exitCode":0}', { mode: 0o600 });
    writeFileSync(junit, '<testsuite failures="0"/>', { mode: 0o600 });
    writeFileSync(retained, 'keep', { mode: 0o600 });
    invalidateEvidenceSummaries(root, repository);
    assert.equal(existsSync(json), false);
    assert.equal(existsSync(junit), false);
    assert.equal(existsSync(retained), true);
    const logs = join(root, 'logs');
    mkdirSync(logs);
    writeFileSync(join(logs, 'probe.log'), 'remove');
    resetMediaOperationsEvidenceLogs(root, repository);
    assert.equal(existsSync(logs), false);
    symlinkSync(outside, logs, 'dir');
    assert.throws(
      () => resetMediaOperationsEvidenceLogs(root, repository),
      /logs path must be a real directory/i,
    );
    rmSync(logs, { force: true });
    assert.equal(
      resolveMediaOperationsEvidenceRoot(repository, root),
      realpathSync(root),
    );
    assert.throws(
      () => resolveMediaOperationsEvidenceRoot(repository, repository),
      /approved task-owned evidence boundary/i,
    );
    assert.throws(
      () => resolveMediaOperationsEvidenceRoot(repository, '/'),
      /approved task-owned evidence boundary/i,
    );
    assert.throws(
      () => resolveMediaOperationsEvidenceRoot(repository, 'relative/path'),
      /absolute path/i,
    );
    const link = join(evidenceParent, 'media-operations-link');
    symlinkSync(outside, link, 'dir');
    assert.throws(
      () => resolveMediaOperationsEvidenceRoot(repository, link),
      /symbolic link/i,
    );
    const temporary = mkdtempSync(
      join(tmpdir(), 'hsk-media-operations-evidence-'),
    );
    assert.equal(
      resolveMediaOperationsEvidenceRoot(repository, temporary),
      realpathSync(temporary),
    );
    rmSync(temporary, { recursive: true, force: true });

    const freshRepository = mkdtempSync(
      join(tmpdir(), 'hsk-media-fresh-repository-'),
    );
    try {
      mkdirSync(join(freshRepository, 'backend'));
      const freshEvidence = join(
        freshRepository,
        'backend/test-results/media-operations',
      );
      assert.equal(
        resolveMediaOperationsEvidenceRoot(freshRepository, freshEvidence),
        join(
          realpathSync(freshRepository),
          'backend/test-results/media-operations',
        ),
      );
      assert.equal(
        realpathSync(join(freshRepository, 'backend/test-results')),
        join(realpathSync(freshRepository), 'backend/test-results'),
      );
    } finally {
      rmSync(freshRepository, { recursive: true, force: true });
    }
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

void test('requires one exact credential-free HTTPS runbook URL on every alert', () => {
  const expected = 'https://runbooks.example.com/media-ingestion';
  const documents = [
    {
      groups: [
        {
          name: 'media',
          rules: [
            { record: 'hsk_media:test', expr: 'vector(1)' },
            {
              alert: 'MediaOne',
              expr: 'vector(1)',
              annotations: { runbook_url: expected },
            },
            {
              alert: 'MediaTwo',
              expr: 'vector(0)',
              annotations: { runbook_url: expected },
            },
          ],
        },
      ],
    },
  ];
  assert.equal(assertEveryAlertRunbookUrl(documents, expected), 2);
  assert.equal(requireCredentialFreeHttpsRunbookUrl(expected), expected);

  const missing = structuredClone(documents);
  delete (
    (missing[0].groups[0].rules[1] as Record<string, unknown>)
      .annotations as Record<string, unknown>
  ).runbook_url;
  assert.throws(
    () => assertEveryAlertRunbookUrl(missing, expected),
    /runbook URL|non-empty HTTPS/i,
  );
  const placeholder = structuredClone(documents);
  (
    (placeholder[0].groups[0].rules[1] as Record<string, unknown>)
      .annotations as Record<string, unknown>
  ).runbook_url = '__MEDIA_RUNBOOK_URL__';
  assert.throws(
    () => assertEveryAlertRunbookUrl(placeholder, expected),
    /runbook URL|absolute HTTPS/i,
  );
  const mismatch = structuredClone(documents);
  (
    (mismatch[0].groups[0].rules[1] as Record<string, unknown>)
      .annotations as Record<string, unknown>
  ).runbook_url = 'https://runbooks.example.com/wrong';
  assert.throws(
    () => assertEveryAlertRunbookUrl(mismatch, expected),
    /does not match/i,
  );
  for (const invalid of [
    'http://runbooks.example.com/media',
    'https://user:password@runbooks.example.com/media',
    'https://runbooks.example.com/media?token=secret',
    'https://runbooks.example.com/media#fragment',
    'https://runbooks.invalid/media',
  ]) {
    assert.throws(
      () => requireCredentialFreeHttpsRunbookUrl(invalid),
      /credential-free production HTTPS/i,
    );
  }
});

void test('validates production runbook response content, not only a 2xx status', async () => {
  const validBody = [
    'HSK_MEDIA_INGESTION_RUNBOOK_V1',
    'service: media-ingestion',
    'runbook-id: media-ingestion-production',
    'owner: platform-sre',
    'revision: 2026-08-22',
    'HSK_MEDIA_RECOVERY_ROLLBACK_V1',
  ].join('\n');

  await withHttpFixture(
    { status: 200, contentType: 'text/plain; charset=utf-8', body: validBody },
    async (url) => {
      const result = await assertProductionRunbookResponse(
        await fetch(url, { redirect: 'manual' }),
      );
      assert.equal(result.runbookId, 'media-ingestion-production');
      assert.equal(result.owner, 'platform-sre');
      assert.equal(result.revision, '2026-08-22');
      assert.match(result.bodySha256, /^[a-f0-9]{64}$/u);
    },
  );

  for (const fixture of [
    { status: 204, contentType: 'text/plain', body: '' },
    { status: 200, contentType: 'text/plain', body: '' },
    { status: 200, contentType: 'application/json', body: validBody },
    { status: 200, contentType: 'text/plain', body: 'wrong page' },
    {
      status: 200,
      contentType: 'text/plain',
      body: validBody.replace('owner: platform-sre', 'owner: unknown'),
    },
    {
      status: 200,
      contentType: 'text/plain',
      body: validBody.replace('HSK_MEDIA_RECOVERY_ROLLBACK_V1', ''),
    },
    {
      status: 200,
      contentType: 'text/plain',
      body: `${validBody}\n${'x'.repeat(256 * 1024)}`,
    },
  ]) {
    await withHttpFixture(fixture, async (url) => {
      await assert.rejects(
        assertProductionRunbookResponse(
          await fetch(url, { redirect: 'manual' }),
        ),
        /runbook|HTTP 200|content type|body|owner|rollback|large/i,
      );
    });
  }

  await withHttpFixture(
    {
      status: 302,
      contentType: 'text/plain',
      body: validBody,
      headers: { location: '/other' },
    },
    async (url) => {
      await assert.rejects(
        assertProductionRunbookResponse(
          await fetch(url, { redirect: 'manual' }),
        ),
        /HTTP 200|redirect/i,
      );
    },
  );
});

void test('requires exact runbook URLs in Prometheus runtime alert rules', () => {
  const expected = 'https://runbooks.example.com/media-ingestion';
  const response = {
    status: 'success',
    data: {
      groups: [
        {
          rules: [
            { type: 'recording', name: 'hsk_media:test' },
            {
              type: 'alerting',
              name: 'MediaRuntime',
              annotations: { runbook_url: expected },
            },
          ],
        },
      ],
    },
  };
  assert.equal(assertPrometheusRuntimeAlertRunbookUrl(response, expected), 1);
  const mismatch = structuredClone(response);
  const runtimeRule = mismatch.data.groups[0]?.rules[1];
  assert.ok(runtimeRule?.annotations);
  runtimeRule.annotations.runbook_url = 'https://runbooks.example.com/wrong';
  assert.throws(
    () => assertPrometheusRuntimeAlertRunbookUrl(mismatch, expected),
    /wrong runbook_url/i,
  );
  assert.throws(
    () =>
      assertPrometheusRuntimeAlertRunbookUrl(
        { status: 'success', data: { groups: [] } },
        expected,
      ),
    /no rule groups/i,
  );
});

void test('requires Grafana status 200 and a non-time metric datapoint', () => {
  const frame = (value: unknown) => ({
    schema: {
      fields: [
        { name: 'Time', type: 'time' },
        { name: 'Value', type: 'number' },
      ],
    },
    data: { values: [[1_700_000_000_000], [value]] },
  });
  assert.doesNotThrow(() =>
    assertGrafanaQueryResult({ status: 200, frames: [frame(1)] }, 'A'),
  );
  assert.throws(
    () => assertGrafanaQueryResult({ frames: [frame(1)] }, 'A'),
    /status 200/i,
  );
  assert.throws(
    () =>
      assertGrafanaQueryResult(
        {
          status: 200,
          frames: [
            {
              schema: { fields: [{ name: 'Time', type: 'time' }] },
              data: { values: [[1_700_000_000_000]] },
            },
          ],
        },
        'A',
      ),
    /no metric datapoint/i,
  );
  assert.throws(
    () => assertGrafanaQueryResult({ status: 200, frames: [frame(null)] }, 'A'),
    /no metric datapoint/i,
  );
  assert.doesNotThrow(() =>
    assertGrafanaNoDataResult({ status: 200, frames: [] }, 'NO_DATA'),
  );
  assert.throws(
    () =>
      assertGrafanaNoDataResult({ status: 200, frames: [frame(1)] }, 'NO_DATA'),
    /unexpectedly returned data/i,
  );
});

void test('waits boundedly for delayed Grafana datapoints and preserves fail-closed errors', async () => {
  const metricFrame = {
    schema: { fields: [{ name: 'Value', type: 'number' }] },
    data: { values: [[1]] },
  };
  let elapsedMs = 0;
  let attempts = 0;
  assert.equal(
    await waitForGrafanaMetricDatapoint(
      () => {
        attempts += 1;
        return attempts < 3
          ? { status: 200, frames: [] }
          : { status: 200, frames: [metricFrame] };
      },
      'PROCESSING_P95',
      {
        timeoutMs: 250,
        pollIntervalMs: 100,
        now: () => elapsedMs,
        sleep: (delayMs) => {
          elapsedMs += delayMs;
          return Promise.resolve();
        },
      },
    ),
    3,
  );
  assert.equal(elapsedMs, 200);

  elapsedMs = 0;
  attempts = 0;
  await assert.rejects(
    waitForGrafanaMetricDatapoint(
      () => {
        attempts += 1;
        return { status: 200, frames: [] };
      },
      'PROCESSING_P95',
      {
        timeoutMs: 250,
        pollIntervalMs: 100,
        now: () => elapsedMs,
        sleep: (delayMs) => {
          elapsedMs += delayMs;
          return Promise.resolve();
        },
      },
    ),
    /PROCESSING_P95 has no metric datapoint.*250ms/iu,
  );
  assert.equal(elapsedMs, 250);
  assert.equal(attempts, 3);

  elapsedMs = 0;
  attempts = 0;
  await assert.rejects(
    waitForGrafanaMetricDatapoint(
      () => {
        attempts += 1;
        return { status: 503, frames: [] };
      },
      'PROCESSING_P95',
      {
        timeoutMs: 250,
        pollIntervalMs: 100,
        now: () => elapsedMs,
        sleep: () => Promise.resolve(),
      },
    ),
    /did not return status 200/iu,
  );
  assert.equal(attempts, 1);
  assert.equal(elapsedMs, 0);

  const runner = readFileSync(
    resolve(__dirname, 'run-media-operations-validation.ts'),
    'utf8',
  );
  assert.match(
    runner,
    /for \(const \{ refId, expr \} of targets\) \{[\s\S]*?await waitForGrafanaMetricDatapoint\(/u,
  );
  assert.match(
    runner,
    /assertGrafanaNoDataResult\(noDataResult, noDataRefId\);/u,
  );
});

void test('requires a unique stable Grafana target contract from imported readback', () => {
  const dashboard = {
    panels: [
      {
        datasource: { type: 'prometheus', uid: 'hsk-media-prometheus' },
        targets: [
          { refId: 'INGEST_AVAILABILITY', expr: 'hsk_media:availability' },
        ],
      },
      {
        datasource: { type: 'prometheus', uid: 'hsk-media-prometheus' },
        targets: [{ refId: 'SIGNED_AVAILABILITY', expr: 'hsk_media:signed' }],
      },
    ],
  };
  assert.deepEqual(
    assertGrafanaDashboardTargetContract(
      dashboard,
      structuredClone(dashboard),
      'hsk-media-prometheus',
    ),
    [
      { refId: 'INGEST_AVAILABILITY', expr: 'hsk_media:availability' },
      { refId: 'SIGNED_AVAILABILITY', expr: 'hsk_media:signed' },
    ],
  );

  const duplicate = structuredClone(dashboard);
  duplicate.panels[1].targets[0].refId = 'INGEST_AVAILABILITY';
  assert.throws(
    () =>
      assertGrafanaDashboardTargetContract(
        duplicate,
        duplicate,
        'hsk-media-prometheus',
      ),
    /duplicate Grafana target refId/i,
  );

  const unstable = structuredClone(dashboard);
  unstable.panels[1].targets[0].expr = 'hsk_media:changed';
  assert.throws(
    () =>
      assertGrafanaDashboardTargetContract(
        dashboard,
        unstable,
        'hsk-media-prometheus',
      ),
    /readback target contract differs/i,
  );

  const generated = structuredClone(dashboard);
  generated.panels[0].targets[0].refId = 'A';
  assert.throws(
    () =>
      assertGrafanaDashboardTargetContract(
        generated,
        generated,
        'hsk-media-prometheus',
      ),
    /stable uppercase identifier/i,
  );

  const wrongDatasource = structuredClone(dashboard);
  wrongDatasource.panels[0].datasource.uid = 'default';
  assert.throws(
    () =>
      assertGrafanaDashboardTargetContract(
        wrongDatasource,
        wrongDatasource,
        'hsk-media-prometheus',
      ),
    /exact provisioned datasource/i,
  );
});

void test('binds evidence to stable in-scope dirty and untracked bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-media-release-digest-'));
  try {
    mkdirSync(join(root, 'backend'), { recursive: true });
    mkdirSync(join(root, 'frontend'), { recursive: true });
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    mkdirSync(join(root, 'docs/reports'), { recursive: true });
    writeFileSync(join(root, 'backend/owned.ts'), 'one');
    writeFileSync(join(root, 'frontend/unrelated.ts'), 'ignored');
    writeFileSync(join(root, '.github/workflows/media-release.yml'), 'one');
    writeFileSync(join(root, 'docs/roadmap.md'), 'roadmap one');
    writeFileSync(join(root, 'docs/roadmap_prod.jpg'), 'image one');
    writeFileSync(join(root, 'docs/roadmap_prod_v2.png'), 'image two');
    writeFileSync(
      join(root, 'docs/reports/10-delivery-production-operations-report.md'),
      'report one',
    );
    const status =
      ' M backend/owned.ts\0?? frontend/unrelated.ts\0 M .github/workflows/media-release.yml\0 M docs/roadmap.md\0?? docs/roadmap_prod.jpg\0?? docs/roadmap_prod_v2.png\0 M docs/reports/10-delivery-production-operations-report.md\0';
    const first = computeReleaseContentDigest(root, status);
    assert.equal(first.pathCount, 2);
    assert.equal(first.releaseContentDirty, true);
    assert.equal(first.releaseContentIndexDirty, false);
    assert.deepEqual(computeGlobalGitState(status), {
      globalWorktreeDirty: true,
      globalIndexDirty: false,
      globalDirtyPathCount: 7,
    });
    assert.doesNotThrow(() => assertReleaseContentStable(first, first));
    writeFileSync(join(root, 'backend/owned.ts'), 'two');
    const second = computeReleaseContentDigest(root, status);
    assert.notEqual(first.digest, second.digest);
    assert.throws(
      () => assertReleaseContentStable(first, second),
      /changed while validation/i,
    );
    writeFileSync(join(root, 'frontend/unrelated.ts'), 'changed but ignored');
    writeFileSync(join(root, 'docs/roadmap.md'), 'changed roadmap ignored');
    writeFileSync(join(root, 'docs/roadmap_prod.jpg'), 'changed jpg ignored');
    writeFileSync(
      join(root, 'docs/roadmap_prod_v2.png'),
      'changed png ignored',
    );
    writeFileSync(
      join(root, 'docs/reports/10-delivery-production-operations-report.md'),
      'changed report ignored',
    );
    const third = computeReleaseContentDigest(root, status);
    assert.equal(second.digest, third.digest);
    const head = 'a'.repeat(40);
    assert.doesNotThrow(() => assertReleaseHeadStable(head, head));
    assert.throws(
      () => assertReleaseHeadStable(head, 'b'.repeat(40)),
      /HEAD changed/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('verifies detached evidence bytes before parsing trusted JSON', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const identity =
    'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-release-evidence.yml@refs/tags/v1.2.3';
  const issuer = 'https://token.actions.githubusercontent.com';
  const now = Date.parse('2026-08-22T08:00:00.000Z');
  const bytes = Buffer.from(
    JSON.stringify({ schemaVersion: 1, restoreSucceeded: true }),
  );
  const signature = signBytes(null, bytes, privateKey);
  const verify = (payload: Buffer) => {
    if (!verifySignature(null, payload, publicKey, signature)) {
      return Promise.reject(new Error('detached signature is invalid'));
    }
    return Promise.resolve({
      payloadSha256: sha256(payload),
      bundleSha256: 'f'.repeat(64),
      issuer,
      identity,
      verifiedAt: '2026-08-22T07:55:00.000Z',
    });
  };

  const trusted = await verifyThenParseJsonEvidence(bytes, verify, {
    issuer,
    identity,
    nowMs: now,
    maxAgeMs: 60 * 60 * 1000,
  });
  assert.deepEqual(trusted.value, {
    schemaVersion: 1,
    restoreSucceeded: true,
  });
  assert.equal(trusted.trust.payloadSha256, sha256(bytes));

  await assert.rejects(
    verifyThenParseJsonEvidence(
      Buffer.from('{"schemaVersion":1,"restoreSucceeded":false}'),
      verify,
      { issuer, identity, nowMs: now, maxAgeMs: 60 * 60 * 1000 },
    ),
    /signature/i,
  );
  await assert.rejects(
    verifyThenParseJsonEvidence(
      bytes,
      () => Promise.reject(new Error('unsigned evidence')),
      { issuer, identity, nowMs: now, maxAgeMs: 60 * 60 * 1000 },
    ),
    /unsigned/i,
  );
  await assert.rejects(
    verifyThenParseJsonEvidence(
      bytes,
      async (payload) => ({
        ...(await verify(payload)),
        identity: `${identity}-attacker`,
      }),
      { issuer, identity, nowMs: now, maxAgeMs: 60 * 60 * 1000 },
    ),
    /identity/i,
  );
  await assert.rejects(
    verifyThenParseJsonEvidence(
      bytes,
      async (payload) => ({
        ...(await verify(payload)),
        issuer: 'https://issuer.example.invalid',
      }),
      { issuer, identity, nowMs: now, maxAgeMs: 60 * 60 * 1000 },
    ),
    /issuer/i,
  );
  await assert.rejects(
    verifyThenParseJsonEvidence(
      bytes,
      async (payload) => ({
        ...(await verify(payload)),
        verifiedAt: '2026-08-20T00:00:00.000Z',
      }),
      { issuer, identity, nowMs: now, maxAgeMs: 60 * 60 * 1000 },
    ),
    /stale/i,
  );
});

void test('pins a protected self-hosted release-evidence verifier workflow', () => {
  const workflow = readFileSync(
    resolve(
      __dirname,
      '../../..',
      '.github/workflows/media-release-evidence.yml',
    ),
    'utf8',
  );
  const uses = Array.from(
    workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gmu),
    (match) => match[1],
  );
  const validateStart = workflow.indexOf('\n  validate:');
  const attestStart = workflow.indexOf('\n  attest:');
  assert.ok(validateStart >= 0 && attestStart > validateStart);
  const validateWorkflow = workflow.slice(validateStart, attestStart);

  assert.ok(uses.length >= 4);
  assert.ok(
    uses.every((entry) => /@[a-f0-9]{40}$/u.test(entry)),
    'Every GitHub Action must use an immutable full commit SHA.',
  );
  assert.match(workflow, /tags:\s*\n\s*- v3\.0\.0/u);
  assert.match(
    validateWorkflow,
    /runs-on:\s*\n\s*- self-hosted\s*\n\s*- linux\s*\n\s*- x64\s*\n\s*- media-release/u,
  );
  assert.match(validateWorkflow, /environment:\s*media-production-release/u);
  assert.doesNotMatch(validateWorkflow, /id-token:\s*write/u);
  assert.doesNotMatch(validateWorkflow, /runs-on:\s*ubuntu-/u);
  for (const binding of [
    'GITHUB_REF_TYPE',
    'GITHUB_REF',
    'GITHUB_SHA',
    'git rev-parse HEAD',
    'git rev-parse "${GITHUB_REF}^{commit}"',
  ]) {
    assert.ok(
      validateWorkflow.includes(binding),
      `Release workflow is missing tag/HEAD binding: ${binding}.`,
    );
  }

  const validationCommand = validateWorkflow.indexOf(
    'npm run test:ops:media:linux-amd64',
  );
  assert.ok(validationCommand > 0);
  assert.doesNotMatch(
    validateWorkflow,
    /\bcosign\s+sign(?:-blob)?\b|Keyless-sign supplied release payloads/u,
    'The verifier workflow must never mint trust for caller-supplied evidence.',
  );
  assert.doesNotMatch(validateWorkflow, /continue-on-error|\|\|\s*true/u);
  assert.match(
    validateWorkflow,
    /secrets\.MEDIA_OPS_OCI_RELEASE_EVIDENCE_JSON_PATH/u,
  );
  assert.match(
    validateWorkflow,
    /secrets\.MEDIA_OPS_OCI_RELEASE_EVIDENCE_BUNDLE_PATH/u,
  );
  assert.match(
    validateWorkflow,
    /secrets\.MEDIA_OPS_CAPACITY_BACKUP_EVIDENCE_JSON_PATH/u,
  );
  assert.match(
    validateWorkflow,
    /secrets\.MEDIA_OPS_CAPACITY_BACKUP_EVIDENCE_BUNDLE_PATH/u,
  );
  assert.match(validateWorkflow, /secrets\.MEDIA_OPS_DB_EVIDENCE_JSON_PATH/u);
  assert.match(validateWorkflow, /secrets\.MEDIA_OPS_DB_EVIDENCE_BUNDLE_PATH/u);
  assert.match(
    validateWorkflow,
    /secrets\.MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_JSON_PATH/u,
  );
  assert.match(
    validateWorkflow,
    /secrets\.MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_BUNDLE_PATH/u,
  );
  assert.match(
    validateWorkflow,
    /secrets\.MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_ROOT_PATH/u,
  );
  assert.match(
    validateWorkflow,
    /secrets\.MEDIA_OPS_PRODUCTION_PREREQUISITE_EVIDENCE_JSON_PATH/u,
  );
  assert.match(
    validateWorkflow,
    /secrets\.MEDIA_OPS_PRODUCTION_PREREQUISITE_EVIDENCE_BUNDLE_PATH/u,
  );
  assert.match(
    validateWorkflow,
    /secrets\.MEDIA_OPS_OCI_RELEASE_EVIDENCE_ROOT_PATH/u,
  );
  assert.match(validateWorkflow, /vars\.MEDIA_OPS_RELEASE_EVIDENCE_BASE_PATH/u);
  assert.match(
    validateWorkflow,
    /Approved evidence base is required when any evidence path is supplied/u,
  );
  assert.match(
    validateWorkflow,
    /must be an absolute regular non-symlink file/u,
  );
  assert.match(validateWorkflow, /must use its exact canonical path/u);
  assert.match(validateWorkflow, /outside the approved evidence base/u);
  assert.doesNotMatch(
    validateWorkflow,
    /MEDIA_OPS_PRODUCTION_PREREQUISITE_ARCHIVE|immutable pre-run prerequisite archive/u,
    'An arbitrary pre-run file cannot satisfy protected artifact attestation.',
  );
  for (const binding of [
    'MEDIA_OPS_OCI_RELEASE_EVIDENCE_BUNDLE=${validated_path}',
    'MEDIA_OPS_CAPACITY_BACKUP_EVIDENCE_BUNDLE=${validated_path}',
    'MEDIA_OPS_DB_EVIDENCE_BUNDLE=${validated_path}',
    'MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_BUNDLE=${validated_path}',
    'MEDIA_OPS_PRODUCTION_PREREQUISITE_EVIDENCE_BUNDLE=${validated_path}',
  ]) {
    const bindingIndex = validateWorkflow.indexOf(binding);
    assert.ok(
      bindingIndex > 0 && bindingIndex < validationCommand,
      `Pre-signed evidence bundle is not wired before verification: ${binding}.`,
    );
  }
  assert.match(
    validateWorkflow,
    /if \[\[ -n "\$\{OCI_EVIDENCE_JSON_PATH\}" \]\]/u,
  );
  assert.match(
    validateWorkflow,
    /if \[\[ -n "\$\{CAPACITY_EVIDENCE_JSON_PATH\}" \]\]/u,
  );
  assert.match(
    validateWorkflow,
    /if \[\[ -n "\$\{LIVE_REHEARSAL_EVIDENCE_JSON_PATH\}" \]\]/u,
  );
  assert.match(
    validateWorkflow,
    /Live rehearsal evidence manifest is outside its evidence root/u,
  );
  assert.doesNotMatch(
    validateWorkflow,
    /signing_required|SIGNING_OUTCOME|TOOL_OUTCOME/u,
  );
  assert.match(
    validateWorkflow,
    /name:\s*Initialize minimal diagnostic evidence/u,
  );
  assert.ok(
    validateWorkflow.indexOf('Initialize minimal diagnostic evidence') <
      validateWorkflow.indexOf('Set up Node.js'),
  );
  assert.match(
    validateWorkflow,
    /name:\s*Run Linux amd64 release validator\s*\n\s*id:\s*release-gate\s*\n\s*if:\s*always\(\)/u,
  );
  assert.match(
    validateWorkflow,
    /name:\s*Package exact evidence bytes\s*\n\s*if:\s*always\(\)/u,
  );
  assert.match(
    validateWorkflow,
    /name:\s*Retain evidence whether pass or fail\s*\n\s*if:\s*always\(\)/u,
  );
  assert.match(validateWorkflow, /tar\s+[\s\S]*--sort=name/u);
  assert.match(validateWorkflow, /--mtime='UTC 1970-01-01'/u);
  assert.match(validateWorkflow, /--owner=0\s+--group=0\s+--numeric-owner/u);
  assert.match(workflow, /retention-days:\s*90/u);
  assert.match(
    workflow,
    /if:\s*needs\.validate\.outputs\.gate-exit-code == '0'/u,
  );
  assert.match(
    validateWorkflow,
    /runner_exit_code=1[\s\S]*npm run test:ops:media:linux-amd64[\s\S]*runner_exit_code=\$\?[\s\S]*value\.postGateAttestationReady === true[\s\S]*"\$\{runner_exit_code\}" = "2" && "\$\{attestation_ready\}" = "true"[\s\S]*gate_exit_code=0/u,
  );
  assert.match(workflow, /runner-exit-code:\s*\$\{\{/u);
  assert.match(workflow, /attestation-ready:\s*\$\{\{/u);
  assert.match(
    workflow,
    /if \[\[ "\$\{RUNNER_EXIT_CODE\}" = "2" \]\]; then[\s\S]*test "\$\{ATTESTATION_READY\}" = "true"[\s\S]*else[\s\S]*test "\$\{RUNNER_EXIT_CODE\}" = "0"/u,
  );
  assert.match(workflow, /id-token:\s*write/u);
  assert.match(workflow, /attestations:\s*write/u);
  assert.doesNotMatch(workflow, /pull_request|permissions:\s*write-all/u);
});

void test('runs release quality prerequisites with a hermetic parse-only database profile', () => {
  const runner = readFileSync(
    resolve(__dirname, 'run-media-operations-validation.ts'),
    'utf8',
  );
  const validationStart = runner.indexOf(
    'async function validateReleaseQualityPrerequisites',
  );
  const databaseHookStart = runner.indexOf(
    'async function validateDatabaseEvidenceHook',
  );
  assert.ok(
    validationStart >= 0 && databaseHookStart > validationStart,
    'Release quality prerequisite boundary is missing.',
  );
  const qualitySection = runner.slice(validationStart, databaseHookStart);
  assert.match(qualitySection, /env:\s*qualityEnvironment/u);
  assert.match(
    qualitySection,
    /postgresql:\/\/release-validator@127\.0\.0\.1:1\/hsk_media_release_validation_test\?schema=public/u,
  );
  assert.match(qualitySection, /NPM_CONFIG_USERCONFIG:\s*'\/dev\/null'/u);
  assert.doesNotMatch(qualitySection, /NPM_CONFIG_GLOBALCONFIG/u);
  assert.doesNotMatch(qualitySection, /\.\.\.process\.env/u);
  for (const secretKey of [
    'AUTH_PASSWORD_PEPPER',
    'JWT_SECRETS',
    'MEDIA_METRICS_BEARER_TOKEN',
    'MEDIA_SIGNING_SECRET',
  ]) {
    assert.equal(qualitySection.includes(secretKey), false);
  }
  for (const evidenceKey of ['DATABASE_URL', 'NPM_CONFIG_USERCONFIG']) {
    assert.equal(
      MEDIA_OPERATIONS_EVIDENCE_ENV_ALLOWLIST.has(evidenceKey),
      true,
    );
  }
});

void test('pins every detached bundle to exact GitHub workflow certificate claims', () => {
  const runner = readFileSync(
    resolve(__dirname, 'run-media-operations-validation.ts'),
    'utf8',
  );
  assert.equal(
    Array.from(
      runner.matchAll(/\.\.\.releaseEvidenceCertificateClaims\(binding\)/gu),
    ).length,
    5,
  );
  for (const claim of [
    '--certificate-github-workflow-name',
    '--certificate-github-workflow-ref',
    '--certificate-github-workflow-repository',
    '--certificate-github-workflow-sha',
    '--certificate-github-workflow-trigger',
  ]) {
    assert.ok(runner.includes(claim), `Missing Cosign claim pin: ${claim}.`);
  }
  assert.match(
    runner,
    /RELEASE_EVIDENCE_WORKFLOW_REF = 'refs\/tags\/v3\.0\.0'/u,
  );
  assert.match(
    runner,
    /RELEASE_EVIDENCE_WORKFLOW_REPOSITORY = 'khonghao0109\/HSK-3\.0-APP'/u,
  );
  assert.match(
    runner,
    /--certificate-github-workflow-sha',[\s\S]*binding\.commit/u,
  );
});

void test('retains trust-verified payload and bundle bytes in the attested tree', () => {
  const runner = readFileSync(
    resolve(__dirname, 'run-media-operations-validation.ts'),
    'utf8',
  );
  for (const path of [
    'production-prerequisites/inventory.json',
    'production-prerequisites/inventory.sigstore.json',
    'oci/release-acceptance.json',
    'oci/release-acceptance.sigstore.json',
    'database/release-evidence.json',
    'database/release-evidence.sigstore.json',
    'capacity-backup/evidence.json',
    'capacity-backup/evidence.sigstore.json',
  ]) {
    assert.ok(
      runner.includes(`'${path}'`),
      `Trusted input is not retained: ${path}.`,
    );
  }
  assert.match(runner, /resetRetainedTrustedEvidence\(\);/u);
  assert.match(runner, /writeStableExclusiveFileWithinRoot\(/u);
});

void test('reads bounded evidence from a stable descriptor and rejects leaf or ancestor swaps', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-media-stable-read-'));
  const outside = mkdtempSync(join(tmpdir(), 'hsk-media-stable-read-outside-'));
  try {
    const direct = join(root, 'direct.json');
    const outsideFile = join(outside, 'outside.json');
    writeFileSync(direct, '{"trusted":true}\n');
    writeFileSync(outsideFile, '{"outside":true}\n');
    assert.equal(
      readStableBoundedFileWithinRoot(
        root,
        'direct.json',
        1024,
        'stable read fixture',
      ).toString('utf8'),
      '{"trusted":true}\n',
    );
    assert.throws(
      () =>
        readStableBoundedFileWithinRoot(
          root,
          'direct.json',
          1024,
          'stable read leaf race',
          {
            beforeDescriptorOpen: () => {
              rmSync(direct);
              symlinkSync(outsideFile, direct, 'file');
            },
          },
        ),
      /symbolic|ELOOP/iu,
    );

    rmSync(direct, { force: true });
    const nested = join(root, 'nested');
    mkdirSync(nested);
    writeFileSync(join(nested, 'report.json'), '{"trusted":true}\n');
    writeFileSync(join(outside, 'report.json'), '{"outside":true}\n');
    assert.throws(
      () =>
        readStableBoundedFileWithinRoot(
          root,
          'nested/report.json',
          1024,
          'stable read ancestor race',
          {
            beforeDescriptorOpen: () => {
              rmSync(nested, { recursive: true, force: true });
              symlinkSync(outside, nested, 'dir');
            },
          },
        ),
      /outside|escaped|changed/iu,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

void test('publishes retained evidence through a stable exclusive descriptor', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-media-stable-write-'));
  const outside = mkdtempSync(
    join(tmpdir(), 'hsk-media-stable-write-outside-'),
  );
  try {
    writeStableExclusiveFileWithinRoot(
      root,
      'normal/evidence.json',
      Buffer.from('{"trusted":true}\n'),
      'stable write fixture',
    );
    assert.equal(
      readFileSync(join(root, 'normal/evidence.json'), 'utf8'),
      '{"trusted":true}\n',
    );

    const racedParent = join(root, 'raced-parent');
    mkdirSync(racedParent);
    assert.throws(
      () =>
        writeStableExclusiveFileWithinRoot(
          root,
          'raced-parent/evidence.json',
          Buffer.from('must-not-escape'),
          'stable write ancestor race',
          {
            beforeDescriptorOpen: () => {
              rmSync(racedParent, { recursive: true, force: true });
              symlinkSync(outside, racedParent, 'dir');
            },
          },
        ),
      /symbolic|directory|ELOOP|ENOTDIR/iu,
    );
    assert.equal(existsSync(join(outside, 'evidence.json')), false);

    rmSync(racedParent, { force: true });
    const outsideFile = join(outside, 'outside.json');
    const racedLeaf = join(root, 'raced-leaf.json');
    writeFileSync(outsideFile, 'outside-must-remain');
    assert.throws(
      () =>
        writeStableExclusiveFileWithinRoot(
          root,
          'raced-leaf.json',
          Buffer.from('must-not-escape'),
          'stable write leaf race',
          {
            afterDescriptorOpen: () => {
              rmSync(racedLeaf, { force: true });
              symlinkSync(outsideFile, racedLeaf, 'file');
            },
          },
        ),
      /changed type|outside|escaped/iu,
    );
    assert.equal(readFileSync(outsideFile, 'utf8'), 'outside-must-remain');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

void test('binds a rendered release tree to sorted relative paths and bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-media-rendered-tree-'));
  try {
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'z.yml'), 'z');
    writeFileSync(join(root, 'nested/a.yml'), 'a');
    const first = computeTreeDigest(root);
    assert.equal(first.pathCount, 2);
    assert.match(first.digest, /^[a-f0-9]{64}$/u);
    assert.deepEqual(first.paths, ['nested/a.yml', 'z.yml']);
    writeFileSync(join(root, 'nested/a.yml'), 'changed');
    assert.notEqual(computeTreeDigest(root).digest, first.digest);
    symlinkSync(join(root, 'z.yml'), join(root, 'nested/link.yml'));
    assert.throws(() => computeTreeDigest(root), /symbolic link/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('computes a deterministic migration catalog from source bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-media-migrations-'));
  try {
    for (const [name, sql] of [
      ['20260813163000_first', 'SELECT 1;\n'],
      ['20260813193000_second', 'SELECT 2;\n'],
    ]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'migration.sql'), sql);
    }
    writeFileSync(
      join(root, 'migration_lock.toml'),
      'provider = "postgresql"\n',
    );
    const first = computeMigrationCatalogEvidence(root);
    assert.equal(first.catalogCount, 2);
    assert.deepEqual(
      first.entries.map(({ name }) => name),
      ['20260813163000_first', '20260813193000_second'],
    );
    assert.match(first.catalogChecksum, /^[a-f0-9]{64}$/u);
    writeFileSync(
      join(root, '20260813193000_second', 'migration.sql'),
      'SELECT 3;\n',
    );
    assert.notEqual(
      computeMigrationCatalogEvidence(root).catalogChecksum,
      first.catalogChecksum,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('rejects fabricated DB booleans and accepts only release-bound command evidence', () => {
  const now = Date.parse('2026-08-13T12:00:00.000Z');
  const evidenceRoot = mkdtempSync(join(tmpdir(), 'hsk-media-db-evidence-'));
  const retained = new Map<string, Buffer>();
  const expected = {
    commit: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    releaseContentDigest: 'c'.repeat(64),
    evidenceRoot,
    catalogCount: 19,
    catalogChecksum: '1'.repeat(64),
    latestMigrations: [
      { name: 'migration-18', checksum: 'd'.repeat(64) },
      { name: 'migration-19', checksum: 'e'.repeat(64) },
    ],
    nowMs: now,
    retainValidatedFile: (relativePath: string, bytes: Buffer) => {
      retained.set(relativePath, bytes);
    },
  };
  const checks = Object.fromEntries(
    [
      'freshMigrationDeploy',
      'upgradeMigrationDeploy',
      'adversarialFixture',
      'integration',
      'concurrency',
      'migrateStatus',
      'checksumAudit',
      'drift',
      'fullE2E',
      'futureTimestampFixture',
      'auditLifecycleRace',
      'boundedMigrationAbort',
    ].map((name) => [name, { outcome: 'PASS', commandId: name }]),
  );
  const commands = Object.keys(checks).map((id) => {
    const logPath = `logs/${id}.log`;
    const bytes = Buffer.from(
      `${id} completed without sensitive data\n${id === 'freshMigrationDeploy' ? 'x'.repeat(1_500) : ''}`,
    );
    mkdirSync(join(evidenceRoot, 'logs'), { recursive: true });
    writeFileSync(join(evidenceRoot, logPath), bytes, { mode: 0o600 });
    return {
      id,
      commandRef: `media-release-${id}`,
      platform: 'darwin/arm64',
      outcome: 'PASS',
      role: 'check',
      durationMs: 1,
      exitCode: 0,
      logPath,
      logSha256: sha256(bytes),
      executable: 'psql',
      executableIdentity: '/synthetic/bin/psql',
      executableSha256: '9'.repeat(64),
      toolVersion: `sha256:${'9'.repeat(64)}`,
      safeArgs: ['--synthetic-check'],
      cwd: '/synthetic/backend',
      envKeys: ['NODE_ENV', 'PGOPTIONS'],
      startedAt: '2026-08-13T11:00:00.000Z',
      completedAt: '2026-08-13T11:00:00.001Z',
      gitCommit: expected.commit,
      gitTreeSha: expected.treeSha,
      releaseContentDigest: expected.releaseContentDigest,
      inputTreeDigest: expected.releaseContentDigest,
    };
  });
  commands[0].safeArgs = ['--synthetic-check', 'SELECT password FROM "User"'];
  const runId = '12345678-abcd-4567-8123-123456789abc';
  const junit = Buffer.from(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuite tests="12" failures="0">',
      ...Object.keys(checks)
        .sort((left, right) => left.localeCompare(right))
        .map((name) => `<testcase name="${name}"/>`),
      `<!-- ${'x'.repeat(1_500)} -->`,
      '</testsuite>',
      '',
    ].join('\n'),
  );
  writeFileSync(join(evidenceRoot, 'evidence.junit.xml'), junit, {
    mode: 0o600,
  });
  const logManifest = Buffer.from(
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      commands: commands.map(({ id, logPath, logSha256 }) => ({
        id,
        logPath,
        logSha256,
      })),
    })}\n`,
  );
  writeFileSync(join(evidenceRoot, 'log-manifest.json'), logManifest, {
    mode: 0o600,
  });
  const evidence = {
    schemaVersion: 1,
    runId,
    startedAt: '2026-08-13T11:00:00.000Z',
    completedAt: '2026-08-13T11:30:00.000Z',
    git: { commit: expected.commit, treeSha: expected.treeSha },
    releaseContentDigest: expected.releaseContentDigest,
    database: {
      hostFingerprintSha256: 'f'.repeat(64),
      port: 55439,
      databaseName: 'hsk_media_release_test',
      guardedTestSuffix: true,
      serverVersion: '16.14',
    },
    migrations: {
      catalogCount: 19,
      catalogChecksumSha256: '1'.repeat(64),
      latestNames: expected.latestMigrations.map(({ name }) => name),
      latestChecksums: expected.latestMigrations.map(
        ({ checksum }) => checksum,
      ),
    },
    checks,
    commands,
    artifacts: {
      junit: { path: 'evidence.junit.xml', sha256: sha256(junit) },
      logManifest: {
        path: 'log-manifest.json',
        sha256: sha256(logManifest),
      },
    },
    auxiliary: {
      futureTimestampAbortCommandId: 'futureTimestampFixture',
      boundedMigrationAbortCommandId: 'boundedMigrationAbort',
      auditLifecycleRaceCommandId: 'auditLifecycleRace',
      concurrency: { blockedOnLock: true, finalAuditCount: 1 },
      benchmark: {
        fixtureRows: 1_000,
        planningTimeMs: 1,
        executionTimeMs: 2,
      },
      databaseCount: 8,
      shadowDatabaseName: 'hsk_media_shadow_test',
    },
    outcome: 'pass',
    durationMs: 1_000,
  };
  try {
    assert.doesNotThrow(() =>
      assertDatabaseReleaseEvidence(evidence, expected),
    );
    assert.equal(retained.size, commands.length + 2);
    assert.equal(sha256(retained.get('evidence.junit.xml')!), sha256(junit));
    assert.equal(
      sha256(retained.get('log-manifest.json')!),
      sha256(logManifest),
    );
    assert.throws(
      () =>
        assertDatabaseReleaseEvidence(
          {
            schemaVersion: 1,
            outcome: 'pass',
            database: { guardedTestSuffix: true },
            checks: Object.fromEntries(
              Object.keys(checks).map((name) => [name, true]),
            ),
          },
          expected,
        ),
      /evidence|field|object/i,
    );
    const forged = structuredClone(evidence);
    forged.commands[0].logSha256 = 'wrong';
    assert.throws(
      () => assertDatabaseReleaseEvidence(forged, expected),
      /command record/i,
    );
    const stale = structuredClone(evidence);
    stale.git.treeSha = '9'.repeat(40);
    assert.throws(
      () => assertDatabaseReleaseEvidence(stale, expected),
      /not bound/i,
    );
    const incompleteJunit = Buffer.from(
      '<testsuite tests="12" failures="0"><testcase name="freshMigrationDeploy"/></testsuite>\n',
    );
    writeFileSync(join(evidenceRoot, 'evidence.junit.xml'), incompleteJunit);
    const incomplete = structuredClone(evidence);
    incomplete.artifacts.junit.sha256 = sha256(incompleteJunit);
    assert.throws(
      () => assertDatabaseReleaseEvidence(incomplete, expected),
      /JUnit.*check matrix/i,
    );
    writeFileSync(join(evidenceRoot, 'evidence.junit.xml'), junit);
    writeFileSync(
      join(evidenceRoot, commands[0].logPath),
      'tampered command log\n',
    );
    assert.throws(
      () => assertDatabaseReleaseEvidence(evidence, expected),
      /forged or unsanitized/i,
    );
  } finally {
    rmSync(evidenceRoot, { recursive: true, force: true });
  }
});

void test('requires release-bound 32-day capacity and restorable backup evidence', async () => {
  const now = Date.parse('2026-08-13T12:00:00.000Z');
  const expected = {
    commit: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    releaseContentDigest: 'c'.repeat(64),
    nowMs: now,
  };
  const provenance = {
    commandsSha256: '4'.repeat(64),
    providerEvidenceSha256: '5'.repeat(64),
    pvcUidSha256: '6'.repeat(64),
    snapshotIdSha256: '7'.repeat(64),
    restoreTargetFingerprintSha256: '8'.repeat(64),
  };
  const clusterFingerprintSha256 = sha256(
    Buffer.from(
      [
        provenance.providerEvidenceSha256,
        provenance.pvcUidSha256,
        provenance.snapshotIdSha256,
        provenance.restoreTargetFingerprintSha256,
      ].join('\0'),
    ),
  );
  const evidence = {
    schemaVersion: 1,
    runId: '12345678-abcd-4567-8123-123456789abc',
    measuredAt: '2026-08-13T11:30:00.000Z',
    git: { commit: expected.commit, treeSha: expected.treeSha },
    releaseContentDigest: expected.releaseContentDigest,
    clusterFingerprintSha256,
    provenance,
    prometheus: {
      pvcBound: true,
      capacityGiB: 50,
      usedGiB: 20,
      compressedIngestGiBPerDay: 0.5,
      projectedRequiredGiB: 20,
      storageClassExpansionAllowed: true,
    },
    backup: {
      encrypted: true,
      retentionDays: 32,
      latestSnapshotAt: '2026-08-13T10:00:00.000Z',
      restoreRehearsedAt: '2026-08-01T10:00:00.000Z',
      restoreSucceeded: true,
      restoreDurationSeconds: 120,
    },
    outcome: 'pass',
  };
  assert.deepEqual(assertCapacityBackupEvidence(evidence, expected), {
    runId: evidence.runId,
    clusterFingerprintSha256: evidence.clusterFingerprintSha256,
    provenanceSha256: sha256(Buffer.from(Object.values(provenance).join('\0'))),
    requiredGiB: 20,
    capacityGiB: 50,
    backupRetentionDays: 32,
  });
  for (const mutate of [
    (candidate: typeof evidence) => {
      candidate.prometheus.projectedRequiredGiB = 41;
    },
    (candidate: typeof evidence) => {
      candidate.prometheus.pvcBound = false;
    },
    (candidate: typeof evidence) => {
      candidate.backup.encrypted = false;
    },
    (candidate: typeof evidence) => {
      candidate.backup.restoreRehearsedAt = '2026-01-01T00:00:00.000Z';
    },
    (candidate: typeof evidence) => {
      candidate.git.treeSha = 'e'.repeat(40);
    },
    (candidate: typeof evidence) => {
      candidate.git.commit = 'e'.repeat(40);
    },
    (candidate: typeof evidence) => {
      candidate.releaseContentDigest = 'e'.repeat(64);
    },
    (candidate: typeof evidence) => {
      candidate.measuredAt = '2026-08-20T00:00:00.000Z';
    },
    (candidate: typeof evidence) => {
      candidate.backup.restoreSucceeded = false;
    },
    (candidate: typeof evidence) => {
      candidate.clusterFingerprintSha256 = 'd'.repeat(64);
    },
    (candidate: typeof evidence) => {
      candidate.provenance.providerEvidenceSha256 = 'e'.repeat(64);
    },
  ]) {
    const candidate = structuredClone(evidence);
    mutate(candidate);
    assert.throws(
      () => assertCapacityBackupEvidence(candidate, expected),
      /capacity|backup|release-bound/i,
    );
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const payload = Buffer.from(JSON.stringify(evidence));
  const signature = signBytes(null, payload, privateKey);
  const issuer = 'https://token.actions.githubusercontent.com';
  const identity =
    'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-release-evidence.yml@refs/tags/v3.0.0';
  const trusted = await verifyThenParseJsonEvidence(
    payload,
    (candidate) => {
      if (!verifySignature(null, candidate, publicKey, signature)) {
        return Promise.reject(
          new Error('capacity evidence signature is invalid'),
        );
      }
      return Promise.resolve({
        payloadSha256: sha256(candidate),
        bundleSha256: 'f'.repeat(64),
        issuer,
        identity,
        verifiedAt: '2026-08-13T11:59:00.000Z',
      });
    },
    { issuer, identity, nowMs: now, maxAgeMs: 5 * 60_000 },
  );
  assert.equal(
    assertCapacityBackupEvidence(trusted.value, expected)
      .clusterFingerprintSha256,
    clusterFingerprintSha256,
  );
});

async function withHttpFixture(
  fixture: {
    status: number;
    contentType: string;
    body: string;
    headers?: Record<string, string>;
  },
  check: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer((_request, response) => {
    response.writeHead(fixture.status, {
      'content-type': fixture.contentType,
      ...fixture.headers,
    });
    response.end(fixture.body);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await check(`http://127.0.0.1:${String(address.port)}/runbook`);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
}

function tarGzip(
  name: string,
  typeFlag: string,
  corruptChecksum = false,
  omitTerminator = false,
): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('00000000000\0', 124, 12, 'ascii');
  header.write(typeFlag, 156, 1, 'ascii');
  header.fill(0x20, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  if (corruptChecksum) header[0] ^= 1;
  return gzipSync(
    omitTerminator
      ? header
      : Buffer.concat([header, Buffer.alloc(512), Buffer.alloc(512)]),
  );
}
