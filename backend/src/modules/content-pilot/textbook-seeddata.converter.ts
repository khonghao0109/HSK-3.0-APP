import { validateTopicContentBlocks } from '../../common/validation/topic-content-blocks';

/**
 * M2.13a: converts PO seeddata of the HSK 2.0 textbook (vocabulary file +
 * lesson file) into one `textbook` import file per lesson
 * (`docs/process/content-pipeline.md` §9). Pure and deterministic: no I/O, no
 * clock, output order follows the input. Seeddata is untrusted: every record
 * is checked against a closed schema and every issue names its exact path.
 */

export const TEXTBOOK_COURSE = {
  code: 'HSK2_TEXTBOOK',
  kind: 'textbook',
  curriculumVersion: 'HSK_2_0',
  title: 'Giáo trình HSK chuẩn 2.0',
  orderIndex: 200,
} as const;

export const TEXTBOOK_DATA_SOURCE = {
  code: 'HSK20_TEXTBOOK_PO_V1',
  version: '1.0.0',
} as const;

// Limits of the CMS blocks (`topic-content-blocks.ts`).
const DIALOGUE_MAX_LINES = 40;
const SLUG_TAIL_MAX = 60;

export interface TextbookWord {
  readonly hanzi: string;
  readonly pinyin: string;
  readonly meaningVi: string;
  readonly partOfSpeech: string | null;
  readonly audioRef: string;
  readonly topicKey: 'vocabulary';
}

export type TextbookBlock =
  | { readonly type: 'vocabulary_list'; readonly value: 'lesson_words' }
  | { readonly type: 'text'; readonly value: string }
  | {
      readonly type: 'dialogue';
      readonly lines: ReadonlyArray<{
        speaker: string;
        hanzi: string;
        pinyin: string;
        vi: string;
      }>;
    }
  | {
      readonly type: 'grammar_point';
      readonly title: string;
      readonly formula: ReadonlyArray<{ role: string; zh: string; vi: string }>;
      readonly explanation: string;
      readonly examples: ReadonlyArray<{
        hanzi: string;
        pinyin: string;
        vi: string;
      }>;
    };

export interface TextbookTopic {
  readonly key: 'vocabulary' | 'key_text' | 'grammar';
  readonly type: 'vocabulary' | 'key_text' | 'grammar';
  readonly title: string;
  readonly orderIndex: number;
  readonly isPremium: false;
  readonly isLocked: false;
  readonly content: readonly TextbookBlock[];
}

export interface TextbookLessonFile {
  readonly format: 'textbook';
  readonly formatVersion: 1;
  readonly course: typeof TEXTBOOK_COURSE;
  readonly unit: {
    readonly gradeNumber: number;
    readonly volume: null;
    readonly orderIndex: number;
    readonly title: string;
  };
  readonly dataSource: typeof TEXTBOOK_DATA_SOURCE;
  readonly lesson: {
    readonly sourceKey: string;
    readonly slug: string;
    readonly title: string;
    readonly description: string;
    readonly orderIndex: number;
  };
  readonly words: readonly TextbookWord[];
  readonly topics: readonly TextbookTopic[];
  /** Audio file names for the media phase; never read here. */
  readonly keyTextAudioRefs: readonly string[];
}

export interface TextbookSeeddataIssue {
  readonly code:
    | 'field_unknown'
    | 'field_missing'
    | 'field_type'
    | 'field_empty'
    | 'lesson_duplicate'
    | 'lesson_missing_in_vocab'
    | 'lesson_missing_in_lessons'
    | 'lesson_empty'
    | 'block_too_long'
    | 'grammar_meaning_empty'
    | 'block_invalid';
  readonly path: string;
  /** Shape of the rejected value (type, never the value itself). */
  readonly detail?: string;
}

function shapeOf(value: unknown): string {
  if (typeof value !== 'string') return value === null ? 'null' : typeof value;
  if (/^\d+$/.test(value)) return 'string(digits)';
  if (/\d+\s*$/.test(value)) return 'string(text+digits)';
  return 'string(text)';
}

export class TextbookSeeddataError extends Error {
  constructor(readonly issues: readonly TextbookSeeddataIssue[]) {
    super(
      `seeddata không hợp lệ (${String(issues.length)} lỗi):\n${issues
        .map(
          (issue) =>
            `- ${issue.code} ${issue.path}${issue.detail === undefined ? '' : ` [${issue.detail}]`}`,
        )
        .join('\n')}`,
    );
    this.name = 'TextbookSeeddataError';
  }
}

