import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('media operations artifacts', () => {
  it('redacts signed queries and prevents shared caching in the proxy contract', () => {
    const config = read('ops/nginx/media-security.conf');
    const httpConfig = read('ops/nginx/media-security-http.conf');
    expect(httpConfig).toContain('$request_method $uri $server_protocol');
    expect(`${httpConfig}\n${config}`).not.toContain('$request_uri');
    expect(`${httpConfig}\n${config}`).not.toContain('$args');
    expect(`${httpConfig}\n${config}`).not.toContain('$is_args');
    expect(`${httpConfig}\n${config}`).not.toContain('$query_string');
    expect(config).toContain('proxy_cache off');
    expect(config).toContain('proxy_no_cache 1');
    expect(config).toContain('private, no-store');
    expect(config).toContain('location = /api/v1/internal/metrics/media');
    expect(config).toContain('return 404');
    expect(config).toContain('Strict-Transport-Security');
    expect(config).toContain('$request_id');
  });

  it('defines every required bounded-cardinality release alert', () => {
    const alerts = read('ops/observability/media-alerts.yml');
    for (const alert of [
      'HskMediaCleanupBacklog',
      'HskMediaProcessingStuck',
      'HskMediaScannerUnavailable',
      'HskMediaStorageErrorSpike',
      'HskMediaCoherenceViolation',
      'HskMediaIntegrityViolation',
      'HskMediaScannerInvalidResponse',
      'HskMediaReplicaScrapeFailure',
    ]) {
      expect(alerts).toContain(`alert: ${alert}`);
    }
    expect(alerts).not.toMatch(/mediaId|storageKey|filename|signature|email/u);
  });

  it('scrapes two explicit backend replicas directly with secret-file auth', () => {
    const prometheus = read('ops/observability/media-prometheus.yml');
    expect(prometheus).toContain(
      'backend-media-0.hsk-backend-media-metrics.hsk.svc.cluster.local:3000',
    );
    expect(prometheus).toContain(
      'backend-media-1.hsk-backend-media-metrics.hsk.svc.cluster.local:3000',
    );
    expect(prometheus).toContain('credentials_file:');
    expect(prometheus).not.toMatch(/load.?balancer|hsk_backend/u);
    const privateNetwork = read(
      'ops/observability/media-metrics-private-network.yml',
    );
    expect(privateNetwork).toContain('clusterIP: None');
    expect(privateNetwork).toContain('kind: NetworkPolicy');
    expect(privateNetwork).toContain('kubernetes.io/metadata.name: hsk-edge');
    expect(privateNetwork).toContain('app.kubernetes.io/name: hsk-nginx');
    expect(privateNetwork).toContain('kubernetes.io/metadata.name: monitoring');
    expect(privateNetwork).toContain('app.kubernetes.io/name: prometheus');
  });

  it('pins each operational validator release artifact by SHA-256', () => {
    const manifest = JSON.parse(
      read('ops/observability/media-toolchain.json'),
    ) as Record<string, { version: string; artifact: string; sha256: string }>;
    expect(Object.keys(manifest)).toEqual(['nginx', 'prometheus', 'grafana']);
    for (const tool of Object.values(manifest)) {
      expect(tool.version).toMatch(/^\d+\.\d+\.\d+$/u);
      expect(tool.artifact).toMatch(/^https:\/\//u);
      expect(tool.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it('ships a parseable dashboard covering all release signals', () => {
    const dashboard = JSON.parse(
      read('ops/observability/media-dashboard.json'),
    ) as {
      panels: Array<{
        title: string;
        gridPos: { x: number; y: number; w: number; h: number };
        datasource: { uid: string };
      }>;
    };
    expect(dashboard.panels.map((panel) => panel.title)).toEqual(
      expect.arrayContaining([
        'Ingestion outcomes',
        'Scanner outcomes and latency',
        'Storage operations and latency',
        'Cleanup backlog / oldest age',
        'Stuck processing / oldest age',
        'Integrity and reconciliation',
      ]),
    );
    for (const panel of dashboard.panels) {
      expect(panel.datasource.uid).toBe('${DS_PROMETHEUS}');
      expect(panel.gridPos.w).toBeGreaterThan(0);
      expect(panel.gridPos.h).toBeGreaterThan(0);
    }
    for (const [index, panel] of dashboard.panels.entries()) {
      for (const candidate of dashboard.panels.slice(index + 1)) {
        expect(overlaps(panel.gridPos, candidate.gridPos)).toBe(false);
      }
    }
  });
});

function overlaps(
  left: { x: number; y: number; w: number; h: number },
  right: { x: number; y: number; w: number; h: number },
): boolean {
  return !(
    left.x + left.w <= right.x ||
    right.x + right.w <= left.x ||
    left.y + left.h <= right.y ||
    right.y + right.h <= left.y
  );
}

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), '..', relativePath), 'utf8');
}
