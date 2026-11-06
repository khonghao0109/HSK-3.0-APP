import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * TL-223: validator dùng chung cho nội dung pilot HSK1.
 *
 * Chuyển toàn bộ luật của script `/tmp/hsk-m29a/check.mjs` (Pha 1/1b) thành module
 * trong repo, để test Jest unit (`pilot-content.validator.spec.ts`) và script nạp
 * (`scripts/content/import-pilot-content.ts`) dùng **cùng một** logic. Nhờ vậy bằng
 * chứng không còn nằm ngoài repo và không thể lệch giữa lúc kiểm và lúc nạp.
 *
 * Ràng buộc dữ liệu tham chiếu: chỉ đọc file **đã commit** trong repo —
 * `scripts/dictionary/raw/hsk1.json` (danh sách từ HSK1) và
 * `scripts/dictionary/parsed/final_words.json` (nguồn tạo bảng `Word`, có
 * `pinyin_tone`). Không đọc file gitignored, không kết nối DB.
 */

export const PILOT_CONTENT_LIMITS = {
  /** Cùng giới hạn với `backend/src/common/validation/lesson-exercise-authoring.validator.ts`. */
  maxStringLength: 4096,
  /** §2.1: `lesson.title` 1–200, `topic.title` 1–200. */
  maxTitleLength: 200,
  /** §2.1: `topic.subtitle` ≤ 500. */
  maxSubtitleLength: 500,
  /** §2.1: `lesson.description` ≤ 2000 (không bắt buộc). */
  maxDescriptionLength: 2000,
  /** TL-212: `exercises[].sourceKey` ≤ 128. */
  maxSourceKeyLength: 128,
  /** §2.1: `lesson.slug` 1–160. */
  maxSlugLength: 160,
  maxArrayLength: 100,
  maxJsonBytes: 65_536,
  maxDepth: 8,
  /** §2.1: `orderIndex` 1–1 000 000 cho lesson/topic/exercise. */
  maxOrderIndex: 1_000_000,
  wordsPerLesson: 20,
  minTopics: 2,
  minExercises: 8,
  minMcqOptions: 4,
  /** TL-214: lesson pilot dùng dải orderIndex 1001–1005. */
  pilotOrderIndexMin: 1001,
  pilotOrderIndexMax: 1005,
  /** Q173: chỉ 3 loại bài tập được publish trong pilot. */
  allowedExerciseTypes: ['mcq', 'fill_blank', 'arrange_sentence'],
  forbiddenExerciseTypes: ['listening_choice', 'speaking_repeat'],
  allowedTopicTypes: ['vocabulary', 'grammar', 'key_text'],
} as const;

/** Mọi mã lỗi validator có thể trả về. Test fixture phải phủ hết danh sách này. */
export const PILOT_CONTENT_ERROR_CODES = [
  'schema_invalid',
  'max_depth_exceeded',
  'lesson_missing',
  'lesson_file_name_invalid',
  'slug_invalid',
  'slug_collides_placeholder',
  'lesson_source_key_invalid',
  'lesson_order_index_pilot',
  'lesson_order_index_range',
  'string_required',
  'string_empty',
  'string_too_long',
  'order_index_invalid',
  'level_invalid',
  'word_invalid',
  'data_source_missing',
  'review_status_invalid',
  'words_missing',
  'words_count',
  'hanzi_not_hsk1',
  'hanzi_duplicate',
  'pinyin_without_tone',
  'word_absent_from_dictionary_source',
  'pinyin_tone_mismatch',
  'word_level_mismatch',
  'example_missing',
  'example_not_hsk1',
  'topics_missing',
  'topics_count',
  'topic_vocabulary_missing',
  'topic_grammar_or_key_text_missing',
  'topic_invalid',
  'topic_type_unsupported',
  'topic_key_missing',
  'topic_key_duplicate',
  'topic_order_invalid',
  'topic_order_duplicate',
  'topic_content_empty',
  'block_invalid',
  'block_type_unsupported',
  'block_unknown_field',
  'exercises_missing',
  'exercises_count',
  'exercise_invalid',
  'exercise_type_forbidden',
  'exercise_type_unsupported',
  'source_key_invalid',
  'source_key_duplicate',
  'topic_key_dangling',
  'exercise_order_invalid',
  'exercise_order_duplicate',
  'payload_too_large',
  'content_missing',
  'answer_missing',
  'mcq_content_keys',
  'mcq_options_missing',
  'mcq_options_below_4',
  'mcq_options_not_4',
  'mcq_option_keys',
  'invalid_stable_id',
  'mcq_option_id_duplicate',
  'mcq_option_text_duplicate',
  'option_not_hsk1',
  'mcq_answer_keys',
  'mcq_answer_not_in_options',
  'mcq_answer_position_skew',
  'fill_blank_content_not_empty',
  'fill_blank_accepted_empty',
  'fill_blank_answer_keys',
  'blank_marker_inconsistent',
  'fill_blank_missing_pinyin',
  'arrange_content_keys',
  'arrange_tokens_missing',
  'arrange_tokens_too_few',
  'arrange_token_keys',
  'arrange_token_id_duplicate',
  'arrange_answer_keys',
  'arrange_answer_missing',
  'arrange_not_permutation',
  'arrange_token_duplicate',
  'arrange_ids_reveal_order',
  'arrange_tokens_not_shuffled',
  'array_too_large',
  'type_missing',
  'types_count',
  'cross_lesson_hanzi_duplicate',
  'cross_lesson_slug_duplicate',
  'cross_lesson_order_index_duplicate',
  'cross_lesson_source_key_duplicate',
] as const;

export type PilotContentErrorCode = (typeof PILOT_CONTENT_ERROR_CODES)[number];

export interface PilotContentIssue {
  readonly code: PilotContentErrorCode;
  /** Đường dẫn trong file, ví dụ `words[17].pinyin`; rỗng khi lỗi ở tên file. */
  readonly path: string;
  readonly message: string;
  /** Chỉ có khi validate cả bộ file. */
  readonly fileName?: string;
}

export interface PilotContentWordReference {
  /** Mọi pinyin có dấu thanh suy ra từ `pinyin_tone` của các row cùng `hanzi`. */
  readonly variants: readonly string[];
  /** Có ít nhất một row `level = 'HSK1'`. */
  readonly hasHsk1Level: boolean;
}

export interface PilotReferenceData {
  readonly wordSet: ReadonlySet<string>;
  readonly charSet: ReadonlySet<string>;
  readonly words: ReadonlyMap<string, PilotContentWordReference>;
}

export interface PilotLessonSource {
  readonly fileName: string;
  readonly raw: unknown;
}

