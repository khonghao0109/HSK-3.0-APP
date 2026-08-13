import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('media operations artifacts', () => {
  it('redacts signed queries and prevents shared caching in the proxy contract', () => {
    const config = read('ops/nginx/media-security.conf');
    expect(config).toContain('$request_method $uri $server_protocol');
    expect(config).not.toContain('$request_uri');
    expect(config).not.toContain('$args');
    expect(config).not.toContain('$is_args');
    expect(config).not.toContain('$query_string');
    expect(config).toContain('proxy_cache off');
    expect(config).toContain('proxy_no_cache 1');
    expect(config).toContain('private, no-store');
    expect(config).toContain('error_log /dev/null crit');
  });

  it('defines every required bounded-cardinality release alert', () => {
    const alerts = read('ops/observability/media-alerts.yml');
    for (const alert of [
      'HskMediaCleanupBacklog',
      'HskMediaProcessingStuck',
      'HskMediaScannerUnavailable',
      'HskMediaStorageErrorSpike',
      'HskMediaCoherenceViolation',
    ]) {
      expect(alerts).toContain(`alert: ${alert}`);
    }
    expect(alerts).not.toMatch(/mediaId|storageKey|filename|signature|email/u);
  });

  it('ships a parseable dashboard covering all release signals', () => {
    const dashboard = JSON.parse(
      read('ops/observability/media-dashboard.json'),
    ) as { panels: Array<{ title: string }> };
    expect(dashboard.panels.map((panel) => panel.title)).toEqual(
      expect.arrayContaining([
        'Ingestion outcomes',
        'Scanner outcomes and latency',
        'Storage operations and latency',
        'Cleanup backlog / oldest age',
        'Stuck processing / oldest age',
        'Signed access and reconciliation',
      ]),
    );
  });
});

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), '..', relativePath), 'utf8');
}
