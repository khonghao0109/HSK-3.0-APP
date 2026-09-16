// Imported first by generate-openapi.ts, before app.module loads and
// ConfigModule.forRoot validates the environment.
//
// Routes and schemas do not depend on configuration. Fixed placeholder values
// make the output identical on every machine; preview mode constructs no
// provider, so nothing ever connects to them.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://openapi@127.0.0.1:5432/openapi_unused',
  JWT_SECRETS: '{"openapi":"placeholder-openapi-generation-only"}',
  JWT_ACTIVE_KID: 'openapi',
  MEDIA_STORAGE_PROVIDER: 'memory',
  MEDIA_SCANNER_PROVIDER: 'test',
  MEDIA_SIGNING_SECRET: 'placeholder-openapi-generation-only',
  MEDIA_METRICS_BEARER_TOKEN: 'placeholder-openapi-generation-only',
});
