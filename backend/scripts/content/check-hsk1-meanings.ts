import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  batchExampleKeys,
  loadHsk1Lexicon,
  type MeaningBatch,
  meaningBatchContentSha256,
  validateMeaningBatch,
} from '../../src/modules/content-hsk1/meaning-batch';

/**
 * Kiểm mọi lô `content/hsk1/meanings/batch-*.json`, in hash nội dung cho người duyệt.
 *   npm run content:check:meanings
 */
const root = resolve(__dirname, '../..');
const dir = join(root, 'content/hsk1/meanings');
const lexicon = loadHsk1Lexicon(root);
const seen = new Set<string>();
let failed = 0;
for (const name of readdirSync(dir)
  .filter((f) => /^batch-\d{2}\.json$/u.test(f))
  .sort()) {
  const batch = JSON.parse(
    readFileSync(join(dir, name), 'utf8'),
  ) as MeaningBatch;
  const issues = validateMeaningBatch(batch, lexicon, seen);
  for (const key of batchExampleKeys(batch)) seen.add(key);
  const examples = batch.entries.reduce((n, e) => n + e.examples.length, 0);
  console.log(
    `${name}: ${batch.entries.length} từ, ${examples} câu ví dụ, review=${batch.review.status}, contentSha256=${meaningBatchContentSha256(batch)}, lỗi=${issues.length}`,
  );
  for (const issue of issues)
    console.log(`  ${issue.code} ${issue.path} ${issue.message}`);
  failed += issues.length;
}
process.exitCode = failed > 0 ? 1 : 0;
