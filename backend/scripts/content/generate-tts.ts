import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  azureProvider,
  runTts,
  TtsError,
  type TtsManifest,
  type TtsProvider,
} from '../../src/modules/content-tts/tts-manifest';

/**
 * Sinh audio offline từ manifest đã duyệt (Q348).
 *
 *   npm run content:tts -- --manifest content/hsk1/audio/slice-01.json [--dry-run]
 *     [--out ~/hsk-media/hsk1-slice/audio] [--checksums content/hsk1/audio/checksums.json]
 *
 * Key/region đọc từ AZURE_SPEECH_KEY, AZURE_SPEECH_REGION; không in ra, không ghi file.
 */
function arg(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const manifestPath = arg(args, '--manifest');
  if (manifestPath === undefined) {
    throw new TtsError('Thiếu --manifest <file>');
  }
  const dryRun = args.includes('--dry-run');
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as TtsManifest;
  const outputDir = resolve(
    arg(args, '--out') ?? join(homedir(), 'hsk-media/hsk1-slice/audio'),
  );
  const checksumsPath = resolve(
    arg(args, '--checksums') ??
      join(resolve(manifestPath, '..'), 'checksums.json'),
  );
  let provider: TtsProvider = {
    name: 'dry-run',
    synthesize: () =>
      Promise.reject(new TtsError('dry-run không gọi provider')),
  };
  if (!dryRun) {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region) {
      throw new TtsError(
        'Thiếu AZURE_SPEECH_KEY / AZURE_SPEECH_REGION trong environment',
      );
    }
    provider = azureProvider(key, region);
  }
  console.log(
    `manifest=${manifestPath} out=${outputDir} dry-run=${dryRun ? 'yes' : 'no'}`,
  );
  const result = await runTts(manifest, provider, {
    outputDir,
    checksumsPath,
    dryRun,
    now: () => new Date(),
    log: (line) => console.log(line),
  });
  console.log(
    `generated=${result.generated.length} skipped=${result.skipped.length} planned=${result.planned.length}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `FAIL: ${error.message}` : error);
  process.exitCode = 1;
});
