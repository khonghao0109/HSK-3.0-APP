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
  assertExecutableFromVerifiedRoot,
  assertExactMediaNetworkTopology,
  assertEveryAlertRunbookUrl,
  assertSafeTemporaryCleanupRoot,
  assertReleaseContentStable,
  assertReleaseHeadStable,
  assertFunctionalEvidence,
  assertGrafanaQueryResult,
  assertGrafanaNoDataResult,
  assertPrometheusRuntimeAlertRunbookUrl,
  assertGzipArchive,
  inspectTarGzipArchive,
  invalidateEvidenceSummaries,
  resetMediaOperationsEvidenceLogs,
  resolveMediaOperationsEvidenceRoot,
  assertOciDigest,
  classifyValidators,
  computeReleaseContentDigest,
  parseExactVersion,
  requireExactVersion,
  requireCredentialFreeHttpsRunbookUrl,
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
  schemaVersion: 2,
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

void test('requires exact OCI digest equality', () => {
  const digest = `sha256:${'c'.repeat(64)}`;
  assert.doesNotThrow(() => assertOciDigest(digest, digest));
  assert.throws(
    () => assertOciDigest(`sha256:${'d'.repeat(64)}`, digest),
    /digest mismatch/i,
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

void test('binds evidence to stable in-scope dirty and untracked bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'hsk-media-release-digest-'));
  try {
    mkdirSync(join(root, 'backend'), { recursive: true });
    mkdirSync(join(root, 'frontend'), { recursive: true });
    writeFileSync(join(root, 'backend/owned.ts'), 'one');
    writeFileSync(join(root, 'frontend/unrelated.ts'), 'ignored');
    const status = ' M backend/owned.ts\0?? frontend/unrelated.ts\0';
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
