import { createHash } from 'node:crypto';

import { normalizePinyin } from '../../common/utils/normalize-pinyin';
import {
  lessonExerciseTextMatchKey,
  MATCHING_LIMITS,
} from '../../common/validation/lesson-exercise-authoring.validator';

/**
 * M2.13b: classroom-phrase rule and auto-generated exercises of the HSK 2.0
 * textbook profile (`docs/process/content-pipeline.md` §9). Pure and
 * deterministic: answer positions and distractors come from a SHA-256 of a
 * stable seed, never from `Math.random`.
 */

/**
 * PO 23/11/2026: a seeddata vocabulary row whose hanzi carries sentence
 * punctuation is a classroom phrase (上课!, 打开书。), not a word.
 */
export function isClassroomPhrase(hanzi: string): boolean {
  return /[!！。？?，,]/u.test(hanzi);
}

/**
 * M2.13b FIX-2: `下面 (下)` → `下面`. Only a trailing ASCII or full-width
 * parenthesised note after a space-free head is removed.
 */
export function stripParenthetical(value: string): {
  value: string;
  stripped: boolean;
} {
  const match = /^(.*?\S)\s*[(（][^()（）]*[)）]$/u.exec(value);
  return match === null
    ? { value, stripped: false }
    : { value: match[1], stripped: true };
}

/** M2.13b FIX-2: `太......了` is a sentence pattern, not a word. */
export function isSentencePattern(value: string): boolean {
  return /\.{3,}|…/u.test(value);
}

export interface ExerciseWord {
  readonly hanzi: string;
  readonly pinyin: string;
  readonly meaningVi: string;
}

export interface TextbookExercise {
  readonly sourceKey: string;
  readonly topicKey: 'vocabulary';
  readonly type: 'matching' | 'mcq';
  readonly prompt: string;
  readonly content: Record<string, unknown>;
  readonly answer: Record<string, unknown>;
  readonly explanation: string;
  readonly orderIndex: number;
}

export interface ExerciseSkips {
  /** Words without three valid distractors for "chữ Hán → nghĩa". */
  readonly mcqMeaning: number;
  /** Words without three valid distractors for "pinyin → chữ Hán". */
  readonly mcqHanzi: number;
  /** Words dropped from every exercise: hanzi or meaning repeats an earlier word. */
  readonly duplicateWords: number;
}

const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;
const DISTRACTORS = OPTION_IDS.length - 1; // Q176: 1 answer + 3 distractors.

function hashNumber(seed: string): number {
  return Number.parseInt(
    createHash('sha256').update(seed).digest('hex').slice(0, 12),
    16,
  );
}

const meaningKey = (word: ExerciseWord): string =>
  lessonExerciseTextMatchKey(word.meaningVi, false);
const hanziKey = (word: ExerciseWord): string =>
  lessonExerciseTextMatchKey(word.hanzi, false);
const pinyinKey = (word: ExerciseWord): string => normalizePinyin(word.pinyin);

/** First word per key, input order kept. */
function uniqueBy(
  words: readonly ExerciseWord[],
  keys: ReadonlyArray<(word: ExerciseWord) => string>,
): ExerciseWord[] {
  const seen = keys.map(() => new Set<string>());
  return words.filter((word) => {
    const values = keys.map((key) => key(word));
    if (values.some((value, index) => seen[index].has(value))) return false;
    values.forEach((value, index) => seen[index].add(value));
    return true;
  });
}

/** Balanced chunks of 3–5 (6 → 3+3, 7 → 4+3, 11 → 4+4+3). */
function matchingChunks(words: readonly ExerciseWord[]): ExerciseWord[][] {
  if (words.length < MATCHING_LIMITS.minPairs) return [];
  const count = Math.ceil(words.length / MATCHING_LIMITS.maxPairs);
  const base = Math.floor(words.length / count);
  const extra = words.length % count;
  const chunks: ExerciseWord[][] = [];
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const size = base + (index < extra ? 1 : 0);
    chunks.push(words.slice(start, start + size));
    start += size;
  }
  return chunks;
}

/**
 * R21 (content-pipeline K-E): distractors come from the same grade, may be
 * words of the lesson, never equal the answer nor each other. Fewer than three
 * valid ones → no question (the caller counts the skip).
 */
