import assert from 'node:assert/strict';
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
  resetMediaOperationsEvidenceLogs,
  resolveMediaOperationsEvidenceRoot,
  assertOciDigest,
  assertOciRegistryResolution,
  resolveVerifiedOciIndex,
  extractSpdxAttestationPredicate,
  classifyValidators,
  computeReleaseContentDigest,
  computeMigrationCatalogEvidence,
  computeTreeDigest,
  contentAddressedCacheFilename,
  parseExactVersion,
  requireExactVersion,
  requireCredentialFreeHttpsRunbookUrl,
  readBoundedResponseBody,
  parseToolchainManifest,
  redactDiagnostic,
  renderValidatorJUnit,
  runProcess,
  selectArtifact,
  sha256,
  verifySha256,
} from './media-operations-validation.helpers';

const requireModule = createRequire(__filename);
const yaml = requireModule('js-yaml') as { loadAll(source: string): unknown[] };

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
      attestations: {
        signature: {
          required: true,
          verifier: 'cosign-keyless',
          issuer: 'https://token.actions.githubusercontent.com',
          approvedIdentities: [
            'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-operations.yml@refs/tags/v1.2.3',
          ],
        },
        sbom: { required: true, format: 'spdx-json' },
      },
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
      attestations: {
        signature: {
          required: true,
          verifier: 'cosign-keyless',
          issuer: 'https://token.actions.githubusercontent.com',
          approvedIdentities: [
            'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-operations.yml@refs/tags/v1.2.3',
          ],
        },
        sbom: { required: true, format: 'spdx-json' },
      },
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
      attestations: {
        signature: {
          required: true,
          verifier: 'cosign-keyless',
          issuer: 'https://token.actions.githubusercontent.com',
          approvedIdentities: [
            'https://github.com/khonghao0109/HSK-3.0-APP/.github/workflows/media-operations.yml@refs/tags/v1.2.3',
          ],
        },
        sbom: { required: true, format: 'spdx-json' },
      },
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
      manifest.images.prometheus.attestations.signature.required = false;
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.attestations.signature.approvedIdentities = [
        '^.*$',
      ];
    },
    (manifest: typeof validManifest) => {
      manifest.images.prometheus.attestations.signature.approvedIdentities = [
        '^abc$',
      ];
    },
  ]) {
    const candidate = structuredClone(validManifest);
    mutate(candidate);
    assert.throws(
      () => parseToolchainManifest(candidate),
      /OCI|digest|linux amd64|attestation|signature|identity/i,
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

void test('parses exact cosign and syft versions', () => {
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
    mkdirSync(join(root, 'docs/reports'), { recursive: true });
    writeFileSync(join(root, 'backend/owned.ts'), 'one');
    writeFileSync(join(root, 'frontend/unrelated.ts'), 'ignored');
    writeFileSync(join(root, 'docs/roadmap.md'), 'roadmap one');
    writeFileSync(join(root, 'docs/roadmap_prod.jpg'), 'image one');
    writeFileSync(join(root, 'docs/roadmap_prod_v2.png'), 'image two');
    writeFileSync(
      join(root, 'docs/reports/10-delivery-production-operations-report.md'),
      'report one',
    );
    const status =
      ' M backend/owned.ts\0?? frontend/unrelated.ts\0 M docs/roadmap.md\0?? docs/roadmap_prod.jpg\0?? docs/roadmap_prod_v2.png\0 M docs/reports/10-delivery-production-operations-report.md\0';
    const first = computeReleaseContentDigest(root, status);
    assert.equal(first.pathCount, 1);
    assert.equal(first.gitDirty, true);
    assert.equal(first.gitIndexDirty, false);
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

void test('requires release-bound 32-day capacity and restorable backup evidence', () => {
  const now = Date.parse('2026-08-13T12:00:00.000Z');
  const expected = {
    commit: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    releaseContentDigest: 'c'.repeat(64),
    nowMs: now,
  };
  const evidence = {
    schemaVersion: 1,
    runId: '12345678-abcd-4567-8123-123456789abc',
    measuredAt: '2026-08-13T11:30:00.000Z',
    git: { commit: expected.commit, treeSha: expected.treeSha },
    releaseContentDigest: expected.releaseContentDigest,
    clusterFingerprintSha256: 'd'.repeat(64),
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
  ]) {
    const candidate = structuredClone(evidence);
    mutate(candidate);
    assert.throws(
      () => assertCapacityBackupEvidence(candidate, expected),
      /capacity|backup|release-bound/i,
    );
  }
});

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
