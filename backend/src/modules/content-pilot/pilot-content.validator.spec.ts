import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  PILOT_CONTENT_ERROR_CODES,
  PILOT_CONTENT_LIMITS,
  derivePilotLessonNumber,
  formatPilotIssues,
  loadPilotReferenceData,
  summarizePilotLesson,
  validatePilotLesson,
  validatePilotLessonSet,
  type PilotContentErrorCode,
  type PilotContentIssue,
  type PilotLessonSource,
  type PilotReferenceData,
} from './pilot-content.validator';

/**
 * TL-223: chuyển script tự kiểm `/tmp/hsk-m29a/check.mjs` (Pha 1 + 4 luật Pha 1b)
 * thành test Jest **trong repo**, không cần DB. Test đọc mọi
 * `backend/content/pilot/hsk1/lesson-NN.json` và kiểm toàn bộ luật của check.mjs:
 *
 * - 20 từ HSK1 unique, pinyin có dấu thanh khớp `pinyin_tone` trong repo;
 * - câu ví dụ chỉ dùng chữ Hán thuộc HSK1;
 * - topic/block đúng loại `text`/`vocabulary_list`;
 * - 10 bài tập chỉ `mcq`/`fill_blank`/`arrange_sentence` (Q173);
 * - `mcq` đúng 4 option, 4 vị trí đáp án rải đều 1 lần (Q176);
 * - `fill_blank` đủ 3 dạng chữ Hán + pinyin có dấu + pinyin không dấu (Q194);
 * - `arrange_sentence` là hoán vị đủ token, token bị xáo, id không lộ thứ tự;
 * - `sourceKey` TL-212, slug TL-215, `orderIndex` pilot TL-214, giới hạn payload.
 *
 * Bằng chứng "từng mã lỗi bắt được" nằm ở `test/fixtures/pilot-content/broken/`:
 * mỗi file JSON mô tả **một** lỗi (operations áp lên file `lesson-01.json` thật),
 * tên file = mã lỗi. Fixture là con trỏ tới một biến thể hỏng của bài thật thay vì
 * copy 18 KB nội dung cho mỗi mã — cùng một nguồn sự thật, không nhân bản nội dung.
 */

const BACKEND_ROOT = join(__dirname, '..', '..', '..');
const CONTENT_DIR = join(BACKEND_ROOT, 'content', 'pilot', 'hsk1');
const FIXTURE_DIR = join(
  BACKEND_ROOT,
  'test',
  'fixtures',
  'pilot-content',
  'broken',
);
const EXPECTED_LESSON_FILES = [
  'lesson-01.json',
  'lesson-02.json',
  'lesson-03.json',
  'lesson-04.json',
  'lesson-05.json',
];

interface FixtureOperation {
  readonly op: string;
  readonly path?: string;
  readonly from?: string;
  readonly to?: string;
  readonly value?: unknown;
  readonly keys?: number;
  readonly valueLength?: number;
  readonly count?: number;
  readonly exercise?: number;
  readonly fromExercise?: number;
  readonly toExercise?: number;
  readonly type?: string;
}

interface BrokenFixture {
  readonly description: string;
  readonly fileName: string;
  readonly operations: readonly FixtureOperation[];
}

/** Mã lỗi kiểm qua `validatePilotLessonSet` (cần ≥ 2 file) thay vì 1 fixture đơn. */
const CROSS_FILE_ERROR_CODES: readonly PilotContentErrorCode[] = [
  'cross_lesson_hanzi_duplicate',
  'cross_lesson_slug_duplicate',
  'cross_lesson_order_index_duplicate',
  'cross_lesson_source_key_duplicate',
];

/**
 * `word_level_mismatch` không thể tái hiện bằng dữ liệu HSK1 trong repo (mọi từ
 * `hsk1.json` đều có row `level = HSK1` trong `final_words.json` — trừ `车上`,
 * trường hợp đó rơi vào `word_absent_from_dictionary_source`), nên được kiểm bằng
 * reference data tổng hợp trong test riêng bên dưới.
 */
const SYNTHETIC_REFERENCE_ERROR_CODES: readonly PilotContentErrorCode[] = [
  'word_level_mismatch',
];

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitPath(path: string): (string | number)[] {
  return path.split('.').flatMap((segment) => {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/u.exec(segment);
    if (match === null) return [segment];
    const keys: (string | number)[] = [match[1]];
    for (const index of match[2].matchAll(/\[(\d+)\]/gu)) {
      keys.push(Number(index[1]));
    }
    return keys;
  });
}

function readPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const key of splitPath(path)) {
    if (typeof key === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else if (isRecord(current)) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function writePath(root: unknown, path: string, value: unknown): void {
  const keys = splitPath(path);
  const last = keys[keys.length - 1];
  let current: unknown = root;
  for (const key of keys.slice(0, -1)) {
    current =
      typeof key === 'number' && Array.isArray(current)
        ? current[key]
        : isRecord(current)
          ? current[key]
          : undefined;
  }
  if (typeof last === 'number' && Array.isArray(current)) {
    current[last] = value;
  } else if (last !== undefined && isRecord(current)) {
    current[last] = value;
  }
}

function deletePath(root: unknown, path: string): void {
  const keys = splitPath(path);
  const last = keys[keys.length - 1];
  let current: unknown = root;
  for (const key of keys.slice(0, -1)) {
    current =
      typeof key === 'number' && Array.isArray(current)
        ? current[key]
        : isRecord(current)
          ? current[key]
          : undefined;
  }
  if (typeof last === 'number' && Array.isArray(current)) {
    current.splice(last, 1);
  } else if (last !== undefined && isRecord(current)) {
    delete current[last];
  }
}

function readFixture(filePath: string): BrokenFixture {
  const raw = readJson(filePath);
  if (!isRecord(raw) || typeof raw.fileName !== 'string') {
    throw new Error(`Fixture sai cấu trúc: ${filePath}`);
  }
  const operations = Array.isArray(raw.operations) ? raw.operations : [];
  if (!operations.every((operation) => isRecord(operation))) {
    throw new Error(`Fixture có operation sai cấu trúc: ${filePath}`);
  }
  return {
    description: typeof raw.description === 'string' ? raw.description : '',
    fileName: raw.fileName,
    operations: operations.map((operation) => ({
      op: String(operation.op),
      path: typeof operation.path === 'string' ? operation.path : undefined,
      from: typeof operation.from === 'string' ? operation.from : undefined,
      to: typeof operation.to === 'string' ? operation.to : undefined,
      value: operation.value,
      keys: typeof operation.keys === 'number' ? operation.keys : undefined,
      valueLength:
        typeof operation.valueLength === 'number'
          ? operation.valueLength
          : undefined,
      count: typeof operation.count === 'number' ? operation.count : undefined,
      exercise:
        typeof operation.exercise === 'number' ? operation.exercise : undefined,
      fromExercise:
        typeof operation.fromExercise === 'number'
          ? operation.fromExercise
          : undefined,
      toExercise:
        typeof operation.toExercise === 'number'
          ? operation.toExercise
          : undefined,
      type: typeof operation.type === 'string' ? operation.type : undefined,
    })),
  };
}

function applyOperation(root: unknown, operation: FixtureOperation): unknown {
  switch (operation.op) {
    case 'set':
      if (operation.path === undefined) throw new Error('set thiếu path');
      writePath(root, operation.path, operation.value);
      return root;
    case 'delete':
      if (operation.path === undefined) throw new Error('delete thiếu path');
      deletePath(root, operation.path);
      return root;
    case 'copy': {
      if (operation.from === undefined || operation.to === undefined) {
        throw new Error('copy thiếu from/to');
      }
      writePath(root, operation.to, readPath(root, operation.from));
      return root;
    }
    case 'replaceRoot':
      return structuredClone(operation.value);
    case 'fillerObject': {
      if (operation.path === undefined)
        throw new Error('fillerObject thiếu path');
      const keys = operation.keys ?? 1;
      const valueLength = operation.valueLength ?? 1;
      const filler: Record<string, string> = {};
      for (let index = 0; index < keys; index += 1) {
        filler[`k${index}`] = 'x'.repeat(valueLength);
      }
      writePath(root, operation.path, filler);
      return root;
    }
    case 'arrayOptions': {
      if (operation.path === undefined)
        throw new Error('arrayOptions thiếu path');
      const count = operation.count ?? 1;
      writePath(
        root,
        operation.path,
        Array.from({ length: count }, (_, index) => ({
          id: `opt-${index}`,
          text: `t${index}`,
        })),
      );
      return root;
    }
    case 'setTypeAll': {
      const exercises = readPath(root, 'exercises');
      if (
        !Array.isArray(exercises) ||
        operation.type === undefined ||
        operation.to === undefined
      ) {
        return root;
      }
      for (const exercise of exercises) {
        if (isRecord(exercise) && exercise.type === operation.type) {
          exercise.type = operation.to;
        }
      }
      return root;
    }
    case 'skewAnswerPosition': {
      if (
        operation.fromExercise === undefined ||
        operation.toExercise === undefined
      ) {
        throw new Error('skewAnswerPosition cần exercise index');
      }
      const fromExercise = readPath(
        root,
        `exercises[${operation.fromExercise}]`,
      );
      const toExercise = readPath(root, `exercises[${operation.toExercise}]`);
      if (!isRecord(fromExercise) || !isRecord(toExercise)) {
        throw new Error('skewAnswerPosition: exercise không phải object');
      }
      const fromContent = fromExercise.content;
      const fromAnswer = fromExercise.answer;
      const toContent = toExercise.content;
      const toAnswer = toExercise.answer;
      if (
        !isRecord(fromContent) ||
        !isRecord(fromAnswer) ||
        !Array.isArray(fromContent.options) ||
        !isRecord(toContent) ||
        !isRecord(toAnswer) ||
        !Array.isArray(toContent.options)
      ) {
        throw new Error('skewAnswerPosition: thiếu options/answer');
      }
      const position = fromContent.options.findIndex(
        (option) => isRecord(option) && option.id === fromAnswer.optionId,
      );
      const target = toContent.options[position];
      if (!isRecord(target) || typeof target.id !== 'string') {
        throw new Error('skewAnswerPosition: không tìm được option đích');
      }
      toAnswer.optionId = target.id;
      return root;
    }
    case 'sortTokenIds': {
      if (operation.exercise === undefined)
        throw new Error('sortTokenIds thiếu exercise');
      const answer = readPath(root, `exercises[${operation.exercise}].answer`);
      if (!isRecord(answer) || !Array.isArray(answer.tokenIds)) {
        throw new Error('sortTokenIds: thiếu tokenIds');
      }
      answer.tokenIds = [...answer.tokenIds].sort();
      return root;
    }
    case 'reorderTokensToAnswer': {
      if (operation.exercise === undefined) {
        throw new Error('reorderTokensToAnswer thiếu exercise');
      }
      const content = readPath(
        root,
        `exercises[${operation.exercise}].content`,
      );
      const answer = readPath(root, `exercises[${operation.exercise}].answer`);
      if (
        !isRecord(content) ||
        !Array.isArray(content.tokens) ||
        !isRecord(answer) ||
        !Array.isArray(answer.tokenIds)
      ) {
        throw new Error('reorderTokensToAnswer: thiếu tokens/tokenIds');
      }
      const byId = new Map<string, unknown>();
      for (const token of content.tokens) {
        if (isRecord(token) && typeof token.id === 'string') {
          byId.set(token.id, token);
        }
      }
      content.tokens = answer.tokenIds.map((id) => byId.get(id));
      return root;
    }
    default:
      throw new Error(`Operation không hỗ trợ: ${operation.op}`);
  }
}

function loadPilotFiles(): {
  refs: PilotReferenceData;
  sources: PilotLessonSource[];
} {
  const refs = loadPilotReferenceData(BACKEND_ROOT);
  const fileNames = readdirSync(CONTENT_DIR)
    .filter((fileName) => /^lesson-\d{2}\.json$/u.test(fileName))
    .sort();
  const sources = fileNames.map((fileName) => ({
    fileName,
    raw: readJson(join(CONTENT_DIR, fileName)),
  }));
  return { refs, sources };
}

function codesOf(
  issues: readonly PilotContentIssue[],
): PilotContentErrorCode[] {
  return issues.map((issue) => issue.code);
}

describe('Nội dung pilot HSK1 (TL-223)', () => {
  const { refs, sources } = loadPilotFiles();
  const byLesson = new Map(
    sources.map((source) => [
      derivePilotLessonNumber(source.fileName) ?? -1,
      source.raw,
    ]),
  );

  it('đọc được đúng 5 file lesson-01..lesson-05', () => {
    expect(sources.map((source) => source.fileName)).toEqual(
      EXPECTED_LESSON_FILES,
    );
  });

  it('mọi file nội dung pilot hợp lệ (0 lỗi)', () => {
    const issues = validatePilotLessonSet(sources, refs);
    expect(issues).toEqual([]);
  });

  it('mỗi bài đúng 20 từ, ≥2 topic có vocabulary + grammar/key_text, 10 bài tập 3 loại', () => {
    for (const source of sources) {
      const summary = summarizePilotLesson(source.raw);
      expect(summary.words).toBe(20);
      expect(summary.topics).toBeGreaterThanOrEqual(2);
      expect(summary.exercises).toBe(10);
      expect(summary.types).toEqual(['arrange_sentence', 'fill_blank', 'mcq']);
    }
  });

  it('mỗi bài có đúng 1 topic vocabulary và 1 topic grammar/key_text', () => {
    for (const source of sources) {
      const summaryIssues = validatePilotLesson(
        source.raw,
        source.fileName,
        refs,
      );
      expect(codesOf(summaryIssues)).not.toContain('topic_vocabulary_missing');
      expect(codesOf(summaryIssues)).not.toContain(
        'topic_grammar_or_key_text_missing',
      );
    }
  });

  it('4 mcq có đáp án ở 4 vị trí 1,2,3,4 mỗi vị trí đúng 1 lần (Q176)', () => {
    for (const source of sources) {
      expect(isRecord(source.raw)).toBe(true);
      const exercises = isRecord(source.raw) ? source.raw.exercises : [];
      const positions: number[] = [];
      for (const exercise of Array.isArray(exercises) ? exercises : []) {
        if (!isRecord(exercise) || exercise.type !== 'mcq') continue;
        const content = exercise.content;
        const answer = exercise.answer;
        if (
          !isRecord(content) ||
          !Array.isArray(content.options) ||
          !isRecord(answer) ||
          typeof answer.optionId !== 'string'
        ) {
          continue;
        }
        // Q176: "đúng 4 option = 1 đáp án + 3 distractor".
        expect(content.options).toHaveLength(4);
        positions.push(
          content.options.findIndex(
            (option) => isRecord(option) && option.id === answer.optionId,
          ),
        );
      }
      expect(positions).toHaveLength(4);
      expect([...positions].sort()).toEqual([0, 1, 2, 3]);
    }
  });

  it('fill_blank.acceptedTexts đúng 3 dạng: chữ Hán, pinyin có dấu, pinyin không dấu (Q194)', () => {
    for (const source of sources) {
      const exercises = isRecord(source.raw) ? source.raw.exercises : [];
      for (const exercise of Array.isArray(exercises) ? exercises : []) {
        if (!isRecord(exercise) || exercise.type !== 'fill_blank') continue;
        const answer = exercise.answer;
        expect(isRecord(answer)).toBe(true);
        const accepted = isRecord(answer) ? answer.acceptedTexts : undefined;
        expect(Array.isArray(accepted)).toBe(true);
        if (!Array.isArray(accepted)) continue;
        expect(accepted).toHaveLength(3);
        const [hanzi, marked, toneless] = accepted as unknown[];
        expect(typeof hanzi).toBe('string');
        expect(/\p{Script=Han}/u.test(String(hanzi))).toBe(true);
        expect(typeof marked).toBe('string');
        expect(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/u.test(String(marked))).toBe(true);
        expect(typeof toneless).toBe('string');
        expect(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/u.test(String(toneless))).toBe(
          false,
        );
      }
    }
  });

  it('arrange_sentence: tokenIds là hoán vị, token bị xáo, id không lộ thứ tự', () => {
    for (const source of sources) {
      const exercises = isRecord(source.raw) ? source.raw.exercises : [];
      for (const exercise of Array.isArray(exercises) ? exercises : []) {
        if (!isRecord(exercise) || exercise.type !== 'arrange_sentence')
          continue;
        const content = exercise.content;
        const answer = exercise.answer;
        expect(isRecord(content)).toBe(true);
        expect(isRecord(answer)).toBe(true);
        if (!isRecord(content) || !isRecord(answer)) continue;
        const tokens = Array.isArray(content.tokens) ? content.tokens : [];
        const tokenIds = Array.isArray(answer.tokenIds) ? answer.tokenIds : [];
        const ids = tokens.filter(isRecord).map((token) => String(token.id));
        expect([...tokenIds].sort()).toEqual([...ids].sort());
        expect(content.tokens).not.toEqual(
          tokenIds.map((id) =>
            tokens
              .filter(isRecord)
              .find((token) => String(token.id) === String(id)),
          ),
        );
        expect(tokenIds).not.toEqual([...tokenIds].sort());
      }
    }
  });

  it('không có từ HSK1 nào lặp giữa 5 bài (100 từ unique)', () => {
    const seen = new Set<string>();
    let total = 0;
    for (const raw of byLesson.values()) {
      if (!isRecord(raw) || !Array.isArray(raw.words)) continue;
      for (const word of raw.words) {
        if (!isRecord(word) || typeof word.hanzi !== 'string') continue;
        total += 1;
        expect(seen.has(word.hanzi)).toBe(false);
        seen.add(word.hanzi);
      }
    }
    expect(total).toBe(100);
  });

  it('mỗi mã lỗi của validator đều có bằng chứng (fixture/kiểm riêng)', () => {
    const fixtureCodes = readdirSync(FIXTURE_DIR)
      .filter((fileName) => fileName.endsWith('.json'))
      .map(
        (fileName) => fileName.replace(/\.json$/u, '') as PilotContentErrorCode,
      );
    const covered = new Set<PilotContentErrorCode>([
      ...fixtureCodes,
      ...CROSS_FILE_ERROR_CODES,
      ...SYNTHETIC_REFERENCE_ERROR_CODES,
    ]);
    const missing = PILOT_CONTENT_ERROR_CODES.filter(
      (code) => !covered.has(code),
    );
    expect(missing).toEqual([]);
    const unknown = [...covered].filter(
      (code) =>
        !(PILOT_CONTENT_ERROR_CODES as readonly string[]).includes(code),
    );
    expect(unknown).toEqual([]);
  });

  describe('fixture hỏng: từng mã lỗi phải bị bắt', () => {
    const fixtureFiles = readdirSync(FIXTURE_DIR).filter((fileName) =>
      fileName.endsWith('.json'),
    );
    const baseLesson = byLesson.get(1);

    it.each(fixtureFiles)('%s', (fixtureFile) => {
      const fixture = readFixture(join(FIXTURE_DIR, fixtureFile));
      const expectedCode = fixtureFile.replace(
        /\.json$/u,
        '',
      ) as PilotContentErrorCode;
      const document = structuredClone(baseLesson);
      let mutated: unknown = document;
      for (const operation of fixture.operations) {
        mutated = applyOperation(mutated, operation);
      }
      const issues = validatePilotLesson(mutated, fixture.fileName, refs);
      const codes = codesOf(issues);
      if (!codes.includes(expectedCode)) {
        throw new Error(
          `Fixture ${fixtureFile} không bắt được mã ${expectedCode}.\n` +
            `Mô tả: ${fixture.description}\n` +
            formatPilotIssues(issues),
        );
      }
    });
  });

  describe('luật liên file (validatePilotLessonSet)', () => {
    it('phát hiện từ HSK1 dùng lại ở bài khác', () => {
      const clone = structuredClone(byLesson.get(1));
      if (!isRecord(clone)) throw new Error('lesson-01 không phải object');
      clone.lesson = {
        ...(isRecord(clone.lesson) ? clone.lesson : {}),
        sourceKey: 'pilot-hsk1:l02',
        orderIndex: 1002,
        slug: 'hsk1-pilot-l02-trung-tu',
      };
      const issues = validatePilotLessonSet(
        [
          { fileName: 'lesson-01.json', raw: byLesson.get(1) },
          { fileName: 'lesson-02.json', raw: clone },
        ],
        refs,
      );
      expect(codesOf(issues)).toContain('cross_lesson_hanzi_duplicate');
    });

    it('phát hiện trùng slug / orderIndex / sourceKey giữa các bài', () => {
      const clone = structuredClone(byLesson.get(2));
      if (!isRecord(clone)) throw new Error('lesson-02 không phải object');
      clone.lesson = {
        ...(isRecord(clone.lesson) ? clone.lesson : {}),
        slug: 'hsk1-pilot-l01-chao-hoi-gioi-thieu',
        orderIndex: 1001,
        sourceKey: 'pilot-hsk1:l01',
      };
      const issues = validatePilotLessonSet(
        [
          { fileName: 'lesson-01.json', raw: byLesson.get(1) },
          { fileName: 'lesson-02.json', raw: clone },
        ],
        refs,
      );
      const codes = codesOf(issues);
      expect(codes).toContain('cross_lesson_slug_duplicate');
      expect(codes).toContain('cross_lesson_order_index_duplicate');
      expect(codes).toContain('cross_lesson_source_key_duplicate');
    });
  });

  it('word_level_mismatch: từ không có row HSK1 trong final_words.json', () => {
    const synthetic: PilotReferenceData = {
      ...refs,
      words: new Map([
        ...refs.words,
        ['我', { variants: ['wǒ'], hasHsk1Level: false }],
      ]),
    };
    const issues = validatePilotLesson(
      byLesson.get(1),
      'lesson-01.json',
      synthetic,
    );
    expect(codesOf(issues)).toContain('word_level_mismatch');
  });

  it('giới hạn payload/depth khớp validator bài tập của backend', () => {
    expect(PILOT_CONTENT_LIMITS.maxJsonBytes).toBe(65_536);
    expect(PILOT_CONTENT_LIMITS.maxDepth).toBe(8);
    expect(PILOT_CONTENT_LIMITS.maxStringLength).toBe(4096);
    expect(PILOT_CONTENT_LIMITS.minMcqOptions).toBe(4);
  });
});
