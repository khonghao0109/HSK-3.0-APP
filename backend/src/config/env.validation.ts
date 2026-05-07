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

  JWT_EXPIRES_IN: Joi.string().default('7d'),
});
