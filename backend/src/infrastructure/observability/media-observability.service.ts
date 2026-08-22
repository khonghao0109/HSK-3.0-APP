import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const INGESTION_OUTCOMES = [
  'request',
  'success',
  'rejected',
  'failed',
  'cleanup_required',
  'disabled',
] as const;
const SCANNER_OUTCOMES = [
  'success',
  'malware',
  'unavailable',
  'invalid_response',
] as const;
const STORAGE_OPERATIONS = ['put', 'get', 'head', 'delete', 'verify'] as const;
const STORAGE_OUTCOMES = [
  'success',
  'error',
  'not_found',
  'provider_mismatch',
  'malformed_response',
  'integrity_error',
] as const;
const SIGNED_ACCESS_OUTCOMES = [
  'success',
  'invalid_grant',
  'unavailable',
  'provider_mismatch',
  'integrity_error',
] as const;
const DATABASE_COLLECTION_OUTCOMES = ['success', 'error', 'timeout'] as const;
const TERMINAL_INGESTION_OUTCOMES = [
  'success',
  'rejected',
  'failed',
  'cleanup_required',
  'disabled',
] as const;
const PROCESSING_DURATION_OUTCOMES = [
  'success',
  'rejected',
  'failed',
  'cleanup_required',
] as const;
const PROCESSING_DURATION_BUCKETS_SECONDS = [
  0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60,
] as const;

export const MEDIA_METRICS_DB_STATEMENT_TIMEOUT_MS = 750;
export const MEDIA_METRICS_COLLECTION_TIMEOUT_MS = 1_000;
export const MEDIA_METRICS_CACHE_TTL_MS = 5_000;
export const MEDIA_METRICS_STALE_TTL_MS = 60_000;

type ScannerOutcome = (typeof SCANNER_OUTCOMES)[number];
type StorageOperation = (typeof STORAGE_OPERATIONS)[number];
type StorageOutcome = (typeof STORAGE_OUTCOMES)[number];
type SignedAccessOutcome = (typeof SIGNED_ACCESS_OUTCOMES)[number];
type TerminalIngestionOutcome = (typeof TERMINAL_INGESTION_OUTCOMES)[number];
type ProcessingDurationOutcome = (typeof PROCESSING_DURATION_OUTCOMES)[number];

export type MediaRequestObservation<T extends string> = {
  complete(outcome: T, milliseconds?: number): void;
};

