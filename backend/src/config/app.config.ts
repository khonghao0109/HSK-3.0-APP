import {
  DEFAULT_NON_PRODUCTION_ORIGINS,
  normalizeAllowedOrigins,
} from './runtime-security';

export default () => ({
  app: {
    port: parseInt(process.env.PORT ?? '3000', 10),
    trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10),
    env: process.env.NODE_ENV ?? 'development',
    allowedOrigins: normalizeAllowedOrigins(
      process.env.ALLOWED_ORIGINS ?? DEFAULT_NON_PRODUCTION_ORIGINS,
      (process.env.NODE_ENV ?? 'development') as
        | 'development'
        | 'production'
        | 'test',
    ),
  },
});
