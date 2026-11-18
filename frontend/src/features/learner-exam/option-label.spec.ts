import { describe, expect, it } from 'vitest';

import { isLetterOnlyOption } from './option-label';

describe('isLetterOnlyOption', () => {
  it('is true when the option text is just its own letter', () => {
    expect(isLetterOnlyOption('A', 'A')).toBe(true);
    expect(isLetterOnlyOption(' c ', 'C')).toBe(true);
  });

  it('is false for real option text or a different letter', () => {
    expect(isLetterOnlyOption('我不饿。', 'A')).toBe(false);
    expect(isLetterOnlyOption('B', 'A')).toBe(false);
    expect(isLetterOnlyOption('A.', 'A')).toBe(false);
  });
});
