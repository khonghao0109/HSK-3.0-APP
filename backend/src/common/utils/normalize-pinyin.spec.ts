import { normalizePinyin } from './normalize-pinyin';

describe('normalizePinyin', () => {
  it('normalizes case, tone numbers, whitespace and ü notation', () => {
    expect(normalizePinyin('  NÜ3   HAO3  ')).toBe('nu: hao');
  });
});
