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
    const { prisma } = databaseFixture([
      {
        cleanupCount: 2n,
        stuckCount: 1n,
        cleanupOldestAgeSeconds: 301,
        processingOldestAgeSeconds: 901,
      },
    ]);
    const metrics = new MediaObservabilityService(prisma as never);
    metrics.recordIngestion('success', 230);
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
    expect(output).toContain(
      'hsk_media_processing_duration_seconds_bucket{outcome="success",le="0.25"} 1',
    );
    expect(output).toContain('hsk_media_metrics_database_available 1');
    expect(output).not.toMatch(/mediaId|storageKey|filename|signature|@/u);
  });

  it('uses immutable lifecycle timestamps in one bounded aggregate query', async () => {
    const { prisma, tx } = databaseFixture([
      {
        cleanupCount: 2n,
        stuckCount: 1n,
        cleanupOldestAgeSeconds: 301,
        processingOldestAgeSeconds: 901,
      },
    ]);
    const metrics = new MediaObservabilityService(prisma as never);

    const output = await metrics.render();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const timeoutQuery = tx.$queryRaw.mock.calls[0]?.[0] as { sql?: string };
    expect(timeoutQuery.sql).toContain("set_config('statement_timeout'");
    const query = tx.$queryRaw.mock.calls[1]?.[0] as { sql?: string };
    expect(query.sql).toContain('"cleanupRequiredAt"');
    expect(query.sql).toContain('"processingStartedAt"');
    expect(query.sql).toContain("status IN ('cleanup_required', 'processing')");
    expect(query.sql).not.toContain('MIN("updatedAt")');
    expect(output).toContain('hsk_media_cleanup_required 2');
    expect(output).toContain('hsk_media_stuck_processing 1');
  });

  it('single-flights concurrent scrapes instead of consuming one pool slot each', async () => {
    const pending = deferred<unknown[]>();
    const { prisma } = databaseFixture(pending.promise);
    const metrics = new MediaObservabilityService(prisma as never);

    const scrapes = Array.from({ length: 20 }, () => metrics.render());
    await Promise.resolve();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    pending.resolve([emptyDatabaseState()]);
    await expect(Promise.all(scrapes)).resolves.toHaveLength(20);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('serves the fresh cache without acquiring another database connection', async () => {
    const { prisma } = databaseFixture([emptyDatabaseState()]);
    const metrics = new MediaObservabilityService(prisma as never);

    await metrics.render();
    const cached = await metrics.render();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(cached).toContain('hsk_media_metrics_database_available 1');
    expect(cached).toContain('hsk_media_metrics_database_snapshot_stale 0');
  });

  it('reports an unavailable database snapshot and one error outcome without a cache', async () => {
    const { prisma, tx } = databaseFixture([]);
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ set_config: '750ms' }])
      .mockRejectedValueOnce(new Error('synthetic database failure'));
    const metrics = new MediaObservabilityService(prisma as never);

    const output = await metrics.render();

    expect(output).toContain('hsk_media_metrics_database_available 0');
    expect(output).toContain('hsk_media_metrics_database_snapshot_stale 0');
    expect(output).toContain(
      'hsk_media_metrics_database_collection_total{outcome="error"} 1',
    );
    expect(output).not.toMatch(/^hsk_media_cleanup_required /mu);
    expect(output).not.toMatch(/^hsk_media_stuck_processing /mu);
    expect(output).not.toMatch(/^hsk_media_cleanup_oldest_age_seconds /mu);
    expect(output).not.toMatch(/^hsk_media_processing_oldest_age_seconds /mu);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('serves bounded stale data after a collection timeout without accumulating queries', async () => {
    const first = databaseFixture([emptyDatabaseState()]);
    const config = {
      get: jest.fn((key: string) =>
        key === 'media.metricsCollectionTimeoutMs'
          ? 10
          : key === 'media.metricsCacheTtlMs'
            ? 0
            : key === 'media.metricsStaleTtlMs'
              ? 60_000
              : undefined,
      ),
    };
    const metrics = new MediaObservabilityService(
      first.prisma as never,
      config as never,
    );
    await metrics.render();

    const never = deferred<unknown[]>();
    first.tx.$queryRaw.mockReturnValueOnce(never.promise);
    const [one, two] = await Promise.all([metrics.render(), metrics.render()]);

    expect(first.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(one).toContain('hsk_media_metrics_database_available 0');
    expect(one).toContain('hsk_media_metrics_database_snapshot_stale 1');
    expect(two).toContain('hsk_media_metrics_database_available 0');
    expect(one).toContain(
      'hsk_media_metrics_database_collection_total{outcome="timeout"} 1',
    );
    never.resolve([emptyDatabaseState()]);
    await Promise.resolve();
    await Promise.resolve();
    const internal = metrics as unknown as { value(key: string): number };
    expect(internal.value('database:success')).toBe(1);
    expect(internal.value('database:timeout')).toBe(1);
  });

  it('exports a terminal-only processing histogram and explicit ingestion denominator', async () => {
    const { prisma } = databaseFixture([emptyDatabaseState()]);
    const metrics = new MediaObservabilityService(prisma as never);
    metrics.recordIngestion('request');
    metrics.recordIngestion('success', 501);
    metrics.recordIngestion('failed', 12_000);

    const output = await metrics.render();

    expect(output).toContain('hsk_media_ingestion_started_total 1');
    expect(output).toContain(
      'hsk_media_ingestion_requests_total{outcome="success"} 1',
    );
    expect(output).not.toContain(
      'hsk_media_processing_duration_seconds_bucket{outcome="request"',
    );
    expect(output).toContain(
      'hsk_media_processing_duration_seconds_bucket{outcome="success",le="1"} 1',
    );
    expect(output).toContain(
      'hsk_media_processing_duration_seconds_bucket{outcome="failed",le="10"} 0',
    );
    expect(output).toContain(
      'hsk_media_processing_duration_seconds_bucket{outcome="failed",le="30"} 1',
    );
  });

  it('keeps counters replica-local so Prometheus can aggregate direct targets', async () => {
    const { prisma: replicaDatabase } = databaseFixture([emptyDatabaseState()]);
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

function emptyDatabaseState() {
  return {
    cleanupCount: 0n,
    stuckCount: 0n,
    cleanupOldestAgeSeconds: 0,
    processingOldestAgeSeconds: 0,
  };
}

function databaseFixture(result: unknown[] | Promise<unknown[]>) {
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ set_config: '750ms' }])
      .mockImplementation(() => Promise.resolve(result)),
  };
  const prisma = {
    $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
      operation(tx),
    ),
  };
  return { prisma, tx };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}
