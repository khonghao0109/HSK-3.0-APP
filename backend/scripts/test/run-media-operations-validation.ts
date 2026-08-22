import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, request } from 'node:http';
import {
  createServer as createHttpsServer,
  request as httpsRequest,
} from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  assertArchiveEntriesSafe,
  assertCommandEvidenceContract,
  assertCosignSignaturePayload,
  assertDatabaseReleaseEvidence,
  assertCapacityBackupEvidence,
  assertOciRegistryResolution,
  resolveVerifiedOciIndex,
  assertExecutionProfile,
  assertExecutableFromVerifiedRoot,
  assertExtractedTreeSafe,
  assertExactMediaNetworkTopology,
  assertEveryAlertRunbookUrl,
  assertFunctionalEvidence,
  assertGrafanaNoDataResult,
  assertGrafanaQueryResult,
  assertGrafanaDashboardTargetContract,
  assertGzipArchive,
  assertGrafanaPrivateApiOnlyContract,
  assertGrafanaProvisioningMountContract,
  assertIstioProbeRewriteContract,
  assertMonitoringSingleReplicaRollout,
  inspectTarGzipFile,
  invalidateEvidenceSummaries,
  resetMediaOperationsEvidenceLogs,
  resolveMediaOperationsEvidenceRoot,
  assertPrometheusRuntimeAlertRunbookUrl,
  requireCredentialFreeHttpsRunbookUrl,
  readBoundedResponseBody,
  assertSafeTemporaryCleanupRoot,
  assertStartupProbePreserved,
  assertReleaseContentStable,
  assertReleaseHeadStable,
  classifyValidators,
  computeReleaseContentDigest,
  computeMigrationCatalogEvidence,
  computeTreeDigest,
  contentAddressedCacheFilename,
  extractSpdxAttestationPredicate,
  parseExactVersion,
  parseToolchainManifest,
  redactDiagnostic,
  renderValidatorJUnit,
  requireExactVersion,
  runProcess,
  selectArtifact,
  sha256,
  verifySha256,
  MEDIA_OPERATIONS_EVIDENCE_ENV_ALLOWLIST,
} from './media-operations-validation.helpers';
import type {
  ShaArtifact,
  ToolDefinition,
  ToolchainManifest,
  ValidatorResult,
  CommandEvidence,
  ExecutionProfile,
  DatabaseReleaseEvidenceSummary,
  OciImageDefinition,
  OciRegistryResolution,
} from './media-operations-validation.helpers';

const repositoryRoot = resolve(process.cwd(), '..');
const defaultEvidenceRoot = join(
  repositoryRoot,
  'backend/test-results/media-operations',
);
let evidenceRoot = defaultEvidenceRoot;
const toolCache = process.env.MEDIA_OPS_TOOL_CACHE;
const allowDownload = process.env.MEDIA_OPS_ALLOW_DOWNLOAD === 'true';
const executionProfile: ExecutionProfile = process.argv.includes(
  '--profile=release-linux-amd64',
)
  ? 'release-linux-amd64'
  : 'reference';
const requireModule = createRequire(__filename);
const yaml = requireModule('js-yaml') as {
  loadAll(source: string): unknown[];
};
const commandEvidence: CommandEvidence[] = [];
let activeValidator = 'bootstrap';
let commandSequence = 0;
let productionRenderedTree:
  | { digest: string; pathCount: number; paths: string[] }
  | undefined;
let databaseReleaseEvidence: DatabaseReleaseEvidenceSummary | undefined;
let commandEvidenceBinding = {
  gitCommit: '0'.repeat(40),
  gitTreeSha: '0'.repeat(40),
  releaseContentDigest: '0'.repeat(64),
  inputTreeDigest: '0'.repeat(64),
};
const verifiedExecutableVersions = new Map<string, string>();
const spawnedEvidence = new WeakMap<
  ReturnType<typeof spawn>,
  {
    id: string;
    validator: string;
    executable: string;
    monotonicStarted: number;
    logPath: string;
    command: string;
    args: string[];
    cwd: string;
    envKeys: string[];
    startedAt: string;
    toolVersion: string;
    binding: typeof commandEvidenceBinding;
  }
>();

class ExternalBlock extends Error {}

interface EvidenceTimer {
  startedAt: string;
  monotonicStarted: number;
}

function startEvidenceTimer(): EvidenceTimer {
  return {
    startedAt: new Date().toISOString(),
    monotonicStarted: performance.now(),
  };
}

function elapsedMilliseconds(timer: EvidenceTimer): number {
  return Math.max(0, Math.round(performance.now() - timer.monotonicStarted));
}

interface VerifiedTool {
  executable: string;
  root: string;
  cleanupRoot: string;
  digest: string;
  definition: ToolDefinition;
}

interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

async function main(): Promise<void> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const safeDefault = resolveMediaOperationsEvidenceRoot(
    repositoryRoot,
    defaultEvidenceRoot,
  );
  mkdirSync(safeDefault, { recursive: true, mode: 0o700 });
  invalidateEvidenceSummaries(safeDefault, repositoryRoot);
  evidenceRoot = resolveMediaOperationsEvidenceRoot(
    repositoryRoot,
    process.env.MEDIA_OPS_EVIDENCE_DIR,
  );
  mkdirSync(evidenceRoot, { recursive: true });
  invalidateEvidenceSummaries(evidenceRoot, repositoryRoot);
  resetMediaOperationsEvidenceLogs(evidenceRoot, repositoryRoot);
  activeValidator = 'evidence';
  const beforeStatus = recordedProcess(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd: repositoryRoot, timeoutMs: 5_000 },
  );
  requireCommand(beforeStatus, 'initial release content status');
  const beforeCommit = recordedProcess('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    timeoutMs: 5_000,
  });
  requireCommand(beforeCommit, 'initial release commit');
  const beforeTree = recordedProcess('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: repositoryRoot,
    timeoutMs: 5_000,
  });
  requireCommand(beforeTree, 'initial Git tree');
  const kernel = recordedProcess('uname', ['-srv'], {
    timeoutMs: 5_000,
  });
  requireCommand(kernel, 'host kernel identity');
  const initialReleaseContent = computeReleaseContentDigest(
    repositoryRoot,
    beforeStatus.stdout,
  );
  const opsSourceTree = computeTreeDigest(resolve(repositoryRoot, 'ops'));
  commandEvidenceBinding = {
    gitCommit: beforeCommit.stdout.trim(),
    gitTreeSha: beforeTree.stdout.trim(),
    releaseContentDigest: initialReleaseContent.digest,
    inputTreeDigest: opsSourceTree.digest,
  };
  bindExistingCommandEvidence();
  const manifest = loadManifest();
  const internal =
    (
      run: () => Promise<Omit<ValidatorResult, 'id' | 'durationMs'>>,
    ): (() => Promise<Omit<ValidatorResult, 'id' | 'durationMs'>>) =>
    async () => {
      try {
        assertExecutionProfile(
          executionProfile,
          process.platform,
          process.arch,
        );
      } catch (error: unknown) {
        throw new ExternalBlock(safeError(error));
      }
      return run();
    };
  const releaseOnly =
    (
      run: () => Promise<Omit<ValidatorResult, 'id' | 'durationMs'>>,
    ): (() => Promise<Omit<ValidatorResult, 'id' | 'durationMs'>>) =>
    async () => {
      if (executionProfile !== 'release-linux-amd64') {
        throw new ExternalBlock(
          'Release-only gate was not executed by the non-release reference profile.',
        );
      }
      return internal(run)();
    };
  const validators: Array<{
    id: string;
    run: () => Promise<Omit<ValidatorResult, 'id' | 'durationMs'>>;
  }> = [
    {
      id: 'manifest-and-version-probes',
      run: internal(() => validateToolchain(manifest)),
    },
    {
      id: 'oci-image-supply-chain',
      run: releaseOnly(() => validateOciSupplyChain(manifest)),
    },
    {
      id: 'release-prerequisite-quality',
      run: releaseOnly(() =>
        validateReleaseQualityPrerequisites({
          commit: beforeCommit.stdout.trim(),
          treeSha: beforeTree.stdout.trim(),
          releaseContentDigest: initialReleaseContent.digest,
        }),
      ),
    },
    {
      id: 'production-retention-capacity-backup',
      run: releaseOnly(() =>
        validateCapacityBackupEvidence({
          commit: beforeCommit.stdout.trim(),
          treeSha: beforeTree.stdout.trim(),
          releaseContentDigest: initialReleaseContent.digest,
        }),
      ),
    },
    {
      id: 'nginx-edge-routing',
      run: internal(() => validateNginx(manifest)),
    },
    {
      id: 'prometheus-rules-and-exposition',
      run: internal(() => validatePrometheus(manifest)),
    },
    {
      id: 'alertmanager-routing',
      run: internal(() => validateAlertmanager(manifest)),
    },
    {
      id: 'kubernetes-core-schema',
      run: internal(() => validateKubernetesSchema(manifest)),
    },
    {
      id: 'kubernetes-topology-and-mtls',
      run: internal(() => validateKubernetesTopology(manifest)),
    },
    {
      id: 'grafana-disposable-runtime',
      run: internal(() => validateGrafana(manifest)),
    },
    {
      id: 'production-runbook-url',
      run: () => validateRunbookUrl(manifest),
    },
  ];
  const results: ValidatorResult[] = [];
  for (const validator of validators) {
    activeValidator = validator.id;
    const timer = startEvidenceTimer();
    const firstCommand = commandEvidence.length;
    try {
      const result = await validator.run();
      results.push({
        id: validator.id,
        durationMs: elapsedMilliseconds(timer),
        ...result,
        commandIds: commandEvidence.slice(firstCommand).map(({ id }) => id),
      });
    } catch (error: unknown) {
      results.push({
        id: validator.id,
        durationMs: elapsedMilliseconds(timer),
        status:
          error instanceof ExternalBlock ? 'BLOCKED_EXTERNAL' : 'FAIL_INTERNAL',
        reason: safeError(error),
        commandIds: commandEvidence.slice(firstCommand).map(({ id }) => id),
      });
    }
  }

  const classified = classifyValidators(results);
  activeValidator = 'evidence';
  const commit = recordedProcess('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    timeoutMs: 5_000,
  });
  requireCommand(commit, 'final release commit');
  const tree = recordedProcess('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: repositoryRoot,
    timeoutMs: 5_000,
  });
  requireCommand(tree, 'final Git tree');
  assertReleaseHeadStable(beforeTree.stdout.trim(), tree.stdout.trim());
  assertReleaseHeadStable(beforeCommit.stdout.trim(), commit.stdout.trim());
  const worktree = recordedProcess(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd: repositoryRoot, timeoutMs: 5_000 },
  );
  requireCommand(worktree, 'release content status');
  const releaseContent = computeReleaseContentDigest(
    repositoryRoot,
    worktree.stdout,
  );
  assertReleaseContentStable(initialReleaseContent, releaseContent);
  const logManifest = commandEvidence.map(({ id, logPath, logSha256 }) => {
    const actual = sha256(readFileSync(join(evidenceRoot, logPath)));
    if (actual !== logSha256) {
      throw new Error(
        `Command evidence log changed before publication: ${id}.`,
      );
    }
    return { id, logPath, sha256: actual };
  });
  const logManifestBytes = Buffer.from(
    `${JSON.stringify({ runId, logs: logManifest }, null, 2)}\n`,
  );
  writeFileSync(
    join(evidenceRoot, 'media-operations-log-manifest.json'),
    logManifestBytes,
    {
      mode: 0o600,
    },
  );
  const evidence = {
    schemaVersion: 3,
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    commit:
      commit.kind === 'success' && /^[a-f0-9]{40}$/u.test(commit.stdout.trim())
        ? commit.stdout.trim()
        : 'unavailable',
    treeSha: tree.stdout.trim(),
    kernel: output(kernel),
    platform: process.platform,
    architecture: process.arch,
    executionProfile,
    releaseTree: productionRenderedTree,
    databaseReleaseEvidence,
    opsSourceTree,
    logManifest: {
      path: 'media-operations-log-manifest.json',
      sha256: sha256(logManifestBytes),
      count: logManifest.length,
    },
    releaseContentDigest: releaseContent.digest,
    releaseContentPathCount: releaseContent.pathCount,
    gitDirty: releaseContent.gitDirty,
    gitIndexDirty: releaseContent.gitIndexDirty,
    exitCode: classified.exitCode,
    results: classified.results,
    commands: commandEvidence,
  };
  assertCommandEvidenceContract(commandEvidence, classified.results);
  writeFileSync(
    join(evidenceRoot, 'media-operations-validation.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(evidenceRoot, 'media-operations-validation.junit.xml'),
    renderValidatorJUnit(classified.results, {
      runId,
      commit: commit.stdout.trim(),
      treeSha: tree.stdout.trim(),
      releaseProfile: executionProfile === 'release-linux-amd64',
    }),
    { mode: 0o600 },
  );
  for (const result of classified.results) {
    const suffix = result.reason ? ` - ${result.reason}` : '';
    console.log(`${result.status}: ${result.id}${suffix}`);
  }
  console.log(`Evidence: ${evidenceRoot}`);
  process.exitCode = classified.exitCode;
}

function loadManifest(): ToolchainManifest {
  return parseToolchainManifest(
    JSON.parse(
      readFileSync(
        resolve(repositoryRoot, 'ops/observability/media-toolchain.json'),
        'utf8',
      ),
    ) as unknown,
  );
}

