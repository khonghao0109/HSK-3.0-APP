import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import {
  assertEveryAlertRunbookUrl,
  requireCredentialFreeHttpsRunbookUrl,
} from '../test/media-operations-validation.helpers';

const repositoryRoot = resolve(process.cwd(), '..');
const runbook = validatedRunbook(process.env.MEDIA_RUNBOOK_URL);
const requireModule = createRequire(__filename);
const yaml = requireModule('js-yaml') as {
  loadAll(source: string): unknown[];
};
const outputRoot = resolve(
  process.env.MEDIA_OBSERVABILITY_RENDER_DIR ??
    resolve(
      repositoryRoot,
      'backend/test-results/media-observability-rendered',
    ),
);
if (existsSync(outputRoot)) {
  const info = lstatSync(outputRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('Rendered observability root must be a real directory.');
  }
  if (readdirSync(outputRoot).length > 0) {
    throw new Error('Rendered observability root must be empty.');
  }
} else {
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
}
chmodSync(outputRoot, 0o700);

for (const relativePath of [
  'ops/observability/media-alerts.yml',
  'ops/observability/media-alerts.test.yml',
  'ops/observability/media-dashboard.json',
]) {
  const input = readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
  if (!input.includes('__MEDIA_RUNBOOK_URL__')) {
    throw new Error(`${relativePath} has no runbook deployment marker.`);
  }
  const rendered = input.split('__MEDIA_RUNBOOK_URL__').join(runbook);
  if (rendered.includes('__MEDIA_RUNBOOK_URL__')) {
    throw new Error(`${relativePath} still contains an unresolved marker.`);
  }
  if (relativePath.endsWith('/media-alerts.yml')) {
    assertEveryAlertRunbookUrl(yaml.loadAll(rendered), runbook);
  }
  const output = resolve(
    outputRoot,
    relativePath.replace('ops/observability/', ''),
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, rendered, { mode: 0o600 });
  console.log(output);
}

for (const filename of [
  'kustomization.yaml',
  'media-alertmanager.yml',
  'media-backend-deployment.patch.yml',
  'media-exporter.sample.prom',
  'media-grafana-datasource.yml',
  'media-grafana-dashboard-provider.yml',
  'media-metrics-private-network.yml',
  'media-prometheus.yml',
]) {
  const source = resolve(repositoryRoot, 'ops/observability', filename);
  const output = resolve(outputRoot, filename);
  copyFileSync(source, output);
  console.log(output);
}

function validatedRunbook(value: string | undefined): string {
  if (!value) throw new Error('MEDIA_RUNBOOK_URL is required.');
  return requireCredentialFreeHttpsRunbookUrl(value);
}
