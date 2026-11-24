/**
 * Step-by-step Từ vựng unit (PO 20/11/2026, N3/N4): thẻ từ → câu ví dụ →
 * chọn nghĩa, then the review drills (Pha G2c). Pure and Zod-free: the
 * client flow imports it.
 */
import type { DrillStep } from './vocabulary-drills';

export type UnitWord = {
  id: number;
  hanzi: string;
  /** Display pinyin (tone marks). */
  pinyin: string;
  /** Every Vietnamese meaning joined with "; " (Q70), null when none. */
  meaning: string | null;
  firstMeaning: string | null;
  partOfSpeech: string | null;
  image: { id: number; altText: string | null } | null;
  /** M2.13c2: the speaker button; null hides it. */
  audio?: { mediaId: number } | null;
  example: { hanzi: string; pinyin: string | null; vi: string | null } | null;
};

export type WordStep =
  | { kind: 'card'; word: number }
  | { kind: 'example'; word: number }
  | { kind: 'quiz'; word: number; options: string[]; answer: number };

export type UnitStep = WordStep | DrillStep;

const DISTRACTORS = 2;

/**
 * Steps of a unit. A quiz has the word's meaning plus up to two other
 * meanings of the lesson (`pool`, lesson order), picked and placed from the
 * word's position and id so a reload shows the same question. A word without
 * a meaning, or with no other meaning to offer, has no quiz.
 */
export function unitSteps(
  words: readonly UnitWord[],
  pool: readonly UnitWord[],
): WordStep[] {
  return words.flatMap((word, index): WordStep[] => {
    const steps: WordStep[] = [{ kind: 'card', word: index }];
    if (word.example) steps.push({ kind: 'example', word: index });
    const correct = word.meaning;
    if (correct === null) return steps;

    const candidates = [
      ...new Set(
        pool
          .filter((other) => other.id !== word.id)
          .map((other) => other.meaning)
          .filter(
            (meaning): meaning is string => !!meaning && meaning !== correct,
          ),
      ),
    ];
    if (candidates.length === 0) return steps;

    const start = Math.max(
      0,
      pool.findIndex((other) => other.id === word.id),
    );
    const count = Math.min(DISTRACTORS, candidates.length);
    const options: string[] = [];
    for (let offset = 0; offset < count; offset += 1) {
      options.push(candidates[(start + offset) % candidates.length] ?? '');
    }
    const answer = word.id % (count + 1);
    options.splice(answer, 0, correct);
    steps.push({ kind: 'quiz', word: index, options, answer });
    return steps;
  });
}

/**
 * Pha C debt 3b: the result mark of a word from its wrong answers (0 = right,
 * undefined = no quiz). Q50 allows one answer per quiz, so it reads
 * "Sai 1 lần" today; the count stays true if retries come.
 */
export function answerMark(
  wrong: number | undefined,
): { tone: 'is-ok' | 'is-wrong'; text: string } | null {
  if (wrong === undefined) return null;
  return wrong === 0
    ? { tone: 'is-ok', text: 'Đúng' }
    : { tone: 'is-wrong', text: `Sai ${wrong} lần` };
}
