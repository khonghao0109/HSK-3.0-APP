import { POSTGRESQL_INT4_MAX } from '../constants/database.constants';

/**
 * Kiểm các block có cấu trúc trong `Topic.content` (mảng block JSON).
 * Chỉ kiểm `grammar_point` (topic `grammar`) và `dialogue` (topic `key_text`);
 * block khác (`text`, `vocabulary_list`, `image`, `audio`, …) và content không
 * phải mảng được bỏ qua để giữ tương thích ngược. Thuần, không phụ thuộc Nest —
 * dùng chung cho CMS và validator nạp nội dung pilot.
 */

export const TOPIC_CONTENT_ISSUE_CODES = [
  'topic_block_type_mismatch',
  'topic_block_unknown_field',
  'topic_block_field_invalid',
  'topic_block_array_size',
  'topic_block_highlight_not_in_hanzi',
] as const;

export type TopicContentIssueCode = (typeof TOPIC_CONTENT_ISSUE_CODES)[number];

export interface TopicContentIssue {
  code: TopicContentIssueCode;
  path: string;
}

const FORMULA_ROLES: readonly string[] = ['subj', 'verb', 'key', 'mw', 'other'];

const BLOCK_TOPIC_TYPE: ReadonlyMap<string, string> = new Map([
  ['grammar_point', 'grammar'],
  ['dialogue', 'key_text'],
]);

type Issues = TopicContentIssue[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(
  issues: Issues,
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      issues.push({
        code: 'topic_block_unknown_field',
        path: `${path}.${key}`,
      });
    }
  }
}

/** Độ dài tối thiểu tính sau trim, tối đa tính trên chuỗi gốc. */
function isText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' && value.trim().length >= 1 && value.length <= max
  );
}

function checkText(
  issues: Issues,
  record: Record<string, unknown>,
  key: string,
  max: number,
  path: string,
): void {
  if (!isText(record[key], max)) {
    issues.push({ code: 'topic_block_field_invalid', path: `${path}.${key}` });
  }
}

function checkArray(
  issues: Issues,
  record: Record<string, unknown>,
  key: string,
  max: number,
  path: string,
): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    issues.push({ code: 'topic_block_field_invalid', path: `${path}.${key}` });
    return [];
  }
  if (value.length < 1 || value.length > max) {
    issues.push({ code: 'topic_block_array_size', path: `${path}.${key}` });
    return [];
  }
  return value;
}

function checkGrammarPoint(
  issues: Issues,
  block: Record<string, unknown>,
  path: string,
): void {
  checkKeys(
    issues,
    block,
    ['type', 'title', 'formula', 'explanation', 'examples'],
    path,
  );
  checkText(issues, block, 'title', 120, path);
  for (const [index, chip] of checkArray(
    issues,
    block,
    'formula',
    12,
    path,
  ).entries()) {
    const at = `${path}.formula[${index}]`;
    if (!isRecord(chip)) {
      issues.push({ code: 'topic_block_field_invalid', path: at });
      continue;
    }
    checkKeys(issues, chip, ['role', 'zh', 'vi'], at);
    if (typeof chip.role !== 'string' || !FORMULA_ROLES.includes(chip.role)) {
      issues.push({ code: 'topic_block_field_invalid', path: `${at}.role` });
    }
    checkText(issues, chip, 'zh', 20, at);
    checkText(issues, chip, 'vi', 40, at);
  }
  checkText(issues, block, 'explanation', 600, path);
  for (const [index, example] of checkArray(
    issues,
    block,
    'examples',
    5,
    path,
  ).entries()) {
    const at = `${path}.examples[${index}]`;
    if (!isRecord(example)) {
      issues.push({ code: 'topic_block_field_invalid', path: at });
      continue;
    }
    checkKeys(issues, example, ['hanzi', 'pinyin', 'vi', 'highlight'], at);
    checkText(issues, example, 'hanzi', 120, at);
    checkText(issues, example, 'pinyin', 240, at);
    checkText(issues, example, 'vi', 240, at);
    const highlight = example.highlight;
    if (highlight === undefined || highlight === null) continue;
    if (!isText(highlight, 120)) {
      issues.push({
        code: 'topic_block_field_invalid',
        path: `${at}.highlight`,
      });
    } else if (
      typeof example.hanzi !== 'string' ||
      !example.hanzi.includes(highlight)
    ) {
      issues.push({
        code: 'topic_block_highlight_not_in_hanzi',
        path: `${at}.highlight`,
      });
    }
  }
}

function checkDialogue(
  issues: Issues,
  block: Record<string, unknown>,
  path: string,
): void {
  checkKeys(issues, block, ['type', 'lines', 'audioMediaId'], path);
  // M2.13d: audio cả bài khoá, chỉ id Media (learner nhận bản chiếu, không id thô).
  if (
    'audioMediaId' in block &&
    !(
      Number.isSafeInteger(block.audioMediaId) &&
      (block.audioMediaId as number) >= 1 &&
      (block.audioMediaId as number) <= POSTGRESQL_INT4_MAX
    )
  ) {
    issues.push({
      code: 'topic_block_field_invalid',
      path: `${path}.audioMediaId`,
    });
  }
  for (const [index, line] of checkArray(
    issues,
    block,
    'lines',
    40,
    path,
  ).entries()) {
    const at = `${path}.lines[${index}]`;
    if (!isRecord(line)) {
      issues.push({ code: 'topic_block_field_invalid', path: at });
      continue;
    }
    checkKeys(issues, line, ['speaker', 'hanzi', 'pinyin', 'vi'], at);
    checkText(issues, line, 'speaker', 40, at);
    checkText(issues, line, 'hanzi', 200, at);
    checkText(issues, line, 'pinyin', 400, at);
    checkText(issues, line, 'vi', 400, at);
  }
}

export function validateTopicContentBlocks(
  topicType: string,
  content: unknown,
): TopicContentIssue[] {
  const issues: Issues = [];
  if (!Array.isArray(content)) return issues;
  for (const [index, block] of content.entries()) {
    if (!isRecord(block) || typeof block.type !== 'string') continue;
    const requiredTopicType = BLOCK_TOPIC_TYPE.get(block.type);
    if (requiredTopicType === undefined) continue;
    const path = `content[${index}]`;
    if (requiredTopicType !== topicType) {
      issues.push({ code: 'topic_block_type_mismatch', path: `${path}.type` });
      continue;
    }
    if (block.type === 'grammar_point') checkGrammarPoint(issues, block, path);
    else checkDialogue(issues, block, path);
  }
  return issues;
}