const TONE_TABLE: Readonly<Record<string, readonly string[]>> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  v: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};
const PLAIN_VOWELS = 'aeiou';
const TONE_MARKS = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/u;
const HAN = /\p{Script=Han}/u;
const PURE_HAN = /^\p{Script=Han}+$/u;
/** TL-213 */
const PILOT_SLUG = /^hsk1-pilot-l\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/u;
/** TL-212 */
const PILOT_EXERCISE_SOURCE_KEY = /^pilot-hsk1:l(\d{2}):e(\d{2})$/u;
/** TL-216/validator stable-id: `backend/src/common/validation/lesson-exercise-authoring.validator.ts`. */
const STABLE_ID = /^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u;
const PILOT_LESSON_FILE_NAME = /^lesson-(\d{2})\.json$/u;

const TONE_TO_BASE: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [base, marks] of Object.entries(TONE_TABLE)) {
    for (const mark of marks) map.set(mark, base);
  }
  return map;
})();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function depth(
  value: unknown,
  cap = PILOT_CONTENT_LIMITS.maxDepth + 1,
): number {
  if (cap <= 0) return 1;
  const children = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : null;
  if (children === null) return 0;
  let deepest = 0;
  for (const child of children) {
    deepest = Math.max(deepest, depth(child, cap - 1));
  }
  return 1 + deepest;
}

function markSyllable(syllable: string, tone: number): string {
  const syl = syllable.replace(/ü/gu, 'v');
  if (tone === 5 || tone === 0) return syl.replace(/v/gu, 'ü');
  let target = -1;
  const atA = syl.indexOf('a');
  const atE = syl.indexOf('e');
  if (atA >= 0) target = atA;
  else if (atE >= 0) target = atE;
  else if (syl.includes('ou')) target = syl.indexOf('o');
  else {
    for (let index = syl.length - 1; index >= 0; index -= 1) {
      const char = syl[index];
      if (PLAIN_VOWELS.includes(char) || char === 'v') {
        target = index;
        break;
      }
    }
  }
  const table = target >= 0 ? TONE_TABLE[syl[target]] : undefined;
  if (target < 0 || !table) return syl.replace(/v/gu, 'ü');
  return (
    syl.slice(0, target) +
    table[tone - 1] +
    syl.slice(target + 1)
  ).replace(/v/gu, 'ü');
}

/** `"wo3 men5"` → `"wǒmen"` (bỏ dấu cách, chữ thường) — cùng quy ước `check.mjs`. */
export function toneMarkedPinyin(numbered: string): string {
  return numbered
    .trim()
    .split(/\s+/u)
    .map((syllable) => {
      const match = /^([a-zü:]+)([1-5])$/iu.exec(syllable);
      if (!match) return syllable;
      return markSyllable(match[1].toLowerCase(), Number(match[2]));
    })
    .join('')
    .toLowerCase();
}

/**
 * So sánh pinyin theo đúng `normalizePinyin` (bỏ số thanh, trim, lowercase, `ü → u:`)
 * rồi bỏ hết khoảng trắng và quy `u:/ü/v` về `v` để `"xué sheng"` so được với
 * `"xue2 sheng5"`. TL-218.
 */
export function normalizePinyinForCompare(value: string): string {
  return value
    .replace(/[1-5]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/ü/gu, 'u:')
    .replace(/\s+/gu, '')
    .replace(/u:/gu, 'v');
}

/** Q194: dạng pinyin không dấu, viết liền, chữ thường. */
export function stripToneMarks(value: string): string {
  let output = '';
  for (const char of value) output += TONE_TO_BASE.get(char) ?? char;
  return output.replace(/ü/gu, 'v');
}

export function derivePilotLessonNumber(fileName: string): number | null {
  const match = PILOT_LESSON_FILE_NAME.exec(basename(fileName));
  if (match === null) return null;
  return Number(match[1]);
}

let cachedReference: { root: string; data: PilotReferenceData } | null = null;

/**
 * Nạp dữ liệu tham chiếu từ repo. Chỉ đọc file đã commit trong repo.
 * `backendRoot` là thư mục `backend/`.
 */
export function loadPilotReferenceData(
  backendRoot: string,
): PilotReferenceData {
  if (cachedReference !== null && cachedReference.root === backendRoot) {
    return cachedReference.data;
  }
  const hsk1Raw: unknown = JSON.parse(
    readFileSync(join(backendRoot, 'scripts/dictionary/raw/hsk1.json'), 'utf8'),
  );
  if (!Array.isArray(hsk1Raw)) {
    throw new Error('hsk1.json phải là mảng.');
  }
  const wordSet = new Set<string>();
  const charSet = new Set<string>();
  for (const entry of hsk1Raw) {
    if (!isRecord(entry) || typeof entry.hanzi !== 'string') continue;
    wordSet.add(entry.hanzi);
    for (const char of entry.hanzi) charSet.add(char);
  }

  const finalWordsRaw: unknown = JSON.parse(
    readFileSync(
      join(backendRoot, 'scripts/dictionary/parsed/final_words.json'),
      'utf8',
    ),
  );
  if (!Array.isArray(finalWordsRaw)) {
    throw new Error('final_words.json phải là mảng.');
  }
  const variants = new Map<string, Set<string>>();
  const hsk1Level = new Set<string>();
  for (const row of finalWordsRaw) {
    if (!isRecord(row) || typeof row.hanzi !== 'string') continue;
    const bucket = variants.get(row.hanzi) ?? new Set<string>();
    if (typeof row.pinyin_tone === 'string') {
      const marked = toneMarkedPinyin(row.pinyin_tone);
      if (marked.length > 0) bucket.add(marked);
    }
    variants.set(row.hanzi, bucket);
    if (row.level === 'HSK1') hsk1Level.add(row.hanzi);
  }
  const words = new Map<string, PilotContentWordReference>();
  for (const [hanzi, bucket] of variants) {
    words.set(hanzi, {
      variants: [...bucket],
      hasHsk1Level: hsk1Level.has(hanzi),
    });
  }

  const data: PilotReferenceData = { wordSet, charSet, words };
  cachedReference = { root: backendRoot, data };
  return data;
}

function createIssue(
  code: PilotContentErrorCode,
  path: string,
  message: string,
): PilotContentIssue {
  return { code, path, message };
}

function checkString(
  issues: PilotContentIssue[],
  value: unknown,
  path: string,
  maxLength: number = PILOT_CONTENT_LIMITS.maxStringLength,
): void {
  if (typeof value !== 'string') {
    issues.push(createIssue('string_required', path, 'phải là string'));
    return;
  }
  if (value.length === 0) {
    issues.push(createIssue('string_empty', path, 'không được rỗng'));
  }
  if (value.length > maxLength) {
    issues.push(
      createIssue(
        'string_too_long',
        path,
        `${value.length} ký tự > ${maxLength}`,
      ),
    );
  }
}