async function validateToolchain(
  manifest: ToolchainManifest,
): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  const artifacts: Array<{ name: string; version?: string; digest: string }> =
    [];
  const temporaryRoots = new Set<string>();
  try {
    for (const name of [
      'promtool',
      'alertmanager',
      'amtool',
      'grafana',
      'istioctl',
      'kubectl',
      'kubeconform',
      'cosign',
      'syft',
    ]) {
      const tool = await acquireTool(manifest, name);
      temporaryRoots.add(tool.cleanupRoot);
      verifyToolVersion(tool);
      artifacts.push({
        name,
        version: tool.definition.version,
        digest: tool.digest,
      });
    }
    for (const name of ['nginx', 'pcre2']) {
      const source = await acquireSource(manifest, name);
      temporaryRoots.add(source.cleanupRoot);
      artifacts.push({
        name,
        version: manifest.tools[name].version,
        digest: source.digest,
      });
    }
    return { status: 'PASS', commandIds: ['exact-version-probes'], artifacts };
  } finally {
    for (const root of temporaryRoots) {
      removeVerifiedTemporaryRoot(root);
    }
  }
}

async function validateOciSupplyChain(
  manifest: ToolchainManifest,
): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  let cosign: VerifiedTool | undefined;
  let syft: VerifiedTool | undefined;
  try {
    cosign = await acquireTool(manifest, 'cosign');
    syft = await acquireTool(manifest, 'syft');
    verifyToolVersion(cosign);
    verifyToolVersion(syft);
    const artifacts: Array<{ name: string; version?: string; digest: string }> =
      [];
    const resolvedImages: Array<[string, OciImageDefinition]> = [];
    for (const [name, image] of Object.entries(manifest.images)) {
      const platform = image.platforms[0];
      if (!platform) throw new Error(`${name} has no Linux amd64 image.`);
      const registryResolution = await resolveOciRegistryImage(image);
      assertOciRegistryResolution(image, registryResolution);
      resolvedImages.push([name, image]);
    }
    for (const [name, image] of resolvedImages) {
      const platform = image.platforms[0];
      if (!platform) throw new Error(`${name} has no Linux amd64 image.`);
      const policy = image.attestations.signature;
      const identity = policy.approvedIdentities[0];
      if (!identity || policy.approvedIdentities.length !== 1) {
        throw new ExternalBlock(
          `${name} has no single approved release workflow identity; signatures cannot be claimed.`,
        );
      }
      const signature = recordedProcess(
        cosign.executable,
        [
          'verify',
          '--output',
          'json',
          '--certificate-oidc-issuer',
          policy.issuer,
          '--certificate-identity',
          identity,
          platform.runtimeRef,
        ],
        { timeoutMs: 120_000 },
      );
      if (signature.kind !== 'success') {
        throw new ExternalBlock(
          `${name} OCI signature is unavailable or does not bind the exact Linux amd64 digest.`,
        );
      }
      assertCosignSignaturePayload(output(signature), platform.digest);
      const attestation = recordedProcess(
        cosign.executable,
        [
          'verify-attestation',
          '--type',
          'spdxjson',
          '--output',
          'json',
          '--certificate-oidc-issuer',
          policy.issuer,
          '--certificate-identity',
          identity,
          platform.runtimeRef,
        ],
        { timeoutMs: 120_000 },
      );
      if (attestation.kind !== 'success') {
        throw new ExternalBlock(
          `${name} signed SPDX SBOM attestation is unavailable.`,
        );
      }
      const predicate = extractSpdxAttestationPredicate(
        output(attestation),
        platform.digest,
      );
      const sbomRoot = mkdtempSync(join(tmpdir(), 'hsk-media-sbom-'));
      try {
        const source = join(sbomRoot, `${name}.spdx.json`);
        const normalized = join(sbomRoot, `${name}.normalized.spdx.json`);
        writeFileSync(source, `${JSON.stringify(predicate)}\n`, {
          mode: 0o600,
        });
        const syftValidation = recordedProcess(
          syft.executable,
          ['convert', source, '-o', `spdx-json=${normalized}`],
          { timeoutMs: 60_000 },
        );
        requireCommand(syftValidation, `${name} signed SPDX SBOM conversion`);
        if (!existsSync(normalized) || statSync(normalized).size === 0) {
          throw new Error(`${name} signed SPDX SBOM did not normalize.`);
        }
      } finally {
        rmSync(sbomRoot, { recursive: true, force: true });
      }
      artifacts.push({
        name: `oci/${name}/linux-amd64`,
        version: image.version,
        digest: platform.digest,
      });
    }
    return {
      status: 'PASS',
      commandIds: ['cosign-signature-and-spdx-attestation'],
      artifacts: [
        ...artifacts,
        {
          name: 'oci-policy-fingerprint',
          digest: sha256(
            Buffer.from(
              Object.values(manifest.images)
                .map(
                  ({ attestations }) =>
                    `${attestations.signature.issuer}\0${attestations.signature.approvedIdentities.join('\0')}`,
                )
                .join('\0'),
            ),
          ),
        },
      ],
    };
  } finally {
    if (cosign) removeVerifiedTemporaryRoot(cosign.cleanupRoot);
    if (syft) removeVerifiedTemporaryRoot(syft.cleanupRoot);
  }
}

async function resolveOciRegistryImage(
  image: OciImageDefinition,
): Promise<OciRegistryResolution> {
  const started = startEvidenceTimer();
  const slash = image.repository.indexOf('/');
  if (slash < 1) throw new Error('OCI repository has no registry host.');
  const declaredHost = image.repository.slice(0, slash);
  const registryHost =
    declaredHost === 'docker.io' ? 'registry-1.docker.io' : declaredHost;
  const repositoryPath = image.repository.slice(slash + 1);
  const manifestUrl = `https://${registryHost}/v2/${repositoryPath}/manifests/${image.indexDigest}`;
  const accept =
    'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json';
  const fetchManifest = async (authorization?: string): Promise<Response> =>
    fetch(manifestUrl, {
      redirect: 'error',
      headers: {
        Accept: accept,
        ...(authorization ? { Authorization: authorization } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  try {
    let response = await fetchManifest();
    if (response.status === 401) {
      const challenge = response.headers.get('www-authenticate') ?? '';
      const realm = /realm="([^"]+)"/u.exec(challenge)?.[1];
      const service = /service="([^"]+)"/u.exec(challenge)?.[1];
      const scope = /scope="([^"]+)"/u.exec(challenge)?.[1];
      if (!realm || !service || !scope) {
        throw new ExternalBlock('OCI registry bearer challenge is malformed.');
      }
      const realmUrl = new URL(realm);
      const expectedRealmHost =
        declaredHost === 'docker.io' ? 'auth.docker.io' : 'quay.io';
      if (
        realmUrl.protocol !== 'https:' ||
        realmUrl.hostname !== expectedRealmHost ||
        realmUrl.username ||
        realmUrl.password ||
        realmUrl.hash
      ) {
        throw new Error(
          'OCI registry token realm is not credential-free HTTPS.',
        );
      }
      realmUrl.searchParams.set('service', service);
      realmUrl.searchParams.set('scope', scope);
      const tokenResponse = await fetch(realmUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (!tokenResponse.ok) {
        throw new ExternalBlock(
          `OCI registry token endpoint returned HTTP ${tokenResponse.status}.`,
        );
      }
      const tokenBytes = await readBoundedResponseBody(
        tokenResponse,
        128 * 1024,
      );
      let tokenJson: unknown;
      try {
        tokenJson = JSON.parse(tokenBytes.toString('utf8')) as unknown;
      } catch {
        throw new Error('OCI registry token response is not valid JSON.');
      }
      if (!isRecord(tokenJson)) {
        throw new Error('OCI registry token response is malformed.');
      }
      const token =
        typeof tokenJson.token === 'string'
          ? tokenJson.token
          : typeof tokenJson.access_token === 'string'
            ? tokenJson.access_token
            : undefined;
      if (!token || token.length > 16_384) {
        throw new Error('OCI registry token response has no bounded token.');
      }
      response = await fetchManifest(`Bearer ${token}`);
    }
    if (!response.ok) {
      throw new ExternalBlock(
        `OCI registry manifest returned HTTP ${response.status}.`,
      );
    }
    const bytes = await readBoundedResponseBody(response, 4 * 1024 * 1024);
    const headerDigest = response.headers.get('docker-content-digest');
    const resolution = resolveVerifiedOciIndex(image, bytes, headerDigest);
    recordProbeEvidence(
      `oci-registry-${image.repository.replace(/[^a-z0-9]/giu, '-')}`,
      started,
      true,
      'OCI registry index and Linux amd64 child resolved.',
    );
    return resolution;
  } catch (error: unknown) {
    recordProbeEvidence(
      `oci-registry-${image.repository.replace(/[^a-z0-9]/giu, '-')}`,
      started,
      false,
      `OCI registry resolution failed (${error instanceof Error ? error.name : 'unknown'}).`,
    );
    if (error instanceof ExternalBlock) throw error;
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.name === 'TimeoutError')
    ) {
      throw new ExternalBlock('OCI registry resolution is unavailable.');
    }
    throw error;
  }
}

function validateReleaseQualityPrerequisites(binding: {
  commit: string;
  treeSha: string;
  releaseContentDigest: string;
}): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  const commands: Array<[string, string[]]> = [
    ['npx', ['prisma', 'format']],
    ['npx', ['prisma', 'validate']],
    ['npx', ['prisma', 'generate']],
    ['npm', ['run', 'build']],
    ['npm', ['run', 'lint:check']],
    ['npm', ['run', 'format:check']],
    ['npm', ['test', '--', '--runInBand']],
    ['npm', ['run', 'test:security:secrets']],
    ['npm', ['audit', '--omit=dev']],
  ];
  for (const [command, args] of commands) {
    const result = recordedProcess(command, args, {
      cwd: resolve(repositoryRoot, 'backend'),
      timeoutMs: 15 * 60_000,
    });
    requireCommand(result, `release prerequisite ${command} ${args.join(' ')}`);
  }
  const databaseEvidence = validateDatabaseEvidenceHook(binding);
  return Promise.resolve({
    status: 'PASS',
    commandIds: ['backend-quality-prerequisites', 'guarded-database-evidence'],
    artifacts: [
      {
        name: 'guarded-database-release-evidence',
        digest: databaseEvidence.evidenceSha256,
      },
    ],
  });
}

function validateDatabaseEvidenceHook(binding: {
  commit: string;
  treeSha: string;
  releaseContentDigest: string;
}): DatabaseReleaseEvidenceSummary {
  const path = resolve(
    process.env.MEDIA_OPS_DB_EVIDENCE_JSON ??
      join(
        repositoryRoot,
        'backend/test-results/media-lifecycle-migration-validation/evidence.json',
      ),
  );
  if (!existsSync(path)) {
    throw new ExternalBlock('Guarded database evidence artifact is absent.');
  }
  const catalog = computeMigrationCatalogEvidence(
    resolve(repositoryRoot, 'backend/prisma/migrations'),
  );
  const latestMigrations = catalog.entries.slice(-2);
  const evidenceBytes = readFileSync(path);
  const validated = assertDatabaseReleaseEvidence(
    JSON.parse(evidenceBytes.toString('utf8')) as unknown,
    {
      ...binding,
      evidenceRoot: dirname(path),
      catalogCount: catalog.catalogCount,
      catalogChecksum: catalog.catalogChecksum,
      latestMigrations,
    },
  );
  databaseReleaseEvidence = {
    ...validated,
    evidenceSha256: sha256(evidenceBytes),
  };
  return databaseReleaseEvidence;
}

function validateCapacityBackupEvidence(binding: {
  commit: string;
  treeSha: string;
  releaseContentDigest: string;
}): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  const configured = process.env.MEDIA_OPS_CAPACITY_BACKUP_EVIDENCE_JSON;
  if (!configured) {
    throw new ExternalBlock(
      'MEDIA_OPS_CAPACITY_BACKUP_EVIDENCE_JSON is required for live 32-day capacity, encrypted backup and restore proof.',
    );
  }
  const path = resolve(configured);
  if (!existsSync(path)) {
    throw new ExternalBlock(
      'Capacity and backup evidence artifact is unavailable.',
    );
  }
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size > 1024 * 1024) {
    throw new Error(
      'Capacity and backup evidence must be a bounded regular file.',
    );
  }
  const bytes = readFileSync(path);
  const validated = assertCapacityBackupEvidence(
    JSON.parse(bytes.toString('utf8')) as unknown,
    binding,
  );
  return Promise.resolve({
    status: 'PASS',
    commandIds: ['live-capacity-backup-restore-evidence'],
    artifacts: [
      {
        name: `capacity-backup/${validated.runId}`,
        digest: sha256(bytes),
      },
      {
        name: 'capacity-backup/cluster-fingerprint',
        digest: validated.clusterFingerprintSha256,
      },
    ],
  });
}

