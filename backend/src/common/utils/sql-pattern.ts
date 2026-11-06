/** Escapes `%`, `_` and `\` so a value matches literally inside SQL `LIKE`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Escapes regex metacharacters so a value matches literally in Postgres `~`. */
export function escapeRegex(value: string): string {
  return value.replace(/[\\.^$|?*+()[\]{}]/g, '\\$&');
}