function checkStableId(
  issues: PilotContentIssue[],
  value: unknown,
  path: string,
): string | null {
  if (typeof value !== 'string') {
    issues.push(createIssue('invalid_stable_id', path, 'không phải string'));
    return null;
  }
  if (!STABLE_ID.test(value)) {
    issues.push(
      createIssue(
        'invalid_stable_id',
        path,
        `= ${JSON.stringify(value)} không khớp regex stable-id`,
      ),
    );
  }
  return value;
}

function validateWords(
  issues: PilotContentIssue[],
  lesson: Record<string, unknown>,
  refs: PilotReferenceData,
  levelCode: unknown,
): readonly Record<string, unknown>[] {
  if (!Array.isArray(lesson.words)) {
    issues.push(createIssue('words_missing', 'words', 'thiếu mảng "words"'));
    return [];
  }
  const parsedWords: Record<string, unknown>[] = [];
  for (const [index, entry] of lesson.words.entries()) {
    if (isRecord(entry)) {
      parsedWords.push(entry);
    } else {
      issues.push(
        createIssue('word_invalid', `words[${index}]`, 'không phải object'),
      );
    }
  }
  const words = parsedWords;
  if (words.length !== PILOT_CONTENT_LIMITS.wordsPerLesson) {
    issues.push(
      createIssue(
        'words_count',
        'words',
        `cần đúng ${PILOT_CONTENT_LIMITS.wordsPerLesson} từ, đếm được ${words.length}`,
      ),
    );
  }
  const seenHanzi = new Set<string>();
  for (const [index, word] of words.entries()) {
    const at = `words[${index}]`;
    const rawIndex = lesson.words.indexOf(word);
    if (typeof word.hanzi !== 'string' || !refs.wordSet.has(word.hanzi)) {
      issues.push(
        createIssue(
          'hanzi_not_hsk1',
          `words[${rawIndex}].hanzi`,
          `= ${JSON.stringify(word.hanzi)} không có trong hsk1.json`,
        ),
      );
    }
    if (typeof word.hanzi === 'string') {
      if (seenHanzi.has(word.hanzi)) {
        issues.push(
          createIssue(
            'hanzi_duplicate',
            `${at}.hanzi`,
            `= ${word.hanzi} lặp trong bài`,
          ),
        );
      }
      seenHanzi.add(word.hanzi);
    }
    checkString(issues, word.pinyin, `${at}.pinyin`);
    if (typeof word.pinyin === 'string' && !TONE_MARKS.test(word.pinyin)) {
      // Thanh nhẹ (neutral tone) không có dấu để viết: 的 = `de`, repo lưu
      // `pinyin_tone = de5`. Chỉ chấp nhận pinyin không dấu khi **reading khớp
      // trong repo** cũng không có dấu; mọi trường hợp khác vẫn fail. Luật
      // `pinyin_tone_mismatch` bên dưới vẫn bắt được mọi pinyin sai thanh, nên
      // ngoại lệ hẹp này không nới lỏng kiểm tra.
      // TL-224 (dải TL-224…TL-229 của M2.9a): ngoại lệ thanh nhẹ — chỉ bỏ qua
      // `pinyin_without_tone` khi reading trong repo cũng không dấu;
      // `pinyin_tone_mismatch` bên dưới vẫn bắt mọi pinyin sai thanh.
      const expectedPinyin = normalizePinyinForCompare(word.pinyin);
      const matchedVariant =
        typeof word.hanzi === 'string'
          ? refs.words
              .get(word.hanzi)
              ?.variants.find(
                (variant) =>
                  normalizePinyinForCompare(variant) === expectedPinyin,
              )
          : undefined;
      const referenceIsNeutralTone =
        matchedVariant !== undefined && !TONE_MARKS.test(matchedVariant);
      if (!referenceIsNeutralTone) {
        issues.push(
          createIssue(
            'pinyin_without_tone',
            `${at}.pinyin`,
            `= ${word.pinyin} không có dấu thanh`,
          ),
        );
      }
    }
    if (typeof word.pinyin === 'string' && typeof word.hanzi === 'string') {
      const reference = refs.words.get(word.hanzi);
      if (reference === undefined) {
        issues.push(
          createIssue(
            'word_absent_from_dictionary_source',
            `${at}.hanzi`,
            `= ${word.hanzi} không có trong parsed/final_words.json (seed sẽ không tạo Word)`,
          ),
        );
      } else {
        const expected = normalizePinyinForCompare(word.pinyin);
        const candidates = reference.variants.map(normalizePinyinForCompare);
        if (!candidates.includes(expected)) {
          issues.push(
            createIssue(
              'pinyin_tone_mismatch',
              `${at}.pinyin`,
              `= ${word.pinyin} nhưng repo có [${candidates.join(', ')}]`,
            ),
          );
        }
        if (typeof levelCode === 'string' && !reference.hasHsk1Level) {
          issues.push(
            createIssue(
              'word_level_mismatch',
              `${at}.hanzi`,
              `= ${word.hanzi} không ở level ${levelCode} trong final_words.json`,
            ),
          );
        }
      }
    }
    checkString(issues, word.meaningVi, `${at}.meaningVi`);
    const example = word.example;
    if (!isRecord(example)) {
      issues.push(
        createIssue('example_missing', `${at}.example`, 'thiếu object ví dụ'),
      );
      continue;
    }
    checkString(issues, example.hanzi, `${at}.example.hanzi`);
    checkString(issues, example.pinyin, `${at}.example.pinyin`);
    checkString(issues, example.meaningVi, `${at}.example.meaningVi`);
    if (typeof example.hanzi === 'string') {
      const outside = [
        ...new Set(
          [...example.hanzi].filter(
            (char) => HAN.test(char) && !refs.charSet.has(char),
          ),
        ),
      ];
      if (outside.length > 0) {
        issues.push(
          createIssue(
            'example_not_hsk1',
            `${at}.example.hanzi`,
            `dùng chữ ngoài HSK1: ${outside.join('')}`,
          ),
        );
      }
    }
  }
  return words;
}

