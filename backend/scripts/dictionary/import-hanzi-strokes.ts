import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  importHanziStrokes,
  parseHanziGraphics,
} from '../../src/modules/dictionary-data/hanzi-strokes';

/**
 * Q357: nạp nét chữ Make Me a Hanzi vào `Character`.
 *   DATABASE_URL=... npm run dictionary:import:strokes -- \
 *     --file content/hanzi/makemeahanzi/graphics-hsk1.jsonl
 */
async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--file');
  const file = index >= 0 ? args[index + 1] : undefined;
  if (!file) {
    console.error('Cần --file <graphics.jsonl>');
    process.exit(2);
  }
  const rows = parseHanziGraphics(readFileSync(resolve(file), 'utf8'));
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await importHanziStrokes(prisma, rows)));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
