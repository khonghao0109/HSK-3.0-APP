import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
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
import { basename, join, resolve } from 'node:path';

import {
  assertArchiveEntriesSafe,
  assertCommandEvidenceContract,
  assertExecutableFromVerifiedRoot,
  assertExtractedTreeSafe,
  assertExactMediaNetworkTopology,
  assertEveryAlertRunbookUrl,
  assertFunctionalEvidence,
  assertGrafanaNoDataResult,
  assertGrafanaQueryResult,
  assertGzipArchive,
  inspectTarGzipFile,
  invalidateEvidenceSummaries,
  resetMediaOperationsEvidenceLogs,
  resolveMediaOperationsEvidenceRoot,
  assertPrometheusRuntimeAlertRunbookUrl,
  requireCredentialFreeHttpsRunbookUrl,
  assertSafeTemporaryCleanupRoot,
  assertReleaseContentStable,
  assertReleaseHeadStable,
  classifyValidators,
  computeReleaseContentDigest,
  parseExactVersion,
  parseToolchainManifest,
  redactDiagnostic,
  renderValidatorJUnit,
  requireExactVersion,
  runProcess,
  selectArtifact,
  verifySha256,
} from './media-operations-validation.helpers';
import type {
  ShaArtifact,
  ToolDefinition,
  ToolchainManifest,
  ValidatorResult,
  CommandEvidence,
} from './media-operations-validation.helpers';

const repositoryRoot = resolve(process.cwd(), '..');
const defaultEvidenceRoot = join(
  repositoryRoot,
  'backend/test-results/media-operations',
);
let evidenceRoot = defaultEvidenceRoot;
const toolCache = process.env.MEDIA_OPS_TOOL_CACHE;
const allowDownload = process.env.MEDIA_OPS_ALLOW_DOWNLOAD === 'true';
const requireModule = createRequire(__filename);
const yaml = requireModule('js-yaml') as {
  loadAll(source: string): unknown[];
};
const commandEvidence: CommandEvidence[] = [];
let activeValidator = 'bootstrap';
let commandSequence = 0;
const spawnedEvidence = new WeakMap<
  ReturnType<typeof spawn>,
  {
    id: string;
    validator: string;
    executable: string;
    started: number;
    logPath: string;
  }
>();