export interface ConvertTextbookInput {
  readonly vocab: unknown;
  readonly lessons: unknown;
  readonly grade: number;
  readonly from: number;
  readonly to: number;
}

// `lessonNumber`: an int, or a label ending with it ("Bài 1") as in the vocab
// file. `ignored`: a known field this phase does not use (may be absent).
type FieldKind = 'text' | 'int' | 'lessonNumber' | 'id' | 'array' | 'ignored';

const LESSON_LABEL = /^\D{0,12}?(\d+)$/u;

export function lessonNumberOf(value: unknown): number | null {
  if (Number.isSafeInteger(value) && (value as number) >= 1) {
    return value as number;
  }
  if (typeof value !== 'string') return null;
  const match = LESSON_LABEL.exec(value.trim());
  const number = match === null ? NaN : Number(match[1]);
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

interface VocabWord {
  han: string;
  pinyin: string;
  vi: string;
  pos: string;
  audio_file: string;
}

interface VocabLesson {
  bai: number;
  ten: string;
  ten_vi: string;
  tu_vung: VocabWord[];
}

interface LessonLine {
  speaker: string;
  text_han: string;
  pinyin: string;
  meaning: string;
  audio: string;
}

interface LessonText {
  type: 'dialog' | 'paragraph';
  audio_file: string;
  content: LessonLine[];
}

interface LessonGrammar {
  pattern: string;
  structure: string;
  type: string;
  explanation: string;
  example: string;
  pinyin: string;
  meaning: string;
}

interface LessonRecord {
  bai: number;
  ten: string;
  ten_vi: string;
  bai_khoa: LessonText[];
  ngu_phap: LessonGrammar[];
}

class Checker {
  readonly issues: TextbookSeeddataIssue[] = [];

  /** Checks a closed object schema; returns null when the value is unusable. */
  record(
    value: unknown,
    path: string,
    fields: Readonly<Record<string, FieldKind>>,
    optionalEmpty: readonly string[] = [],
  ): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.issues.push({ code: 'field_type', path });
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!(key in fields)) {
        this.issues.push({ code: 'field_unknown', path: `${path}.${key}` });
      }
    }
    let ok = true;
    for (const [key, kind] of Object.entries(fields)) {
      const at = `${path}.${key}`;
      const field = record[key];
      if (kind === 'ignored') continue;
      if (field === undefined) {
        this.issues.push({ code: 'field_missing', path: at });
        ok = false;
      } else if (kind === 'text') {
        if (typeof field !== 'string') {
          this.issues.push({ code: 'field_type', path: at });
          ok = false;
        } else if (field.trim() === '' && !optionalEmpty.includes(key)) {
          this.issues.push({ code: 'field_empty', path: at });
          ok = false;
        }
      } else if (kind === 'int') {
        if (!Number.isSafeInteger(field) || (field as number) < 1) {
          this.issues.push({
            code: 'field_type',
            path: at,
            detail: shapeOf(field),
          });
          ok = false;
        }
      } else if (kind === 'lessonNumber') {
        if (lessonNumberOf(field) === null) {
          this.issues.push({
            code: 'field_type',
            path: at,
            detail: shapeOf(field),
          });
          ok = false;
        }
      } else if (kind === 'id') {
        if (
          !(typeof field === 'string' && field.trim() !== '') &&
          !Number.isSafeInteger(field)
        ) {
          this.issues.push({ code: 'field_type', path: at });
          ok = false;
        }
      } else if (!Array.isArray(field)) {
        this.issues.push({ code: 'field_type', path: at });
        ok = false;
      }
    }
    return ok ? record : null;
  }

  array(value: unknown, path: string): unknown[] {
    if (Array.isArray(value)) return value;
    this.issues.push({ code: 'field_type', path });
    return [];
  }
}