function validateTopics(
  issues: PilotContentIssue[],
  lesson: Record<string, unknown>,
): ReadonlySet<string> {
  const topicKeys = new Set<string>();
  if (!Array.isArray(lesson.topics)) {
    issues.push(createIssue('topics_missing', 'topics', 'thiếu mảng "topics"'));
    return topicKeys;
  }
  const parsedTopics: Record<string, unknown>[] = [];
  for (const [index, entry] of lesson.topics.entries()) {
    if (isRecord(entry)) {
      parsedTopics.push(entry);
    } else {
      issues.push(
        createIssue('topic_invalid', `topics[${index}]`, 'không phải object'),
      );
    }
  }
  const topics = parsedTopics;
  if (topics.length < PILOT_CONTENT_LIMITS.minTopics) {
    issues.push(
      createIssue(
        'topics_count',
        'topics',
        `cần ≥ ${PILOT_CONTENT_LIMITS.minTopics} topic, đếm được ${topics.length}`,
      ),
    );
  }
  if (!topics.some((topic) => topic.type === 'vocabulary')) {
    issues.push(
      createIssue(
        'topic_vocabulary_missing',
        'topics',
        'thiếu topic type "vocabulary"',
      ),
    );
  }
  if (
    !topics.some(
      (topic) => topic.type === 'grammar' || topic.type === 'key_text',
    )
  ) {
    issues.push(
      createIssue(
        'topic_grammar_or_key_text_missing',
        'topics',
        'thiếu topic "grammar" hoặc "key_text"',
      ),
    );
  }
  const topicOrders = new Set<number>();
  for (const [index, topic] of topics.entries()) {
    const at = `topics[${index}]`;
    if (
      typeof topic.type !== 'string' ||
      !(PILOT_CONTENT_LIMITS.allowedTopicTypes as readonly string[]).includes(
        topic.type,
      )
    ) {
      issues.push(
        createIssue(
          'topic_type_unsupported',
          `${at}.type`,
          `= ${String(topic.type)}`,
        ),
      );
    }
    if (typeof topic.key !== 'string' || topic.key.length === 0) {
      issues.push(createIssue('topic_key_missing', `${at}.key`, 'thiếu key'));
    } else {
      if (topicKeys.has(topic.key)) {
        issues.push(
          createIssue('topic_key_duplicate', `${at}.key`, `= ${topic.key}`),
        );
      }
      topicKeys.add(topic.key);
    }
    if (
      !Number.isInteger(topic.orderIndex) ||
      (topic.orderIndex as number) < 1 ||
      (topic.orderIndex as number) > PILOT_CONTENT_LIMITS.maxOrderIndex
    ) {
      issues.push(
        createIssue('topic_order_invalid', `${at}.orderIndex`, 'không hợp lệ'),
      );
    } else if (topicOrders.has(topic.orderIndex as number)) {
      issues.push(
        createIssue(
          'topic_order_duplicate',
          `${at}.orderIndex`,
          `= ${String(topic.orderIndex)}`,
        ),
      );
    } else {
      topicOrders.add(topic.orderIndex as number);
    }
    checkString(
      issues,
      topic.title,
      `${at}.title`,
      PILOT_CONTENT_LIMITS.maxTitleLength,
    );
    if (topic.subtitle !== undefined) {
      checkString(
        issues,
        topic.subtitle,
        `${at}.subtitle`,
        PILOT_CONTENT_LIMITS.maxSubtitleLength,
      );
    }
    if (!Array.isArray(topic.content) || topic.content.length === 0) {
      issues.push(
        createIssue('topic_content_empty', `${at}.content`, 'thiếu block'),
      );
      continue;
    }
    for (const [blockIndex, block] of topic.content.entries()) {
      const blockPath = `${at}.content[${blockIndex}]`;
      if (!isRecord(block)) {
        issues.push(
          createIssue('block_invalid', blockPath, 'không phải object'),
        );
        continue;
      }
      // Q175/K-A: chỉ `text` và `vocabulary_list`, value là string.
      if (block.type !== 'text' && block.type !== 'vocabulary_list') {
        issues.push(
          createIssue(
            'block_type_unsupported',
            `${blockPath}.type`,
            `= ${JSON.stringify(block.type)}`,
          ),
        );
        continue;
      }
      const blockKeys = Object.keys(block).sort().join(',');
      if (blockKeys !== 'type,value') {
        issues.push(
          createIssue('block_unknown_field', blockPath, `keys = ${blockKeys}`),
        );
      }
      checkString(issues, block.value, `${blockPath}.value`);
    }
  }
  return topicKeys;
}

interface McqAnswerPosition {
  readonly path: string;
  readonly position: number;
}