async function validateNginx(
  manifest: ToolchainManifest,
): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  const nginxSource = await acquireSource(manifest, 'nginx');
  const pcreSource = await acquireSource(manifest, 'pcre2');
  const temporary = mkdtempSync(join(tmpdir(), 'hsk-media-nginx-validation-'));
  let upstreamHits = 0;
  const upstream = createServer((_incoming, response) => {
    upstreamHits += 1;
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('synthetic generic upstream');
  });
  let nginxProcess: ReturnType<typeof spawn> | undefined;
  try {
    const configure = recordedProcess(
      join(nginxSource.root, 'configure'),
      [
        `--prefix=${join(temporary, 'install')}`,
        `--with-pcre=${pcreSource.root}`,
        '--without-http_gzip_module',
      ],
      { cwd: nginxSource.root, timeoutMs: 120_000 },
    );
    requireCommand(configure, 'nginx configure');
    const build = recordedProcess('make', ['-j2'], {
      cwd: nginxSource.root,
      timeoutMs: 600_000,
    });
    requireCommand(build, 'nginx build', true);
    const nginxExecutable = join(nginxSource.root, 'objs/nginx');
    assertExecutableFromVerifiedRoot(nginxExecutable, nginxSource.root);
    const version = recordedProcess(nginxExecutable, ['-v'], {
      timeoutMs: 5_000,
    });
    requireCommand(version, 'nginx exact version');
    requireExactVersion(
      parseExactVersion('nginx', output(version)),
      manifest.tools.nginx.version,
    );

    const upstreamPort = await listen(upstream);
    const proxyPort = await reservePort();
    mkdirSync(join(temporary, 'logs'), { recursive: true });
    const locationPath = join(temporary, 'media-security.conf');
    const accessLogPath = join(temporary, 'media_access.log');
    const safeErrorLogPath = join(temporary, 'media_error.log');
    writeFileSync(
      locationPath,
      readFileSync(
        resolve(repositoryRoot, 'ops/nginx/media-security.conf'),
        'utf8',
      )
        .split('/var/log/nginx/media_access.log')
        .join(accessLogPath)
        .split('/var/log/nginx/media_error.log')
        .join(safeErrorLogPath),
      { mode: 0o600 },
    );
    const configPath = join(temporary, 'nginx.conf');
    writeFileSync(
      configPath,
      `worker_processes 1;\npid ${join(temporary, 'nginx.pid')};\nerror_log ${join(temporary, 'error.log')} notice;\nevents { worker_connections 64; }\nhttp {\n  include ${resolve(repositoryRoot, 'ops/nginx/media-security-http.conf')};\n  upstream hsk_backend { server 127.0.0.1:${upstreamPort}; }\n  server {\n    listen 127.0.0.1:${proxyPort};\n    include ${locationPath};\n    location / { proxy_pass http://hsk_backend; }\n  }\n}\n`,
      { mode: 0o600 },
    );
    const syntax = recordedProcess(
      nginxExecutable,
      ['-t', '-c', configPath, '-p', `${temporary}/`],
      { timeoutMs: 10_000 },
    );
    requireCommand(syntax, 'nginx -t');
    assertFunctionalEvidence('nginx-config', output(syntax));
    nginxProcess = spawnRecorded(
      'nginx-runtime',
      nginxExecutable,
      ['-c', configPath, '-p', `${temporary}/`, '-g', 'daemon off;'],
      { stdio: 'ignore' },
    );
    const httpMatrixStarted = startEvidenceTimer();
    await waitForStatus(proxyPort, '/health', 200);
    if (upstreamHits !== 1)
      throw new Error('Generic upstream probe was not reached.');

    const metricsVariants = [
      '/metrics',
      '/metrics/',
      '/METRICS',
      '//metrics',
      '/metrics;v=x',
      '/metrics/subpath',
      '/met%72ics',
      '/metrics?token=must-not-leak',
      '/api/v1/internal/metrics',
      '/api/v1/internal/metrics/',
      '/API/V1/INTERNAL/METRICS',
      '/api//v1/internal/metrics',
      '/api;v=x/v1/internal/metrics',
      '/api/v1/internal/metrics;v=x',
      '/api/v1/internal/metrics/subpath',
      '/api%2Fv1/internal/metrics',
      '/api/v1/internal/metrics?token=must-not-leak',
    ];
    const metricsBaseline = upstreamHits;
    await assertRejected(proxyPort, metricsVariants);
    if (upstreamHits !== metricsBaseline) {
      throw new Error(
        'Rejected metrics route fell through to the generic upstream.',
      );
    }
    const nonNamespace = await rawHttp(proxyPort, '/metricsx', 'GET');
    if (nonNamespace.status !== 200 || upstreamHits !== metricsBaseline + 1) {
      throw new Error(
        'Metrics edge matcher blocks outside its namespace boundary.',
      );
    }

    const signature = 'operational-secret-signature';
    const canonical = await rawHttp(
      proxyPort,
      `/api/v1/media/1/content?expires=1&signature=${signature}`,
      'GET',
    );
    if (
      canonical.status !== 200 ||
      canonical.headers['cache-control'] !== 'private, no-store'
    ) {
      throw new Error(
        'Canonical signed-content route did not reach the safe proxy.',
      );
    }
    const canonicalHitCount = upstreamHits;
    const signedVariants: Array<[string, string]> = [
      ['HEAD', '/api/v1/media/1/content'],
      ['GET', '/api/v1/media/1/content/'],
      ['GET', '/API/V1/MEDIA/1/CONTENT'],
      ['GET', '/api//v1/media/1/content'],
      ['GET', '/api;v=x/v1/media/1/content'],
      ['GET', '/api/v1/media/1;x=y/content'],
      ['GET', '/api/v1/media/1/content;x=y'],
      ['GET', '/api%2Fv1/media/1/content'],
      ['GET', '/api/v1/media/2/../1/content'],
    ];
    for (const [method, path] of signedVariants) {
      const result = await rawHttp(proxyPort, path, method);
      if (result.status !== 404) {
        throw new Error(
          `Signed route variant was not rejected: ${method} ${path}.`,
        );
      }
    }
    if (upstreamHits !== canonicalHitCount) {
      throw new Error(
        'Rejected signed route fell through to the generic upstream.',
      );
    }
    await delay(75);
    const log = readFileSync(accessLogPath, 'utf8');
    for (const forbidden of [
      signature,
      'expires=',
      'token=',
      'must-not-leak',
    ]) {
      if (log.includes(forbidden))
        throw new Error('Nginx access evidence leaked a query secret.');
    }
    if (!log.includes('/api/v1/media/1/content') || !log.includes('200')) {
      throw new Error('Nginx safe access evidence is incomplete.');
    }
    if (existsSync(safeErrorLogPath)) {
      const diagnosticLog = readFileSync(safeErrorLogPath, 'utf8');
      for (const forbidden of [
        signature,
        'expires=',
        'token=',
        'must-not-leak',
      ]) {
        if (diagnosticLog.includes(forbidden)) {
          throw new Error(
            'Nginx forensic diagnostics leaked signed query data.',
          );
        }
      }
    }
    recordProbeEvidence(
      'nginx-http-adversarial-matrix',
      httpMatrixStarted,
      true,
      'Public metrics variants rejected; canonical content and ordinary route reached the synthetic upstream; queries absent from logs.',
    );
    return {
      status: 'PASS',
      commandIds: ['nginx-build', 'nginx-t', 'nginx-http-adversarial-matrix'],
      artifacts: [
        { name: 'nginx', digest: nginxSource.digest },
        { name: 'pcre2', digest: pcreSource.digest },
      ],
    };
  } finally {
    if (nginxProcess) await stopProcess(nginxProcess);
    await closeServer(upstream);
    rmSync(temporary, { recursive: true, force: true });
    removeVerifiedTemporaryRoot(nginxSource.cleanupRoot);
    removeVerifiedTemporaryRoot(pcreSource.cleanupRoot);
  }
}

async function validatePrometheus(
  manifest: ToolchainManifest,
): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  let promtool: VerifiedTool | undefined;
  const temporary = mkdtempSync(join(tmpdir(), 'hsk-media-prometheus-'));
  try {
    promtool = await acquireTool(manifest, 'promtool');
    verifyToolVersion(promtool);
    const directory = resolve(repositoryRoot, 'ops/observability');
    const tokenPath = join(temporary, 'metrics-token');
    writeFileSync(tokenPath, randomBytes(32).toString('base64url'), {
      mode: 0o600,
    });
    const configPath = join(temporary, 'prometheus.yml');
    writeFileSync(
      configPath,
      readFileSync(join(directory, 'media-prometheus.yml'), 'utf8')
        .replace('media-alerts.yml', join(directory, 'media-alerts.yml'))
        .replace('/run/secrets/hsk_media_metrics_token', tokenPath),
      { mode: 0o600 },
    );
    const commands: Array<[string, string[], string]> = [
      ['check-config', ['check', 'config', configPath], 'promtool-check'],
      [
        'check-rules',
        ['check', 'rules', join(directory, 'media-alerts.yml')],
        'promtool-check',
      ],
      [
        'test-rules',
        ['test', 'rules', join(directory, 'media-alerts.test.yml')],
        'promtool-test-rules',
      ],
    ];
    for (const [, args, evidence] of commands) {
      const result = recordedProcess(promtool.executable, args, {
        timeoutMs: evidence === 'promtool-test-rules' ? 120_000 : 30_000,
      });
      requireCommand(result, `promtool ${args.join(' ')}`);
      assertFunctionalEvidence(
        evidence as 'promtool-check' | 'promtool-test-rules',
        output(result),
      );
    }
    const exposition = recordedProcess(
      promtool.executable,
      ['check', 'metrics'],
      {
        timeoutMs: 10_000,
        input: readFileSync(
          join(directory, 'media-exporter.sample.prom'),
          'utf8',
        ),
      },
    );
    requireCommand(exposition, 'promtool check metrics');
    return {
      status: 'PASS',
      commandIds: [
        'promtool-check-config',
        'promtool-check-rules',
        'promtool-test-rules',
        'promtool-check-metrics',
      ],
      artifacts: [{ name: 'promtool', digest: promtool.digest }],
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    if (promtool) removeVerifiedTemporaryRoot(promtool.cleanupRoot);
  }
}