const VOCAB_LESSON_FIELDS = {
  bai: 'lessonNumber',
  ten: 'text',
  ten_vi: 'text',
  tu_vung: 'array',
} as const;
const VOCAB_WORD_FIELDS = {
  id: 'id',
  han: 'text',
  pinyin: 'text',
  vi: 'text',
  pos: 'text',
  audio_file: 'text',
  audio: 'ignored',
} as const;
const LESSON_FIELDS = {
  bai: 'int',
  ten: 'text',
  ten_vi: 'text',
  bai_khoa: 'array',
  ngu_phap: 'array',
} as const;
const TEXT_FIELDS = {
  type: 'text',
  audio_file: 'text',
  content: 'array',
  text_id: 'ignored',
  title_han: 'ignored',
  title_vi: 'ignored',
  text_han: 'ignored',
  text_vi: 'ignored',
  fileURL: 'ignored',
} as const;
const LINE_FIELDS = {
  speaker: 'text',
  text_han: 'text',
  pinyin: 'text',
  meaning: 'text',
  audio: 'text',
  speaker_vi: 'ignored',
} as const;
const GRAMMAR_FIELDS = {
  pattern: 'text',
  structure: 'text',
  type: 'text',
  explanation: 'text',
  example: 'text',
  pinyin: 'text',
  meaning: 'text',
  gramID: 'ignored',
  patternID: 'ignored',
} as const;
// Empty in part of the seeddata: not used, or handled per lesson in range.
const GRAMMAR_OPTIONAL_EMPTY = ['type', 'structure', 'meaning'];

/** ASCII of a Vietnamese title: no diacritics, đ → d, kebab-case. */
export function slugTail(title: string): string {
  const ascii = title
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = ascii.slice(0, SLUG_TAIL_MAX).replace(/-+$/g, '');
  return cut === '' ? 'bai' : cut;
}

function isSupplementary(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const tenVi = (entry as Record<string, unknown>).ten_vi;
  return typeof tenVi === 'string' && slugTail(tenVi).includes('bo-sung');
}

function readVocab(raw: unknown, check: Checker): Map<number, VocabLesson> {
  const entries = check.array(raw, 'vocab');
  // The last entry "Từ vựng bổ sung" is a word pool, not a lesson.
  const lessons =
    entries.length > 0 && isSupplementary(entries[entries.length - 1])
      ? entries.slice(0, -1)
      : entries;
  const byNumber = new Map<number, VocabLesson>();
  lessons.forEach((entry, index) => {
    const path = `vocab[${String(index)}]`;
    const record = check.record(entry, path, VOCAB_LESSON_FIELDS);
    const words = check
      .array(
        typeof entry === 'object' && entry !== null
          ? (entry as Record<string, unknown>).tu_vung
          : undefined,
        `${path}.tu_vung`,
      )
      .map((word, wordIndex) =>
        check.record(
          word,
          `${path}.tu_vung[${String(wordIndex)}]`,
          VOCAB_WORD_FIELDS,
          ['pos'],
        ),
      );
    if (record === null || words.some((word) => word === null)) return;
    const bai = lessonNumberOf(record.bai) as number;
    if (byNumber.has(bai)) {
      check.issues.push({ code: 'lesson_duplicate', path: `${path}.bai` });
      return;
    }
    byNumber.set(bai, {
      bai,
      ten: record.ten as string,
      ten_vi: record.ten_vi as string,
      tu_vung: (words as Array<Record<string, unknown>>).map((word) => ({
        han: word.han as string,
        pinyin: word.pinyin as string,
        vi: word.vi as string,
        pos: word.pos as string,
        audio_file: word.audio_file as string,
      })),
    });
  });
  return byNumber;
}

