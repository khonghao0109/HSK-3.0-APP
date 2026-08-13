import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const INGESTION_OUTCOMES = [
  'request',
  'success',
  'rejected',
  'failed',
  'cleanup_required',
] as const;
const SCANNER_OUTCOMES = [
  'success',
  'malware',
  'unavailable',
  'invalid_response',
] as const;
const STORAGE_OPERATIONS = ['put', 'get', 'head', 'delete'] as const;
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

type IngestionOutcome = (typeof INGESTION_OUTCOMES)[number];
type ScannerOutcome = (typeof SCANNER_OUTCOMES)[number];
type StorageOperation = (typeof STORAGE_OPERATIONS)[number];
type StorageOutcome = (typeof STORAGE_OUTCOMES)[number];
type SignedAccessOutcome = (typeof SIGNED_ACCESS_OUTCOMES)[number];

@Injectable()
export class MediaObservabilityService {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<
    string,
    { count: number; milliseconds: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  recordIngestion(outcome: IngestionOutcome, milliseconds?: number): void {
    assertAllowed(INGESTION_OUTCOMES, outcome);
    this.increment(`ingestion:${outcome}`);
    if (milliseconds !== undefined)
      this.observe(`processing:${outcome}`, milliseconds);
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
    const [state] = await this.prisma.$queryRaw<MediaDatabaseMetrics[]>(
      Prisma.sql`SELECT
        COUNT(*) FILTER (WHERE status = 'cleanup_required')::bigint AS "cleanupCount",
        COUNT(*) FILTER (
          WHERE status = 'processing'
            AND "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
        )::bigint AS "stuckCount",
        COALESCE(EXTRACT(EPOCH FROM (
          CURRENT_TIMESTAMP - MIN("updatedAt") FILTER (WHERE status = 'cleanup_required')
        )), 0)::double precision AS "cleanupOldestAgeSeconds",
        COALESCE(EXTRACT(EPOCH FROM (
          CURRENT_TIMESTAMP - MIN("updatedAt") FILTER (WHERE status = 'processing')
        )), 0)::double precision AS "processingOldestAgeSeconds"
      FROM "MediaIngestion"`,
    );
    const lines: string[] = [];
    for (const outcome of INGESTION_OUTCOMES) {
      lines.push(
        `hsk_media_ingestion_total{outcome="${outcome}"} ${this.value(`ingestion:${outcome}`)}`,
      );
    }
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
    for (const outcome of SIGNED_ACCESS_OUTCOMES) {
      lines.push(
        `hsk_media_signed_access_total{outcome="${outcome}"} ${this.value(`signed:${outcome}`)}`,
      );
    }
    for (const outcome of ['coherent', 'violation'] as const) {
      lines.push(
        `hsk_media_reconciliation_total{outcome="${outcome}"} ${this.value(`reconciliation:${outcome}`)}`,
      );
    }
    lines.push(`hsk_media_cleanup_required ${state?.cleanupCount ?? 0}`);
    lines.push(`hsk_media_stuck_processing ${state?.stuckCount ?? 0}`);
    lines.push(
      `hsk_media_cleanup_oldest_age_seconds ${boundedAge(state?.cleanupOldestAgeSeconds)}`,
    );
    lines.push(
      `hsk_media_processing_oldest_age_seconds ${boundedAge(state?.processingOldestAgeSeconds)}`,
    );
    for (const outcome of INGESTION_OUTCOMES) {
      appendDuration(
        lines,
        'hsk_media_processing_latency',
        { outcome },
        this.duration(`processing:${outcome}`),
      );
    }
    return `${lines.join('\n')}\n`;
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

  private value(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  private duration(key: string): { count: number; milliseconds: number } {
    return this.durations.get(key) ?? { count: 0, milliseconds: 0 };
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

function boundedAge(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}
