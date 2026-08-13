import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  formatSecretFinding,
  formatSecretScanError,
  scanGitSecretFiles,
  type SecretScanAllowlist,
} from './secret-scan';

const repositoryRoot = resolve(process.cwd(), '..');
try {
  const allowlist = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, 'backend/secret-scan.allowlist.json'),
      'utf8',
    ),
  ) as SecretScanAllowlist;
  const findings = scanGitSecretFiles(repositoryRoot, allowlist);

  if (findings.length > 0) {
    console.error(`Secret scan: FAIL (${findings.length} finding(s)).`);
    for (const finding of findings) console.error(formatSecretFinding(finding));
    process.exitCode = 1;
  } else {
    console.log('Secret scan: PASS (no high-confidence findings).');
  }
} catch (error: unknown) {
  console.error(formatSecretScanError(error));
  process.exitCode = 1;
}