function validateExercises(
  issues: PilotContentIssue[],
  lesson: Record<string, unknown>,
  topicKeys: ReadonlySet<string>,
  words: readonly Record<string, unknown>[],
  refs: PilotReferenceData,
): void {
  if (!Array.isArray(lesson.exercises)) {
    issues.push(
      createIssue('exercises_missing', 'exercises', 'thiếu mảng "exercises"'),
    );
    return;
  }
  const parsedExercises: Record<string, unknown>[] = [];
  for (const [index, entry] of lesson.exercises.entries()) {
    if (isRecord(entry)) {
      parsedExercises.push(entry);
    } else {
      issues.push(
        createIssue(
          'exercise_invalid',
          `exercises[${index}]`,
          'không phải object',
        ),
      );
    }
  }
  const exercises = parsedExercises;
  if (exercises.length < PILOT_CONTENT_LIMITS.minExercises) {
    issues.push(
      createIssue(
        'exercises_count',
        'exercises',
        `cần ≥ ${PILOT_CONTENT_LIMITS.minExercises} bài tập, đếm được ${exercises.length}`,
      ),
    );
  }
  const typeSeen = new Set<string>();
  const sourceKeys = new Set<string>();
  const orderSeen = new Set<number>();
  const mcqPositions: McqAnswerPosition[] = [];

  for (const exercise of exercises) {
    const at = `exercises[${lesson.exercises.indexOf(exercise)}]`;
    const type = exercise.type;
    if (
      typeof type === 'string' &&
      (
        PILOT_CONTENT_LIMITS.forbiddenExerciseTypes as readonly string[]
      ).includes(type)
    ) {
      issues.push(
        createIssue(
          'exercise_type_forbidden',
          `${at}.type`,
          `= ${type} (Q173)`,
        ),
      );
    }
    if (
      typeof type !== 'string' ||
      !(
        PILOT_CONTENT_LIMITS.allowedExerciseTypes as readonly string[]
      ).includes(type)
    ) {
      issues.push(
        createIssue(
          'exercise_type_unsupported',
          `${at}.type`,
          `= ${JSON.stringify(type)}`,
        ),
      );
    } else {
      typeSeen.add(type);
    }

    if (
      typeof exercise.sourceKey !== 'string' ||
      !PILOT_EXERCISE_SOURCE_KEY.test(exercise.sourceKey)
    ) {
      issues.push(
        createIssue(
          'source_key_invalid',
          `${at}.sourceKey`,
          `= ${JSON.stringify(exercise.sourceKey)} (TL-212)`,
        ),
      );
    } else if (
      typeof exercise.sourceKey === 'string' &&
      exercise.sourceKey.length > PILOT_CONTENT_LIMITS.maxSourceKeyLength
    ) {
      issues.push(
        createIssue(
          'string_too_long',
          `${at}.sourceKey`,
          `${exercise.sourceKey.length} ký tự > ${PILOT_CONTENT_LIMITS.maxSourceKeyLength}`,
        ),
      );
    }
    if (typeof exercise.sourceKey === 'string') {
      if (sourceKeys.has(exercise.sourceKey)) {
        issues.push(
          createIssue(
            'source_key_duplicate',
            `${at}.sourceKey`,
            `= ${exercise.sourceKey}`,
          ),
        );
      }
      sourceKeys.add(exercise.sourceKey);
    }

    // §2.1: `topicKey: null` = bài tập độc lập của lesson, hợp lệ.
    if (exercise.topicKey !== null) {
      if (
        typeof exercise.topicKey !== 'string' ||
        !topicKeys.has(exercise.topicKey)
      ) {
        issues.push(
          createIssue(
            'topic_key_dangling',
            `${at}.topicKey`,
            `= ${JSON.stringify(exercise.topicKey)}`,
          ),
        );
      }
    }

    if (
      !Number.isInteger(exercise.orderIndex) ||
      (exercise.orderIndex as number) < 1 ||
      (exercise.orderIndex as number) > 1_000_000
    ) {
      issues.push(
        createIssue(
          'exercise_order_invalid',
          `${at}.orderIndex`,
          'không hợp lệ',
        ),
      );
    } else if (orderSeen.has(exercise.orderIndex as number)) {
      issues.push(
        createIssue(
          'exercise_order_duplicate',
          `${at}.orderIndex`,
          `= ${String(exercise.orderIndex)}`,
        ),
      );
    } else {
      orderSeen.add(exercise.orderIndex as number);
    }

    checkString(issues, exercise.prompt, `${at}.prompt`);
    checkString(issues, exercise.explanation, `${at}.explanation`);

    const payload: Record<string, unknown> = {
      type: exercise.type,
      prompt: exercise.prompt,
      content: exercise.content,
      answer: exercise.answer,
    };
    if (exercise.explanation !== undefined) {
      payload.explanation = exercise.explanation;
    }
    const payloadJson = JSON.stringify(payload);
    const payloadBytes = Buffer.byteLength(payloadJson, 'utf8');
    if (payloadBytes > PILOT_CONTENT_LIMITS.maxJsonBytes) {
      issues.push(
        createIssue(
          'payload_too_large',
          at,
          `${payloadBytes} byte > ${PILOT_CONTENT_LIMITS.maxJsonBytes}`,
        ),
      );
    }
    const payloadDepth = depth(payload);
    if (payloadDepth > PILOT_CONTENT_LIMITS.maxDepth) {
      issues.push(
        createIssue(
          'max_depth_exceeded',
          at,
          `depth = ${payloadDepth} > ${PILOT_CONTENT_LIMITS.maxDepth}`,
        ),
      );
    }

    const content = exercise.content;
    const answer = exercise.answer;
    if (!isRecord(content)) {
      issues.push(
        createIssue('content_missing', `${at}.content`, 'thiếu object'),
      );
      continue;
    }
    if (!isRecord(answer)) {
      issues.push(
        createIssue('answer_missing', `${at}.answer`, 'thiếu object'),
      );
      continue;
    }

    if (type === 'mcq') {
      validateMcq(issues, at, content, answer, refs, mcqPositions);
    }
    if (type === 'fill_blank') {
      validateFillBlank(
        issues,
        at,
        content,
        answer,
        words,
        refs,
        exercise.prompt,
      );
    }
    if (type === 'arrange_sentence') {
      validateArrange(issues, at, content, answer);
    }
  }

  const positionCounts = new Map<number, string[]>();
  for (const { path, position } of mcqPositions) {
    const list = positionCounts.get(position) ?? [];
    list.push(path);
    positionCounts.set(position, list);
  }
  for (const [position, paths] of positionCounts) {
    if (paths.length > 1) {
      issues.push(
        createIssue(
          'mcq_answer_position_skew',
          paths[0],
          `vị trí ${position + 1} là đáp án ${paths.length} lần (${paths.join(', ')}) — Q176`,
        ),
      );
    }
  }

  for (const required of PILOT_CONTENT_LIMITS.allowedExerciseTypes) {
    if (!typeSeen.has(required)) {
      issues.push(
        createIssue('type_missing', 'exercises', `thiếu loại ${required}`),
      );
    }
  }
  if (typeSeen.size < PILOT_CONTENT_LIMITS.allowedExerciseTypes.length) {
    issues.push(
      createIssue(
        'types_count',
        'exercises',
        `cần ≥ ${PILOT_CONTENT_LIMITS.allowedExerciseTypes.length} loại, đếm được ${typeSeen.size}`,
      ),
    );
  }
}

function validateMcq(
  issues: PilotContentIssue[],
  at: string,
  content: Record<string, unknown>,
  answer: Record<string, unknown>,
  refs: PilotReferenceData,
  mcqPositions: McqAnswerPosition[],
): void {
  if (Object.keys(content).join(',') !== 'options') {
    issues.push(
      createIssue('mcq_content_keys', `${at}.content`, 'chỉ được có "options"'),
    );
  }
  const options = content.options;
  if (!Array.isArray(options)) {
    issues.push(
      createIssue('mcq_options_missing', `${at}.content.options`, 'thiếu mảng'),
    );
    return;
  }
  if (options.length < PILOT_CONTENT_LIMITS.minMcqOptions) {
    issues.push(
      createIssue(
        'mcq_options_below_4',
        `${at}.content.options`,
        `${options.length} lựa chọn (Q176 yêu cầu 4)`,
      ),
    );
  } else if (options.length > PILOT_CONTENT_LIMITS.minMcqOptions) {
    // Q176: "đúng 4 option = 1 đáp án + 3 distractor".
    issues.push(
      createIssue(
        'mcq_options_not_4',
        `${at}.content.options`,
        `${options.length} lựa chọn (Q176 yêu cầu đúng 4)`,
      ),
    );
  }
  if (options.length > PILOT_CONTENT_LIMITS.maxArrayLength) {
    issues.push(
      createIssue(
        'array_too_large',
        `${at}.content.options`,
        `${options.length} > ${PILOT_CONTENT_LIMITS.maxArrayLength}`,
      ),
    );
  }
  const ids = new Set<string>();
  const texts = new Set<string>();
  for (const [index, option] of options.entries()) {
    const oat = `${at}.content.options[${index}]`;
    if (
      !isRecord(option) ||
      Object.keys(option).sort().join(',') !== 'id,text'
    ) {
      issues.push(
        createIssue('mcq_option_keys', oat, 'phải có đúng {id,text}'),
      );
      continue;
    }
    const id = checkStableId(issues, option.id, `${oat}.id`);
    if (id !== null) {
      if (ids.has(id)) {
        issues.push(
          createIssue('mcq_option_id_duplicate', `${oat}.id`, `= ${id}`),
        );
      }
      ids.add(id);
    }
    checkString(issues, option.text, `${oat}.text`);
    if (typeof option.text === 'string') {
      if (texts.has(option.text)) {
        issues.push(
          createIssue(
            'mcq_option_text_duplicate',
            `${oat}.text`,
            `= ${option.text}`,
          ),
        );
      }
      texts.add(option.text);
      // R21: distractor cùng Level — option chữ Hán phải là từ HSK1.
      if (PURE_HAN.test(option.text) && !refs.wordSet.has(option.text)) {
        issues.push(
          createIssue(
            'option_not_hsk1',
            `${oat}.text`,
            `= ${option.text} không có trong hsk1.json`,
          ),
        );
      }
    }
  }
  if (Object.keys(answer).join(',') !== 'optionId') {
    issues.push(
      createIssue('mcq_answer_keys', `${at}.answer`, 'chỉ được có "optionId"'),
    );
  }
  if (typeof answer.optionId !== 'string' || !ids.has(answer.optionId)) {
    issues.push(
      createIssue(
        'mcq_answer_not_in_options',
        `${at}.answer.optionId`,
        `= ${JSON.stringify(answer.optionId)}`,
      ),
    );
    return;
  }
  const position = options.findIndex(
    (option) => isRecord(option) && option.id === answer.optionId,
  );
  mcqPositions.push({ path: `${at}.answer.optionId`, position });
}

