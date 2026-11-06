/**
 * R11 (TL-137): các key tuyệt đối không được xuất hiện trong payload BFF,
 * HTML hay RSC gửi tới learner. Dùng chung cho unit test route handler và
 * e2e để hai nơi không lệch nhau (vòng 2c-b, R1).
 */
export const FORBIDDEN_KEYS = [
  'correctAnswer',
  'explanation',
  'acceptedTexts',
  'caseSensitive',
  'tokenIds',
  'optionId',
  'isCorrect',
  'contentHash',
  'questionId',
  'questionVersion',
] as const;

/**
 * TL-171: walks an already-parsed payload and returns the first forbidden key
 * it finds (R11). Used by the result BFF to fail closed (503) instead of ever
 * forwarding a key that the backend must not expose.
 */
export function firstForbiddenKey(value: unknown): string | null {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (current === null || typeof current !== 'object') continue;
    for (const [key, nested] of Object.entries(current)) {
      if ((FORBIDDEN_KEYS as readonly string[]).includes(key)) return key;
      stack.push(nested);
    }
  }
  return null;
}
