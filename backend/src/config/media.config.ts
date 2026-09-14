/** `memory` keeps objects in process memory and loses them on restart. */
export const MEDIA_STORAGE_PROVIDERS = ['s3', 'memory'] as const;
/** `test` recognizes only the EICAR signature; it is not a malware scanner. */
export const MEDIA_SCANNER_PROVIDERS = ['clamav', 'test'] as const;

export default () => ({
  media: {
    storageProvider: process.env.MEDIA_STORAGE_PROVIDER ?? 's3',
    scannerProvider: process.env.MEDIA_SCANNER_PROVIDER ?? 'clamav',
    bucket: process.env.MEDIA_STORAGE_BUCKET,
    region: process.env.MEDIA_STORAGE_REGION,
    endpoint: process.env.MEDIA_STORAGE_ENDPOINT,
    signingSecret: process.env.MEDIA_SIGNING_SECRET,
    accessTtlSeconds: Number(process.env.MEDIA_ACCESS_TTL_SECONDS ?? '300'),
    scannerHost: process.env.MEDIA_SCANNER_HOST,
    scannerPort: Number(process.env.MEDIA_SCANNER_PORT ?? '3310'),
    ingestionEnabled: process.env.MEDIA_INGESTION_ENABLED === 'true',
    uploadTimeoutMs: Number(process.env.MEDIA_UPLOAD_TIMEOUT_MS ?? '30000'),
    metricsBearerTokens: [
      process.env.MEDIA_METRICS_BEARER_TOKEN,
      process.env.MEDIA_METRICS_BEARER_TOKEN_PREVIOUS,
    ].filter((value): value is string => value !== undefined),
    metricsHost: process.env.MEDIA_METRICS_HOST ?? '127.0.0.1',
    metricsPort: Number(process.env.MEDIA_METRICS_PORT ?? '9464'),
    metricsDatabaseStatementTimeoutMs: Number(
      process.env.MEDIA_METRICS_DB_STATEMENT_TIMEOUT_MS ?? '750',
    ),
    metricsCollectionTimeoutMs: Number(
      process.env.MEDIA_METRICS_COLLECTION_TIMEOUT_MS ?? '1000',
    ),
    metricsCacheTtlMs: Number(process.env.MEDIA_METRICS_CACHE_TTL_MS ?? '5000'),
    metricsStaleTtlMs: Number(
      process.env.MEDIA_METRICS_STALE_TTL_MS ?? '60000',
    ),
  },
});