function validateFillBlank(
  issues: PilotContentIssue[],
  at: string,
  content: Record<string, unknown>,
  answer: Record<string, unknown>,
  words: readonly Record<string, unknown>[],
  refs: PilotReferenceData,
  prompt: unknown,
): void {
  if (Object.keys(content).length !== 0) {
    issues.push(
      createIssue(
        'fill_blank_content_not_empty',
        `${at}.content`,
        'phải là {}',
      ),
    );
  }
  const acceptedTexts = answer.acceptedTexts;
  if (!Array.isArray(acceptedTexts) || acceptedTexts.length === 0) {
    issues.push(
      createIssue(
        'fill_blank_accepted_empty',
        `${at}.answer.acceptedTexts`,
        'thiếu/không hợp lệ',
      ),
    );
  } else {
    if (acceptedTexts.length > PILOT_CONTENT_LIMITS.maxArrayLength) {
      issues.push(
        createIssue(
          'array_too_large',
          `${at}.answer.acceptedTexts`,
          `${acceptedTexts.length} > ${PILOT_CONTENT_LIMITS.maxArrayLength}`,
        ),
      );
    }
    for (const [index, text] of acceptedTexts.entries()) {
      checkString(issues, text, `${at}.answer.acceptedTexts[${index}]`);
    }
  }
  const answerKeys = Object.keys(answer).sort().join(',');
  if (
    answerKeys !== 'acceptedTexts' &&
    answerKeys !== 'acceptedTexts,caseSensitive'
  ) {
    issues.push(
      createIssue(
        'fill_blank_answer_keys',
        `${at}.answer`,
        `keys = ${answerKeys}`,
      ),
    );
  }
  // Ô trống phải thống nhất đúng "___" (ba gạch dưới) trong mọi bài.
  const markers =
    typeof prompt === 'string' ? (prompt.match(/_{2,}/gu) ?? []) : [];
  if (markers.length !== 1) {
    issues.push(
      createIssue(
        'blank_marker_inconsistent',
        `${at}.prompt`,
        `phải có đúng 1 ô trống ___, có ${markers.length}`,
      ),
    );
  } else if (markers[0] !== '___') {
    issues.push(
      createIssue(
        'blank_marker_inconsistent',
        `${at}.prompt`,
        `dùng ${JSON.stringify(markers[0])}, chuẩn của bài là "___"`,
      ),
    );
  }

  // Q194: acceptedTexts = chữ Hán + pinyin có dấu + pinyin không dấu (viết liền, chữ thường).
  const acceptedList = Array.isArray(acceptedTexts) ? acceptedTexts : [];
  const hanForms = acceptedList.filter(
    (text): text is string => typeof text === 'string' && HAN.test(text),
  );
  if (hanForms.length !== 1) {
    issues.push(
      createIssue(
        'fill_blank_missing_pinyin',
        `${at}.answer.acceptedTexts`,
        `phải có đúng 1 dạng chữ Hán, có ${hanForms.length}`,
      ),
    );
    return;
  }
  const hanzi = hanForms[0];
  const lessonWord = words.find((word) => word.hanzi === hanzi);
  const lessonWordPinyin =
    lessonWord !== undefined && typeof lessonWord.pinyin === 'string'
      ? lessonWord.pinyin
      : '';
  const sourcePinyin =
    lessonWordPinyin.length > 0
      ? lessonWordPinyin
      : (refs.words.get(hanzi)?.variants[0] ?? '');
  const marked = sourcePinyin.replace(/\s+/gu, '').toLowerCase();
  const toneless = stripToneMarks(marked);
  const normalizedAccepted = acceptedList
    .filter((text): text is string => typeof text === 'string')
    .map((text) => text.replace(/\s+/gu, '').toLowerCase());
  if (marked.length === 0 || !normalizedAccepted.includes(marked)) {
    issues.push(
      createIssue(
        'fill_blank_missing_pinyin',
        `${at}.answer.acceptedTexts`,
        `thiếu pinyin có dấu ${JSON.stringify(marked)} (Q194)`,
      ),
    );
  }
  if (!normalizedAccepted.includes(toneless)) {
    issues.push(
      createIssue(
        'fill_blank_missing_pinyin',
        `${at}.answer.acceptedTexts`,
        `thiếu pinyin không dấu ${JSON.stringify(toneless)} (Q194)`,
      ),
    );
  }
}

