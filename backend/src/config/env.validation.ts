import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().required(),

  JWT_SECRETS: Joi.string().required(),
  JWT_ACTIVE_KID: Joi.string().required(),
  AUTH_PASSWORD_PEPPER: Joi.string().min(16).optional(),

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

  JWT_EXPIRES_IN: Joi.string().default('7d'),
});
