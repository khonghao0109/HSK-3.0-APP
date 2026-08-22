import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseToolchainManifest } from '../../../scripts/test/media-operations-validation.helpers';

describe('media operations artifacts', () => {
  it('redacts signed queries and prevents shared caching in the proxy contract', () => {
    const config = read('ops/nginx/media-security.conf');
    const httpConfig = read('ops/nginx/media-security-http.conf');
    const logFormat = httpConfig.match(
      /log_format hsk_media_redacted[\s\S]*?;/u,
    )?.[0];
    expect(logFormat).toBeDefined();
    expect(httpConfig).toContain('$request_method $uri $server_protocol');
    expect(logFormat).not.toContain('$request_uri');
    expect(logFormat).not.toContain('$args');
    expect(logFormat).not.toContain('$is_args');
    expect(logFormat).not.toContain('$query_string');
    expect(config).toContain('proxy_cache off');
    expect(config).toContain('proxy_no_cache 1');
    expect(config).toContain('private, no-store');
    expect(config).toContain(
      'location ~* "^/api(?:;[^/]*)?/+v1(?:;[^/]*)?/+internal',
    );
    expect(config).toContain('location ~* "^/metrics(?:/|;|$)"');
    expect(config).toContain('return 404');
    expect(httpConfig).toContain(
      'map "$request_method:$request_uri" $hsk_media_signed_request_canonical',
    );
    expect(httpConfig).toContain('~^GET:/api/v1/media/[1-9][0-9]*/content');
    expect(config).toContain('if ($hsk_media_signed_request_canonical = 0)');
    expect(config).toContain('Strict-Transport-Security');
    expect(config).toContain('$request_id');
    expect(config).not.toContain('error_log /dev/null');
    expect(config).toMatch(
      /error_log\s+\/var\/log\/nginx\/media_error\.log\s+emerg;/u,
    );
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
      'HskMediaReplicaTargetUnderMinimum',
      'HskMediaMetricsDatabaseUnavailable',
      'HskMediaMetricsSnapshotStale',
      'HskMediaIngestionFastBurn',
      'HskMediaIngestionSlowBurn',
      'HskMediaSignedContentFastBurn',
      'HskMediaSignedContentSlowBurn',
      'HskMediaProcessingLatency',
    ]) {
      expect(alerts).toContain(`alert: ${alert}`);
    }
    expect(alerts).not.toMatch(/mediaId|storageKey|filename|signature|email/u);
  });

  it('discovers any ready backend replica on the dedicated private metrics port', () => {
    const prometheus = read('ops/observability/media-prometheus.yml');
    expect(prometheus).toContain('dns_sd_configs:');
    expect(prometheus).toContain(
      'hsk-backend-media-metrics.hsk.svc.cluster.local',
    );
    expect(prometheus).toContain('port: 9464');
    expect(prometheus).toContain('metrics_path: /metrics');
    expect(prometheus).toContain('credentials_file:');
    expect(prometheus).not.toMatch(/backend-media-[0-9]/u);
    const privateNetwork = read(
      'ops/observability/media-metrics-private-network.yml',
    );
    const backendPatch = read(
      'ops/observability/media-backend-deployment.patch.yml',
    );
    expect(privateNetwork).toContain('clusterIP: None');
    expect(privateNetwork).toContain('kind: NetworkPolicy');
    expect(privateNetwork).toContain('kubernetes.io/metadata.name: hsk-edge');
    expect(privateNetwork).toContain('app.kubernetes.io/name: hsk-nginx');
    expect(privateNetwork).toContain('kubernetes.io/metadata.name: monitoring');
    expect(privateNetwork).toContain('app.kubernetes.io/name: prometheus');
    expect(privateNetwork).toContain('port: 9464');
    expect(privateNetwork).toContain('kind: ServiceAccount');
    expect(privateNetwork).not.toContain('kind: Role\n');
    expect(privateNetwork).not.toContain('kind: RoleBinding\n');
    expect(privateNetwork).toContain('kind: PeerAuthentication');
    expect(privateNetwork).toContain('mode: STRICT');
    expect(privateNetwork).toContain('kind: AuthorizationPolicy');
    expect(privateNetwork).toContain('projected:');
    expect(privateNetwork).toContain('@sha256:');
    expect(backendPatch).toContain('containerPort: 9464');
    expect(backendPatch).toContain('name: MEDIA_METRICS_BEARER_TOKEN');
    expect(backendPatch).toContain('name: MEDIA_METRICS_BEARER_TOKEN_PREVIOUS');
    expect(backendPatch).toContain('secretKeyRef:');
    expect(backendPatch).not.toContain('startupProbe:');
    expect(backendPatch).not.toContain('readinessProbe:');
    const runbook = read('docs/operations/MEDIA_INGESTION_RELEASE_RUNBOOK.md');
    const stageNew = runbook.indexOf('current=OLD`; stage `previous=NEW');
    const swap = runbook.indexOf('current=NEW`, `previous=OLD');
    const removePrevious = runbook.indexOf('Remove `previous`');
    expect(stageNew).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(stageNew);
    expect(removePrevious).toBeGreaterThan(swap);
    expect(privateNetwork).toContain('key: current');
    expect(privateNetwork).not.toContain('key: previous');
  });

  it('pins each operational validator release artifact by SHA-256', () => {
    const manifest = parseToolchainManifest(
      JSON.parse(read('ops/observability/media-toolchain.json')),
    );
    expect(Object.keys(manifest.tools)).toEqual(
      expect.arrayContaining([
        'nginx',
        'istioctl',
        'prometheus',
        'promtool',
        'alertmanager',
        'amtool',
        'grafana',
        'kubectl',
        'kubeconform',
      ]),
    );
    for (const tool of Object.values(manifest.tools)) {
      expect(tool.version).toMatch(/^\d+\.\d+(?:\.\d+)?$/u);
      expect(tool.platforms).toHaveLength(2);
      for (const artifact of tool.platforms) {
        if ('artifact' in artifact) {
          expect(artifact.artifact).toMatch(/^https:\/\//u);
          expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
        } else {
          expect(artifact.ociDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
        }
      }
    }
    expect(Object.keys(manifest.images)).toEqual([
      'alertmanager',
      'grafana',
      'prometheus',
    ]);
    for (const image of Object.values(manifest.images)) {
      expect(image.platforms).toHaveLength(1);
      expect(image.platforms[0]).toMatchObject({
        os: 'linux',
        architecture: 'x64',
      });
      expect(image.platforms[0]?.runtimeRef).toBe(
        `${image.repository}@${image.platforms[0]?.digest}`,
      );
      expect(image.attestations.signature.required).toBe(true);
      expect(image.attestations.sbom.required).toBe(true);
    }
  });

  it('ships an isolated, hardened, 28-day-capable observability topology', () => {
    const topology = read(
      'ops/observability/media-metrics-private-network.yml',
    );
    expect(topology).toContain('--storage.tsdb.retention.time=32d');
    expect(topology).toContain('storage: 50Gi');
    expect(topology).toContain('name: hsk-media-prometheus-private');
    expect(topology).toContain('policyTypes: [Ingress, Egress]');
    expect(topology).toContain('name: hsk-media-prometheus-principal');
    expect(topology).toContain('name: hsk-media-prometheus-strict-mtls');
    expect(topology).toContain('name: hsk-media-grafana');
    expect(topology).toContain('name: hsk-media-grafana-private');
    expect(topology).toContain('name: hsk-media-grafana-principal');
    expect(topology).toContain('name: hsk-media-grafana-strict-mtls');
    expect(topology).toContain('name: hsk-media-grafana-admin');
    expect(topology).toContain('name: GF_SECURITY_ADMIN_PASSWORD');
    expect(topology).toContain('subPath: provider.yml');
    expect(topology).toContain('app.kubernetes.io/name: hsk-media-operator');
    expect(topology).not.toContain('hsk-operations-access-proxy');
    expect(topology).not.toContain('/d/*');
    expect(topology).not.toContain('/login');
    const provider = read(
      'ops/observability/media-grafana-dashboard-provider.yml',
    );
    expect(provider).toContain('type: file');
    expect(provider).toContain('path: /var/lib/grafana/dashboards');
    expect(topology).toContain('automountServiceAccountToken: false');
    expect(topology).toContain('allowPrivilegeEscalation: false');
    expect(topology).toContain('readOnlyRootFilesystem: true');
    expect(topology).toContain('seccompProfile:');
    expect(topology).toContain('type: RuntimeDefault');
  });

  it('ships a parseable dashboard covering all release signals', () => {
    const dashboard = JSON.parse(
      read('ops/observability/media-dashboard.json'),
    ) as {
      panels: Array<{
        title: string;
        gridPos: { x: number; y: number; w: number; h: number };
        datasource: { uid: string };
        targets: Array<{ refId: string; expr: string }>;
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
        '28d ingestion availability',
        '28d signed-content availability',
        'Inflight and terminal deficit',
        'Process restarts',
      ]),
    );
    for (const panel of dashboard.panels) {
      expect(panel.datasource.uid).toBe('hsk-media-prometheus');
      expect(panel.gridPos.w).toBeGreaterThan(0);
      expect(panel.gridPos.h).toBeGreaterThan(0);
      expect(new Set(panel.targets.map(({ refId }) => refId)).size).toBe(
        panel.targets.length,
      );
      expect(panel.targets.every(({ expr }) => expr.length > 0)).toBe(true);
    }
    const allRefIds = dashboard.panels.flatMap((panel) =>
      panel.targets.map(({ refId }) => refId),
    );
    expect(new Set(allRefIds).size).toBe(allRefIds.length);
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
