// Zod-free display rules shared by the server pages and the client components.

export const NO_VIETNAMESE = 'Chưa có nghĩa tiếng Việt';
export const SEARCH_QUERY_MAX_LENGTH = 64;

type Meaning = { vi: string | null };

/** Q324: the non-empty Vietnamese meanings, in the API order. */
export function vietnameseMeanings(meanings: readonly Meaning[]): string[] {
  return meanings
    .map((meaning) => meaning.vi?.trim() ?? '')
    .filter((vi) => vi !== '');
}

/** Q70: a result row shows the first Vietnamese meaning; never English (Q65). */
export function firstVietnamese(meanings: readonly Meaning[]): string | null {
  return vietnameseMeanings(meanings)[0] ?? null;
}

/** Q70: the word page joins every Vietnamese meaning with "; ". */
export function allVietnamese(meanings: readonly Meaning[]): string | null {
  const all = vietnameseMeanings(meanings);
  return all.length ? all.join('; ') : null;
}

export function displayPinyin(word: {
  pinyin: string;
  pinyinTone: string | null;
}): string {
  return joinWordPinyin(numberedToToneMarks(word.pinyinTone ?? word.pinyin));
}

const SYLLABLE = /^[A-Za-zÀ-ɏ\u0300-\u036f]+$/u;
const VOWEL_START = /^[aoeāáǎàōóǒòēéěè]/u;
const CAPITAL_START = /^[A-ZĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ]/u;

/**
 * Pinyin of one dictionary word is written as one word (GB/T 16159-2012,
 * Q354): "wǒ men" -> "wǒmen", "Zhōng guó" -> "Zhōngguó". A syllable that
 * starts with a, o or e after another syllable takes an apostrophe
 * ("Xī ān" -> "Xī'ān"). A capitalised syllable after the first one starts a
 * new proper-name part and keeps its space ("Lǐ Bái"). Four syllables are
 * two words ("xuésheng yùndòng"); five or more, and text with anything other
 * than plain syllables (punctuation, digits, spelled Latin letters such as
 * "A A zhì" for AA制), are returned unchanged.
 */
export function joinWordPinyin(pinyin: string): string {
  const syllables = pinyin.trim().split(/\s+/u);
  if (
    syllables.length < 2 ||
    syllables.length > 4 ||
    !syllables.every((s) => SYLLABLE.test(s)) ||
    syllables.some((s) => /^[A-Z]+$/u.test(s))
  ) {
    return pinyin;
  }
  if (syllables.length === 4) {
    return `${joinSyllables(syllables.slice(0, 2))} ${joinSyllables(syllables.slice(2))}`;
  }
  return joinSyllables(syllables);
}

function joinSyllables(syllables: readonly string[]): string {
  let out = syllables[0] ?? '';
  for (const syllable of syllables.slice(1)) {
    if (CAPITAL_START.test(syllable)) out += ` ${syllable}`;
    else if (VOWEL_START.test(syllable.toLowerCase())) out += `'${syllable}`;
    else out += syllable;
  }
  return out;
}

const MARKS: Record<string, string> = {
  a: 'āáǎà',
  e: 'ēéěè',
  i: 'īíǐì',
  o: 'ōóǒò',
  u: 'ūúǔù',
  ü: 'ǖǘǚǜ',
  A: 'ĀÁǍÀ',
  E: 'ĒÉĚÈ',
  I: 'ĪÍǏÌ',
  O: 'ŌÓǑÒ',
  U: 'ŪÚǓÙ',
  Ü: 'ǕǗǙǛ',
};

function markSyllable(syllable: string): string {
  const tone = Number(syllable.slice(-1));
  const body = syllable
    .slice(0, -1)
    .replace(/u:|v/gu, 'ü')
    .replace(/U:|V/gu, 'Ü');
  if (tone < 1 || tone > 4) return body;
  const lower = body.toLowerCase();
  // Standard rule: a or e takes the mark, "ou" marks the o, else the last vowel.
  let at = lower.search(/[ae]/u);
  if (at < 0) at = lower.indexOf('ou');
  if (at < 0) {
    for (let index = lower.length - 1; index >= 0; index -= 1) {
      if ('iouü'.includes(lower.charAt(index))) {
        at = index;
        break;
      }
    }
  }
  const marks = at < 0 ? undefined : MARKS[body.charAt(at)];
  if (!marks) return body;
  return body.slice(0, at) + marks.charAt(tone - 1) + body.slice(at + 1);
}

/** "xie4 xie5" -> "xiè xie"; text without tone numbers is returned unchanged. */
export function numberedToToneMarks(pinyin: string): string {
  return pinyin.replace(/[A-Za-züÜ:]+[0-5]/gu, markSyllable);
}

/** Trimmed query, or null when it is empty or longer than the API accepts. */
export function normalizeSearchQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim();
  return q.length >= 1 && q.length <= SEARCH_QUERY_MAX_LENGTH ? q : null;
}
