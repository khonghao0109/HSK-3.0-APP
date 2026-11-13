/**
 * Canonical form of a meaning (Vietnamese or English) for search: no
 * diacritics, `đ` as `d`, lower case, single spaces. Seeds write
 * `meaningViNormalized`/`meaningEnNormalized` with it and public lookup
 * normalizes the query the same way.
 */
export function normalizeMeaning(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
