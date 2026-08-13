import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type ToolManifest = Record<string, { version: string; source: string }>;

const repositoryRoot = resolve(process.cwd(), '..');
const toolchain = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'ops/observability/media-toolchain.json'),
    'utf8',
  ),
) as ToolManifest;

async function main(): Promise<void> {
  const tools = [
    ['nginx', ['-v'], toolchain.nginx.version],
    ['promtool', ['--version'], toolchain.prometheus.version],
  ] as const;
  const missing: string[] = [];
  for (const [command, args, expectedVersion] of tools) {
    if (!validateToolVersion(command, args, expectedVersion))
      missing.push(command);
  }
  if (
    !validateToolVersion('grafana-server', ['-v'], toolchain.grafana.version) &&
    !validateToolVersion('grafana', ['server', '-v'], toolchain.grafana.version)
  ) {
    missing.push('grafana-server/grafana');
  }
  if (missing.length > 0) {
    console.error(
      `BLOCKED_EXTERNAL: missing operational validation tools: ${missing.join(', ')}.`,
    );
    process.exitCode = 2;
    return;
  }
  if (!hasDisposableGrafanaEnvironment()) {
    console.error(
      'BLOCKED_EXTERNAL: a loopback disposable Grafana URL/token and MEDIA_GRAFANA_DISPOSABLE=true are required.',
    );
    process.exitCode = 2;
    return;
  }

  await validateNginx();
  validatePrometheus();
  await validateGrafana();
  console.log('Media operational artifact validation: PASS.');
}

async function validateNginx(): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'hsk-media-nginx-'));
  const upstream = createServer((_request, response) => {
    response.statusCode = 503;
    response.end('synthetic upstream failure');
  });
  try {
    const upstreamPort = await listen(upstream);
    const proxyPort = await reservePort();
    const configPath = join(temporary, 'nginx.conf');
    const mediaLocationPath = join(temporary, 'media-security.conf');
    writeFileSync(
      mediaLocationPath,
      readFileSync(
        resolve(repositoryRoot, 'ops/nginx/media-security.conf'),
        'utf8',
      )
        .split('/var/log/nginx/media_access.log')
        .join(join(temporary, 'media_access.log')),
      { encoding: 'utf8', mode: 0o600 },
    );
    writeFileSync(
      configPath,
      `worker_processes 1;
pid ${join(temporary, 'nginx.pid')};
error_log ${join(temporary, 'error.log')} notice;
events { worker_connections 32; }
http {
  include ${resolve(repositoryRoot, 'ops/nginx/media-security-http.conf')};
  upstream hsk_backend { server 127.0.0.1:${upstreamPort}; }
  server {
    listen 127.0.0.1:${proxyPort};
    include ${mediaLocationPath};
    location / { return 404; }
  }
}`,
      { encoding: 'utf8', mode: 0o600 },
    );
    run('nginx', ['-t', '-c', configPath, '-p', `${temporary}/`]);
    const nginx = spawn('nginx', [
      '-c',
      configPath,
      '-p',
      `${temporary}/`,
      '-g',
      'daemon off;',
    ]);
    try {
      await waitForHttp(`http://127.0.0.1:${proxyPort}/health`);
      const signature = 'operational-secret-signature';
      const content = await fetch(
        `http://127.0.0.1:${proxyPort}/api/v1/media/1/content?expires=1&signature=${signature}`,
      );
      if (
        content.status !== 503 ||
        content.headers.get('cache-control') !== 'private, no-store' ||
        !content.headers.get('x-request-id')
      ) {
        throw new Error('Nginx signed-content route contract failed.');
      }
      const metrics = await fetch(
        `http://127.0.0.1:${proxyPort}/api/v1/internal/metrics/media`,
      );
      if (metrics.status !== 404) {
        throw new Error('Nginx public metrics deny contract failed.');
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      const accessLog = readFileSync(
        join(temporary, 'media_access.log'),
        'utf8',
      );
      if (
        accessLog.includes(signature) ||
        accessLog.includes('expires=') ||
        !accessLog.includes('/api/v1/media/1/content') ||
        !accessLog.includes('503')
      ) {
        throw new Error('Nginx redacted diagnostic log contract failed.');
      }
    } finally {
      nginx.kill('SIGTERM');
      if (nginx.exitCode === null) {
        await new Promise<void>((resolveExit) =>
          nginx.once('exit', () => resolveExit()),
        );
      }
    }
  } finally {
    await new Promise<void>((resolveClose) =>
      upstream.close(() => resolveClose()),
    );
    rmSync(temporary, { recursive: true, force: true });
  }
}

function validatePrometheus(): void {
  const directory = resolve(repositoryRoot, 'ops/observability');
  run('promtool', ['check', 'rules', 'media-alerts.yml'], directory);
  run('promtool', ['test', 'rules', 'media-alerts.test.yml'], directory);
}

async function validateGrafana(): Promise<void> {
  const url = process.env.MEDIA_GRAFANA_DISPOSABLE_URL!;
  const token = process.env.MEDIA_GRAFANA_DISPOSABLE_TOKEN!;
  const authorization = { Authorization: `Bearer ${token}` };
  const health = await fetch(new URL('/api/health', url), {
    headers: authorization,
  });
  const healthBody = (await health.json()) as { version?: string };
  if (!health.ok || healthBody.version !== toolchain.grafana.version) {
    throw new Error('Disposable Grafana version validation failed.');
  }
  const dashboard = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, 'ops/observability/media-dashboard.json'),
      'utf8',
    ),
  ) as { uid: string };
  const imported = await fetch(new URL('/api/dashboards/db', url), {
    method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dashboard, overwrite: false }),
  });
  if (!imported.ok) throw new Error('Disposable Grafana import failed.');
  let validationError: Error | undefined;
  try {
    const readBack = await fetch(
      new URL(`/api/dashboards/uid/${encodeURIComponent(dashboard.uid)}`, url),
      { headers: authorization },
    );
    if (!readBack.ok) throw new Error('Disposable Grafana read-back failed.');
  } catch (error: unknown) {
    validationError =
      error instanceof Error
        ? error
        : new Error('Disposable Grafana read-back failed.');
  }
  const removed = await fetch(
    new URL(`/api/dashboards/uid/${encodeURIComponent(dashboard.uid)}`, url),
    { method: 'DELETE', headers: authorization },
  );
  if (!removed.ok) throw new Error('Disposable Grafana cleanup failed.');
  if (validationError) throw validationError;
}

function validateToolVersion(
  command: string,
  args: readonly string[],
  expectedVersion: string,
): boolean {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (
    result.error &&
    'code' in result.error &&
    result.error.code === 'ENOENT'
  ) {
    return false;
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0 || !output.includes(expectedVersion)) {
    throw new Error(`${command} does not match the pinned toolchain version.`);
  }
  return true;
}

function run(command: string, args: string[], cwd = process.cwd()): void {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} validation failed.`);
  }
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Loopback listener did not expose a port.'));
        return;
      }
      resolvePort(address.port);
    });
  });
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

async function waitForHttp(url: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
  throw new Error('Nginx validation instance did not start.');
}

function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function hasDisposableGrafanaEnvironment(): boolean {
  const url = process.env.MEDIA_GRAFANA_DISPOSABLE_URL;
  return (
    process.env.MEDIA_GRAFANA_DISPOSABLE === 'true' &&
    typeof url === 'string' &&
    isLoopbackUrl(url) &&
    Boolean(process.env.MEDIA_GRAFANA_DISPOSABLE_TOKEN)
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Validation failed.');
  process.exitCode = 1;
});
