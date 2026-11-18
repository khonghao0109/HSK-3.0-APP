import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  type BlueprintFile,
  type ExamSetLedger,
  type ExamSetSource,
  importBlueprints,
  importQuestionSets,
} from '../../src/modules/content-hsk1/exam-blueprint';

/**
 * Q357: nạp blueprint đề thi và (tuỳ chọn) bộ câu dùng chung của một đề mẫu.
 *   DATABASE_URL=... npm run content:import:blueprint -- \
 *     --file content/hsk1/exam/blueprint-hsk1.json \
 *     [--exam content/hsk1/exam/mock-01.json --ledger <ledger.json>]
 * Sổ (ledger) là sổ của `content:import:exam` cùng môi trường.
 */
const args = process.argv.slice(2);
const arg = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const read = <T>(path: string) =>
  JSON.parse(readFileSync(resolve(path), 'utf8')) as T;

async function main() {
  const file = arg('--file');
  if (!file) {
    console.error('Cần --file <blueprint.json>');
    process.exit(2);
  }
  const blueprints = read<BlueprintFile>(file);
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await importBlueprints(prisma, blueprints)));
    const exam = arg('--exam');
    const ledger = arg('--ledger');
    if (exam && ledger) {
      const level = blueprints.blueprints[0]?.level ?? 'HSK1';
      console.log(
        JSON.stringify(
          await importQuestionSets(prisma, {
            blueprints,
            exam: read<ExamSetSource>(exam),
            ledger: read<ExamSetLedger>(ledger),
            level,
          }),
        ),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
