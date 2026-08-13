export default () => ({
  media: {
    bucket: process.env.MEDIA_STORAGE_BUCKET,
    region: process.env.MEDIA_STORAGE_REGION,
    endpoint: process.env.MEDIA_STORAGE_ENDPOINT,
    signingSecret: process.env.MEDIA_SIGNING_SECRET,
    accessTtlSeconds: Number(process.env.MEDIA_ACCESS_TTL_SECONDS ?? '300'),
    scannerHost: process.env.MEDIA_SCANNER_HOST,
    scannerPort: Number(process.env.MEDIA_SCANNER_PORT ?? '3310'),
    ingestionEnabled:
      process.env.MEDIA_INGESTION_ENABLED === undefined
        ? process.env.NODE_ENV === 'test'
        : process.env.MEDIA_INGESTION_ENABLED === 'true',
    metricsBearerTokens: [
      process.env.MEDIA_METRICS_BEARER_TOKEN ??
        (process.env.NODE_ENV === 'test'
          ? 'test-media-metrics-token-at-least-32-chars'
          : undefined),
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
