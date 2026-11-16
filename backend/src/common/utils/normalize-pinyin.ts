/**
 * Canonical form used by dictionary ingestion, seed fixtures and public lookup.
 * Tone numbers and tone marks are presentation metadata, not part of the
 * search key; `ü`, `v` and `u:` all become `u:` (R6/R9, M3.4a).
 */
export function normalizePinyin(value: string): string {
  return (
    value
      .normalize('NFD')
      // Combining marks are tone marks, except the diaeresis of ü (U+0308).
      .replace(/[̀-̇̉-ͯ]/g, '')
      .normalize('NFC')
      .replace(/[1-5']/g, '')
      .trim()
      .toLowerCase()
      .replace(/u:|ü|v/g, 'u:')
      .replace(/\s+/g, ' ')
  );
}