async function validateAlertmanager(
  manifest: ToolchainManifest,
): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  let amtool: VerifiedTool | undefined;
  let alertmanager: VerifiedTool | undefined;
  let prometheus: VerifiedTool | undefined;
  const temporary = mkdtempSync(join(tmpdir(), 'hsk-media-alertmanager-'));
  const pageEvents: string[] = [];
  const ticketEvents: string[] = [];
  const webhook = createServer((incoming, response) => {
    let body = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk: string) => {
      body += chunk;
    });
    incoming.on('end', () => {
      (incoming.url === '/page' ? pageEvents : ticketEvents).push(
        body.slice(0, 64 * 1024),
      );
      response.writeHead(200);
      response.end('ok');
    });
  });
  let alertmanagerProcess: ReturnType<typeof spawn> | undefined;
  let prometheusProcess: ReturnType<typeof spawn> | undefined;
  try {
    amtool = await acquireTool(manifest, 'amtool');
    alertmanager = await acquireTool(manifest, 'alertmanager');
    prometheus = await acquireTool(manifest, 'prometheus');
    verifyToolVersion(amtool);
    verifyToolVersion(alertmanager);
    verifyToolVersion(prometheus);
    const webhookPort = await listen(webhook);
    const alertmanagerPort = await reservePort();
    const prometheusPort = await reservePort();
    const pageUrl = join(temporary, 'page-webhook-url');
    const ticketUrl = join(temporary, 'ticket-webhook-url');
    writeFileSync(pageUrl, `http://127.0.0.1:${webhookPort}/page\n`, {
      mode: 0o600,
    });
    writeFileSync(ticketUrl, `http://127.0.0.1:${webhookPort}/ticket\n`, {
      mode: 0o600,
    });
    const alertPhasePath = join(evidenceRoot, 'logs/alertmanager-phases.log');
    const configPath = join(temporary, 'alertmanager.yml');
    writeFileSync(
      configPath,
      readFileSync(
        resolve(repositoryRoot, 'ops/observability/media-alertmanager.yml'),
        'utf8',
      )
        .replace('resolve_timeout: 5m', 'resolve_timeout: 1s')
        .replace('group_wait: 30s', 'group_wait: 0s')
        .replace('group_interval: 5m', 'group_interval: 1s')
        .replace('/run/secrets/hsk-alertmanager/page-webhook-url', pageUrl)
        .replace('/run/secrets/hsk-alertmanager/ticket-webhook-url', ticketUrl),
      { mode: 0o600 },
    );
    const check = recordedProcess(
      amtool.executable,
      [
        'check-config',
        resolve(repositoryRoot, 'ops/observability/media-alertmanager.yml'),
      ],
      { timeoutMs: 10_000 },
    );
    requireCommand(check, 'amtool check-config repository contract');
    assertFunctionalEvidence('amtool-config', output(check));
    const renderedCheck = recordedProcess(
      amtool.executable,
      ['check-config', configPath],
      { timeoutMs: 10_000 },
    );
    requireCommand(renderedCheck, 'amtool check-config rendered transport');
    assertFunctionalEvidence('amtool-config', output(renderedCheck));
    const alertmanagerData = join(temporary, 'alertmanager-data');
    alertmanagerProcess = spawnRecorded(
      'alertmanager-runtime-initial',
      alertmanager.executable,
      [
        `--config.file=${configPath}`,
        `--storage.path=${alertmanagerData}`,
        `--web.listen-address=127.0.0.1:${alertmanagerPort}`,
      ],
      { stdio: 'ignore' },
    );
    await waitForStatus(alertmanagerPort, '/-/ready', 200);
    await stopProcess(alertmanagerProcess);
    alertmanagerProcess = spawnRecorded(
      'alertmanager-runtime-restart',
      alertmanager.executable,
      [
        `--config.file=${configPath}`,
        `--storage.path=${alertmanagerData}`,
        `--web.listen-address=127.0.0.1:${alertmanagerPort}`,
      ],
      { stdio: 'ignore' },
    );
    await waitForStatus(alertmanagerPort, '/-/ready', 200);

    const rulePath = join(temporary, 'synthetic-rule.yml');
    writeSyntheticAlertRule(rulePath, 'page');
    const prometheusConfig = join(temporary, 'prometheus.yml');
    writeFileSync(
      prometheusConfig,
      `global:\n  evaluation_interval: 1s\nrule_files:\n  - ${rulePath}\nalerting:\n  alertmanagers:\n    - static_configs:\n        - targets: [127.0.0.1:${alertmanagerPort}]\n`,
      { mode: 0o600 },
    );
    const prometheusData = join(temporary, 'prometheus-data');
    const prometheusArgs = [
      `--config.file=${prometheusConfig}`,
      `--storage.tsdb.path=${prometheusData}`,
      `--web.listen-address=127.0.0.1:${prometheusPort}`,
      '--web.enable-lifecycle',
      '--rules.alert.resend-delay=1s',
    ];
    const routingStarted = startEvidenceTimer();
    prometheusProcess = spawnRecorded(
      'prometheus-alert-runtime',
      prometheus.executable,
      prometheusArgs,
      {
        stdio: 'ignore',
      },
    );
    await waitForStatus(prometheusPort, '/-/ready', 200);
    await waitForAlertDelivery(pageEvents, 'firing', 'page', alertPhasePath);
    if (
      ticketEvents.some((body) =>
        body.includes('HskMediaValidationSyntheticPage'),
      )
    ) {
      throw new Error('Page alert was delivered to ticket receiver.');
    }
    writeSyntheticAlertRule(rulePath);
    await postEmpty(prometheusPort, '/-/reload');
    await waitForAlertDelivery(pageEvents, 'resolved', 'page', alertPhasePath);
    const pageEventCountBeforeTicket = pageEvents.length;
    const ticketEventCountBeforeTicket = ticketEvents.length;
    writeSyntheticAlertRule(rulePath, 'ticket');
    await postEmpty(prometheusPort, '/-/reload');
    await waitForAlertDelivery(
      ticketEvents,
      'firing',
      'ticket',
      alertPhasePath,
    );
    writeSyntheticAlertRule(rulePath);
    await postEmpty(prometheusPort, '/-/reload');
    await waitForAlertDelivery(
      ticketEvents,
      'resolved',
      'ticket',
      alertPhasePath,
    );
    if (
      pageEvents.length !== pageEventCountBeforeTicket ||
      ticketEvents.length <= ticketEventCountBeforeTicket
    ) {
      throw new Error(
        'Ticket alert routing changed page delivery or missed the ticket receiver.',
      );
    }
    recordProbeEvidence(
      'prometheus-alertmanager-page-ticket-routing',
      routingStarted,
      true,
      'Prometheus delivered firing and resolved page/ticket alerts to only the exact repository-configured receivers.',
    );
    return {
      status: 'PASS',
      commandIds: [
        'amtool-check-repository-config',
        'amtool-check-rendered-secret-file-config',
        'prometheus-to-alertmanager-firing-resolved-webhook',
        'alertmanager-page-ticket-exact-routing',
        'prometheus-alertmanager-restart-readiness',
      ],
      artifacts: [
        { name: 'amtool', digest: amtool.digest },
        { name: 'alertmanager', digest: alertmanager.digest },
        { name: 'prometheus', digest: prometheus.digest },
      ],
    };
  } finally {
    if (prometheusProcess) await stopProcess(prometheusProcess);
    if (alertmanagerProcess) await stopProcess(alertmanagerProcess);
    await closeServer(webhook);
    rmSync(temporary, { recursive: true, force: true });
    if (amtool) removeVerifiedTemporaryRoot(amtool.cleanupRoot);
    if (alertmanager) removeVerifiedTemporaryRoot(alertmanager.cleanupRoot);
    if (prometheus) removeVerifiedTemporaryRoot(prometheus.cleanupRoot);
  }
}

async function validateKubernetesSchema(
  manifest: ToolchainManifest,
): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  let kubectl: VerifiedTool | undefined;
  let istioctl: VerifiedTool | undefined;
  let kubeconform: VerifiedTool | undefined;
  const temporary = mkdtempSync(join(tmpdir(), 'hsk-media-kubernetes-schema-'));
  try {
    kubectl = await acquireTool(manifest, 'kubectl');
    istioctl = await acquireTool(manifest, 'istioctl');
    kubeconform = await acquireTool(manifest, 'kubeconform');
    verifyToolVersion(kubectl);
    verifyToolVersion(istioctl);
    verifyToolVersion(kubeconform);
    const render = recordedProcess(
      kubectl.executable,
      ['kustomize', resolve(repositoryRoot, 'ops/observability')],
      { timeoutMs: 20_000 },
    );
    requireCommand(render, 'kubectl kustomize schema input');
    const renderedPath = join(temporary, 'rendered.yml');
    writeFileSync(renderedPath, render.stdout, { mode: 0o600 });
    const coreResources = yaml
      .loadAll(render.stdout)
      .filter(isRecord)
      .filter(
        (resource) =>
          !String(resource.apiVersion).startsWith('security.istio.io/'),
      );
    const corePath = join(temporary, 'core-resources.yml');
    writeFileSync(
      corePath,
      coreResources.map((resource) => JSON.stringify(resource)).join('\n---\n'),
      { mode: 0o600 },
    );
    const schemaRoot = join(temporary, 'schemas');
    mkdirSync(schemaRoot, { recursive: true, mode: 0o700 });
    const schemaBundle = manifest.schemaBundles['kubernetes-core'];
    if (!schemaBundle || schemaBundle.version !== '1.33.3') {
      throw new Error('Pinned Kubernetes 1.33.3 core schema bundle is absent.');
    }
    const schemaArtifacts: Array<{
      name: string;
      version?: string;
      digest: string;
    }> = [];
    for (const schema of schemaBundle.files) {
      const bytes = await verifiedRemoteBytes(
        `kubernetes-schema-${schema.name}`,
        schema.artifact,
        schema.sha256,
      );
      writeFileSync(join(schemaRoot, schema.name), bytes, { mode: 0o600 });
      schemaArtifacts.push({
        name: `kubernetes-schema/${schema.name}`,
        version: schemaBundle.version,
        digest: schema.sha256,
      });
    }
    const coreValidation = recordedProcess(
      kubeconform.executable,
      [
        '-strict',
        '-summary',
        '-kubernetes-version',
        schemaBundle.version,
        '-schema-location',
        join(schemaRoot, '{{.ResourceKind}}{{.KindSuffix}}.json'),
        corePath,
      ],
      { timeoutMs: 30_000 },
    );
    requireCommand(
      coreValidation,
      'kubeconform offline core schema validation',
    );
    assertFunctionalEvidence('kubeconform-summary', output(coreValidation));
    const summary = output(coreValidation);
    const found = Number(/Summary:\s+(\d+) resources?/iu.exec(summary)?.[1]);
    if (!Number.isSafeInteger(found) || found !== coreResources.length) {
      throw new Error(
        'Kubeconform summary does not cover every rendered core resource.',
      );
    }
    const analysis = recordedProcess(
      istioctl.executable,
      [
        'analyze',
        '--use-kube=false',
        '--failure-threshold=Warning',
        renderedPath,
      ],
      { timeoutMs: 60_000 },
    );
    requireCommand(analysis, 'istioctl analyze rendered Kubernetes topology');
    assertFunctionalEvidence('istio-analyze', output(analysis));
    return {
      status: 'PASS',
      commandIds: [
        'kubectl-kustomize-schema-input',
        'kubeconform-offline-core-schema-zero-skipped',
        'istioctl-embedded-core-and-istio-schema-analysis',
      ],
      artifacts: [
        {
          name: 'kubectl',
          version: kubectl.definition.version,
          digest: kubectl.digest,
        },
        {
          name: 'kubeconform',
          version: kubeconform.definition.version,
          digest: kubeconform.digest,
        },
        ...schemaArtifacts,
        {
          name: 'istioctl',
          version: istioctl.definition.version,
          digest: istioctl.digest,
        },
      ],
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    if (kubectl) removeVerifiedTemporaryRoot(kubectl.cleanupRoot);
    if (istioctl) removeVerifiedTemporaryRoot(istioctl.cleanupRoot);
    if (kubeconform) removeVerifiedTemporaryRoot(kubeconform.cleanupRoot);
  }
}

async function validateKubernetesTopology(
  manifest: ToolchainManifest,
): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  let kubectl: VerifiedTool | undefined;
  let kubeconform: VerifiedTool | undefined;
  const temporary = mkdtempSync(join(tmpdir(), 'hsk-media-topology-patch-'));
  try {
    kubectl = await acquireTool(manifest, 'kubectl');
    kubeconform = await acquireTool(manifest, 'kubeconform');
    verifyToolVersion(kubectl);
    verifyToolVersion(kubeconform);
    const bundle = manifest.schemaBundles['kubernetes-core'];
    const deploymentSchema = bundle?.files.find(
      ({ name }) => name === 'deployment-apps-v1.json',
    );
    if (!bundle || !deploymentSchema) {
      throw new Error('Pinned Deployment schema is absent.');
    }
    writeFileSync(
      join(temporary, deploymentSchema.name),
      await verifiedRemoteBytes(
        'topology-deployment-schema',
        deploymentSchema.artifact,
        deploymentSchema.sha256,
      ),
      { mode: 0o600 },
    );
    const render = recordedProcess(
      kubectl.executable,
      ['kustomize', resolve(repositoryRoot, 'ops/observability')],
      { timeoutMs: 20_000 },
    );
    requireCommand(render, 'kubectl kustomize topology');
    const resources = yaml.loadAll(render.stdout).filter(isRecord);
    const patch = firstRecord(
      yaml.loadAll(
        readFileSync(
          resolve(
            repositoryRoot,
            'ops/observability/media-backend-deployment.patch.yml',
          ),
          'utf8',
        ),
      ),
      'backend patch',
    );
    const startupHandlers = [
      '          startupProbe:\n            httpGet:\n              path: /startup\n              port: 3000\n',
      '          startupProbe:\n            exec:\n              command: [node, startup.js]\n',
      '          startupProbe:\n            tcpSocket:\n              port: 3000\n',
    ];
    for (const [index, startupProbe] of startupHandlers.entries()) {
      const syntheticBase =
        'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: hsk-backend\n  namespace: hsk\nspec:\n  selector:\n    matchLabels:\n      app.kubernetes.io/name: hsk-backend\n  template:\n    metadata:\n      labels:\n        app.kubernetes.io/name: hsk-backend\n    spec:\n      containers:\n        - name: backend\n          image: example.invalid/backend@sha256:' +
        '0'.repeat(64) +
        '\n          readinessProbe:\n            httpGet:\n              path: /api/v1/health\n              port: 3000\n' +
        startupProbe;
      const patchResult = recordedProcess(
        kubectl.executable,
        [
          'patch',
          '--local=true',
          '--type=strategic',
          '-f',
          '-',
          `--patch-file=${resolve(repositoryRoot, 'ops/observability/media-backend-deployment.patch.yml')}`,
          '-o',
          'yaml',
        ],
        { timeoutMs: 20_000, input: syntheticBase },
      );
      requireCommand(
        patchResult,
        `kubectl local backend deployment patch variant ${index + 1}`,
      );
      const baseResource = firstRecord(
        yaml.loadAll(syntheticBase),
        'synthetic backend base',
      );
      const patchedResource = firstRecord(
        yaml.loadAll(patchResult.stdout),
        'patched synthetic backend',
      );
      assertStartupProbePreserved(
        backendContainer(baseResource),
        backendContainer(patchedResource),
      );
      const patchedPath = join(temporary, `patched-${index + 1}.yml`);
      writeFileSync(patchedPath, patchResult.stdout, { mode: 0o600 });
      const schemaValidation = recordedProcess(
        kubeconform.executable,
        [
          '-strict',
          '-summary',
          '-kubernetes-version',
          bundle.version,
          '-schema-location',
          join(temporary, '{{.ResourceKind}}{{.KindSuffix}}.json'),
          patchedPath,
        ],
        { timeoutMs: 20_000 },
      );
      requireCommand(
        schemaValidation,
        `kubeconform strict schema validation for patched variant ${index + 1}`,
      );
      assertFunctionalEvidence('kubeconform-summary', output(schemaValidation));
      if (
        !patchResult.stdout.includes('readinessProbe:') ||
        !patchResult.stdout.includes('path: /api/v1/health') ||
        !patchResult.stdout.includes('name: media-metrics')
      ) {
        throw new Error(
          'Backend patch application degrades readiness or misses the metrics port.',
        );
      }
    }
    assertTopology(resources, patch, manifest);
    const istioResources = resources.filter((resource) =>
      String(resource.apiVersion).startsWith('security.istio.io/'),
    );
    if (istioResources.length !== 8) {
      throw new Error(
        'STRICT mTLS and identity authorization resources are incomplete.',
      );
    }
    return {
      status: 'PASS',
      commandIds: [
        'kubectl-local-strategic-backend-patch-startup-handler-matrix',
        'kubernetes-topology-semantic-contract',
      ],
      artifacts: [{ name: 'kubectl', digest: kubectl.digest }],
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    if (kubectl) removeVerifiedTemporaryRoot(kubectl.cleanupRoot);
    if (kubeconform) removeVerifiedTemporaryRoot(kubeconform.cleanupRoot);
  }
}

