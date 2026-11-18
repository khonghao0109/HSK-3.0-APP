import {
  classifyDictionaryQuery,
  pinyinTonePattern,
} from './dictionary-search-query';

describe('classifyDictionaryQuery', () => {
  it.each([
    [''],
    ['   '],
    ['<script>'],
    ['%'],
    ['a'.repeat(65)],
    ['xue6'],
    ['hoc_tap'],
  ])('rejects %j', (query) => {
    expect(classifyDictionaryQuery(query)).toEqual({ kind: 'invalid' });
  });

  it('rejects a non-string query (repeated ?query=)', () => {
    expect(classifyDictionaryQuery(['a', 'b'])).toEqual({ kind: 'invalid' });
  });

  it('keeps hanzi queries on the hanzi prefix path', () => {
    expect(classifyDictionaryQuery(' 学习 ')).toEqual({
      kind: 'hanzi',
      prefix: '学习',
    });
  });

  it('searches pinyin and meaning for plain Latin text', () => {
    expect(classifyDictionaryQuery(' Xue2 ')).toEqual({
      kind: 'latin',
      pinyinPrefix: 'xue',
      pinyinTonePattern: '^x[1-5]?u[1-5]?e2',
      meaning: 'xue2',
      legacyMeaning: null,
    });
  });

  it('accepts 64 characters', () => {
    expect(classifyDictionaryQuery('a'.repeat(64)).kind).toBe('latin');
  });

  it('skips pinyin and adds the accented form for Vietnamese text', () => {
    expect(classifyDictionaryQuery('Học  Tập')).toEqual({
      kind: 'latin',
      pinyinPrefix: null,
      pinyinTonePattern: null,
      meaning: 'hoc tap',
      legacyMeaning: 'học tập',
    });
  });

  it('reads a decomposed (NFD) query like its composed form', () => {
    expect(classifyDictionaryQuery('học'.normalize('NFD'))).toEqual(
      classifyDictionaryQuery('học'),
    );
  });

  it('does not search meanings for one character', () => {
    expect(classifyDictionaryQuery('h')).toEqual({
      kind: 'latin',
      pinyinPrefix: 'h',
      pinyinTonePattern: null,
      meaning: null,
      legacyMeaning: null,
    });
  });

  it('keeps ü queries on the pinyin path', () => {
    expect(classifyDictionaryQuery('nü')).toMatchObject({
      pinyinPrefix: 'nu:',
      meaning: 'nu',
    });
  });

  it.each([
    ['xuéxí', 'xuexi'],
    ['Xué Xí', 'xuexi'],
    ['xue2 xi2', 'xuexi'],
    ['xue xi', 'xuexi'],
    ['nǚ', 'nu:'],
    ['nv3', 'nu:'],
    ["xī'ān", 'xian'],
  ])('reads %j as the compact pinyin key %j', (query, key) => {
    expect(classifyDictionaryQuery(query)).toMatchObject({
      kind: 'latin',
      pinyinPrefix: key,
    });
  });

  describe('pinyinTonePattern (R6: typed tones rank first)', () => {
    const matches = (query: string, compactTone: string) =>
      new RegExp(pinyinTonePattern(query) ?? '^$').test(compactTone);

    it('is null when the query gives no tone', () => {
      expect(pinyinTonePattern('mai')).toBeNull();
      expect(pinyinTonePattern('xue sheng')).toBeNull();
      expect(classifyDictionaryQuery('mai')).toMatchObject({
        pinyinTonePattern: null,
      });
    });

    it.each([
      ['mai4', 'mai4', true],
      ['mai4', 'mai3', false],
      ['mài', 'mai4', true],
      ['mǎi', 'mai4', false],
      ['mai4', 'mai4tou2', true],
      ['xuéshēng', 'xue2sheng1', true],
      ['xuéshēng', 'xue2sheng5', false],
      ['xue2sheng', 'xue2sheng5', true],
      ['xuesheng5', 'xue2sheng1', false],
      ['xué xí', 'xue2xi2', true],
      ['nǚ', 'nu:3', true],
      ['nv3', 'nu:3', true],
      ['lü4', 'lu4', false],
      ["xī'ān", 'xi1an1', true],
      ["xī'ān", 'xian1', false],
    ])('%j against %j → %j', (query, compactTone, expected) => {
      expect(matches(query, compactTone)).toBe(expected);
    });

    it('only emits pinyin letters, tone digits and fixed regex syntax', () => {
      for (const query of ["xī'ān", 'nǚ', 'Mài', 'xue2 xi2', 'lu:4']) {
        expect(pinyinTonePattern(query)).toMatch(
          /^\^(?:[a-z:]|[1-5]|\[1-5\]\??|\(\?=\[a-z:\]\*[1-4]\))+$/,
        );
      }
    });
  });
});
