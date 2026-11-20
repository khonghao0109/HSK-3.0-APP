import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  splitIntegrityIssues,
  splitPilotLesson,
} from '../../src/modules/content-pilot/split-pilot-units';

/**
 * Chia topic Từ vựng / Ngữ pháp của mọi `content/pilot/hsk1/lesson-NN.json`
 * thành đơn vị học (Pha F). Idempotent; dừng, không ghi file nào, nếu một bài
 * không qua kiểm toàn vẹn. `--check` chỉ kiểm, không ghi.
 */
const dir = join(__dirname, '../../content/pilot/hsk1');
const checkOnly = process.argv.includes('--check');
const files = readdirSync(dir)
  .filter((name) => /^lesson-\d{2}\.json$/u.test(name))
  .sort();

const outputs: { file: string; text: string; changed: boolean }[] = [];
let failed = false;
for (const file of files) {
  const text = readFileSync(join(dir, file), 'utf8');
  const before = JSON.parse(text) as Record<string, unknown>;
  const after = splitPilotLesson(before);
  const issues = splitIntegrityIssues(before, after);
  const next = `${JSON.stringify(after, null, 2)}\n`;
  const units = (after.topics as Record<string, unknown>[])
    .map((topic) => `${String(topic.key)}:${String(topic.type)}`)
    .join(' ');
  console.log(
    `${file} ${issues.length === 0 ? 'OK' : `FAIL ${issues.join(', ')}`} ` +
      `${next === text ? 'unchanged' : 'changed'} | ${units}`,
  );
  if (issues.length > 0) failed = true;
  outputs.push({ file, text: next, changed: next !== text });
}
if (failed) {
  process.exitCode = 1;
} else if (!checkOnly) {
  for (const output of outputs.filter((entry) => entry.changed)) {
    writeFileSync(join(dir, output.file), output.text);
  }
}
console.log(
  `${files.length} bài, ${outputs.filter((entry) => entry.changed).length} đổi, ` +
    `${failed ? 'CÓ LỖI toàn vẹn' : 'toàn vẹn OK'}${checkOnly ? ' (--check, không ghi)' : ''}`,
);