class ExternalBlock extends Error {}

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
  const initialReleaseContent = computeReleaseContentDigest(
    repositoryRoot,
    beforeStatus.stdout,
  );
  const manifest = loadManifest();
  const validators: Array<{
    id: string;
    run: () => Promise<Omit<ValidatorResult, 'id' | 'durationMs'>>;
  }> = [
    {
      id: 'manifest-and-version-probes',
      run: () => validateToolchain(manifest),
    },
    { id: 'nginx-edge-routing', run: () => validateNginx(manifest) },
    {
      id: 'prometheus-rules-and-exposition',
      run: () => validatePrometheus(manifest),
    },
    { id: 'alertmanager-routing', run: () => validateAlertmanager(manifest) },
    {
      id: 'kubernetes-core-schema',
      run: () => validateKubernetesSchema(manifest),
    },
    {
      id: 'kubernetes-topology-and-mtls',
      run: () => validateKubernetesTopology(manifest),
    },
    { id: 'grafana-disposable-runtime', run: () => validateGrafana(manifest) },
    { id: 'production-runbook-url', run: validateRunbookUrl },
  ];
  const results: ValidatorResult[] = [];
  for (const validator of validators) {
    activeValidator = validator.id;
    const start = Date.now();
    const firstCommand = commandEvidence.length;
    try {
      const result = await validator.run();
      results.push({
        id: validator.id,
        durationMs: Date.now() - start,
        ...result,
        commandIds: commandEvidence.slice(firstCommand).map(({ id }) => id),
      });
    } catch (error: unknown) {
      results.push({
        id: validator.id,
        durationMs: Date.now() - start,
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
  const evidence = {
    schemaVersion: 2,
    startedAt,
    completedAt: new Date().toISOString(),
    commit:
      commit.kind === 'success' && /^[a-f0-9]{40}$/u.test(commit.stdout.trim())
        ? commit.stdout.trim()
        : 'unavailable',
    platform: process.platform,
    architecture: process.arch,
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
    renderValidatorJUnit(classified.results),
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
      timeoutMs: 180_000,
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
    writeFileSync(
      locationPath,
      readFileSync(
        resolve(repositoryRoot, 'ops/nginx/media-security.conf'),
        'utf8',
      )
        .split('/var/log/nginx/media_access.log')
        .join(accessLogPath),
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
    const httpMatrixStarted = Date.now();
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
        timeoutMs: 30_000,
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
    const routingStarted = Date.now();
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
  try {
    kubectl = await acquireTool(manifest, 'kubectl');
    verifyToolVersion(kubectl);
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
    const syntheticBase =
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: hsk-backend\n  namespace: hsk\nspec:\n  selector:\n    matchLabels:\n      app.kubernetes.io/name: hsk-backend\n  template:\n    metadata:\n      labels:\n        app.kubernetes.io/name: hsk-backend\n    spec:\n      containers:\n        - name: backend\n          image: example.invalid/backend@sha256:' +
      '0'.repeat(64) +
      '\n          readinessProbe:\n            httpGet:\n              path: /api/v1/health\n              port: 3000\n';
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
    requireCommand(patchResult, 'kubectl local backend deployment patch');
    if (
      !patchResult.stdout.includes('readinessProbe:') ||
      !patchResult.stdout.includes('path: /api/v1/health') ||
      !patchResult.stdout.includes('startupProbe:') ||
      !patchResult.stdout.includes('name: media-metrics')
    ) {
      throw new Error(
        'Backend patch application degrades application readiness or misses metrics startup.',
      );
    }
    assertTopology(resources, patch);
    const istioResources = resources.filter((resource) =>
      String(resource.apiVersion).startsWith('security.istio.io/'),
    );
    if (istioResources.length !== 4) {
      throw new Error(
        'STRICT mTLS and identity authorization resources are incomplete.',
      );
    }
    return {
      status: 'PASS',
      commandIds: [
        'kubectl-local-strategic-backend-patch',
        'kubernetes-topology-semantic-contract',
      ],
      artifacts: [{ name: 'kubectl', digest: kubectl.digest }],
    };
  } finally {
    if (kubectl) removeVerifiedTemporaryRoot(kubectl.cleanupRoot);
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
          GF_AUTH_ANONYMOUS_ENABLED: 'true',
          GF_AUTH_ANONYMOUS_ORG_ROLE: 'Admin',
          GF_AUTH_DISABLE_LOGIN_FORM: 'true',
          GF_USERS_ALLOW_SIGN_UP: 'false',
          GF_ANALYTICS_REPORTING_ENABLED: 'false',
          GF_ANALYTICS_CHECK_FOR_UPDATES: 'false',
          GF_PLUGINS_PREINSTALL_DISABLED: 'true',
        },
      },
    );
    await waitForStatus(grafanaPort, '/api/health', 200);
    const grafanaApiStarted = Date.now();
    const datasourceUid = 'hsk-media-prometheus-validation';
    const created = await grafanaJson(grafanaPort, '/api/datasources', 'POST', {
      name: 'HSK Media Prometheus Validation',
      uid: datasourceUid,
      type: 'prometheus',
      access: 'proxy',
      url: `http://127.0.0.1:${prometheusPort}`,
      isDefault: false,
      jsonData: { httpMethod: 'GET', prometheusType: 'Prometheus' },
    });
    datasourceId = numberProperty(created, 'id');
    const health = await grafanaJson(
      grafanaPort,
      `/api/datasources/uid/${datasourceUid}/health`,
      'GET',
    );
    if (!['OK', 'success'].includes(String(health.status))) {
      throw new Error('Grafana Prometheus datasource health check failed.');
    }
    const sourceDashboard = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, 'ops/observability/media-dashboard.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const dashboard = JSON.parse(
      JSON.stringify(sourceDashboard)
        .split('${DS_PROMETHEUS}')
        .join(datasourceUid)
        .split('__MEDIA_RUNBOOK_URL__')
        .join(runbookUrl),
    ) as Record<string, unknown>;
    dashboard.uid = dashboardUid;
    await grafanaJson(grafanaPort, '/api/dashboards/db', 'POST', {
      dashboard,
      overwrite: false,
    });
    const readBack = await grafanaJson(
      grafanaPort,
      `/api/dashboards/uid/${dashboardUid}`,
      'GET',
    );
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
    if (!Array.isArray(dashboard.panels) || dashboard.panels.length === 0) {
      throw new Error('Grafana dashboard must define at least one panel.');
    }
    const panels = dashboard.panels;
    let expectedTargetCount = 0;
    let executedTargetCount = 0;
    for (const panel of panels) {
      if (
        !isRecord(panel) ||
        !Array.isArray(panel.targets) ||
        panel.targets.length === 0
      ) {
        throw new Error('Every Grafana panel must define non-empty targets.');
      }
      expectedTargetCount += panel.targets.length;
      for (const target of panel.targets) {
        if (!isRecord(target)) {
          throw new Error('Grafana panel target must be an object.');
        }
        const refId = typeof target.refId === 'string' ? target.refId : '';
        const expr = typeof target.expr === 'string' ? target.expr : '';
        if (!refId || !expr) {
          throw new Error('Grafana panel target lacks a string refId or expr.');
        }
        const query = await grafanaJson(grafanaPort, '/api/ds/query', 'POST', {
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
        });
        const result = isRecord(query.results)
          ? query.results[refId]
          : undefined;
        assertGrafanaQueryResult(result, refId);
        executedTargetCount += 1;
      }
    }
    if (
      expectedTargetCount === 0 ||
      executedTargetCount !== expectedTargetCount
    ) {
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

async function validateRunbookUrl(): Promise<
  Omit<ValidatorResult, 'id' | 'durationMs'>
> {
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const reachabilityStarted = Date.now();
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
  const cached = toolCache ? join(toolCache, filename) : undefined;
  if (cached && existsSync(cached)) {
    if (statSync(cached).size > 512 * 1024 * 1024)
      throw new Error(`${name} cached artifact exceeds the 512 MiB limit.`);
    return readFileSync(cached);
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
  const filename = basename(new URL(artifact.artifact).pathname);
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
): void {
  assertExactMediaNetworkTopology(resources);
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
  const network = resource(
    'NetworkPolicy',
    'hsk-backend-media-metrics-private',
  );
  const metricsService = resource('Service', 'hsk-backend-media-metrics');
  resource('ServiceAccount', 'hsk-media-prometheus');
  resource('Role', 'hsk-media-prometheus-discovery');
  resource('RoleBinding', 'hsk-media-prometheus-discovery');
  resource('PeerAuthentication', 'hsk-backend-media-metrics-strict-mtls');
  resource('PeerAuthentication', 'hsk-media-alertmanager-strict-mtls');
  resource('AuthorizationPolicy', 'hsk-backend-media-metrics-principal');
  resource('AuthorizationPolicy', 'hsk-media-alertmanager-principal');
  resource('NetworkPolicy', 'hsk-media-alertmanager-private');
  resource('PersistentVolumeClaim', 'hsk-media-prometheus-data');
  resource('PersistentVolumeClaim', 'hsk-media-alertmanager-data');
  if (
    nestedValue(prometheus, ['spec', 'replicas']) !== 1 ||
    nestedValue(alertmanager, ['spec', 'replicas']) !== 1
  ) {
    throw new Error(
      'Monitoring V1 must be single replica until HA clustering is configured.',
    );
  }
  if (
    nestedString(prometheus, ['spec', 'strategy', 'type']) !== 'Recreate' ||
    nestedString(alertmanager, ['spec', 'strategy', 'type']) !== 'Recreate'
  ) {
    throw new Error(
      'Single-replica RWO monitoring workloads require Recreate rollout.',
    );
  }
  for (const deployment of [prometheus, alertmanager]) {
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
    !JSON.stringify(alertmanager).includes('/alertmanager')
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
    'startupProbe',
  ]) {
    if (!serializedPatch.includes(expected))
      throw new Error(`Backend patch is missing ${expected}.`);
  }
  if (serializedPatch.includes('readinessProbe')) {
    throw new Error(
      'Metrics patch must preserve the externally owned application readiness probe.',
    );
  }
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
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
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
  const started = Date.now();
  const result = runProcess(command, args, options);
  const sequence = String(++commandSequence).padStart(3, '0');
  const executable = basename(command);
  const id = `${activeValidator}/${sequence}/${executable}`;
  const logDirectory = join(evidenceRoot, 'logs');
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const logPath = `logs/${sequence}-${activeValidator.replace(/[^a-z0-9-]/giu, '-')}-${executable.replace(/[^a-z0-9.-]/giu, '-')}.log`;
  writeFileSync(
    join(evidenceRoot, logPath),
    `${redactDiagnostic(output(result))}\n`,
    {
      mode: 0o600,
    },
  );
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
    durationMs: Date.now() - started,
    logPath,
  });
  return result;
}

function recordProbeEvidence(
  probeId: string,
  started: number,
  success: boolean,
  diagnostic: string,
): void {
  const sequence = String(++commandSequence).padStart(3, '0');
  const safeProbe = probeId.replace(/[^a-z0-9.-]/giu, '-');
  const logPath = `logs/${sequence}-${activeValidator}-${safeProbe}.log`;
  mkdirSync(join(evidenceRoot, 'logs'), { recursive: true, mode: 0o700 });
  writeFileSync(
    join(evidenceRoot, logPath),
    `${redactDiagnostic(diagnostic)}\n`,
    { mode: 0o600 },
  );
  commandEvidence.push({
    id: `${activeValidator}/${sequence}/${safeProbe}`,
    validator: activeValidator,
    executable: 'http-probe',
    exitCode: success ? 0 : 1,
    durationMs: Date.now() - started,
    logPath,
  });
}

function output(result: ReturnType<typeof runProcess>): string {
  return `${result.stdout}\n${result.stderr}`.trim();
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
): Promise<void> {
  await waitFor(
    async () => (await rawHttp(port, path, 'GET')).status === status,
    10_000,
  );
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
    started: Date.now(),
    logPath,
  });
  return processHandle;
}

function finalizeSpawnEvidence(
  processHandle: ReturnType<typeof spawn>,
  intentional: boolean,
): void {
  const pending = spawnedEvidence.get(processHandle);
  if (!pending) return;
  commandEvidence.push({
    id: pending.id,
    validator: pending.validator,
    executable: pending.executable,
    exitCode:
      intentional && processHandle.signalCode
        ? 0
        : (processHandle.exitCode ?? 1),
    durationMs: Date.now() - pending.started,
    logPath: pending.logPath,
    expectedStop: intentional,
    signal: processHandle.signalCode ?? undefined,
  });
  writeFileSync(
    join(evidenceRoot, pending.logPath),
    `Disposable runtime stopped with exit=${processHandle.exitCode ?? 'signal'}.\n`,
    { mode: 0o600 },
  );
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
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Lifecycle POST returned ${response.status}.`);
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
