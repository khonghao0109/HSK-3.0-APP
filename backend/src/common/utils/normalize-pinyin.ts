/**
 * Canonical form used by dictionary ingestion, seed fixtures and public lookup.
 * CC-CEDICT tone numbers are presentation metadata, not part of the search key.
 */
export function normalizePinyin(value: string): string {
  return value
    .replace(/[1-5]/g, '')
    .trim()
    .toLowerCase()
    .replace(/ü/g, 'u:')
    .replace(/\s+/g, ' ');
}
