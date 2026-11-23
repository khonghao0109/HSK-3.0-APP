/**
 * Pha G2c (PO 22/11/2026): the four review drills that end a Từ vựng unit,
 * built from the unit's own words: ghép cặp, điền chỗ trống, sắp xếp theo
 * nghĩa tiếng Việt, nghe rồi sắp xếp. Graded on the client, no attempt is
 * written (Q-G8). Pure, deterministic (no Math.random) and Zod-free: the
 * client flow imports it.
 */
import type { MatchingPair } from './lesson-player-model';
import type { UnitWord } from './vocabulary-unit';

export type DrillChip = { hanzi: string; pinyin: string };

type Arrange = {
  sentence: string;
  pinyin: string;
  /** Chips in sentence order. */
  chips: DrillChip[];
  /** Chip indexes as the bank shows them; never the sentence order. */
  bank: number[];
};

export type DrillStep =
  | { kind: 'match'; pairs: MatchingPair[]; rightOrder: string[] }
  | {
      kind: 'fill';
      sentence: string;
      before: string;
      after: string;
      vi: string | null;
      options: DrillChip[];
      answer: number;
    }
  | ({ kind: 'arrange'; vi: string } & Arrange)
  | ({ kind: 'listen'; vi: string | null } & Arrange);

const MATCH_MIN = 3;
const MATCH_MAX = 5;
const FILL_DISTRACTORS = 3;
const CHIPS_MIN = 3;
const CHIPS_MAX = 7;