function readLessons(raw: unknown, check: Checker): Map<number, LessonRecord> {
  const byNumber = new Map<number, LessonRecord>();
  check.array(raw, 'lessons').forEach((entry, index) => {
    const path = `lessons[${String(index)}]`;
    const record = check.record(entry, path, LESSON_FIELDS);
    const source =
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)
        : {};
    let ok = record !== null;
    check.array(source.bai_khoa, `${path}.bai_khoa`).forEach((text, t) => {
      const at = `${path}.bai_khoa[${String(t)}]`;
      const textRecord = check.record(text, at, TEXT_FIELDS);
      if (
        textRecord !== null &&
        textRecord.type !== 'dialog' &&
        textRecord.type !== 'paragraph'
      ) {
        check.issues.push({ code: 'field_type', path: `${at}.type` });
        ok = false;
      }
      const lines =
        typeof text === 'object' && text !== null
          ? (text as Record<string, unknown>).content
          : undefined;
      check.array(lines, `${at}.content`).forEach((line, l) => {
        // A paragraph has no speaker; a dialogue line must name one.
        const lineRecord = check.record(
          line,
          `${at}.content[${String(l)}]`,
          LINE_FIELDS,
          textRecord?.type === 'paragraph' ? ['speaker'] : [],
        );
        if (lineRecord === null) ok = false;
      });
      if (textRecord === null) ok = false;
    });
    check.array(source.ngu_phap, `${path}.ngu_phap`).forEach((grammar, g) => {
      if (
        check.record(
          grammar,
          `${path}.ngu_phap[${String(g)}]`,
          GRAMMAR_FIELDS,
          GRAMMAR_OPTIONAL_EMPTY,
        ) === null
      ) {
        ok = false;
      }
    });
    if (!ok || record === null) return;
    const bai = record.bai as number;
    if (byNumber.has(bai)) {
      check.issues.push({ code: 'lesson_duplicate', path: `${path}.bai` });
      return;
    }
    const texts = source.bai_khoa as Array<Record<string, unknown>>;
    const grammar = source.ngu_phap as Array<Record<string, string>>;
    byNumber.set(bai, {
      bai,
      ten: record.ten as string,
      ten_vi: record.ten_vi as string,
      bai_khoa: texts.map((text) => ({
        type: text.type as LessonText['type'],
        audio_file: text.audio_file as string,
        content: (text.content as Array<Record<string, string>>).map(
          (line) => ({
            speaker: line.speaker,
            text_han: line.text_han,
            pinyin: line.pinyin,
            meaning: line.meaning,
            audio: line.audio,
          }),
        ),
      })),
      ngu_phap: grammar.map((item) => ({
        pattern: item.pattern,
        structure: item.structure,
        type: item.type,
        explanation: item.explanation,
        example: item.example,
        pinyin: item.pinyin,
        meaning: item.meaning,
      })),
    });
  });
  return byNumber;
}

function keyTextBlocks(texts: readonly LessonText[]): TextbookBlock[] {
  const blocks: TextbookBlock[] = [];
  for (const text of texts) {
    if (text.type === 'paragraph') {
      for (const line of text.content) {
        blocks.push({
          type: 'text',
          value: `${line.text_han}\n${line.pinyin}\n${line.meaning}`,
        });
      }
      continue;
    }
    for (
      let start = 0;
      start < text.content.length;
      start += DIALOGUE_MAX_LINES
    ) {
      blocks.push({
        type: 'dialogue',
        lines: text.content
          .slice(start, start + DIALOGUE_MAX_LINES)
          .map((line) => ({
            speaker: line.speaker,
            hanzi: line.text_han,
            pinyin: line.pinyin,
            vi: line.meaning,
          })),
      });
    }
  }
  return blocks;
}

/**
 * `structure` ("Chủ ngữ + 是 + N") becomes formula chips split on "+". The
 * seeddata has no Vietnamese label per chip, so a chip repeats its own text;
 * chips with Han characters are the key words.
 */
