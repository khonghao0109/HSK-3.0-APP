import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  checkJsonLevel,
  loadLevelLexicon,
  parseHskLevel,
} from '../../src/modules/content-levels/level-vocabulary';

/**
 * Kiểm nội dung cấp N chỉ dùng từ cấp ≤ N (Q356).
 *   npm run content:check:level -- --level HSK2 content/hsk2/lesson-01.json [...]
 *   --allow 小明,王老师   thêm từ được phép (tên riêng); `properNames[]` trong file tự được tính.
 */
const args = process.argv.slice(2);
let levelArg: string | undefined;
const allowed: string[] = [];
const files: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--level') levelArg = args[++i];
  else if (args[i] === '--allow') allowed.push(...(args[++i] ?? '').split(','));
  else files.push(args[i]);
}
const level = levelArg ? parseHskLevel(levelArg) : null;
if (!level || files.length === 0) {
  console.error(
    'Dùng: npm run content:check:level -- --level HSK1..HSK7-9 [--allow a,b] <file.json>...',
  );
  process.exit(2);
}
const root = resolve(__dirname, '../..');
const lexicon = loadLevelLexicon(root);
let failed = 0;
for (const file of files) {
  const value = JSON.parse(readFileSync(resolve(file), 'utf8')) as unknown;
  const issues = checkJsonLevel(value, level, lexicon, {
    allowed: allowed.filter(Boolean),
  });
  console.log(`${file}: ${level}, lỗi=${issues.length}`);
  for (const issue of issues)
    console.log(`  ${issue.code} ${issue.path} ${issue.message}`);
  failed += issues.length;
}
process.exitCode = failed > 0 ? 1 : 0;