@Injectable()
export class MediaObservabilityService {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<
    string,
    { count: number; milliseconds: number }
  >();
  private readonly processingHistograms = new Map<string, Histogram>();
  private readonly databaseStatementTimeoutMs: number;
  private readonly collectionTimeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly staleTtlMs: number;
  private readonly processStartTimeSeconds = Date.now() / 1_000;
  private ingestionInflight = 0;
  private signedContentInflight = 0;
  private databaseCache: DatabaseCache | undefined;
  private activeCollection: ActiveCollection | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() config?: ConfigService,
  ) {
    this.databaseStatementTimeoutMs = boundedConfig(
      config,
      'media.metricsDatabaseStatementTimeoutMs',
      MEDIA_METRICS_DB_STATEMENT_TIMEOUT_MS,
      50,
      4_000,
    );
    this.collectionTimeoutMs = boundedConfig(
      config,
      'media.metricsCollectionTimeoutMs',
      MEDIA_METRICS_COLLECTION_TIMEOUT_MS,
      10,
      4_500,
    );
    this.cacheTtlMs = boundedConfig(
      config,
      'media.metricsCacheTtlMs',
      MEDIA_METRICS_CACHE_TTL_MS,
      0,
      60_000,
    );
    this.staleTtlMs = boundedConfig(
      config,
      'media.metricsStaleTtlMs',
      MEDIA_METRICS_STALE_TTL_MS,
      1_000,
      300_000,
    );
  }

  beginIngestionRequest(): MediaRequestObservation<TerminalIngestionOutcome> {
    this.increment('ingestion:request');
    this.ingestionInflight += 1;
    return onceObservation((outcome, milliseconds) => {
      assertAllowed(TERMINAL_INGESTION_OUTCOMES, outcome);
      this.ingestionInflight = Math.max(0, this.ingestionInflight - 1);
      this.increment(`ingestion:${outcome}`);
      if (
        milliseconds !== undefined &&
        isAllowed(PROCESSING_DURATION_OUTCOMES, outcome)
      ) {
        this.observe(`processing:${outcome}`, milliseconds);
        this.observeProcessing(outcome, milliseconds);
      }
    });
  }

  beginSignedContentRequest(): MediaRequestObservation<SignedAccessOutcome> {
    this.increment('signed:started');
    this.signedContentInflight += 1;
    return onceObservation((outcome) => {
      assertAllowed(SIGNED_ACCESS_OUTCOMES, outcome);
      this.signedContentInflight = Math.max(0, this.signedContentInflight - 1);
      this.increment(`signed:terminal:${outcome}`);
    });
  }

  recordScanner(outcome: ScannerOutcome, milliseconds: number): void {
    assertAllowed(SCANNER_OUTCOMES, outcome);
    this.increment(`scanner:${outcome}`);
    this.observe(`scanner:${outcome}`, milliseconds);
  }

  recordStorage(
    operation: StorageOperation,
    outcome: StorageOutcome,
    milliseconds: number,
  ): void {
    assertAllowed(STORAGE_OPERATIONS, operation);
    assertAllowed(STORAGE_OUTCOMES, outcome);
    this.increment(`storage:${operation}:${outcome}`);
    this.observe(`storage:${operation}:${outcome}`, milliseconds);
  }

  recordSignedAccess(outcome: SignedAccessOutcome): void {
    assertAllowed(SIGNED_ACCESS_OUTCOMES, outcome);
    this.increment(`signed:${outcome}`);
  }

  recordReconciliation(outcome: 'coherent' | 'violation'): void {
    assertAllowed(['coherent', 'violation'] as const, outcome);
    this.increment(`reconciliation:${outcome}`);
  }

  async render(): Promise<string> {
    const database = await this.databaseSnapshot();
    const state = database.state;
    const lines: string[] = [];
    lines.push(
      '# HELP hsk_media_process_start_time_seconds Unix timestamp when this metrics process started.',
    );
    lines.push('# TYPE hsk_media_process_start_time_seconds gauge');
    lines.push(
      `hsk_media_process_start_time_seconds ${this.processStartTimeSeconds}`,
    );
    lines.push(
      '# HELP hsk_media_ingestion_started_total Eligible media ingestion requests entering the measured boundary.',
    );
    lines.push('# TYPE hsk_media_ingestion_started_total counter');
    lines.push(
      `hsk_media_ingestion_started_total ${this.value('ingestion:request')}`,
    );
    lines.push(
      '# HELP hsk_media_ingestion_inflight Media ingestion requests started but not terminal in this process.',
    );
    lines.push('# TYPE hsk_media_ingestion_inflight gauge');
    lines.push(`hsk_media_ingestion_inflight ${this.ingestionInflight}`);
    lines.push(
      '# HELP hsk_media_ingestion_requests_total Terminal media ingestion request outcomes.',
    );
    lines.push('# TYPE hsk_media_ingestion_requests_total counter');
    for (const outcome of TERMINAL_INGESTION_OUTCOMES) {
      lines.push(
        `hsk_media_ingestion_requests_total{outcome="${outcome}"} ${this.value(`ingestion:${outcome}`)}`,
      );
    }
    // Compatibility series retained for one release while rules migrate to the
    // unambiguous started/terminal counters above.
    lines.push(
      '# HELP hsk_media_ingestion_total Media ingestion lifecycle events retained for compatibility.',
    );
    lines.push('# TYPE hsk_media_ingestion_total counter');
    for (const outcome of INGESTION_OUTCOMES) {
      lines.push(
        `hsk_media_ingestion_total{outcome="${outcome}"} ${this.value(`ingestion:${outcome}`)}`,
      );
    }
    lines.push(
      '# HELP hsk_media_scanner_total Media malware scanner outcomes.',
    );
    lines.push('# TYPE hsk_media_scanner_total counter');
    lines.push(
      '# HELP hsk_media_scanner_latency_seconds Media malware scanner latency.',
    );
    lines.push('# TYPE hsk_media_scanner_latency_seconds summary');
    for (const outcome of SCANNER_OUTCOMES) {
      lines.push(
        `hsk_media_scanner_total{outcome="${outcome}"} ${this.value(`scanner:${outcome}`)}`,
      );
      appendDuration(
        lines,
        'hsk_media_scanner_latency',
        { outcome },
        this.duration(`scanner:${outcome}`),
      );
    }
    lines.push(
      '# HELP hsk_media_storage_operations_total Private object storage operation outcomes.',
    );
    lines.push('# TYPE hsk_media_storage_operations_total counter');
    lines.push(
      '# HELP hsk_media_storage_latency_seconds Private object storage operation latency.',
    );
    lines.push('# TYPE hsk_media_storage_latency_seconds summary');
    for (const operation of STORAGE_OPERATIONS) {
      for (const outcome of STORAGE_OUTCOMES) {
        const labels = { operation, outcome };
        const key = `storage:${operation}:${outcome}`;
        lines.push(
          `hsk_media_storage_operations_total${formatLabels(labels)} ${this.value(key)}`,
        );
        appendDuration(
          lines,
          'hsk_media_storage_latency',
          labels,
          this.duration(key),
        );
      }
    }
    lines.push(
      '# HELP hsk_media_signed_access_total Signed media content access outcomes.',
    );
    lines.push('# TYPE hsk_media_signed_access_total counter');
    for (const outcome of SIGNED_ACCESS_OUTCOMES) {
      lines.push(
        `hsk_media_signed_access_total{outcome="${outcome}"} ${this.value(`signed:${outcome}`)}`,
      );
    }
    lines.push(
      '# HELP hsk_media_signed_content_started_total Signed content requests entering the service boundary.',
    );
    lines.push('# TYPE hsk_media_signed_content_started_total counter');
    lines.push(
      `hsk_media_signed_content_started_total ${this.value('signed:started')}`,
    );
    lines.push(
      '# HELP hsk_media_signed_content_requests_total Terminal signed content request outcomes.',
    );
    lines.push('# TYPE hsk_media_signed_content_requests_total counter');
    for (const outcome of SIGNED_ACCESS_OUTCOMES) {
      lines.push(
        `hsk_media_signed_content_requests_total{outcome="${outcome}"} ${this.value(`signed:terminal:${outcome}`)}`,
      );
    }
    lines.push(
      '# HELP hsk_media_signed_content_inflight Signed content requests started but not terminal in this process.',
    );
    lines.push('# TYPE hsk_media_signed_content_inflight gauge');
    lines.push(
      `hsk_media_signed_content_inflight ${this.signedContentInflight}`,
    );
    lines.push(
      '# HELP hsk_media_reconciliation_total Media storage and database reconciliation outcomes.',
    );
    lines.push('# TYPE hsk_media_reconciliation_total counter');
    for (const outcome of ['coherent', 'violation'] as const) {
      lines.push(
        `hsk_media_reconciliation_total{outcome="${outcome}"} ${this.value(`reconciliation:${outcome}`)}`,
      );
    }
    lines.push(
      '# HELP hsk_media_cleanup_required Current media ingestion rows requiring object cleanup.',
    );
    lines.push('# TYPE hsk_media_cleanup_required gauge');
    lines.push(
      '# HELP hsk_media_stuck_processing Current media ingestion rows processing beyond the lifecycle threshold.',
    );
    lines.push('# TYPE hsk_media_stuck_processing gauge');
    lines.push(
      '# HELP hsk_media_cleanup_oldest_age_seconds Age of the oldest active cleanup lifecycle.',
    );
    lines.push('# TYPE hsk_media_cleanup_oldest_age_seconds gauge');
    lines.push(
      '# HELP hsk_media_processing_oldest_age_seconds Age of the oldest active processing attempt.',
    );
    lines.push('# TYPE hsk_media_processing_oldest_age_seconds gauge');
    if (state) {
      lines.push(`hsk_media_cleanup_required ${state.cleanupCount}`);
      lines.push(`hsk_media_stuck_processing ${state.stuckCount}`);
      lines.push(
        `hsk_media_cleanup_oldest_age_seconds ${boundedAge(state.cleanupOldestAgeSeconds)}`,
      );
      lines.push(
        `hsk_media_processing_oldest_age_seconds ${boundedAge(state.processingOldestAgeSeconds)}`,
      );
    }
    lines.push(
      '# HELP hsk_media_metrics_database_available Whether the latest database collection completed within budget.',
    );
    lines.push('# TYPE hsk_media_metrics_database_available gauge');
    lines.push(
      `hsk_media_metrics_database_available ${database.available ? 1 : 0}`,
    );
    lines.push(
      '# HELP hsk_media_metrics_database_snapshot_stale Whether database gauges came from the bounded stale cache.',
    );
    lines.push('# TYPE hsk_media_metrics_database_snapshot_stale gauge');
    lines.push(
      `hsk_media_metrics_database_snapshot_stale ${database.stale ? 1 : 0}`,
    );
    lines.push(
      '# HELP hsk_media_metrics_database_cache_age_seconds Age of the rendered database gauge snapshot.',
    );
    lines.push('# TYPE hsk_media_metrics_database_cache_age_seconds gauge');
    lines.push(
      `hsk_media_metrics_database_cache_age_seconds ${database.cacheAgeSeconds}`,
    );
    lines.push(
      '# HELP hsk_media_metrics_database_collection_total Database-backed metrics collection outcomes.',
    );
    lines.push('# TYPE hsk_media_metrics_database_collection_total counter');
    for (const outcome of DATABASE_COLLECTION_OUTCOMES) {
      lines.push(
        `hsk_media_metrics_database_collection_total{outcome="${outcome}"} ${this.value(`database:${outcome}`)}`,
      );
    }
    lines.push(
      '# HELP hsk_media_processing_duration_seconds End-to-end media ingestion processing duration by terminal outcome.',
    );
    lines.push('# TYPE hsk_media_processing_duration_seconds histogram');
    for (const outcome of PROCESSING_DURATION_OUTCOMES) {
      appendHistogram(
        lines,
        'hsk_media_processing_duration_seconds',
        { outcome },
        this.processingHistogram(outcome),
      );
    }
    return `${lines.join('\n')}\n`;
  }

  private async databaseSnapshot(): Promise<RenderedDatabaseSnapshot> {
    const now = Date.now();
    if (
      this.databaseCache &&
      now - this.databaseCache.collectedAtMs < this.cacheTtlMs
    ) {
      return renderedSnapshot(this.databaseCache, true, false, now);
    }

    const collection = this.activeCollection ?? this.startCollection();
    try {
      const state = await collection.promise;
      return renderedSnapshot(
        { state, collectedAtMs: Date.now() },
        true,
        false,
        Date.now(),
      );
    } catch {
      const cache = this.databaseCache;
      const fallbackNow = Date.now();
      if (cache && fallbackNow - cache.collectedAtMs <= this.staleTtlMs) {
        return renderedSnapshot(cache, false, true, fallbackNow);
      }
      return {
        state: undefined,
        available: false,
        stale: false,
        cacheAgeSeconds: 0,
      };
    }
  }

  private startCollection(): ActiveCollection {
    const databaseOperation = this.collectDatabaseMetrics();
    const collection: ActiveCollection = {
      promise: withTimeout(databaseOperation, this.collectionTimeoutMs),
      outcome: undefined,
    };
    this.activeCollection = collection;
    void collection.promise.then(
      (state) => {
        if (collection.outcome === undefined) {
          this.databaseCache = { state, collectedAtMs: Date.now() };
          this.recordCollectionOutcome(collection, 'success');
        }
        if (this.activeCollection === collection)
          this.activeCollection = undefined;
      },
      (error: unknown) => {
        this.recordCollectionOutcome(
          collection,
          error instanceof MetricsCollectionTimeoutError ? 'timeout' : 'error',
        );
        if (
          !(error instanceof MetricsCollectionTimeoutError) &&
          this.activeCollection === collection
        ) {
          this.activeCollection = undefined;
        }
      },
    );
    // A timed-out driver call may still be resolving underneath the shared
    // absolute deadline. Retain that failed collection until the underlying
    // operation settles so later scrapes cannot accumulate pool waiters or
    // reinterpret the same operation as successful.
    void databaseOperation.then(
      () => {
        if (this.activeCollection === collection)
          this.activeCollection = undefined;
      },
      () => {
        if (this.activeCollection === collection)
          this.activeCollection = undefined;
      },
    );
    return collection;
  }

  private collectDatabaseMetrics(): Promise<MediaDatabaseMetrics> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT set_config('statement_timeout', ${String(this.databaseStatementTimeoutMs)}, true)`,
        );
        const [state] = await tx.$queryRaw<MediaDatabaseMetrics[]>(
          Prisma.sql`SELECT
            COUNT(*) FILTER (
              WHERE "cleanupRequiredAt" IS NOT NULL
                AND status IN ('cleanup_required', 'processing')
            )::bigint AS "cleanupCount",
            COUNT(*) FILTER (
              WHERE status = 'processing'
                AND "processingStartedAt" IS NOT NULL
                AND "processingStartedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
            )::bigint AS "stuckCount",
            COALESCE(EXTRACT(EPOCH FROM (
              CURRENT_TIMESTAMP - MIN("cleanupRequiredAt")
                FILTER (WHERE "cleanupRequiredAt" IS NOT NULL AND status IN ('cleanup_required', 'processing'))
            )), 0)::double precision AS "cleanupOldestAgeSeconds",
            COALESCE(EXTRACT(EPOCH FROM (
              CURRENT_TIMESTAMP - MIN("processingStartedAt")
                FILTER (WHERE status = 'processing' AND "processingStartedAt" IS NOT NULL)
            )), 0)::double precision AS "processingOldestAgeSeconds"
          FROM "MediaIngestion"`,
        );
        return state ?? EMPTY_DATABASE_METRICS;
      },
      {
        maxWait: Math.min(250, this.databaseStatementTimeoutMs),
        timeout: this.databaseStatementTimeoutMs + 500,
      },
    );
  }

  private recordCollectionOutcome(
    collection: ActiveCollection,
    outcome: DatabaseCollectionOutcome,
  ): void {
    if (collection.outcome !== undefined) return;
    collection.outcome = outcome;
    this.increment(`database:${outcome}`);
  }

  private increment(key: string): void {
    this.counters.set(key, this.value(key) + 1);
  }

  private observe(key: string, milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    const current = this.duration(key);
    this.durations.set(key, {
      count: current.count + 1,
      milliseconds: current.milliseconds + milliseconds,
    });
  }

  private observeProcessing(
    outcome: ProcessingDurationOutcome,
    milliseconds: number,
  ) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    const histogram = this.processingHistogram(outcome);
    histogram.count += 1;
    histogram.milliseconds += milliseconds;
    for (let index = 0; index < histogram.buckets.length; index += 1) {
      if (milliseconds / 1_000 <= PROCESSING_DURATION_BUCKETS_SECONDS[index]) {
        histogram.buckets[index] += 1;
      }
    }
  }

  private value(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  private duration(key: string): { count: number; milliseconds: number } {
    return this.durations.get(key) ?? { count: 0, milliseconds: 0 };
  }

  private processingHistogram(outcome: ProcessingDurationOutcome): Histogram {
    const existing = this.processingHistograms.get(outcome);
    if (existing) return existing;
    const created = {
      count: 0,
      milliseconds: 0,
      buckets: PROCESSING_DURATION_BUCKETS_SECONDS.map(() => 0),
    };
    this.processingHistograms.set(outcome, created);
    return created;
  }
}

export function assertMediaIngestionEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_INGESTION_DISABLED',
      message: 'Media ingestion is temporarily disabled.',
    });
  }
}

function assertAllowed<T extends string>(
  allowed: readonly T[],
  value: string,
): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new Error('Unsupported media metric label.');
  }
}

function isAllowed<T extends string>(
  allowed: readonly T[],
  value: string,
): value is T {
  return allowed.includes(value as T);
}

function appendDuration(
  lines: string[],
  metric: string,
  labels: Record<string, string>,
  duration: { count: number; milliseconds: number },
): void {
  const serialized = formatLabels(labels);
  lines.push(
    `${metric}_seconds_sum${serialized} ${duration.milliseconds / 1000}`,
  );
  lines.push(`${metric}_seconds_count${serialized} ${duration.count}`);
}

function appendHistogram(
  lines: string[],
  metric: string,
  labels: Record<string, string>,
  histogram: Histogram,
): void {
  for (
    let index = 0;
    index < PROCESSING_DURATION_BUCKETS_SECONDS.length;
    index += 1
  ) {
    lines.push(
      `${metric}_bucket${formatLabels({ ...labels, le: String(PROCESSING_DURATION_BUCKETS_SECONDS[index]) })} ${histogram.buckets[index]}`,
    );
  }
  lines.push(
    `${metric}_bucket${formatLabels({ ...labels, le: '+Inf' })} ${histogram.count}`,
  );
  lines.push(
    `${metric}_sum${formatLabels(labels)} ${histogram.milliseconds / 1_000}`,
  );
  lines.push(`${metric}_count${formatLabels(labels)} ${histogram.count}`);
}

function formatLabels(labels: Record<string, string>): string {
  const values = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(',');
  return `{${values}}`;
}

type MediaDatabaseMetrics = {
  cleanupCount: bigint;
  stuckCount: bigint;
  cleanupOldestAgeSeconds: number;
  processingOldestAgeSeconds: number;
};

type DatabaseCollectionOutcome = (typeof DATABASE_COLLECTION_OUTCOMES)[number];

type Histogram = {
  buckets: number[];
  count: number;
  milliseconds: number;
};

type DatabaseCache = {
  state: MediaDatabaseMetrics;
  collectedAtMs: number;
};

type ActiveCollection = {
  promise: Promise<MediaDatabaseMetrics>;
  outcome: DatabaseCollectionOutcome | undefined;
};

type RenderedDatabaseSnapshot = {
  state: MediaDatabaseMetrics | undefined;
  available: boolean;
  stale: boolean;
  cacheAgeSeconds: number;
};

const EMPTY_DATABASE_METRICS: MediaDatabaseMetrics = {
  cleanupCount: 0n,
  stuckCount: 0n,
  cleanupOldestAgeSeconds: 0,
  processingOldestAgeSeconds: 0,
};

class MetricsCollectionTimeoutError extends Error {}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new MetricsCollectionTimeoutError()),
      timeoutMs,
    );
    timeout.unref();
    void operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(
          error instanceof Error
            ? error
            : new Error('Metrics collection failed.'),
        );
      },
    );
  });
}

function renderedSnapshot(
  cache: DatabaseCache,
  available: boolean,
  stale: boolean,
  now: number,
): RenderedDatabaseSnapshot {
  return {
    state: cache.state,
    available,
    stale,
    cacheAgeSeconds: Math.max(
      0,
      Math.floor((now - cache.collectedAtMs) / 1_000),
    ),
  };
}

function boundedConfig(
  config: ConfigService | undefined,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const configured = config?.get<number>(key);
  return typeof configured === 'number' &&
    Number.isInteger(configured) &&
    configured >= minimum &&
    configured <= maximum
    ? configured
    : fallback;
}

function boundedAge(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function onceObservation<T extends string>(
  settle: (outcome: T, milliseconds?: number) => void,
): MediaRequestObservation<T> {
  let completed = false;
  return {
    complete(outcome, milliseconds) {
      if (completed) return;
      completed = true;
      settle(outcome, milliseconds);
    },
  };
}