function validateArrange(
  issues: PilotContentIssue[],
  at: string,
  content: Record<string, unknown>,
  answer: Record<string, unknown>,
): void {
  if (Object.keys(content).join(',') !== 'tokens') {
    issues.push(
      createIssue(
        'arrange_content_keys',
        `${at}.content`,
        'chỉ được có "tokens"',
      ),
    );
  }
  const tokens = content.tokens;
  if (!Array.isArray(tokens)) {
    issues.push(
      createIssue(
        'arrange_tokens_missing',
        `${at}.content.tokens`,
        'thiếu mảng',
      ),
    );
    return;
  }
  if (tokens.length < 2) {
    issues.push(
      createIssue(
        'arrange_tokens_too_few',
        `${at}.content.tokens`,
        `${tokens.length} token`,
      ),
    );
  }
  if (tokens.length > PILOT_CONTENT_LIMITS.maxArrayLength) {
    issues.push(
      createIssue(
        'array_too_large',
        `${at}.content.tokens`,
        `${tokens.length} > ${PILOT_CONTENT_LIMITS.maxArrayLength}`,
      ),
    );
  }
  const ids: (string | null)[] = [];
  for (const [index, token] of tokens.entries()) {
    const tat = `${at}.content.tokens[${index}]`;
    if (!isRecord(token) || Object.keys(token).sort().join(',') !== 'id,text') {
      issues.push(
        createIssue('arrange_token_keys', tat, 'phải có đúng {id,text}'),
      );
      ids.push(null);
      continue;
    }
    ids.push(checkStableId(issues, token.id, `${tat}.id`));
    checkString(issues, token.text, `${tat}.text`);
  }
  const knownIds = ids.filter((id): id is string => id !== null);
  if (new Set(knownIds).size !== knownIds.length) {
    issues.push(
      createIssue(
        'arrange_token_id_duplicate',
        `${at}.content.tokens`,
        'ids lặp',
      ),
    );
  }
  if (Object.keys(answer).join(',') !== 'tokenIds') {
    issues.push(
      createIssue(
        'arrange_answer_keys',
        `${at}.answer`,
        'chỉ được có "tokenIds"',
      ),
    );
  }
  const tokenIds = answer.tokenIds;
  if (!Array.isArray(tokenIds)) {
    issues.push(
      createIssue(
        'arrange_answer_missing',
        `${at}.answer.tokenIds`,
        'thiếu mảng',
      ),
    );
    return;
  }
  if (tokenIds.length !== ids.length) {
    issues.push(
      createIssue(
        'arrange_not_permutation',
        `${at}.answer.tokenIds`,
        `answer có ${tokenIds.length} id, tokens có ${ids.length}`,
      ),
    );
  }
  const stringIds = tokenIds.filter(
    (id): id is string => typeof id === 'string',
  );
  if (new Set(stringIds).size !== stringIds.length) {
    issues.push(
      createIssue('arrange_token_duplicate', `${at}.answer.tokenIds`, 'lặp id'),
    );
  }
  const missing = knownIds.filter((id) => !stringIds.includes(id));
  const extra = stringIds.filter((id) => !knownIds.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    issues.push(
      createIssue(
        'arrange_not_permutation',
        `${at}.answer.tokenIds`,
        `thiếu ${JSON.stringify(missing)} thừa ${JSON.stringify(extra)}`,
      ),
    );
  }
  tokenIds.forEach((id, index) =>
    checkStableId(issues, id, `${at}.answer.tokenIds[${index}]`),
  );
  if (tokenIds.length === ids.length && ids.every((id) => id !== null)) {
    const answerOrder = stringIds.join('|');
    const sortedIds = [...stringIds].sort().join('|');
    if (answerOrder === sortedIds) {
      issues.push(
        createIssue(
          'arrange_ids_reveal_order',
          `${at}.answer.tokenIds`,
          `thứ tự đáp án trùng thứ tự sắp xếp id (${answerOrder})`,
        ),
      );
    }
    const tokenOrder = knownIds.join('|');
    if (tokenOrder === answerOrder) {
      issues.push(
        createIssue(
          'arrange_tokens_not_shuffled',
          `${at}.content.tokens`,
          'đang xếp đúng thứ tự đáp án, phải xáo trộn',
        ),
      );
    }
  }
}

/**
 * Kiểm 1 file. `fileName` quyết định số bài (TL-212 `pilot-hsk1:lNN`) và dải
 * `orderIndex` pilot (TL-214).
 */
export function validatePilotLesson(
  raw: unknown,
  fileName: string,
  refs: PilotReferenceData,
): PilotContentIssue[] {
  const issues: PilotContentIssue[] = [];
  const lessonNumber = derivePilotLessonNumber(fileName);
  if (lessonNumber === null) {
    issues.push(
      createIssue(
        'lesson_file_name_invalid',
        '',
        `${basename(fileName)} không khớp lesson-NN.json`,
      ),
    );
    return issues;
  }
  if (!isRecord(raw)) {
    issues.push(createIssue('lesson_missing', '', 'file phải là object JSON'));
    return issues;
  }
  if (raw.schemaVersion !== 1) {
    issues.push(
      createIssue('schema_invalid', 'schemaVersion', 'phải bằng 1 (TL-210)'),
    );
  }
  if (depth(raw) > PILOT_CONTENT_LIMITS.maxDepth) {
    issues.push(
      createIssue(
        'max_depth_exceeded',
        '',
        `depth = ${depth(raw)} > ${PILOT_CONTENT_LIMITS.maxDepth}`,
      ),
    );
  }

  const meta = raw.lesson;
  let levelCode: unknown = null;
  if (!isRecord(meta)) {
    issues.push(
      createIssue('lesson_missing', 'lesson', 'thiếu object "lesson"'),
    );
  } else {
    levelCode = meta.levelCode;
    if (
      typeof meta.slug === 'string' &&
      meta.slug.length > PILOT_CONTENT_LIMITS.maxSlugLength
    ) {
      issues.push(
        createIssue(
          'string_too_long',
          'lesson.slug',
          `${meta.slug.length} ký tự > ${PILOT_CONTENT_LIMITS.maxSlugLength}`,
        ),
      );
    }
    if (typeof meta.slug !== 'string' || !PILOT_SLUG.test(meta.slug)) {
      issues.push(
        createIssue(
          'slug_invalid',
          'lesson.slug',
          `= ${JSON.stringify(meta.slug)} (TL-215)`,
        ),
      );
    }
    if (typeof meta.slug === 'string' && /-lesson-\d+$/u.test(meta.slug)) {
      issues.push(
        createIssue(
          'slug_collides_placeholder',
          'lesson.slug',
          `slug ${meta.slug} trùng mẫu placeholder <levelSlug>-lesson-<n>`,
        ),
      );
    }
    checkString(
      issues,
      meta.title,
      'lesson.title',
      PILOT_CONTENT_LIMITS.maxTitleLength,
    );
    // §2.1: `lesson.description` không bắt buộc (≤ 2000 khi có).
    if (meta.description !== undefined) {
      checkString(
        issues,
        meta.description,
        'lesson.description',
        PILOT_CONTENT_LIMITS.maxDescriptionLength,
      );
    }
    if (
      !Number.isInteger(meta.orderIndex) ||
      (meta.orderIndex as number) < 1 ||
      (meta.orderIndex as number) > 1_000_000
    ) {
      issues.push(
        createIssue(
          'order_index_invalid',
          'lesson.orderIndex',
          `= ${String(meta.orderIndex)}`,
        ),
      );
    } else {
      const orderIndex = meta.orderIndex as number;
      if (
        orderIndex < PILOT_CONTENT_LIMITS.pilotOrderIndexMin ||
        orderIndex > PILOT_CONTENT_LIMITS.pilotOrderIndexMax
      ) {
        issues.push(
          createIssue(
            'lesson_order_index_range',
            'lesson.orderIndex',
            `= ${orderIndex} ngoài dải pilot ${PILOT_CONTENT_LIMITS.pilotOrderIndexMin}–${PILOT_CONTENT_LIMITS.pilotOrderIndexMax} (TL-214)`,
          ),
        );
      }
      if (orderIndex !== 1000 + lessonNumber) {
        issues.push(
          createIssue(
            'lesson_order_index_pilot',
            'lesson.orderIndex',
            `= ${orderIndex} nhưng file lesson-${String(lessonNumber).padStart(2, '0')} phải dùng ${1000 + lessonNumber}`,
          ),
        );
      }
    }
    if (meta.levelCode !== 'HSK1') {
      issues.push(
        createIssue(
          'level_invalid',
          'lesson.levelCode',
          `= ${JSON.stringify(meta.levelCode)}`,
        ),
      );
    }
    if (
      meta.sourceKey !== `pilot-hsk1:l${String(lessonNumber).padStart(2, '0')}`
    ) {
      issues.push(
        createIssue(
          'lesson_source_key_invalid',
          'lesson.sourceKey',
          `= ${JSON.stringify(meta.sourceKey)} (file lesson-${String(lessonNumber).padStart(2, '0')})`,
        ),
      );
    }
  }

  if (!isRecord(raw.dataSource)) {
    issues.push(
      createIssue(
        'data_source_missing',
        'dataSource',
        'thiếu object "dataSource"',
      ),
    );
  } else {
    checkString(issues, raw.dataSource.code, 'dataSource.code');
    checkString(issues, raw.dataSource.version, 'dataSource.version');
  }
  if (!isRecord(raw.review) || raw.review.status !== 'draft') {
    issues.push(
      createIssue(
        'review_status_invalid',
        'review.status',
        'phải là "draft" (Q172)',
      ),
    );
  }

  const words = validateWords(issues, raw, refs, levelCode);
  const topicKeys = validateTopics(issues, raw);
  validateExercises(issues, raw, topicKeys, words, refs);
  return issues;
}