async function validateGrafana(
  manifest: ToolchainManifest,
): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  let grafana: VerifiedTool | undefined;
  let prometheus: VerifiedTool | undefined;
  const temporary = mkdtempSync(join(tmpdir(), 'hsk-media-grafana-'));
  let exporterScrapes = 0;
  const exporter = createServer((_incoming, response) => {
    exporterScrapes += 1;
    response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    response.end(
      incrementSyntheticCounters(
        readFileSync(
          resolve(
            repositoryRoot,
            'ops/observability/media-exporter.sample.prom',
          ),
          'utf8',
        ),
        exporterScrapes,
      ),
    );
  });
  let prometheusProcess: ReturnType<typeof spawn> | undefined;
  let grafanaProcess: ReturnType<typeof spawn> | undefined;
  let datasourceId: number | undefined;
  let grafanaPort: number | undefined;
  let runbook: ReturnType<typeof createHttpsServer> | undefined;
  const dashboardUid = 'hsk-media-release-validation';
  const grafanaAdminUser = 'hsk-ops-admin';
  const grafanaAdminPassword = randomBytes(32).toString('base64url');
  try {
    grafana = await acquireTool(manifest, 'grafana');
    prometheus = await acquireTool(manifest, 'prometheus');
    verifyToolVersion(grafana);
    verifyToolVersion(prometheus);
    const exporterPort = await listen(exporter);
    const prometheusPort = await reservePort();
    grafanaPort = await reservePort();
    const runbookKey = join(temporary, 'runbook.key');
    const runbookCertificate = join(temporary, 'runbook.crt');
    const certificate = recordedProcess(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-days',
        '1',
        '-keyout',
        runbookKey,
        '-out',
        runbookCertificate,
      ],
      { timeoutMs: 10_000 },
    );
    requireCommand(certificate, 'disposable runbook TLS certificate', true);
    runbook = createHttpsServer(
      {
        key: readFileSync(runbookKey),
        cert: readFileSync(runbookCertificate),
      },
      (_incoming, response) => {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('Synthetic media operations runbook');
      },
    );
    const runbookPort = await listen(runbook);
    const runbookUrl = `https://127.0.0.1:${runbookPort}/media-ingestion`;
    if (
      (await httpsStatus(runbookUrl, readFileSync(runbookCertificate))) !== 200
    ) {
      throw new Error('Disposable HTTPS runbook is not reachable.');
    }
    const rulesPath = join(temporary, 'media-alerts.rendered.yml');
    const renderedRules = readFileSync(
      resolve(repositoryRoot, 'ops/observability/media-alerts.yml'),
      'utf8',
    );
    if (!renderedRules.includes('__MEDIA_RUNBOOK_URL__')) {
      throw new Error('Media alert rules have no runbook deployment marker.');
    }
    const boundRules = renderedRules
      .split('__MEDIA_RUNBOOK_URL__')
      .join(runbookUrl);
    assertEveryAlertRunbookUrl(yaml.loadAll(boundRules), runbookUrl, {
      allowLoopback: true,
    });
    writeFileSync(rulesPath, boundRules, { mode: 0o600 });
    const prometheusConfig = join(temporary, 'prometheus.yml');
    writeFileSync(
      prometheusConfig,
      `global:\n  scrape_interval: 1s\n  evaluation_interval: 1s\nrule_files:\n  - ${rulesPath}\nscrape_configs:\n  - job_name: hsk-media-replicas\n    static_configs:\n      - targets: [127.0.0.1:${exporterPort}]\n`,
      { mode: 0o600 },
    );
    prometheusProcess = spawnRecorded(
      'prometheus-grafana-runtime',
      prometheus.executable,
      [
        `--config.file=${prometheusConfig}`,
        `--storage.tsdb.path=${join(temporary, 'prometheus-data')}`,
        `--web.listen-address=127.0.0.1:${prometheusPort}`,
      ],
      { stdio: 'ignore' },
    );
    await waitForStatus(prometheusPort, '/-/ready', 200);
    await waitFor(async () => {
      const query = await fetchJson(
        `http://127.0.0.1:${prometheusPort}/api/v1/query?query=${encodeURIComponent('hsk_media_metrics_database_available')}`,
      );
      return JSON.stringify(query).includes(
        'hsk_media_metrics_database_available',
      );
    }, 15_000);
    await waitFor(async () => {
      const query = await fetchJson(
        `http://127.0.0.1:${prometheusPort}/api/v1/query?query=${encodeURIComponent('hsk_media:signed_error_budget:burn_rate6h')}`,
      );
      return JSON.stringify(query).includes(
        'hsk_media:signed_error_budget:burn_rate6h',
      );
    }, 45_000);
    const runtimeRules = await fetchJson(
      `http://127.0.0.1:${prometheusPort}/api/v1/rules`,
    );
    assertPrometheusRuntimeAlertRunbookUrl(runtimeRules, runbookUrl, {
      allowLoopback: true,
    });

    const grafanaData = join(temporary, 'grafana-data');
    const grafanaLogs = join(temporary, 'grafana-logs');
    const grafanaPlugins = join(temporary, 'grafana-plugins');
    mkdirSync(grafanaData, { recursive: true });
    mkdirSync(grafanaLogs, { recursive: true });
    mkdirSync(grafanaPlugins, { recursive: true });
    const datasourceUid = 'hsk-media-prometheus';
    const provisioningRoot = join(temporary, 'grafana-provisioning');
    const datasourceRoot = join(provisioningRoot, 'datasources');
    const dashboardProviderRoot = join(provisioningRoot, 'dashboards');
    const dashboardRoot = join(temporary, 'grafana-dashboards');
    for (const path of [datasourceRoot, dashboardProviderRoot, dashboardRoot]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    const sourceDatasourcePath = resolve(
      repositoryRoot,
      'ops/observability/media-grafana-datasource.yml',
    );
    const sourceProviderPath = resolve(
      repositoryRoot,
      'ops/observability/media-grafana-dashboard-provider.yml',
    );
    const sourceDatasource = readFileSync(sourceDatasourcePath, 'utf8');
    const sourceProvider = readFileSync(sourceProviderPath, 'utf8');
    const productionPrometheusUrl =
      'http://hsk-media-prometheus.monitoring.svc.cluster.local:9090';
    const productionDashboardRoot = '/var/lib/grafana/dashboards';
    if (
      countOccurrences(sourceDatasource, productionPrometheusUrl) !== 1 ||
      countOccurrences(sourceDatasource, `uid: ${datasourceUid}`) !== 1 ||
      countOccurrences(sourceProvider, productionDashboardRoot) !== 1
    ) {
      throw new Error(
        'Grafana source provisioning is not the exact production contract.',
      );
    }
    const disposableDatasource = sourceDatasource.replace(
      productionPrometheusUrl,
      `http://127.0.0.1:${prometheusPort}`,
    );
    const disposableProvider = sourceProvider.replace(
      productionDashboardRoot,
      dashboardRoot,
    );
    if (
      countOccurrences(
        disposableDatasource,
        `http://127.0.0.1:${prometheusPort}`,
      ) !== 1 ||
      countOccurrences(disposableProvider, dashboardRoot) !== 1
    ) {
      throw new Error(
        'Grafana disposable provisioning replacement is ambiguous.',
      );
    }
    writeFileSync(
      join(datasourceRoot, 'datasource.yml'),
      disposableDatasource,
      {
        mode: 0o600,
      },
    );
    writeFileSync(
      join(dashboardProviderRoot, 'provider.yml'),
      disposableProvider,
      {
        mode: 0o600,
      },
    );
    const sourceDashboard = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, 'ops/observability/media-dashboard.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const sourceDashboardText = JSON.stringify(sourceDashboard);
    if (
      sourceDashboardText.includes('${DS_PROMETHEUS}') ||
      !sourceDashboardText.includes('hsk-media-prometheus')
    ) {
      throw new Error(
        'Grafana dashboard must bind the exact provisioned datasource UID.',
      );
    }
    const dashboard = JSON.parse(
      sourceDashboardText.split('__MEDIA_RUNBOOK_URL__').join(runbookUrl),
    ) as Record<string, unknown>;
    dashboard.uid = dashboardUid;
    writeFileSync(
      join(dashboardRoot, 'media-dashboard.json'),
      `${JSON.stringify(dashboard)}\n`,
      { mode: 0o600 },
    );
    grafanaProcess = spawnRecorded(
      'grafana-runtime',
      grafana.executable,
      [
        'server',
        `--homepath=${grafana.root}`,
        `--config=${join(grafana.root, 'conf/defaults.ini')}`,
      ],
      {
        stdio: 'ignore',
        env: {
          ...process.env,
          GF_SERVER_HTTP_ADDR: '127.0.0.1',
          GF_SERVER_HTTP_PORT: String(grafanaPort),
          GF_PATHS_DATA: grafanaData,
          GF_PATHS_LOGS: grafanaLogs,
          GF_PATHS_PLUGINS: grafanaPlugins,
          GF_PATHS_PROVISIONING: provisioningRoot,
          GF_AUTH_ANONYMOUS_ENABLED: 'false',
          GF_SECURITY_ADMIN_USER: grafanaAdminUser,
          GF_SECURITY_ADMIN_PASSWORD: grafanaAdminPassword,
          GF_USERS_ALLOW_SIGN_UP: 'false',
          GF_ANALYTICS_REPORTING_ENABLED: 'false',
          GF_ANALYTICS_CHECK_FOR_UPDATES: 'false',
          GF_PLUGINS_PREINSTALL_DISABLED: 'true',
        },
      },
    );
    await waitForStatus(grafanaPort, '/api/health', 200, 60_000);
    const grafanaApiStarted = startEvidenceTimer();
    const credentials = {
      user: grafanaAdminUser,
      password: grafanaAdminPassword,
    };
    const anonymous = await rawHttp(grafanaPort, '/api/dashboards/home', 'GET');
    if (anonymous.status !== 401) {
      throw new Error('Grafana operator API is anonymously accessible.');
    }
    const created = await grafanaJson(
      grafanaPort,
      `/api/datasources/uid/${datasourceUid}`,
      'GET',
      undefined,
      credentials,
    );
    datasourceId = numberProperty(created, 'id');
    const health = await grafanaJson(
      grafanaPort,
      `/api/datasources/uid/${datasourceUid}/health`,
      'GET',
      undefined,
      credentials,
    );
    if (!['OK', 'success'].includes(String(health.status))) {
      throw new Error('Grafana Prometheus datasource health check failed.');
    }
    let readBack: Record<string, unknown> | undefined;
    await waitFor(async () => {
      try {
        readBack = await grafanaJson(
          grafanaPort as number,
          `/api/dashboards/uid/${dashboardUid}`,
          'GET',
          undefined,
          credentials,
        );
        return true;
      } catch {
        return false;
      }
    }, 15_000);
    if (!readBack) throw new Error('Provisioned Grafana dashboard is absent.');
    const serialized = JSON.stringify(readBack);
    if (
      serialized.includes('${DS_PROMETHEUS}') ||
      serialized.includes('__MEDIA_RUNBOOK_URL__') ||
      !serialized.includes(runbookUrl)
    ) {
      throw new Error(
        'Grafana dashboard retains an unresolved deployment variable.',
      );
    }
    const readBackDashboard = isRecord(readBack.dashboard)
      ? readBack.dashboard
      : undefined;
    const targets = assertGrafanaDashboardTargetContract(
      dashboard,
      readBackDashboard,
      datasourceUid,
    );
    let executedTargetCount = 0;
    for (const { refId, expr } of targets) {
      const query = await grafanaJson(
        grafanaPort,
        '/api/ds/query',
        'POST',
        {
          from: String(Date.now() - 5 * 60_000),
          to: String(Date.now()),
          queries: [
            {
              refId,
              expr,
              datasource: { type: 'prometheus', uid: datasourceUid },
              format: 'time_series',
              intervalMs: 1_000,
              maxDataPoints: 300,
            },
          ],
        },
        credentials,
      );
      const result = isRecord(query.results) ? query.results[refId] : undefined;
      assertGrafanaQueryResult(result, refId);
      executedTargetCount += 1;
    }
    if (targets.length === 0 || executedTargetCount !== targets.length) {
      throw new Error('Grafana target execution coverage is incomplete.');
    }
    const noDataRefId = 'GUARANTEED_ABSENT';
    const noDataQuery = await grafanaJson(
      grafanaPort,
      '/api/ds/query',
      'POST',
      {
        from: String(Date.now() - 5 * 60_000),
        to: String(Date.now()),
        queries: [
          {
            refId: noDataRefId,
            expr: 'hsk_media_guaranteed_absent_validation_metric',
            datasource: { type: 'prometheus', uid: datasourceUid },
            format: 'time_series',
            intervalMs: 1_000,
            maxDataPoints: 300,
          },
        ],
      },
      credentials,
    );
    const noDataResult = isRecord(noDataQuery.results)
      ? noDataQuery.results[noDataRefId]
      : undefined;
    assertGrafanaNoDataResult(noDataResult, noDataRefId);
    recordProbeEvidence(
      'grafana-datasource-dashboard-query-api',
      grafanaApiStarted,
      true,
      'Datasource health, dashboard readback, exact HTTPS runbook link and every target frame validated through Grafana APIs.',
    );
    return {
      status: 'PASS',
      commandIds: [
        'prometheus-deterministic-exporter-scrape',
        'prometheus-runtime-all-alert-runbook-links',
        'grafana-datasource-health',
        'grafana-dashboard-import-readback',
        'grafana-all-panel-query-api',
        'grafana-explicit-no-data-query-policy',
      ],
      artifacts: [
        {
          name: 'grafana',
          version: grafana.definition.version,
          digest: grafana.digest,
        },
        {
          name: 'prometheus',
          version: prometheus.definition.version,
          digest: prometheus.digest,
        },
      ],
    };
  } finally {
    if (grafanaProcess && grafanaPort !== undefined) {
      await grafanaJson(
        grafanaPort,
        `/api/dashboards/uid/${dashboardUid}`,
        'DELETE',
        undefined,
        { user: grafanaAdminUser, password: grafanaAdminPassword },
      ).catch(() => undefined);
    }
    if (
      grafanaProcess &&
      grafanaPort !== undefined &&
      datasourceId !== undefined
    ) {
      await grafanaJson(
        grafanaPort,
        `/api/datasources/${datasourceId}`,
        'DELETE',
        undefined,
        { user: grafanaAdminUser, password: grafanaAdminPassword },
      ).catch(() => undefined);
    }
    if (grafanaProcess) await stopProcess(grafanaProcess);
    if (prometheusProcess) await stopProcess(prometheusProcess);
    if (runbook) await closeServer(runbook);
    await closeServer(exporter);
    rmSync(temporary, { recursive: true, force: true });
    if (grafana) removeVerifiedTemporaryRoot(grafana.cleanupRoot);
    if (prometheus) removeVerifiedTemporaryRoot(prometheus.cleanupRoot);
  }
}

