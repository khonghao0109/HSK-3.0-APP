import './document-environment';

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../src/app.module';
import { createOpenApiDocument } from '../../src/common/openapi/openapi-document';
import { API_GLOBAL_PREFIX } from '../../src/config/app.config';

/**
 * Writes `backend/openapi.json`, or with `--check` fails when the committed
 * file differs from the code. Run it through `npm run openapi:generate` or
 * `npm run openapi:check`: property schemas come from the @nestjs/swagger CLI
 * plugin, which only runs in `nest build`, so this must be the compiled file.
 */

const OUTPUT_PATH = resolve(process.cwd(), 'openapi.json');

async function renderDocument(): Promise<string> {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
    abortOnError: false,
  });
  try {
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
    return `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`;
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  if (!__filename.endsWith('.js')) {
    console.error('Run the compiled script (npm run openapi:generate).');
    process.exitCode = 1;
    return;
  }
  const rendered = await renderDocument();
  if (!process.argv.includes('--check')) {
    writeFileSync(OUTPUT_PATH, rendered);
    console.log(`OpenAPI document written to ${OUTPUT_PATH}`);
    return;
  }
  let committed = '';
  try {
    committed = readFileSync(OUTPUT_PATH, 'utf8');
  } catch {
    // A missing file is reported as out of date below.
  }
  if (committed !== rendered) {
    console.error(
      'openapi.json is out of date. Run `npm run openapi:generate` in backend/ and commit the result.',
    );
    process.exitCode = 1;
    return;
  }
  console.log('OpenAPI document is up to date.');
}

main().catch((error: unknown) => {
  // Like handleBootstrapFailure: a config validation error can carry the
  // environment (local .env included), so only its class is printed.
  const name = error instanceof Error ? error.constructor.name : 'value';
  console.error(`OpenAPI generation failed (${name}).`);
  process.exitCode = 1;
});
