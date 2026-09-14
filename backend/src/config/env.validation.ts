import * as Joi from 'joi';

import {
  assertProductionSecrets,
  DEFAULT_NON_PRODUCTION_ORIGINS,
  normalizeAllowedOrigins,
} from './runtime-security';

function allowedOrigins(environment: 'development' | 'production') {
  return Joi.string().custom((value: unknown, helpers: Joi.CustomHelpers) => {
    if (typeof value !== 'string') return helpers.error('any.invalid');
    try {
      return normalizeAllowedOrigins(value, environment).join(',');
    } catch {
      return helpers.error('any.invalid');
    }
  });
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().default(3000),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(1),

  DATABASE_URL: Joi.string().required(),

  JWT_SECRETS: Joi.string().required(),
  JWT_ACTIVE_KID: Joi.string().required(),
  AUTH_PASSWORD_PEPPER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().min(16).optional(),
  }),
  ALLOWED_ORIGINS: Joi.when('NODE_ENV', {
    is: 'production',
    then: allowedOrigins('production').required(),
    otherwise: allowedOrigins('development').default(
      DEFAULT_NON_PRODUCTION_ORIGINS,
    ),
  }),

  MEDIA_STORAGE_BUCKET: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string().optional(),
    otherwise: Joi.string().min(3).max(63).required(),
  }),
  MEDIA_STORAGE_REGION: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string().optional(),
    otherwise: Joi.string().required(),
  }),
  MEDIA_STORAGE_ENDPOINT: Joi.string()
    .uri({ scheme: ['https'] })
    .optional(),
  MEDIA_SIGNING_SECRET: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string()
      .min(32)
      .default('test-media-signing-secret-at-least-32-characters'),
    otherwise: Joi.string().min(32).required(),
  }),
  MEDIA_ACCESS_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(600)
    .default(300),
  MEDIA_SCANNER_HOST: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string().optional(),
    otherwise: Joi.string().hostname().required(),
  }),
  MEDIA_SCANNER_PORT: Joi.number().integer().min(1).max(65535).default(3310),
  MEDIA_INGESTION_ENABLED: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.boolean().default(true),
    otherwise: Joi.boolean().default(false),
  }),
  MEDIA_UPLOAD_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(120000)
    .default(30000),
  MEDIA_METRICS_BEARER_TOKEN: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string()
      .min(32)
      .default('test-media-metrics-token-at-least-32-chars'),
    otherwise: Joi.string().min(32).required(),
  }),
  MEDIA_METRICS_BEARER_TOKEN_PREVIOUS: Joi.string().min(32).optional(),
  MEDIA_METRICS_HOST: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .ip({ version: ['ipv4', 'ipv6'] })
      .required(),
    otherwise: Joi.string()
      .ip({ version: ['ipv4', 'ipv6'] })
      .default('127.0.0.1'),
  }),
  MEDIA_METRICS_PORT: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.number().integer().min(1).max(65535).required(),
    otherwise: Joi.number().integer().min(0).max(65535).default(9464),
  }),
  MEDIA_METRICS_DB_STATEMENT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(50)
    .max(4000)
    .default(750),
  MEDIA_METRICS_COLLECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(10)
    .max(4500)
    .default(1000),
  MEDIA_METRICS_CACHE_TTL_MS: Joi.number()
    .integer()
    .min(0)
    .max(60000)
    .default(5000),
  MEDIA_METRICS_STALE_TTL_MS: Joi.number()
    .integer()
    .min(1000)
    .max(300000)
    .default(60000),

  JWT_EXPIRES_IN: Joi.string().default('7d'),
}).custom((environment: unknown, helpers: Joi.CustomHelpers) => {
  if (!isEnvironmentRecord(environment)) return helpers.error('any.invalid');
  if (environment.MEDIA_METRICS_PORT === environment.PORT) {
    return helpers.error('any.invalid');
  }
  if (
    Number(environment.MEDIA_METRICS_DB_STATEMENT_TIMEOUT_MS) >=
    Number(environment.MEDIA_METRICS_COLLECTION_TIMEOUT_MS)
  ) {
    return helpers.error('any.invalid');
  }
  if (
    Number(environment.MEDIA_METRICS_CACHE_TTL_MS) >=
    Number(environment.MEDIA_METRICS_STALE_TTL_MS)
  ) {
    return helpers.error('any.invalid');
  }
  if (environment.NODE_ENV !== 'production') return environment;
  try {
    assertProductionSecrets(environment);
    return environment;
  } catch {
    return helpers.error('any.invalid');
  }
});

function isEnvironmentRecord(
  value: unknown,
): value is Record<string, string | undefined> {
  return typeof value === 'object' && value !== null;
}
