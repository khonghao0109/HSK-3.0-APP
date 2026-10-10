/** `HSK1` → `HSK 1`; `HSK7_9` → `HSK 7–9` (Q3). Unknown codes pass through. */
export function levelLabel(code: string): string {
  const range = /^HSK(\d+)_(\d+)$/u.exec(code);
  if (range) return `HSK ${range[1]}–${range[2]}`;
  const single = /^HSK(\d+)$/u.exec(code);
  return single ? `HSK ${single[1]}` : code;
}