async function validateRunbookUrl(
  manifest: ToolchainManifest,
): Promise<Omit<ValidatorResult, 'id' | 'durationMs'>> {
  const configured = process.env.MEDIA_RUNBOOK_URL;
  if (!configured) {
    throw new ExternalBlock(
      'MEDIA_RUNBOOK_URL is required for live HTTPS reachability validation.',
    );
  }
  const runbookUrl = requireCredentialFreeHttpsRunbookUrl(configured);
  const url = new URL(runbookUrl);
  const renderRoot = mkdtempSync(join(tmpdir(), 'hsk-media-rendered-'));
  const render = recordedProcess(
    process.execPath,
    [
      '-r',
      'ts-node/register',
      resolve(
        repositoryRoot,
        'backend/scripts/operations/render-media-observability.ts',
      ),
    ],
    {
      cwd: resolve(repositoryRoot, 'backend'),
      timeoutMs: 15_000,
      env: {
        ...process.env,
        MEDIA_RUNBOOK_URL: runbookUrl,
        MEDIA_OBSERVABILITY_RENDER_DIR: renderRoot,
      },
    },
  );
  requireCommand(render, 'media observability deployment rendering');
  for (const file of [
    'media-alerts.yml',
    'media-alerts.test.yml',
    'media-dashboard.json',
  ]) {
    const content = readFileSync(join(renderRoot, file), 'utf8');
    if (
      content.includes('__MEDIA_RUNBOOK_URL__') ||
      !content.includes(runbookUrl)
    ) {
      throw new Error(
        `Rendered ${file} does not bind the validated runbook URL.`,
      );
    }
  }
  const renderedAlertRules = readFileSync(
    join(renderRoot, 'media-alerts.yml'),
    'utf8',
  );
  assertEveryAlertRunbookUrl(yaml.loadAll(renderedAlertRules), runbookUrl);
  productionRenderedTree = computeTreeDigest(renderRoot);
  commandEvidenceBinding = {
    ...commandEvidenceBinding,
    inputTreeDigest: productionRenderedTree.digest,
  };
  const verifiedTools: VerifiedTool[] = [];
  try {
    for (const toolName of [
      'promtool',
      'amtool',
      'kubectl',
      'kubeconform',
      'istioctl',
    ]) {
      const tool = await acquireTool(manifest, toolName);
      verifiedTools.push(tool);
      verifyToolVersion(tool);
    }
    const tool = (name: string): VerifiedTool => {
      const match = verifiedTools.find(
        ({ definition }) => definition === manifest.tools[name],
      );
      if (!match) throw new Error(`Rendered-tree validator lacks ${name}.`);
      return match;
    };
    for (const [name, args, evidenceKind] of [
      [
        'rendered Prometheus rules',
        ['check', 'rules', join(renderRoot, 'media-alerts.yml')],
        'promtool-check',
      ],
      [
        'rendered Prometheus rule tests',
        ['test', 'rules', join(renderRoot, 'media-alerts.test.yml')],
        'promtool-test-rules',
      ],
    ] as const) {
      const check = recordedProcess(tool('promtool').executable, args, {
        cwd: renderRoot,
        timeoutMs: 60_000,
      });
      requireCommand(check, name);
      assertFunctionalEvidence(evidenceKind, output(check));
    }
    const alertmanagerCheck = recordedProcess(
      tool('amtool').executable,
      ['check-config', join(renderRoot, 'media-alertmanager.yml')],
      { timeoutMs: 30_000 },
    );
    requireCommand(alertmanagerCheck, 'rendered Alertmanager config');
    assertFunctionalEvidence('amtool-config', output(alertmanagerCheck));
    const renderedKubernetes = recordedProcess(
      tool('kubectl').executable,
      ['kustomize', renderRoot],
      { timeoutMs: 30_000 },
    );
    requireCommand(renderedKubernetes, 'rendered Kubernetes release tree');
    const renderedManifest = join(renderRoot, '.rendered-topology.yml');
    writeFileSync(renderedManifest, renderedKubernetes.stdout, { mode: 0o600 });
    const coreResources = yaml
      .loadAll(renderedKubernetes.stdout)
      .filter(isRecord)
      .filter(
        (resource) =>
          !String(resource.apiVersion).startsWith('security.istio.io/'),
      );
    const schemaRoot = mkdtempSync(
      join(tmpdir(), 'hsk-media-rendered-schema-'),
    );
    try {
      const bundle = manifest.schemaBundles['kubernetes-core'];
      if (!bundle) throw new Error('Kubernetes schema bundle is absent.');
      for (const schema of bundle.files) {
        const bytes = await verifiedRemoteBytes(
          `rendered-${schema.name}`,
          schema.artifact,
          schema.sha256,
        );
        writeFileSync(join(schemaRoot, schema.name), bytes, { mode: 0o600 });
      }
      const coreManifest = join(schemaRoot, 'core.yml');
      writeFileSync(
        coreManifest,
        coreResources
          .map((resource) => JSON.stringify(resource))
          .join('\n---\n'),
        { mode: 0o600 },
      );
      const schema = recordedProcess(
        tool('kubeconform').executable,
        [
          '-strict',
          '-summary',
          '-kubernetes-version',
          bundle.version,
          '-schema-location',
          join(schemaRoot, '{{.ResourceKind}}{{.KindSuffix}}.json'),
          coreManifest,
        ],
        { timeoutMs: 60_000 },
      );
      requireCommand(schema, 'rendered Kubernetes core schema');
      assertFunctionalEvidence('kubeconform-summary', output(schema));
      const found = Number(
        /Summary:\s+(\d+) resources?/iu.exec(output(schema))?.[1],
      );
      if (found !== coreResources.length) {
        throw new Error(
          'Rendered kubeconform coverage does not include every core resource.',
        );
      }
    } finally {
      rmSync(schemaRoot, { recursive: true, force: true });
    }
    const istio = recordedProcess(
      tool('istioctl').executable,
      [
        'analyze',
        '--use-kube=false',
        '--failure-threshold=Warning',
        renderedManifest,
      ],
      { timeoutMs: 60_000 },
    );
    requireCommand(istio, 'rendered Istio topology');
    assertFunctionalEvidence('istio-analyze', output(istio));
    rmSync(renderedManifest, { force: true });
  } finally {
    for (const tool of verifiedTools) {
      removeVerifiedTemporaryRoot(tool.cleanupRoot);
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const reachabilityStarted = startEvidenceTimer();
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok)
      throw new ExternalBlock(`Runbook returned HTTP ${response.status}.`);
    recordProbeEvidence(
      'production-runbook-https-get',
      reachabilityStarted,
      true,
      `Credential-free HTTPS runbook returned ${response.status}.`,
    );
  } catch (error: unknown) {
    recordProbeEvidence(
      'production-runbook-https-get',
      reachabilityStarted,
      false,
      `Production runbook reachability failed (${error instanceof Error ? error.name : 'unknown error'}).`,
    );
    if (error instanceof ExternalBlock) throw error;
    throw new ExternalBlock(
      `Runbook reachability failed (${error instanceof Error ? error.name : 'unknown error'}).`,
    );
  } finally {
    clearTimeout(timeout);
    rmSync(renderRoot, { recursive: true, force: true });
  }
  return {
    status: 'PASS',
    commandIds: ['render-media-observability', 'runbook-https-get'],
  };
}

async function acquireTool(
  manifest: ToolchainManifest,
  name: string,
): Promise<VerifiedTool> {
  const definition = manifest.tools[name];
  if (!definition) throw new Error(`Tool is absent from manifest: ${name}.`);
  const artifact = selectArtifact(definition, process.platform, process.arch);
  if (typeof artifact.artifact !== 'string') {
    throw new ExternalBlock(
      `${name} is pinned as OCI but no OCI runtime is available.`,
    );
  }
  const extracted = await extractVerifiedArtifact(name, artifact);
  const executable = join(extracted.root, artifact.executable);
  if (!existsSync(executable))
    throw new Error(`${name} executable is absent from verified artifact.`);
  chmodSync(executable, 0o700);
  assertExecutableFromVerifiedRoot(executable, extracted.root);
  verifiedExecutableVersions.set(resolve(executable), definition.version);
  return {
    executable,
    root: extracted.root,
    cleanupRoot: extracted.cleanupRoot,
    digest: extracted.digest,
    definition,
  };
}

async function acquireSource(
  manifest: ToolchainManifest,
  name: string,
): Promise<{ root: string; cleanupRoot: string; digest: string }> {
  const definition = manifest.tools[name];
  if (!definition) throw new Error(`Source is absent from manifest: ${name}.`);
  const artifact = selectArtifact(definition, process.platform, process.arch);
  if (typeof artifact.artifact !== 'string' || artifact.archive !== 'tar.gz') {
    throw new Error(`${name} is not a pinned source archive.`);
  }
  return extractVerifiedArtifact(name, artifact);
}

async function extractVerifiedArtifact(
  name: string,
  artifact: ShaArtifact,
): Promise<{ root: string; cleanupRoot: string; digest: string }> {
  const bytes = await artifactBytes(name, artifact);
  const digest = verifySha256(bytes, artifact.sha256);
  persistVerifiedCache(artifact, bytes);
  const temporary = mkdtempSync(join(tmpdir(), `hsk-media-${name}-verified-`));
  const archivePath = join(
    temporary,
    basename(new URL(artifact.artifact).pathname) || name,
  );
  writeFileSync(archivePath, bytes, { mode: 0o600 });
  if (artifact.archive === 'raw') {
    const executable = join(temporary, artifact.executable);
    if (executable !== archivePath) copyFileSync(archivePath, executable);
    return { root: temporary, cleanupRoot: temporary, digest };
  }
  assertGzipArchive(bytes);
  assertArchiveEntriesSafe(
    await inspectTarGzipFile(archivePath),
    artifact.archiveRoot,
  );
  const extraction = recordedProcess(
    'tar',
    ['-xzf', archivePath, '-C', temporary],
    {
      timeoutMs: 60_000,
    },
  );
  requireCommand(extraction, `${name} archive extraction`, true);
  const root =
    artifact.archiveRoot === '.'
      ? temporary
      : join(temporary, artifact.archiveRoot);
  if (!existsSync(root))
    throw new Error(`${name} archive root is absent after extraction.`);
  assertExtractedTreeSafe(root, temporary);
  return { root, cleanupRoot: temporary, digest };
}

