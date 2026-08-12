export default () => ({
  media: {
    bucket: process.env.MEDIA_STORAGE_BUCKET,
    region: process.env.MEDIA_STORAGE_REGION,
    endpoint: process.env.MEDIA_STORAGE_ENDPOINT,
    signingSecret: process.env.MEDIA_SIGNING_SECRET,
    accessTtlSeconds: Number(process.env.MEDIA_ACCESS_TTL_SECONDS ?? '300'),
    scannerHost: process.env.MEDIA_SCANNER_HOST,
    scannerPort: Number(process.env.MEDIA_SCANNER_PORT ?? '3310'),
  },
});