const HAN = /\p{Script=Han}/u;
const VOWEL = /[aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/u;

/** Syllables of one pinyin word: one per run of vowels ("xuéshēng" = 2). */
function syllables(word: string): number {
  let count = 0;
  let inVowel = false;
  for (const char of word.toLowerCase()) {
    const vowel = VOWEL.test(char);
    if (vowel && !inVowel) count += 1;
    inVowel = vowel;
  }
  return count;
}

/**
 * The chips of a sentence. Characters split by the longest lesson word, the rest one by one;
 * a chip never cuts a pinyin word of the sentence, so each chip carries its
 * own pinyin (Q-G6). Null when the pinyin does not match the characters.
 */
export function sentenceChips(
  hanzi: string,
  pinyin: string | null,
  lesson: readonly { hanzi: string; pinyin: string }[],
): DrillChip[] | null {
  if (!pinyin) return null;
  const text = [...hanzi].filter((char) => HAN.test(char)).join('');
  const words = pinyin
    .normalize('NFC')
    .split(/\s+/u)
    .map((word) => word.replace(/[^\p{L}\p{M}'’]/gu, ''))
    .filter(Boolean);
  const counts = words.map(syllables);
  const length = [...text].length;
  if (counts.includes(0) || counts.reduce((a, b) => a + b, 0) !== length) {
    return null;
  }

  const spans: { end: number; word: string }[] = [];
  let at = 0;
  words.forEach((word, index) => {
    at += counts[index] ?? 0;
    spans.push({ end: at, word });
  });
  const pinyinEnds = new Set(spans.map((span) => span.end));

  const chars = [...text];
  const lessonWords = [
    ...new Set(
      lesson
        .map((word) => word.hanzi)
        .filter((word) => [...word].every((char) => HAN.test(char))),
    ),
  ].sort((a, b) => [...b].length - [...a].length);
  const ends: number[] = [];
  for (let index = 0; index < chars.length;) {
    const rest = chars.slice(index).join('');
    const match = lessonWords.find((word) => rest.startsWith(word));
    index += match ? [...match].length : 1;
    if (pinyinEnds.has(index)) ends.push(index);
  }

  const capital = new Set(
    lesson
      .filter((word) => /^\p{Lu}/u.test(word.pinyin))
      .map((word) => word.hanzi),
  );
  let start = 0;
  return ends.map((end, index) => {
    const chip = chars.slice(start, end).join('');
    const said = spans
      .filter((span) => span.end > start && span.end <= end)
      .map((span) => span.word)
      .join(' ');
    start = end;
    // The sentence capital would give the first chip away; a name keeps it.
    const pinyinText =
      index === 0 && !capital.has(chip)
        ? said.charAt(0).toLowerCase() + said.slice(1)
        : said;
    return { hanzi: chip, pinyin: pinyinText };
  });
}

/** Right when each place holds the chip of the sentence (equal chips swap). */
export function arrangedRight(
  chips: readonly DrillChip[],
  order: readonly number[],
): boolean {
  return (
    order.length === chips.length &&
    order.every((chip, place) => chips[chip]?.hanzi === chips[place]?.hanzi)
  );
}

/** A fixed shuffle of 0..length-1 from the seed; never the identity. */
function shuffle(length: number, seed: number): number[] {
  const order = Array.from({ length }, (_, index) => index);
  let state = (Math.abs(seed) % 2147483646) + 1;
  for (let index = length - 1; index > 0; index -= 1) {
    state = (state * 48271) % 2147483647;
    const other = state % (index + 1);
    [order[index], order[other]] = [order[other] ?? 0, order[index] ?? 0];
  }
  if (length > 1 && order.every((value, index) => value === index)) {
    order.push(order.shift() ?? 0);
  }
  return order;
}

const partsOfSpeech = (value: string | null) =>
  new Set(
    (value ?? '')
      .split(/[,/;]/u)
      .map((part) => part.trim())
      .filter(Boolean),
  );

function matchDrill(
  words: readonly UnitWord[],
  seed: number,
): DrillStep | null {
  const seen = new Set<string>();
  const chosen = words.filter((word) => {
    const meaning = word.firstMeaning;
    if (!meaning || seen.has(meaning) || seen.size >= MATCH_MAX) return false;
    seen.add(meaning);
    return true;
  });
  if (chosen.length < MATCH_MIN) return null;
  const pairs = chosen.map((word) => ({
    id: String(word.id),
    left: word.hanzi,
    leftReading: word.pinyin,
    right: word.firstMeaning ?? '',
  }));
  return {
    kind: 'match',
    pairs,
    rightOrder: shuffle(pairs.length, seed).map(
      (index) => pairs[index]?.id ?? '',
    ),
  };
}

/**
 * Điền chỗ trống: the first example that holds its word once, with three
 * other lesson words of another part of speech (Q-G3). None of those: no
 * drill, never a distractor of the same part of speech.
 */
function fillDrill(
  words: readonly UnitWord[],
  pool: readonly UnitWord[],
  seed: number,
): Extract<DrillStep, { kind: 'fill' }> | null {
  const others = [
    ...new Map([...words, ...pool].map((word) => [word.hanzi, word])).values(),
  ];
  for (const word of words) {
    const example = word.example;
    const target = partsOfSpeech(word.partOfSpeech);
    if (!example || target.size === 0) continue;
    const parts = example.hanzi.split(word.hanzi);
    if (parts.length !== 2) continue;

    const distractors = others.filter((other) => {
      const pos = partsOfSpeech(other.partOfSpeech);
      return (
        pos.size > 0 &&
        ![...pos].some((part) => target.has(part)) &&
        !other.hanzi.includes(word.hanzi) &&
        !word.hanzi.includes(other.hanzi)
      );
    });
    if (distractors.length < FILL_DISTRACTORS) continue;

    const options: DrillChip[] = [];
    for (let offset = 0; offset < FILL_DISTRACTORS; offset += 1) {
      const other = distractors[(seed + offset) % distractors.length];
      if (other) options.push({ hanzi: other.hanzi, pinyin: other.pinyin });
    }
    const answer = word.id % (FILL_DISTRACTORS + 1);
    options.splice(answer, 0, { hanzi: word.hanzi, pinyin: word.pinyin });
    return {
      kind: 'fill',
      sentence: example.hanzi,
      before: parts[0] ?? '',
      after: parts[1] ?? '',
      vi: example.vi,
      options,
      answer,
    };
  }
  return null;
}

/**
 * The four drills that end a unit, in order (PO G2c). Each one is left out
 * when the unit lacks what it needs; the flow also leaves out "listen" on a
 * device without a zh voice.
 */
export function unitDrills(
  words: readonly UnitWord[],
  pool: readonly UnitWord[],
): DrillStep[] {
  const seed = words.reduce((sum, word) => sum + word.id, 0);
  const drills: DrillStep[] = [];
  const match = matchDrill(words, seed);
  if (match) drills.push(match);
  const fill = fillDrill(words, pool, seed);
  if (fill) drills.push(fill);

  const lesson = [...words, ...pool];
  const sentences: (Arrange & { vi: string | null })[] = [];
  for (const word of words) {
    const example = word.example;
    if (!example || sentences.some((item) => item.sentence === example.hanzi)) {
      continue;
    }
    const chips = sentenceChips(example.hanzi, example.pinyin, lesson);
    if (!chips || chips.length < CHIPS_MIN || chips.length > CHIPS_MAX) {
      continue;
    }
    sentences.push({
      sentence: example.hanzi,
      pinyin: example.pinyin ?? '',
      vi: example.vi,
      chips,
      bank: shuffle(chips.length, seed + sentences.length),
    });
  }

  // Prefer a sentence the fill drill did not show.
  const fresh = (item: { sentence: string }) =>
    item.sentence !== fill?.sentence;
  const withVi = sentences.filter((item) => item.vi);
  const arrange = withVi.find(fresh) ?? withVi[0];
  if (arrange?.vi) drills.push({ ...arrange, kind: 'arrange', vi: arrange.vi });
  const rest = sentences.filter((item) => item !== arrange);
  const listen = rest.find(fresh) ?? rest[0];
  if (listen) drills.push({ ...listen, kind: 'listen' });
  return drills;
}
