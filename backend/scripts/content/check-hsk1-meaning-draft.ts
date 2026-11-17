import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  loadHsk1Lexicon,
  type MeaningBatch,
  validateMeaningBatch,
} from '../../src/modules/content-hsk1/meaning-batch';

/**
 * Kiểm một file nháp `{ lesson, words: [{hanzi, pinyin}], properNames, entries }`
 * bằng đúng luật của lô (bỏ phần dataSource/review). Dùng khi soạn.
 *   npx ts-node scripts/content/check-hsk1-meaning-draft.ts <draft.json>
 */
const draft = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8')) as {
  words: { hanzi: string; pinyin: string }[];
  properNames?: MeaningBatch['properNames'];
  entries: MeaningBatch['entries'];
};
const batch: MeaningBatch = {
  schemaVersion: 1,
  batchId: 'hsk1-vi-99',
  lessons: [],
  dataSource: {
    code: 'HSK30_VI_HSK1_B99',
    name: 'x',
    version: '1',
    license: 'x',
    attribution: 'x',
    notes: 'x',
  },
  review: {
    status: 'pending',
    reviewer: null,
    reviewedAt: null,
    contentSha256: null,
    notes: [],
  },
  properNames: draft.properNames ?? [],
  entries: draft.entries,
};
const issues = validateMeaningBatch(
  batch,
  loadHsk1Lexicon(resolve(__dirname, '../..')),
);
const expected = new Set(draft.words.map((w) => `${w.hanzi} ${w.pinyin}`));
const got = new Set(draft.entries.map((e) => `${e.hanzi} ${e.pinyin}`));
for (const w of expected)
  if (!got.has(w)) issues.push({ code: 'entry_missing', path: '', message: w });
for (const w of got)
  if (!expected.has(w))
    issues.push({ code: 'entry_extra', path: '', message: w });
for (const issue of issues)
  console.log(`${issue.code} ${issue.path} ${issue.message}`);
console.log(`${issues.length} lỗi`);
process.exitCode = issues.length ? 1 : 0;