async function artifactBytes(
  name: string,
  artifact: ShaArtifact,
): Promise<Buffer> {
  const filename = basename(new URL(artifact.artifact).pathname) || name;
  const cacheFilename = contentAddressedCacheFilename(
    artifact.artifact,
    artifact.sha256,
  );
  const cached = toolCache ? join(toolCache, cacheFilename) : undefined;
  if (cached && existsSync(cached)) {
    if (statSync(cached).size > 512 * 1024 * 1024)
      throw new Error(`${name} cached artifact exceeds the 512 MiB limit.`);
    const bytes = readFileSync(cached);
    try {
      verifySha256(bytes, artifact.sha256);
    } catch {
      const quarantine = join(
        toolCache as string,
        `.quarantine-${cacheFilename}-${Date.now()}-${process.pid}`,
      );
      renameSync(cached, quarantine);
      throw new Error(
        `${name} content-addressed cache entry was quarantined after digest mismatch.`,
      );
    }
    return bytes;
  }
  const legacy = toolCache ? join(toolCache, filename) : undefined;
  if (legacy && existsSync(legacy)) {
    if (statSync(legacy).size > 512 * 1024 * 1024)
      throw new Error(`${name} cached artifact exceeds the 512 MiB limit.`);
    const bytes = readFileSync(legacy);
    try {
      verifySha256(bytes, artifact.sha256);
    } catch {
      const quarantine = join(
        toolCache as string,
        `.quarantine-legacy-${filename}-${Date.now()}-${process.pid}`,
      );
      renameSync(legacy, quarantine);
      throw new Error(
        `${name} legacy cache entry was quarantined after digest mismatch.`,
      );
    }
    persistVerifiedCache(artifact, bytes);
    return bytes;
  }
  if (!allowDownload) {
    throw new ExternalBlock(
      `${name} artifact is absent from MEDIA_OPS_TOOL_CACHE and downloads are disabled.`,
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(artifact.artifact, {
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok)
      throw new ExternalBlock(
        `${name} download returned HTTP ${response.status}.`,
      );
    const finalUrl = new URL(response.url);
    if (
      finalUrl.protocol !== 'https:' ||
      finalUrl.username ||
      finalUrl.password
    ) {
      throw new Error(`${name} redirected to a non-HTTPS or credentialed URL.`);
    }
    const declared = Number(response.headers.get('content-length'));
    const maximum = 512 * 1024 * 1024;
    if (Number.isFinite(declared) && declared > maximum)
      throw new Error(`${name} download exceeds the 512 MiB limit.`);
    if (!response.body) throw new Error(`${name} download has no body.`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.length;
      if (total > maximum) {
        await reader.cancel();
        throw new Error(`${name} download exceeds the 512 MiB limit.`);
      }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, total);
  } catch (error: unknown) {
    if (error instanceof ExternalBlock) throw error;
    throw new ExternalBlock(`${name} download failed: ${safeError(error)}.`);
  } finally {
    clearTimeout(timeout);
  }
}

async function verifiedRemoteBytes(
  name: string,
  artifact: string,
  expectedSha256: string,
): Promise<Buffer> {
  const definition: ShaArtifact = {
    os: process.platform as 'darwin' | 'linux',
    architecture: process.arch as 'arm64' | 'x64',
    artifact,
    sha256: expectedSha256,
    archive: 'raw',
    archiveRoot: '.',
    executable: basename(new URL(artifact).pathname),
  };
  const bytes = await artifactBytes(name, definition);
  verifySha256(bytes, expectedSha256);
  persistVerifiedCache(definition, bytes);
  return bytes;
}

function persistVerifiedCache(artifact: ShaArtifact, bytes: Buffer): void {
  if (!toolCache) return;
  mkdirSync(toolCache, { recursive: true, mode: 0o700 });
  const filename = contentAddressedCacheFilename(
    artifact.artifact,
    artifact.sha256,
  );
  const destination = join(toolCache, filename);
  if (existsSync(destination)) return;
  const temporary = join(
    toolCache,
    `.${filename}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  writeFileSync(temporary, bytes, { mode: 0o600 });
  try {
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function verifyToolVersion(tool: VerifiedTool): void {
  const probe = recordedProcess(tool.executable, tool.definition.probe.args, {
    timeoutMs: 30_000,
  });
  requireCommand(probe, 'exact version probe');
  requireExactVersion(
    parseExactVersion(tool.definition.probe.parser, output(probe)),
    tool.definition.version,
  );
}

function assertTopology(
  resources: Record<string, unknown>[],
  patch: Record<string, unknown>,
  manifest: ToolchainManifest,
): void {
  assertExactMediaNetworkTopology(resources);
  assertGrafanaPrivateApiOnlyContract(resources);
  assertGrafanaProvisioningMountContract(resources);
  assertMonitoringSingleReplicaRollout(resources);
  assertIstioProbeRewriteContract(resources, patch);
  const resource = (kind: string, name: string): Record<string, unknown> => {
    const match = resources.find(
      (candidate) =>
        candidate.kind === kind &&
        nestedString(candidate, ['metadata', 'name']) === name,
    );
    if (!match)
      throw new Error(`Kubernetes resource is missing: ${kind}/${name}.`);
    return match;
  };
  const prometheus = resource('Deployment', 'hsk-media-prometheus');
  const alertmanager = resource('Deployment', 'hsk-media-alertmanager');
  const grafana = resource('Deployment', 'hsk-media-grafana');
  const network = resource(
    'NetworkPolicy',
    'hsk-backend-media-metrics-private',
  );
  const metricsService = resource('Service', 'hsk-backend-media-metrics');
  resource('ServiceAccount', 'hsk-media-prometheus');
  resource('ServiceAccount', 'hsk-media-grafana');
  resource('ServiceAccount', 'hsk-media-operator');
  resource('PeerAuthentication', 'hsk-backend-media-metrics-strict-mtls');
  resource('PeerAuthentication', 'hsk-media-alertmanager-strict-mtls');
  resource('PeerAuthentication', 'hsk-media-prometheus-strict-mtls');
  resource('PeerAuthentication', 'hsk-media-grafana-strict-mtls');
  resource('AuthorizationPolicy', 'hsk-backend-media-metrics-principal');
  resource('AuthorizationPolicy', 'hsk-media-alertmanager-principal');
  resource('AuthorizationPolicy', 'hsk-media-prometheus-principal');
  resource('AuthorizationPolicy', 'hsk-media-grafana-principal');
  resource('NetworkPolicy', 'hsk-media-alertmanager-private');
  resource('NetworkPolicy', 'hsk-media-prometheus-private');
  resource('NetworkPolicy', 'hsk-media-grafana-private');
  resource('PersistentVolumeClaim', 'hsk-media-prometheus-data');
  resource('PersistentVolumeClaim', 'hsk-media-alertmanager-data');
  resource('Deployment', 'hsk-media-grafana');
  resource('PersistentVolumeClaim', 'hsk-media-grafana-data');
  if (
    nestedValue(prometheus, ['spec', 'replicas']) !== 1 ||
    nestedValue(alertmanager, ['spec', 'replicas']) !== 1 ||
    nestedValue(grafana, ['spec', 'replicas']) !== 1
  ) {
    throw new Error(
      'Monitoring V1 must be single replica until HA clustering is configured.',
    );
  }
  for (const [name, deployment, containerName] of [
    ['prometheus', prometheus, 'prometheus'],
    ['alertmanager', alertmanager, 'alertmanager'],
    ['grafana', grafana, 'grafana'],
  ] as const) {
    const definition = manifest.images[name];
    const expectedImage = definition?.platforms[0]?.runtimeRef;
    const containers = nestedValue(deployment, [
      'spec',
      'template',
      'spec',
      'containers',
    ]);
    const container: unknown = Array.isArray(containers)
      ? (containers as unknown[]).find(
          (candidate) =>
            isRecord(candidate) && candidate.name === containerName,
        )
      : undefined;
    if (!isRecord(container) || container.image !== expectedImage) {
      throw new Error(
        `${name} workload does not use the exact manifest image.`,
      );
    }
    if (
      nestedValue(deployment, [
        'spec',
        'template',
        'spec',
        'automountServiceAccountToken',
      ]) !== false ||
      nestedValue(container, [
        'securityContext',
        'allowPrivilegeEscalation',
      ]) !== false ||
      nestedValue(container, ['securityContext', 'readOnlyRootFilesystem']) !==
        true ||
      !nestedValue(container, ['resources', 'requests']) ||
      !nestedValue(container, ['resources', 'limits'])
    ) {
      throw new Error(`${name} workload security/resources are incomplete.`);
    }
  }
  if (
    !JSON.stringify(prometheus).includes('--storage.tsdb.retention.time=32d') ||
    !JSON.stringify(
      resource('PersistentVolumeClaim', 'hsk-media-prometheus-data'),
    ).includes('50Gi')
  ) {
    throw new Error(
      'Prometheus cannot truthfully retain the required 28d SLI.',
    );
  }
  if (
    nestedString(prometheus, ['spec', 'strategy', 'type']) !== 'Recreate' ||
    nestedString(alertmanager, ['spec', 'strategy', 'type']) !== 'Recreate' ||
    nestedString(grafana, ['spec', 'strategy', 'type']) !== 'Recreate'
  ) {
    throw new Error(
      'Single-replica RWO monitoring workloads require Recreate rollout.',
    );
  }
  for (const deployment of [prometheus, alertmanager, grafana]) {
    if (
      nestedString(deployment, [
        'spec',
        'template',
        'metadata',
        'annotations',
        'sidecar.istio.io/inject',
      ]) !== 'true'
    ) {
      throw new Error(
        'Monitoring workload is missing Istio sidecar injection annotation.',
      );
    }
  }
  if (
    !JSON.stringify(prometheus).includes('hsk-media-prometheus-data') ||
    !JSON.stringify(prometheus).includes('/prometheus') ||
    !JSON.stringify(alertmanager).includes('hsk-media-alertmanager-data') ||
    !JSON.stringify(alertmanager).includes('/alertmanager') ||
    !JSON.stringify(grafana).includes('hsk-media-grafana-data') ||
    !JSON.stringify(grafana).includes('/var/lib/grafana')
  ) {
    throw new Error(
      'Monitoring restart state is not mounted from explicit PVCs.',
    );
  }
  const prometheusConfig = nestedString(prometheus, [
    'spec',
    'template',
    'spec',
    'volumes',
    '0',
    'configMap',
    'name',
  ]);
  const alertmanagerConfig = nestedString(alertmanager, [
    'spec',
    'template',
    'spec',
    'volumes',
    '0',
    'configMap',
    'name',
  ]);
  if (
    !prometheusConfig?.match(/^hsk-media-prometheus-[a-z0-9]{10}$/u) ||
    !alertmanagerConfig?.match(/^hsk-media-alertmanager-[a-z0-9]{10}$/u)
  ) {
    throw new Error(
      'Monitoring ConfigMaps lack rollout-triggering content hashes.',
    );
  }
  if (nestedValue(metricsService, ['spec', 'clusterIP']) !== 'None') {
    throw new Error('Metrics service must be headless for replica discovery.');
  }
  const serializedNetwork = JSON.stringify(network);
  if (
    !serializedNetwork.includes('monitoring') ||
    !serializedNetwork.includes('9464') ||
    !serializedNetwork.includes('hsk-edge')
  ) {
    throw new Error(
      'Metrics NetworkPolicy identity/port rules are incomplete.',
    );
  }
  const serializedPatch = JSON.stringify(patch);
  for (const expected of [
    'MEDIA_METRICS_BEARER_TOKEN',
    'MEDIA_METRICS_BEARER_TOKEN_PREVIOUS',
    'secretKeyRef',
    'media-metrics',
  ]) {
    if (!serializedPatch.includes(expected))
      throw new Error(`Backend patch is missing ${expected}.`);
  }
  if (serializedPatch.includes('readinessProbe')) {
    throw new Error(
      'Metrics patch must preserve the externally owned application readiness probe.',
    );
  }
  if (serializedPatch.includes('startupProbe')) {
    throw new Error(
      'Portable metrics patch must not create or replace startupProbe.',
    );
  }
}

function backendContainer(
  deployment: Record<string, unknown>,
): Record<string, unknown> {
  const containers = nestedValue(deployment, [
    'spec',
    'template',
    'spec',
    'containers',
  ]);
  if (!Array.isArray(containers)) {
    throw new Error('Backend Deployment has no containers array.');
  }
  const container: unknown = (containers as unknown[]).find(
    (candidate) => isRecord(candidate) && candidate.name === 'backend',
  );
  if (!container || !isRecord(container)) {
    throw new Error('Backend Deployment has no backend container.');
  }
  return container;
}

function nestedValue(input: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = input;
  for (const key of path) {
    if (Array.isArray(current) && /^\d+$/u.test(key)) {
      current = current[Number(key)];
    } else if (isRecord(current)) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function nestedString(
  input: Record<string, unknown>,
  path: string[],
): string | undefined {
  const value = nestedValue(input, path);
  return typeof value === 'string' ? value : undefined;
}

function firstRecord(
  input: unknown[],
  description: string,
): Record<string, unknown> {
  const value = input.find(isRecord);
  if (!value) throw new Error(`${description} is not a YAML object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function assertRejected(port: number, paths: string[]): Promise<void> {
  for (const path of paths) {
    const result = await rawHttp(port, path, 'GET');
    if (result.status !== 404)
      throw new Error(`Metrics route variant was not rejected: ${path}.`);
  }
}

function rawHttp(
  port: number,
  path: string,
  method: string,
): Promise<HttpResult> {
  return new Promise((resolveRequest, reject) => {
    const incoming = request(
      { hostname: '127.0.0.1', port, method, path, timeout: 3_000 },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          resolveRequest({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
          });
        });
      },
    );
    incoming.once('timeout', () =>
      incoming.destroy(new Error('HTTP request timed out.')),
    );
    incoming.once('error', reject);
    incoming.end();
  });
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok)
      throw new Error(`Loopback JSON request returned ${response.status}.`);
    const body: unknown = await response.json();
    if (!isRecord(body))
      throw new Error('Loopback JSON response was not an object.');
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function httpsStatus(url: string, certificate: Buffer): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const parsed = new URL(url);
    const outgoing = httpsRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'GET',
        ca: certificate,
        timeout: 3_000,
      },
      (response) => {
        response.resume();
        response.on('end', () => resolveStatus(response.statusCode ?? 0));
      },
    );
    outgoing.once('timeout', () =>
      outgoing.destroy(new Error('HTTPS request timed out.')),
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
}

