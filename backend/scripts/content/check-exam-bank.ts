import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { BlueprintFile } from '../../src/modules/content-hsk1/exam-blueprint';
import {
  type BankFile,
  validateBankFiles,
} from '../../src/modules/content-hsk1/exam-bank';
import { loadHsk1Lexicon } from '../../src/modules/content-hsk1/meaning-batch';

/**
 * Q357: kiểm mọi file câu hỏi thi HSK1 (`content/hsk1/exam/mock-*.json`, `bank-*.json`).
 *   npm run content:check:exam
 */
const root = resolve(__dirname, '../..');
const dir = join(root, 'content/hsk1/exam');
const read = <T>(name: string) =>
  JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
const names = readdirSync(dir)
  .filter((name) => /^(mock|bank)-[a-z0-9-]+\.json$/u.test(name))
  .filter((name) => !name.endsWith('-links.json'))
  .sort();
const issues = validateBankFiles(
  names.map((path) => ({ path, file: read<BankFile>(path) })),
  read<BlueprintFile>('blueprint-hsk1.json'),
  loadHsk1Lexicon(root).syllables,
);
for (const name of names) {
  const file = read<BankFile>(name);
  const count = file.sections.reduce(
    (n, s) => n + s.parts.reduce((m, p) => m + p.questions.length, 0),
    0,
  );
  console.log(`${name}: ${count} câu`);
}
for (const issue of issues)
  console.log(`  ${issue.code} ${issue.path} ${issue.message}`);
console.log(`lỗi=${issues.length}`);
process.exitCode = issues.length > 0 ? 1 : 0;
