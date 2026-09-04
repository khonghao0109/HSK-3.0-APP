import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';

type CosignPlatform = {
  os: 'darwin' | 'linux';
  architecture: 'arm64' | 'x64';
  artifact: string;
  sha256: string;
};

void test('verifies a real Cosign v3 bundle and rejects tampered bytes or the wrong key', () => {
  const backendRoot = process.cwd();
  const manifest = JSON.parse(
    readFileSync(
      resolve(backendRoot, '../ops/observability/media-toolchain.json'),
      'utf8',
    ),
  ) as {
    tools: {
      cosign: { version: string; platforms: CosignPlatform[] };
    };
  };
  const expected = manifest.tools.cosign.platforms.find(
    ({ os, architecture }) =>
      os === process.platform && architecture === process.arch,
  );
  assert.ok(expected, 'Pinned Cosign does not support the current platform.');
  const configuredBinary = process.env.MEDIA_OPS_COSIGN_BINARY;
  const configuredCache = process.env.MEDIA_OPS_TOOL_CACHE;
  const executable = configuredBinary
    ? resolve(configuredBinary)
    : configuredCache
      ? resolve(
          configuredCache,
          `${expected.sha256}-${basename(new URL(expected.artifact).pathname)}`,
        )
      : '';
  assert.ok(
    executable,
    'MEDIA_OPS_COSIGN_BINARY or MEDIA_OPS_TOOL_CACHE is required for the real Cosign integration gate.',
  );
  assert.equal(
    sha256(readFileSync(executable)),
    expected.sha256,
    'Cosign integration binary does not match the pinned artifact.',
  );
  chmodSync(executable, 0o700);
  const version = spawnSync(executable, ['version'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(version.status, 0);
  assert.match(
    `${version.stdout}\n${version.stderr}`,
    new RegExp(`GitVersion:\\s+v${manifest.tools.cosign.version}`, 'u'),
  );

  const fixtureRoot = resolve(__dirname, 'fixtures/cosign');
  const payload = join(fixtureRoot, 'media-evidence-payload.txt');
  const bundle = join(fixtureRoot, 'media-evidence.bundle.json');
  const publicKey = join(fixtureRoot, 'media-evidence-public.pem');
  const wrongPublicKey = join(fixtureRoot, 'media-evidence-wrong-public.pem');
  assert.equal(
    assertCompletedVerification(
      verify(executable, publicKey, bundle, payload),
      'Pinned Cosign fixture verification',
    ),
    0,
    'Pinned Cosign must verify the checked-in cryptographic fixture.',
  );

  const temporary = mkdtempSync(join(tmpdir(), 'hsk-media-cosign-fixture-'));
  try {
    const tampered = join(temporary, 'tampered-payload.txt');
    writeFileSync(tampered, `${readFileSync(payload, 'utf8')}tampered\n`, {
      mode: 0o600,
    });
    assertCompletedCryptographicRejection(
      verify(executable, publicKey, bundle, tampered),
      'Cosign must reject payload bytes not committed by the bundle.',
    );
    assertCompletedCryptographicRejection(
      verify(executable, wrongPublicKey, bundle, payload),
      'Cosign must reject a bundle under a different public key.',
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

function verify(
  executable: string,
  publicKey: string,
  bundle: string,
  payload: string,
) {
  return spawnSync(
    executable,
    [
      'verify-blob',
      '--key',
      publicKey,
      '--bundle',
      bundle,
      '--insecure-ignore-tlog',
      payload,
    ],
    {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function assertCompletedVerification(
  result: ReturnType<typeof verify>,
  label: string,
): number {
  assert.equal(result.error, undefined, `${label} failed to spawn.`);
  assert.equal(result.signal, null, `${label} terminated by signal.`);
  assert.equal(
    typeof result.status,
    'number',
    `${label} did not exit normally.`,
  );
  return result.status as number;
}

function assertCompletedCryptographicRejection(
  result: ReturnType<typeof verify>,
  label: string,
): void {
  const status = assertCompletedVerification(result, label);
  assert.notEqual(status, 0, label);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
