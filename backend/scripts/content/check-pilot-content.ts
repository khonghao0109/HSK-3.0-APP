import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  formatPilotIssues,
  loadPilotReferenceData,
  validatePilotLessonSet,
} from '../../src/modules/content-pilot/pilot-content.validator';

/** Kiểm mọi `content/pilot/hsk1/lesson-NN.json` (chỉ đọc file, không cần DB). */
const root = join(__dirname, '../..');
const dir = join(root, 'content/pilot/hsk1');
const sources = readdirSync(dir)
  .filter((name) => /^lesson-\d{2}\.json$/u.test(name))
  .sort()
  .map((fileName) => ({
    fileName,
    raw: JSON.parse(readFileSync(join(dir, fileName), 'utf8')) as unknown,
  }));
const issues = validatePilotLessonSet(sources, loadPilotReferenceData(root));
console.log(`${sources.length} bài, ${issues.length} lỗi`);
if (issues.length > 0) {
  console.log(formatPilotIssues(issues));
  process.exitCode = 1;
}
