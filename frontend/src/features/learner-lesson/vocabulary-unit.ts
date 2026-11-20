/**
 * Step-by-step Từ vựng unit (PO 20/11/2026, N3/N4): thẻ từ → câu ví dụ →
 * chọn nghĩa. Pure and Zod-free: the client flow imports it.
 */

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
  example: { hanzi: string; pinyin: string | null; vi: string | null } | null;
};

export type UnitStep =
  | { kind: 'card'; word: number }
  | { kind: 'example'; word: number }
  | { kind: 'quiz'; word: number; options: string[]; answer: number };

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
): UnitStep[] {
  return words.flatMap((word, index): UnitStep[] => {
    const steps: UnitStep[] = [{ kind: 'card', word: index }];
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

export type SentenceToken = { hanzi: string; pinyin: string; target: boolean };

const HAN = /\p{Script=Han}/u;

/**
 * Splits an example sentence into one token per Han character with its
 * syllable above (mẫu `.lu-tok`); punctuation stays with the character before
 * it. Null when the pinyin is missing or not one syllable per character
 * (e.g. "wǒmen"): the screen then shows the plain sentence.
 */
export function sentenceTokens(
  hanzi: string,
  pinyin: string | null,
  target: string,
): SentenceToken[] | null {
  if (!pinyin) return null;
  const syllables = pinyin
    .split(/\s+/u)
    .map((part) => part.replace(/[^\p{L}\p{M}]/gu, ''))
    .filter(Boolean);
  const tokens: string[] = [];
  for (const char of hanzi) {
    if (HAN.test(char) || tokens.length === 0) tokens.push(char);
    else tokens[tokens.length - 1] += char;
  }
  const hanCount = tokens.filter((token) => HAN.test(token.charAt(0))).length;
  if (hanCount !== tokens.length || syllables.length !== tokens.length) {
    return null;
  }

  const chars = tokens.map((token) => token.charAt(0)).join('');
  const marked = new Set<number>();
  const length = [...target].length;
  if (length > 0) {
    for (
      let at = chars.indexOf(target);
      at !== -1;
      at = chars.indexOf(target, at + 1)
    ) {
      for (let offset = 0; offset < length; offset += 1)
        marked.add(at + offset);
    }
  }
  return tokens.map((token, index) => ({
    hanzi: token,
    pinyin: syllables[index] ?? '',
    target: marked.has(index),
  }));
}

/**
 * Pha C debt 3b: the result mark of a word from its wrong answers (0 = right,
 * undefined = no quiz). Q50 allows one Kiểm tra per quiz, so it reads
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
