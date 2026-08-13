import { ServiceUnavailableException } from '@nestjs/common';

import {
  assertMediaIngestionEnabled,
  MediaObservabilityService,
} from './media-observability.service';

describe('media operations controls and metrics', () => {
  it('fails closed when the ingestion kill switch is disabled', () => {
    expect(() => assertMediaIngestionEnabled(false)).toThrow(
      ServiceUnavailableException,
    );
  });

  it('emits bounded Prometheus labels and never raw media identity', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          cleanupCount: 2n,
          stuckCount: 1n,
          cleanupOldestAgeSeconds: 301,
          processingOldestAgeSeconds: 901,
        },
      ]),
    };
    const metrics = new MediaObservabilityService(prisma as never);
    metrics.recordIngestion('success');
    metrics.recordStorage('put', 'success', 23);
    metrics.recordStorage('get', 'provider_mismatch', 0);
    metrics.recordScanner('unavailable', 12);
    metrics.recordSignedAccess('invalid_grant');

    const output = await metrics.render();

    expect(output).toContain('hsk_media_ingestion_total{outcome="success"} 1');
    expect(output).toContain(
      'hsk_media_storage_operations_total{operation="put",outcome="success"} 1',
    );
    expect(output).toContain('hsk_media_cleanup_required 2');
    expect(output).toContain('hsk_media_stuck_processing 1');
    expect(output).not.toMatch(/mediaId|storageKey|filename|signature|@/u);
  });

  it('uses one bounded database query per scrape', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          cleanupCount: 2n,
          stuckCount: 1n,
          cleanupOldestAgeSeconds: 301,
          processingOldestAgeSeconds: 901,
        },
      ]),
    };
    const metrics = new MediaObservabilityService(prisma as never);

    const output = await metrics.render();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(output).toContain('hsk_media_cleanup_required 2');
    expect(output).toContain('hsk_media_stuck_processing 1');
  });

  it('keeps counters replica-local so Prometheus can aggregate direct targets', async () => {
    const replicaDatabase = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          cleanupCount: 0n,
          stuckCount: 0n,
          cleanupOldestAgeSeconds: 0,
          processingOldestAgeSeconds: 0,
        },
      ]),
    };
    const first = new MediaObservabilityService(replicaDatabase as never);
    const second = new MediaObservabilityService(replicaDatabase as never);
    first.recordIngestion('success');
    second.recordIngestion('success');
    second.recordIngestion('success');

    const values = await Promise.all([first.render(), second.render()]);
    const total = values.reduce(
      (sum, value) =>
        sum +
        Number(
          /hsk_media_ingestion_total\{outcome="success"\} (\d+)/u.exec(
            value,
          )?.[1] ?? 0,
        ),
      0,
    );
    expect(total).toBe(3);

    const restarted = new MediaObservabilityService(replicaDatabase as never);
    await expect(restarted.render()).resolves.toContain(
      'hsk_media_ingestion_total{outcome="success"} 0',
    );
    await expect(second.render()).resolves.toContain(
      'hsk_media_ingestion_total{outcome="success"} 2',
    );
  });

  it('rejects unbounded labels instead of serializing them', () => {
    const metrics = new MediaObservabilityService({} as never);
    expect(() =>
      metrics.recordStorage('put', 'secret-object-key' as never, 1),
    ).toThrow('Unsupported media metric label');
  });
});