async function grafanaJson(
  port: number,
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
  credentials?: { user: string; password: string },
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(credentials
          ? {
              Authorization: `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64')}`,
            }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Grafana API ${method} ${path} returned ${response.status}.`,
      );
    if (response.status === 204) return {};
    const value: unknown = await response.json();
    if (!isRecord(value))
      throw new Error('Grafana API response was not an object.');
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function numberProperty(value: Record<string, unknown>, key: string): number {
  const candidate = value[key];
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate))
    throw new Error(`Expected numeric response property: ${key}.`);
  return candidate;
}

function requireCommand(
  result: ReturnType<typeof runProcess>,
  name: string,
  missingIsExternal = false,
): void {
  if (result.kind === 'success') return;
  if (result.kind === 'missing' && missingIsExternal) {
    throw new ExternalBlock(`${name} prerequisite is unavailable.`);
  }
  if (result.kind === 'timeout')
    throw new Error(`${name} exceeded its bounded timeout.`);
  throw new Error(`${name} failed: ${redactDiagnostic(output(result))}.`);
}

function recordedProcess(
  command: string,
  args: readonly string[],
  options: Parameters<typeof runProcess>[2],
): ReturnType<typeof runProcess> {
  const timer = startEvidenceTimer();
  const result = runProcess(command, args, options);
  const completedAt = new Date().toISOString();
  const sequence = String(++commandSequence).padStart(3, '0');
  const executable = basename(command);
  const id = `${activeValidator}/${sequence}/${executable}`;
  const logDirectory = join(evidenceRoot, 'logs');
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const logPath = `logs/${sequence}-${activeValidator.replace(/[^a-z0-9-]/giu, '-')}-${executable.replace(/[^a-z0-9.-]/giu, '-')}.log`;
  const logBytes = Buffer.from(`${redactDiagnostic(output(result))}\n`);
  writeFileSync(join(evidenceRoot, logPath), logBytes, { mode: 0o600 });
  const identity = executableEvidence(command);
  commandEvidence.push({
    id,
    validator: activeValidator,
    executable,
    exitCode:
      result.kind === 'success'
        ? 0
        : result.kind === 'exit'
          ? (result.status ?? 1)
          : result.kind === 'timeout'
            ? 124
            : 127,
    durationMs: elapsedMilliseconds(timer),
    logPath,
    logSha256: sha256(logBytes),
    safeArgs: args.map((argument) => redactDiagnostic(argument)),
    cwd: resolve(options.cwd ?? process.cwd()),
    startedAt: timer.startedAt,
    completedAt,
    platform: process.platform,
    architecture: process.arch,
    inputSha256:
      options.input === undefined
        ? undefined
        : sha256(Buffer.from(options.input)),
    envKeys: safeEnvironmentKeys(options.env ?? process.env),
    executableIdentity: identity.path,
    executableSha256: identity.digest,
    toolVersion: identity.version,
    ...commandEvidenceBinding,
  });
  return result;
}

function recordProbeEvidence(
  probeId: string,
  timer: EvidenceTimer,
  success: boolean,
  diagnostic: string,
): void {
  const sequence = String(++commandSequence).padStart(3, '0');
  const safeProbe = probeId.replace(/[^a-z0-9.-]/giu, '-');
  const logPath = `logs/${sequence}-${activeValidator}-${safeProbe}.log`;
  mkdirSync(join(evidenceRoot, 'logs'), { recursive: true, mode: 0o700 });
  const logBytes = Buffer.from(`${redactDiagnostic(diagnostic)}\n`);
  writeFileSync(join(evidenceRoot, logPath), logBytes, { mode: 0o600 });
  commandEvidence.push({
    id: `${activeValidator}/${sequence}/${safeProbe}`,
    validator: activeValidator,
    executable: 'http-probe',
    exitCode: success ? 0 : 1,
    durationMs: elapsedMilliseconds(timer),
    logPath,
    logSha256: sha256(logBytes),
    safeArgs: [],
    cwd: process.cwd(),
    startedAt: timer.startedAt,
    completedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    envKeys: [],
    executableIdentity: 'internal:http-probe',
    executableSha256: sha256(Buffer.from('internal:http-probe:v1')),
    toolVersion: 'internal-v1',
    ...commandEvidenceBinding,
  });
}

function safeEnvironmentKeys(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((key) => MEDIA_OPERATIONS_EVIDENCE_ENV_ALLOWLIST.has(key))
    .sort((left, right) => left.localeCompare(right));
}

function executableEvidence(command: string): {
  path: string;
  digest: string;
  version: string;
} {
  const candidates = command.includes('/')
    ? [resolve(command)]
    : (process.env.PATH ?? '')
        .split(':')
        .filter(Boolean)
        .map((directory) => join(directory, command));
  const executable = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (!executable) {
    const path = `missing:${basename(command)}`;
    return {
      path,
      digest: sha256(Buffer.from(path)),
      version: 'unavailable-v1',
    };
  }
  return {
    path: executable,
    digest: sha256(readFileSync(executable)),
    version:
      verifiedExecutableVersions.get(resolve(executable)) ??
      `sha256:${sha256(readFileSync(executable))}`,
  };
}

function bindExistingCommandEvidence(): void {
  for (const command of commandEvidence) {
    Object.assign(command, commandEvidenceBinding);
  }
}

function output(result: ReturnType<typeof runProcess>): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) throw new Error('Occurrence needle must not be empty.');
  return value.split(needle).length - 1;
}

async function listen(
  server: ReturnType<typeof createServer>,
): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        return reject(new Error('Listener has no port.'));
      resolvePort(address.port);
    });
  });
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

async function closeServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function waitForStatus(
  port: number,
  path: string,
  status: number,
  timeoutMs = 10_000,
): Promise<void> {
  await waitFor(
    async () => (await rawHttp(port, path, 'GET')).status === status,
    timeoutMs,
  );
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch {
      // A bounded retry is expected while the disposable process starts.
    }
    await delay(100);
  }
  throw new Error(
    'Disposable runtime did not reach the expected state before timeout.',
  );
}

async function waitForAlertDelivery(
  events: readonly string[],
  status: 'firing' | 'resolved',
  receiver: 'page' | 'ticket',
  phaseLogPath: string,
): Promise<void> {
  try {
    await waitFor(
      () => events.some((body) => body.includes(`"status":"${status}"`)),
      30_000,
    );
    writeFileSync(
      phaseLogPath,
      `${receiver}:${status}:PASS eventCount=${events.length}\n`,
      { mode: 0o600, flag: 'a' },
    );
  } catch {
    const observed = events
      .map((body) => /"status":"([a-z]+)"/u.exec(body)?.[1] ?? 'unknown')
      .join(',');
    writeFileSync(
      phaseLogPath,
      `${receiver}:${status}:FAIL eventCount=${events.length} observed=${redactDiagnostic(observed || 'none')}\n`,
      { mode: 0o600, flag: 'a' },
    );
    throw new Error(
      `Alertmanager ${receiver} receiver missed ${status}; observed=${observed || 'none'}.`,
    );
  }
}

async function stopProcess(
  processHandle: ReturnType<typeof spawn>,
): Promise<void> {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
    finalizeSpawnEvidence(processHandle, false);
    throw new Error('Disposable runtime exited before its intentional stop.');
  }
  processHandle.kill('SIGTERM');
  await waitForProcessExit(processHandle, 3_000);
  if (processHandle.exitCode === null && processHandle.signalCode === null) {
    processHandle.kill('SIGKILL');
    await waitForProcessExit(processHandle, 3_000);
  }
  if (processHandle.exitCode === null && processHandle.signalCode === null) {
    finalizeSpawnEvidence(processHandle, false);
    throw new Error(
      'Disposable runtime did not stop within its bounded timeout.',
    );
  }
  finalizeSpawnEvidence(processHandle, true);
}

async function waitForProcessExit(
  processHandle: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<void> {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null)
    return;
  await Promise.race([
    new Promise<void>((resolveExit) =>
      processHandle.once('exit', () => resolveExit()),
    ),
    delay(timeoutMs),
  ]);
}

function spawnRecorded(
  id: string,
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
): ReturnType<typeof spawn> {
  const timer = startEvidenceTimer();
  const processHandle = spawn(command, [...args], options);
  const sequence = String(++commandSequence).padStart(3, '0');
  const logDirectory = join(evidenceRoot, 'logs');
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const logPath = `logs/${sequence}-${id}.log`;
  writeFileSync(
    join(evidenceRoot, logPath),
    'Disposable runtime started; stdio intentionally suppressed.\n',
    { mode: 0o600 },
  );
  spawnedEvidence.set(processHandle, {
    id: `${activeValidator}/${sequence}/${id}`,
    validator: activeValidator,
    executable: basename(command),
    monotonicStarted: timer.monotonicStarted,
    logPath,
    command,
    args: args.map((argument) => redactDiagnostic(argument)),
    cwd: typeof options.cwd === 'string' ? resolve(options.cwd) : process.cwd(),
    envKeys: safeEnvironmentKeys(options.env ?? process.env),
    startedAt: timer.startedAt,
    toolVersion: executableEvidence(command).version,
    binding: { ...commandEvidenceBinding },
  });
  return processHandle;
}

function finalizeSpawnEvidence(
  processHandle: ReturnType<typeof spawn>,
  intentional: boolean,
): void {
  const pending = spawnedEvidence.get(processHandle);
  if (!pending) return;
  const logBytes = Buffer.from(
    `Disposable runtime stopped with exit=${processHandle.exitCode ?? 'signal'}.\n`,
  );
  writeFileSync(join(evidenceRoot, pending.logPath), logBytes, { mode: 0o600 });
  const identity = executableEvidence(pending.command);
  commandEvidence.push({
    id: pending.id,
    validator: pending.validator,
    executable: pending.executable,
    exitCode:
      intentional && processHandle.signalCode
        ? 0
        : (processHandle.exitCode ?? 1),
    durationMs: Math.max(
      0,
      Math.round(performance.now() - pending.monotonicStarted),
    ),
    logPath: pending.logPath,
    logSha256: sha256(logBytes),
    safeArgs: pending.args,
    cwd: pending.cwd,
    startedAt: pending.startedAt,
    completedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    envKeys: pending.envKeys,
    executableIdentity: identity.path,
    executableSha256: identity.digest,
    toolVersion: pending.toolVersion,
    ...pending.binding,
    expectedStop: intentional,
    signal: processHandle.signalCode ?? undefined,
  });
  spawnedEvidence.delete(processHandle);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function safeError(error: unknown): string {
  return redactDiagnostic(
    error instanceof Error ? error.message : 'Unknown validation error.',
  );
}

function writeSyntheticAlertRule(
  path: string,
  severity?: 'page' | 'ticket',
): void {
  const pageValue = severity === 'page' ? 1 : 0;
  const ticketValue = severity === 'ticket' ? 1 : 0;
  writeFileSync(
    path,
    `groups:\n  - name: hsk-media-validation\n    rules:\n      - alert: HskMediaValidationSyntheticPage\n        expr: vector(${pageValue}) > 0\n        for: 0s\n        labels:\n          severity: page\n          owner: platform-sre\n        annotations:\n          summary: synthetic validation only\n      - alert: HskMediaValidationSyntheticTicket\n        expr: vector(${ticketValue}) > 0\n        for: 0s\n        labels:\n          severity: ticket\n          owner: platform-sre\n        annotations:\n          summary: synthetic validation only\n`,
    { mode: 0o600 },
  );
}

function incrementSyntheticCounters(source: string, increment: number): string {
  return source.replace(
    /^([a-z_:][a-z0-9_:]*(?:\{[^}]*\})?\s+)(-?\d+(?:\.\d+)?)$/gimu,
    (line, prefix: string, rawValue: string) => {
      const metric = prefix.trim().split('{', 1)[0];
      if (!/(?:_total|_sum|_count|_bucket)$/u.test(metric)) return line;
      return `${prefix}${Number(rawValue) + increment}`;
    },
  );
}

async function postEmpty(port: number, path: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Lifecycle POST returned ${response.status}.`);
  } catch (error: unknown) {
    throw new Error(
      `Lifecycle POST ${path} failed (${error instanceof Error ? error.name : 'unknown error'}).`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function removeVerifiedTemporaryRoot(cleanupRoot: string): void {
  assertSafeTemporaryCleanupRoot(cleanupRoot);
  rmSync(cleanupRoot, { recursive: true, force: true });
}

void main().catch((error: unknown) => {
  const reason = safeError(error);
  console.error(`FAIL_INTERNAL: bootstrap - ${reason}`);
  try {
    mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
    invalidateEvidenceSummaries(evidenceRoot, repositoryRoot);
    const bootstrap: ValidatorResult = {
      id: 'bootstrap',
      status: 'FAIL_INTERNAL',
      durationMs: 0,
      reason,
    };
    writeFileSync(
      join(evidenceRoot, 'media-operations-validation.json'),
      `${JSON.stringify({ schemaVersion: 2, exitCode: 1, results: [bootstrap], commands: [] }, null, 2)}\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      join(evidenceRoot, 'media-operations-validation.junit.xml'),
      renderValidatorJUnit([bootstrap]),
      { mode: 0o600 },
    );
  } catch {
    // The console failure remains authoritative when even evidence publication fails.
  }
  process.exitCode = 1;
});