function grammarBlock(grammar: LessonGrammar): TextbookBlock {
  const source =
    grammar.structure.trim() === '' ? grammar.pattern : grammar.structure;
  // A chip longer than the CMS limit (zh ≤ 20) is split on spaces.
  const chips = source
    .split('+')
    .flatMap((part) => (part.trim().length > 20 ? part.split(/\s+/u) : [part]))
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return {
    type: 'grammar_point',
    title: grammar.pattern,
    formula: chips.map((chip) => ({
      role: /\p{Script=Han}/u.test(chip) ? 'key' : 'other',
      zh: chip,
      vi: chip,
    })),
    explanation: grammar.explanation,
    examples: [
      { hanzi: grammar.example, pinyin: grammar.pinyin, vi: grammar.meaning },
    ],
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function buildFile(
  grade: number,
  vocab: VocabLesson,
  lesson: LessonRecord,
): TextbookLessonFile {
  const number = pad(lesson.bai);
  const topics: TextbookTopic[] = [
    {
      key: 'vocabulary',
      type: 'vocabulary',
      title: `Từ vựng bài ${String(lesson.bai)}`,
      orderIndex: 1,
      isPremium: false,
      isLocked: false,
      content: [{ type: 'vocabulary_list', value: 'lesson_words' }],
    },
  ];
  const keyText = keyTextBlocks(lesson.bai_khoa);
  if (keyText.length > 0) {
    topics.push({
      key: 'key_text',
      type: 'key_text',
      title: `Bài khoá bài ${String(lesson.bai)}`,
      orderIndex: 2,
      isPremium: false,
      isLocked: false,
      content: keyText,
    });
  }
  if (lesson.ngu_phap.length > 0) {
    topics.push({
      key: 'grammar',
      type: 'grammar',
      title: `Ngữ pháp bài ${String(lesson.bai)}`,
      orderIndex: 3,
      isPremium: false,
      isLocked: false,
      content: lesson.ngu_phap.map(grammarBlock),
    });
  }
  return {
    format: 'textbook',
    formatVersion: 1,
    course: TEXTBOOK_COURSE,
    unit: {
      gradeNumber: grade,
      volume: null,
      orderIndex: grade,
      title: `HSK 2.0 — Cấp ${String(grade)}`,
    },
    dataSource: TEXTBOOK_DATA_SOURCE,
    lesson: {
      sourceKey: `hsk2-textbook:g${String(grade)}:l${number}`,
      slug: `hsk2-textbook-g${String(grade)}-l${number}-${slugTail(lesson.ten_vi)}`,
      title: lesson.ten_vi,
      description: lesson.ten,
      orderIndex: lesson.bai,
    },
    words: vocab.tu_vung.map((word) => ({
      hanzi: word.han,
      pinyin: word.pinyin,
      meaningVi: word.vi,
      partOfSpeech: word.pos.trim() === '' ? null : word.pos,
      audioRef: word.audio_file,
      topicKey: 'vocabulary',
    })),
    topics,
    keyTextAudioRefs: lesson.bai_khoa.flatMap((text) => [
      text.audio_file,
      ...text.content.map((line) => line.audio),
    ]),
  };
}

export function convertTextbookSeeddata(
  input: ConvertTextbookInput,
): Array<{ fileName: string; content: TextbookLessonFile }> {
  const check = new Checker();
  const vocab = readVocab(input.vocab, check);
  const lessons = readLessons(input.lessons, check);
  if (check.issues.length > 0) throw new TextbookSeeddataError(check.issues);

  for (const bai of [...vocab.keys()].sort((a, b) => a - b)) {
    if (!lessons.has(bai)) {
      check.issues.push({
        code: 'lesson_missing_in_lessons',
        path: `vocab bai=${String(bai)}`,
      });
    }
  }
  for (const bai of [...lessons.keys()].sort((a, b) => a - b)) {
    if (!vocab.has(bai)) {
      check.issues.push({
        code: 'lesson_missing_in_vocab',
        path: `lessons bai=${String(bai)}`,
      });
    }
  }
  if (check.issues.length > 0) throw new TextbookSeeddataError(check.issues);

  const files: Array<{ fileName: string; content: TextbookLessonFile }> = [];
  for (let bai = input.from; bai <= input.to; bai += 1) {
    const vocabLesson = vocab.get(bai);
    const lesson = lessons.get(bai);
    if (vocabLesson === undefined || lesson === undefined) {
      check.issues.push({
        code: 'lesson_missing_in_vocab',
        path: `bai=${String(bai)}`,
      });
      continue;
    }
    lesson.ngu_phap.forEach((item, index) => {
      if (item.meaning.trim() === '') {
        check.issues.push({
          code: 'grammar_meaning_empty',
          path: `lessons bai=${String(bai)} ngu_phap[${String(index)}].meaning`,
        });
      }
    });
    if (vocabLesson.tu_vung.length === 0) {
      check.issues.push({
        code: 'lesson_empty',
        path: `vocab bai=${String(bai)}`,
      });
      continue;
    }
    const content = buildFile(input.grade, vocabLesson, lesson);
    // Never emit a file the CMS validator (and so the importer) rejects.
    for (const topic of content.topics) {
      for (const issue of validateTopicContentBlocks(
        topic.type,
        topic.content,
      )) {
        check.issues.push({
          code: 'block_invalid',
          path: `lessons bai=${String(bai)} ${topic.key} ${issue.path}`,
        });
      }
    }
    files.push({ fileName: `lesson-${pad(bai)}.json`, content });
  }
  if (check.issues.length > 0) throw new TextbookSeeddataError(check.issues);
  return files;
}

/** Stable bytes for hashing: insertion-ordered keys, 2-space indent, final LF. */
export function serializeTextbookLesson(file: TextbookLessonFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
