import { normalizeMeaning } from '../../common/utils/normalize-meaning';
import { normalizePinyin } from '../../common/utils/normalize-pinyin';

export type DictionarySearchQuery =
  | { kind: 'invalid' }
  | { kind: 'hanzi'; prefix: string }
  | {
      kind: 'latin';
      /** Prefix of `pinyinNormalized`; null when the query is not pinyin. */
      pinyinPrefix: string | null;
      /** Substring of a normalized meaning; null below 2 characters. */
      meaning: string | null;
      /** Accented form for rows normalized by the P0 backfill (keeps marks). */
      legacyMeaning: string | null;
    };

const MAX_QUERY_LENGTH = 64;
const HANZI = /[㐀-鿿]/;
const HANZI_QUERY = /^[a-zA-Z1-5:üÜ㐀-鿿' ]+$/;
const PINYIN_QUERY = /^[a-zA-Z1-5:üÜ' ]+$/;
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
  const searchMeaning = meaning.length >= 2;
  const accented = /[^ -~]/.test(query);
  return {
    kind: 'latin',
    pinyinPrefix: PINYIN_QUERY.test(query) ? normalizePinyin(query) : null,
    meaning: searchMeaning ? meaning : null,
    legacyMeaning:
      searchMeaning && accented
        ? query.toLowerCase().replace(/ +/g, ' ')
        : null,
  };
}
