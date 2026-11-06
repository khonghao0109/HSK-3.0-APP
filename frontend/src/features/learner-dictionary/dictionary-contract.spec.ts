import { describe, expect, it } from 'vitest';

import {
  backendDictionarySavedSchema,
  backendDictionarySearchSchema,
  backendDictionaryWordSchema,
} from './dictionary-contract';
import {
  allVietnamese,
  displayPinyin,
  firstVietnamese,
  normalizeSearchQuery,
} from './dictionary-display';

const meta = { requestId: 'r', timestamp: 't' };
const word = {
  id: 12,
  hanzi: '学习',
  traditional: '學習',
  pinyin: 'xue2 xi2',
  pinyinTone: 'xuéxí',
  example: '我每天都学习中文。',
  meanings: [
    {
      order: 1,
      en: 'to learn',
      vi: 'học tập',
      partOfSpeech: null,
      usage: null,
      note: null,
    },
  ],
  levels: [{ code: 'HSK1', name: 'HSK 1' }],
  sources: [
    {
      name: 'Từ điển Hán Lộ',
      version: '1.0.0',
      license: null,
      attribution: null,
    },
  ],
};

describe('dictionary contract', () => {
  it('parses a search row and drops backend meta', () => {
    const row = {
      id: 12,
      hanzi: '学习',
      pinyin: 'xue2 xi2',
      pinyinTone: null,
      meanings: [{ en: 'to learn', vi: null }],
      level: null,
    };
    expect(
      backendDictionarySearchSchema.parse({ success: true, data: [row], meta }),
    ).toEqual({ success: true, data: [row] });
  });

  it.each([
    [
      'meanings missing',
      { id: 1, hanzi: 'a', pinyin: 'a', pinyinTone: null, level: null },
    ],
    [
      'id as string',
      {
        id: '1',
        hanzi: 'a',
        pinyin: 'a',
        pinyinTone: null,
        meanings: [],
        level: null,
      },
    ],
    [
      'vi as number',
      {
        id: 1,
        hanzi: 'a',
        pinyin: 'a',
        pinyinTone: null,
        meanings: [{ en: null, vi: 3 }],
        level: null,
      },
    ],
  ])('rejects a search row with %s', (_label, row) => {
    expect(
      backendDictionarySearchSchema.safeParse({
        success: true,
        data: [row],
        meta,
      }).success,
    ).toBe(false);
  });

  it('parses a word detail and keeps only the read fields', () => {
    const parsed = backendDictionaryWordSchema.parse({
      success: true,
      data: word,
      meta,
    });
    expect(parsed.data.sources).toEqual([
      { name: 'Từ điển Hán Lộ', version: '1.0.0' },
    ]);
    expect(parsed.data.meanings).toEqual([
      { order: 1, en: 'to learn', vi: 'học tập' },
    ]);
  });

  it.each([
    ['levels missing', { ...word, levels: undefined }],
    ['traditional missing', { ...word, traditional: undefined }],
    ['source without version', { ...word, sources: [{ name: 'x' }] }],
  ])('rejects a word detail with %s', (_label, data) => {
    expect(
      backendDictionaryWordSchema.safeParse({ success: true, data, meta })
        .success,
    ).toBe(false);
  });

  it('rejects a saved body without a boolean', () => {
    expect(
      backendDictionarySavedSchema.safeParse({
        success: true,
        data: { wordId: 1, saved: 'yes' },
        meta,
      }).success,
    ).toBe(false);
  });
});

describe('dictionary display rules', () => {
  it('Q70: the row shows the first non-empty Vietnamese meaning, never English', () => {
    expect(
      firstVietnamese([
        { vi: null },
        { vi: '  ' },
        { vi: 'nghiên cứu' },
        { vi: 'học' },
      ]),
    ).toBe('nghiên cứu');
    expect(firstVietnamese([{ vi: null }])).toBeNull();
  });

  it('Q70: the word page joins every Vietnamese meaning with "; "', () => {
    expect(
      allVietnamese([{ vi: 'học tập' }, { vi: null }, { vi: 'nghiên cứu' }]),
    ).toBe('học tập; nghiên cứu');
    expect(allVietnamese([])).toBeNull();
  });

  it('prefers the tone-marked pinyin', () => {
    expect(displayPinyin({ pinyin: 'xue2', pinyinTone: 'xué' })).toBe('xué');
    expect(displayPinyin({ pinyin: 'xue2', pinyinTone: null })).toBe('xue2');
  });

  it('trims the query and accepts 1–64 characters only', () => {
    expect(normalizeSearchQuery(' 学习 ')).toBe('学习');
    expect(normalizeSearchQuery('')).toBeNull();
    expect(normalizeSearchQuery('a'.repeat(65))).toBeNull();
    expect(normalizeSearchQuery(['a'])).toBeNull();
  });
});
