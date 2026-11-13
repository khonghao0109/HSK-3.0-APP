import { classifyDictionaryQuery } from './dictionary-search-query';

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
});
