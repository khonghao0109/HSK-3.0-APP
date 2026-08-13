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
    metricsBearerToken:
      process.env.MEDIA_METRICS_BEARER_TOKEN ??
      (process.env.NODE_ENV === 'test'
        ? 'test-media-metrics-token-at-least-32-chars'
        : undefined),
  },
});