function pickDistractors(
  seed: string,
  answer: ExerciseWord,
  pool: readonly ExerciseWord[],
  conflicts: ReadonlyArray<(word: ExerciseWord) => string>,
): ExerciseWord[] | null {
  const ranked = [...pool]
    .map((word) => ({
      word,
      rank: hashNumber(`${seed}|${word.hanzi}|${word.pinyin}`),
    }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.word.hanzi.localeCompare(b.word.hanzi) ||
        a.word.pinyin.localeCompare(b.word.pinyin),
    );
  const taken = conflicts.map((key) => new Set([key(answer)]));
  const picked: ExerciseWord[] = [];
  for (const { word } of ranked) {
    if (picked.length === DISTRACTORS) break;
    const values = conflicts.map((key) => key(word));
    if (values.some((value, index) => taken[index].has(value))) continue;
    values.forEach((value, index) => taken[index].add(value));
    picked.push(word);
  }
  return picked.length === DISTRACTORS ? picked : null;
}

function choice(
  seed: string,
  answerText: string,
  distractorTexts: readonly string[],
): { content: Record<string, unknown>; answer: Record<string, unknown> } {
  const position = hashNumber(seed) % OPTION_IDS.length;
  const texts = [...distractorTexts];
  texts.splice(position, 0, answerText);
  return {
    content: {
      options: texts.map((text, index) => ({ id: OPTION_IDS[index], text })),
    },
    answer: { optionId: OPTION_IDS[position] },
  };
}

type Draft = Omit<TextbookExercise, 'sourceKey' | 'orderIndex'>;

export function buildTextbookExercises(
  lessonSourceKey: string,
  words: readonly ExerciseWord[],
  pool: readonly ExerciseWord[],
): { exercises: TextbookExercise[]; skipped: ExerciseSkips } {
  const drafts: Draft[] = [];
  const lessonWords = uniqueBy(words, [hanziKey, meaningKey]);
  const fits = (word: ExerciseWord) =>
    word.hanzi.length <= MATCHING_LIMITS.maxLeftLength &&
    word.pinyin.length <= MATCHING_LIMITS.maxLeftReadingLength &&
    word.meaningVi.length <= MATCHING_LIMITS.maxRightLength;
  for (const chunk of matchingChunks(lessonWords.filter(fits))) {
    drafts.push({
      topicKey: 'vocabulary',
      type: 'matching',
      prompt: 'Ghép chữ Hán với nghĩa.',
      content: {
        pairs: chunk.map((word, index) => ({
          id: `p${String(index + 1)}`,
          left: word.hanzi,
          leftReading: word.pinyin,
          right: word.meaningVi,
        })),
      },
      answer: {},
      explanation: 'Mỗi chữ Hán đi với đúng một nghĩa.',
    });
  }

  const grade = uniqueBy(pool, [
    (word) => `${hanziKey(word)}|${pinyinKey(word)}`,
  ]);
  let mcqMeaning = 0;
  let mcqHanzi = 0;
  const explain = (word: ExerciseWord) =>
    `"${word.hanzi}" (${word.pinyin}) nghĩa là "${word.meaningVi}".`;
  for (const word of lessonWords) {
    const seed = `${lessonSourceKey}|meaning|${word.hanzi}|${word.pinyin}`;
    const distractors = pickDistractors(seed, word, grade, [
      hanziKey,
      meaningKey,
    ]);
    if (distractors === null) {
      mcqMeaning += 1;
      continue;
    }
    drafts.push({
      topicKey: 'vocabulary',
      type: 'mcq',
      prompt: `Chọn nghĩa đúng của "${word.hanzi}".`,
      ...choice(
        seed,
        word.meaningVi,
        distractors.map((d) => d.meaningVi),
      ),
      explanation: explain(word),
    });
  }
  for (const word of lessonWords) {
    const seed = `${lessonSourceKey}|hanzi|${word.hanzi}|${word.pinyin}`;
    // Same toneless pinyin would make two options correct.
    const distractors = pickDistractors(seed, word, grade, [
      hanziKey,
      pinyinKey,
    ]);
    if (distractors === null) {
      mcqHanzi += 1;
      continue;
    }
    drafts.push({
      topicKey: 'vocabulary',
      type: 'mcq',
      prompt: `Chọn chữ Hán đúng của "${word.pinyin}".`,
      ...choice(
        seed,
        word.hanzi,
        distractors.map((d) => d.hanzi),
      ),
      explanation: explain(word),
    });
  }

  return {
    exercises: drafts.map((draft, index) => ({
      sourceKey: `${lessonSourceKey}:e${String(index + 1).padStart(2, '0')}`,
      ...draft,
      orderIndex: index + 1,
    })),
    skipped: {
      mcqMeaning,
      mcqHanzi,
      duplicateWords: words.length - lessonWords.length,
    },
  };
}