/**
 * Kiểm cả bộ file: luật từng file + luật liên file (Pha 2: mỗi bài 20 từ HSK1
 * chưa dùng ở bài trước, slug/orderIndex/sourceKey không trùng).
 */
export function validatePilotLessonSet(
  sources: readonly PilotLessonSource[],
  refs: PilotReferenceData,
): PilotContentIssue[] {
  const issues: PilotContentIssue[] = [];
  const hanziOwner = new Map<string, string>();
  const slugOwner = new Map<string, string>();
  const orderOwner = new Map<number, string>();
  const sourceKeyOwner = new Map<string, string>();

  const crossIssue = (
    code: PilotContentErrorCode,
    path: string,
    message: string,
    fileName: string,
  ): PilotContentIssue => ({ ...createIssue(code, path, message), fileName });

  for (const source of sources) {
    const fileIssues = validatePilotLesson(source.raw, source.fileName, refs);
    for (const issue of fileIssues) {
      issues.push({ ...issue, fileName: source.fileName });
    }
    if (!isRecord(source.raw)) continue;

    if (Array.isArray(source.raw.words)) {
      for (const word of source.raw.words) {
        if (!isRecord(word) || typeof word.hanzi !== 'string') continue;
        const owner = hanziOwner.get(word.hanzi);
        if (owner !== undefined) {
          issues.push(
            crossIssue(
              'cross_lesson_hanzi_duplicate',
              'words.hanzi',
              `${word.hanzi} đã dùng ở ${owner}`,
              source.fileName,
            ),
          );
        } else {
          hanziOwner.set(word.hanzi, source.fileName);
        }
      }
    }
    const meta = source.raw.lesson;
    if (isRecord(meta)) {
      if (typeof meta.slug === 'string') {
        const owner = slugOwner.get(meta.slug);
        if (owner !== undefined) {
          issues.push(
            crossIssue(
              'cross_lesson_slug_duplicate',
              'lesson.slug',
              `${meta.slug} đã dùng ở ${owner}`,
              source.fileName,
            ),
          );
        } else {
          slugOwner.set(meta.slug, source.fileName);
        }
      }
      if (typeof meta.orderIndex === 'number') {
        const owner = orderOwner.get(meta.orderIndex);
        if (owner !== undefined) {
          issues.push(
            crossIssue(
              'cross_lesson_order_index_duplicate',
              'lesson.orderIndex',
              `${meta.orderIndex} đã dùng ở ${owner}`,
              source.fileName,
            ),
          );
        } else {
          orderOwner.set(meta.orderIndex, source.fileName);
        }
      }
      if (typeof meta.sourceKey === 'string') {
        const owner = sourceKeyOwner.get(meta.sourceKey);
        if (owner !== undefined) {
          issues.push(
            crossIssue(
              'cross_lesson_source_key_duplicate',
              'lesson.sourceKey',
              `${meta.sourceKey} đã dùng ở ${owner}`,
              source.fileName,
            ),
          );
        } else {
          sourceKeyOwner.set(meta.sourceKey, source.fileName);
        }
      }
    }
  }
  return issues;
}

export interface PilotLessonSummary {
  readonly words: number;
  readonly topics: number;
  readonly exercises: number;
  readonly types: readonly string[];
  readonly exercisePayloadBytes: number;
}

export function summarizePilotLesson(raw: unknown): PilotLessonSummary {
  if (!isRecord(raw)) {
    return {
      words: 0,
      topics: 0,
      exercises: 0,
      types: [],
      exercisePayloadBytes: 0,
    };
  }
  const words = Array.isArray(raw.words) ? raw.words.length : 0;
  const topics = Array.isArray(raw.topics) ? raw.topics.length : 0;
  const exercises = Array.isArray(raw.exercises)
    ? raw.exercises.filter(isRecord)
    : [];
  const types = [
    ...new Set(
      exercises
        .map((exercise) => exercise.type)
        .filter((type): type is string => typeof type === 'string'),
    ),
  ].sort();
  let exercisePayloadBytes = 0;
  for (const exercise of exercises) {
    const payload: Record<string, unknown> = {
      type: exercise.type,
      prompt: exercise.prompt,
      content: exercise.content,
      answer: exercise.answer,
    };
    if (exercise.explanation !== undefined) {
      payload.explanation = exercise.explanation;
    }
    exercisePayloadBytes += Buffer.byteLength(JSON.stringify(payload), 'utf8');
  }
  return {
    words,
    topics,
    exercises: exercises.length,
    types,
    exercisePayloadBytes,
  };
}

export function formatPilotIssues(
  issues: readonly PilotContentIssue[],
): string {
  return issues
    .map((issue) => {
      const where =
        issue.fileName === undefined
          ? issue.path
          : `${issue.fileName}:${issue.path}`;
      return `  - ${issue.code}: ${where} ${issue.message}`.trimEnd();
    })
    .join('\n');
}
