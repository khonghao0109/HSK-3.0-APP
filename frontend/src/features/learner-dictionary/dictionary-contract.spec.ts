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
  numberedToToneMarks,
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
  audio: null,
  examples: [],
  related: [],
};

const source = {
  name: 'Từ điển Hán Lộ',
  version: '1.0.0',
  license: null,
  attribution: null,
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

  it('parses examples and related words (M3.4b) and drops their audio and source licence', () => {
    const parsed = backendDictionaryWordSchema.parse({
      success: true,
      data: {
        ...word,
        examples: [
          {
            hanzi: '我在学习中文。',
            pinyin: 'Wǒ zài xuéxí Zhōngwén.',
            vi: 'Tôi đang học tiếng Trung.',
            en: null,
            source,
            audio: null,
          },
        ],
        related: [
          {
            id: 31,
            hanzi: '学生',
            pinyin: 'xue2 sheng5',
            pinyinTone: 'xuésheng',
            meanings: [{ en: 'student', vi: 'học sinh' }],
            level: 'HSK 1',
          },
        ],
      },
      meta,
    });
    expect(parsed.data.audio).toBeNull();
    expect(parsed.data.examples).toEqual([
      {
        hanzi: '我在学习中文。',
        pinyin: 'Wǒ zài xuéxí Zhōngwén.',
        vi: 'Tôi đang học tiếng Trung.',
        en: null,
        source: { name: 'Từ điển Hán Lộ', version: '1.0.0' },
      },
    ]);
    expect(parsed.data.related).toEqual([
      {
        id: 31,
        hanzi: '学生',
        pinyin: 'xue2 sheng5',
        pinyinTone: 'xuésheng',
        meanings: [{ en: 'student', vi: 'học sinh' }],
        level: 'HSK 1',
      },
    ]);
  });

  it.each([
    ['examples missing', { ...word, examples: undefined }],
    ['related missing', { ...word, related: undefined }],
    [
      'an example without source',
      {
        ...word,
        examples: [
          { hanzi: 'a', pinyin: null, vi: null, en: null, audio: null },
        ],
      },
    ],
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
    expect(displayPinyin({ pinyin: 'xue2', pinyinTone: null })).toBe('xué');
    expect(displayPinyin({ pinyin: 'xie4', pinyinTone: 'xie4 xie5' })).toBe(
      'xièxie',
    );
  });

  it('writes the syllables of one word together (GB/T 16159-2012)', () => {
    const cases: [string, string][] = [
      ['wo3 men5', 'wǒmen'],
      ['Zhong1 guo2', 'Zhōngguó'],
      ['ming2 zi5', 'míngzi'],
      ['Xi1 an1', "Xī'ān"],
      ['tian1 an1 men2', "tiān'ānmén"],
      ['yi1 hui4 r5', 'yīhuìr'],
      ['Li3 Bai2', 'Lǐ Bái'],
      ['wǒ men', 'wǒmen'],
      ['xue2', 'xué'],
      ['ka3 la1 O K', 'kǎ lā O K'],
      ['A A zhi4', 'A A zhì'],
      ['yi1 , er4', 'yī , èr'],
      ['xue2 sheng5 yun4 dong4', 'xuésheng yùndòng'],
      ['ce4 shi4 ci2 dian3', 'cèshì cídiǎn'],
      ['ce4 shi4 fu4 xi2 er4', 'cè shì fù xí èr'],
      ['cèshì cídiǎn', 'cèshì cídiǎn'],
      ['cèshì fùxí yī', 'cèshì fùxí yī'],
    ];
    for (const [input, output] of cases) {
      expect(displayPinyin({ pinyin: input, pinyinTone: null })).toBe(output);
    }
  });

  it('turns numbered pinyin into tone marks', () => {
    const cases: [string, string][] = [
      ['xie4 xie5', 'xiè xie'],
      ['lv4', 'lǜ'],
      ['nu:3', 'nǚ'],
      ['hao3', 'hǎo'],
      ['er2', 'ér'],
      ['zhuang4', 'zhuàng'],
      ['liu2', 'liú'],
      ['gui4', 'guì'],
      ['Ni3', 'Nǐ'],
      ['zou3', 'zǒu'],
      ['ma0', 'ma'],
      ['', ''],
      ['cèxué', 'cèxué'],
      ['xiè xie', 'xiè xie'],
    ];
    for (const [input, output] of cases) {
      expect(numberedToToneMarks(input)).toBe(output);
      expect(numberedToToneMarks(output)).toBe(output);
    }
  });

  it('trims the query and accepts 1–64 characters only', () => {
    expect(normalizeSearchQuery(' 学习 ')).toBe('学习');
    expect(normalizeSearchQuery('')).toBeNull();
    expect(normalizeSearchQuery('a'.repeat(65))).toBeNull();
    expect(normalizeSearchQuery(['a'])).toBeNull();
  });
});
