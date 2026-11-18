import { normalizeMeaning } from '../../common/utils/normalize-meaning';
import { normalizePinyin } from '../../common/utils/normalize-pinyin';

export type DictionarySearchQuery =
  | { kind: 'invalid' }
  | { kind: 'hanzi'; prefix: string }
  | {
      kind: 'latin';
      /** Prefix of `pinyinCompact` (no spaces); null when the query is not pinyin. */
      pinyinPrefix: string | null;
      /**
       * POSIX regex over the compact numbered `pinyinTone` ("mai4",
       * "xue2sheng5") for the tones the query gives; null when it gives none.
       * Ranks a word with the typed tones first (R6, Bảng PL.2 tuần 7).
       */
      pinyinTonePattern: string | null;
      /** Substring of a normalized meaning; null below 2 characters. */
      meaning: string | null;
      /** Accented form for rows normalized by the P0 backfill (keeps marks). */
      legacyMeaning: string | null;
    };

const MAX_QUERY_LENGTH = 64;
const HANZI = /[㐀-鿿]/;
const HANZI_QUERY = /^[a-zA-Z1-5:üÜ㐀-鿿' ]+$/;
const PINYIN_QUERY = /^[a-zA-Z1-5:' ]+$/;
// The four pinyin tone marks and the ü diaeresis, as NFD combining marks.
// Other marks (Vietnamese dot below, hook, circumflex…) keep a query meaning-only.
const PINYIN_MARKS = /\u0300|\u0301|\u0304|\u030c|\u0308/g;
const LATIN_QUERY = /^[\p{Script=Latin}1-5' :]+$/u;

/** Sorts a raw `?query=` into the lookups `GET /dictionary` runs (A.5). */
export function classifyDictionaryQuery(raw: unknown): DictionarySearchQuery {
  if (typeof raw !== 'string') return { kind: 'invalid' };
  const query = raw.normalize('NFC').trim();
  if (query.length < 1 || query.length > MAX_QUERY_LENGTH) {
    return { kind: 'invalid' };
  }

  if (HANZI.test(query)) {
    return HANZI_QUERY.test(query)
      ? { kind: 'hanzi', prefix: query }
      : { kind: 'invalid' };
  }
  if (!LATIN_QUERY.test(query)) return { kind: 'invalid' };

  const meaning = normalizeMeaning(query);
  const isPinyin = PINYIN_QUERY.test(
    query.normalize('NFD').replace(PINYIN_MARKS, ''),
  );
  const searchMeaning = meaning.length >= 2;
  const accented = /[^ -~]/.test(query);
  return {
    kind: 'latin',
    pinyinPrefix: isPinyin ? normalizePinyin(query).replace(/ /g, '') : null,
    pinyinTonePattern: isPinyin ? pinyinTonePattern(query) : null,
    meaning: searchMeaning ? meaning : null,
    legacyMeaning:
      searchMeaning && accented
        ? query.toLowerCase().replace(/ +/g, ' ')
        : null,
  };
}

const TONE_OF_MARK: Record<string, string> = {
  '\u0304': '1',
  '\u0301': '2',
  '\u030c': '3',
  '\u0300': '4',
};

/**
 * Builds an anchored POSIX regex over the compact numbered `pinyinTone`
 * (`lower`, no spaces, `ü` as `u:`) that holds only when every tone the query
 * gives matches: a tone number must sit right after its letter
 * ("mai4" → `^m[1-5]?a[1-5]?i4`), a tone mark must equal the next tone
 * number of the word ("mài" → `^m[1-5]?a(?=[a-z:]*4)[1-5]?i[1-5]?`).
 * Letters the query leaves without a tone accept any tone; an apostrophe or
 * space marks a syllable end, so a tone number must follow there. The pattern only
 * holds a-z, `:`, 1–5 and fixed regex syntax, never raw query text. Returns
 * null when the query gives no tone, so the ranking stays as before.
 */
export function pinyinTonePattern(query: string): string | null {
  const chars = [...query.normalize('NFD').toLowerCase()];
  let pattern = '^';
  let hasTone = false;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (/[1-5]/.test(ch)) {
      pattern += ch;
      hasTone = true;
      continue;
    }
    if (ch === "'" || ch === ' ') {
      // A syllable boundary the query spells out: the word must end a
      // syllable here too ("xī'ān" is 西安 xi1an1, not 仙 xian1).
      if (pattern.endsWith('[1-5]?')) pattern = `${pattern.slice(0, -6)}[1-5]`;
      continue;
    }
    if (!/[a-z]/.test(ch)) continue;
    let letter = ch === 'v' ? 'u:' : ch;
    let tone: string | null = null;
    while (i + 1 < chars.length && /[\u0300-\u036f:]/.test(chars[i + 1])) {
      const mark = chars[i + 1];
      if ((mark === '\u0308' || mark === ':') && ch === 'u') letter = 'u:';
      else if (TONE_OF_MARK[mark]) tone = TONE_OF_MARK[mark];
      i += 1;
    }
    pattern += letter;
    if (tone) {
      pattern += `(?=[a-z:]*${tone})`;
      hasTone = true;
    }
    if (!/[1-5]/.test(chars[i + 1] ?? '')) pattern += '[1-5]?';
  }
  return hasTone ? pattern : null;
}
