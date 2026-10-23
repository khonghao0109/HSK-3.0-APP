// Zod-free display rules shared by the server pages and the client components.

export const NO_VIETNAMESE = 'Chưa có nghĩa tiếng Việt';
export const SEARCH_QUERY_MAX_LENGTH = 64;

type Meaning = { vi: string | null };

function viMeanings(meanings: readonly Meaning[]): string[] {
  return meanings
    .map((meaning) => meaning.vi?.trim() ?? '')
    .filter((vi) => vi !== '');
}

/** Q70: a result row shows the first Vietnamese meaning; never English (Q65). */
export function firstVietnamese(meanings: readonly Meaning[]): string | null {
  return viMeanings(meanings)[0] ?? null;
}

/** Q70: the word page joins every Vietnamese meaning with "; ". */
export function allVietnamese(meanings: readonly Meaning[]): string | null {
  const all = viMeanings(meanings);
  return all.length ? all.join('; ') : null;
}

export function displayPinyin(word: {
  pinyin: string;
  pinyinTone: string | null;
}): string {
  return word.pinyinTone ?? word.pinyin;
}

/** Trimmed query, or null when it is empty or longer than the API accepts. */
export function normalizeSearchQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim();
  return q.length >= 1 && q.length <= SEARCH_QUERY_MAX_LENGTH ? q : null;
}
