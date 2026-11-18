import { normalizePinyin } from './normalize-pinyin';

describe('normalizePinyin', () => {
  it('normalizes case, tone numbers, whitespace and ü notation', () => {
    expect(normalizePinyin('  NÜ3   HAO3  ')).toBe('nu: hao');
  });

  it.each([
    ['xuéxí', 'xuexi'],
    ['xué xí', 'xue xi'],
    ['Xué Xí', 'xue xi'],
    ['xue2 xi2', 'xue xi'],
  ])('removes tone marks and tone numbers: %j -> %j', (input, expected) => {
    expect(normalizePinyin(input)).toBe(expected);
  });

  it.each([
    ['nǚ', 'nu:'],
    ['lǜ', 'lu:'],
    ['nv3', 'nu:'],
    ['nu:3', 'nu:'],
    ['NÜ', 'nu:'],
  ])('maps every ü spelling to u:: %j -> %j', (input, expected) => {
    expect(normalizePinyin(input)).toBe(expected);
  });

  it("drops the syllable apostrophe: xī'ān -> xian", () => {
    expect(normalizePinyin("xī'ān")).toBe('xian');
    expect(normalizePinyin('xi1 an1')).toBe('xi an');
  });
});
