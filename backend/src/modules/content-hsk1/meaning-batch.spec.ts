import { join } from 'node:path';

import {
  exampleStatusFor,
  hanOnly,
  type Hsk1Lexicon,
  loadHsk1Lexicon,
  type MeaningBatch,
  meaningBatchContentSha256,
  segmentWords,
  syllableCounts,
  validateMeaningBatch,
} from './meaning-batch';

const lexicon: Hsk1Lexicon = loadHsk1Lexicon(join(__dirname, '../../..'));

function batch(overrides: Partial<MeaningBatch> = {}): MeaningBatch {
  return {
    schemaVersion: 1,
    batchId: 'hsk1-vi-01',
    lessons: [1],
    dataSource: {
      code: 'HSK30_VI_HSK1_B01',
      name: 'Nghĩa tiếng Việt HSK1 lô 01',
      version: '1',
      license: 'Original content authored for HSK 3.0 APP',
      attribution: 'HSK 3.0 APP',
      notes: 'nháp',
    },
    review: {
      status: 'pending',
      reviewer: null,
      reviewedAt: null,
      contentSha256: null,
      notes: [],
    },
    properNames: [{ hanzi: '小雨', pinyin: 'Xiǎoyǔ', note: 'tên riêng' }],
    entries: [
      {
        hanzi: '个',
        pinyin: 'gè',
        partOfSpeech: 'lượng từ',
        meaningVi: '(lượng từ) cái, chiếc',
        examples: [
          {
            hanzi: '我有一个朋友。',
            pinyin: 'Wǒ yǒu yī ge péngyou.',
            translationVi: 'Tôi có một người bạn.',
          },
        ],
      },
      {
        hanzi: '学生',
        pinyin: 'xuéshēng',
        partOfSpeech: 'danh từ',
        meaningVi: 'học sinh, sinh viên',
        examples: [
          {
            hanzi: '小雨是学生。',
            pinyin: 'Xiǎoyǔ shì xuéshēng.',
            translationVi: 'Tiểu Vũ là học sinh.',
          },
        ],
      },
    ],
    ...overrides,
  };
}

const codes = (b: MeaningBatch, seen?: Set<string>) =>
  validateMeaningBatch(b, lexicon, seen).map((i) => i.code);

describe('meaning batch validator (P1–P2)', () => {
  it('accepts a well-formed pending batch', () => {
    expect(codes(batch())).toEqual([]);
  });

  it('segments sentences into HSK1 words and counts pinyin syllables', () => {
    expect(hanOnly('我有一个朋友。')).toBe('我有一个朋友');
    expect(hanOnly('我有3个朋友')).toBeNull();
    expect(
      segmentWords('我有一个朋友', new Set(lexicon.readings.keys())),
    ).toEqual(['我', '有', '一', '个', '朋友']);
    expect(
      segmentWords('我喜欢咖啡', new Set(lexicon.readings.keys())),
    ).toBeNull();
    expect(syllableCounts('Wǒ yǒu yī diǎnr.', lexicon.syllables).has(5)).toBe(
      true,
    );
    expect(
      syllableCounts('Xiǎoyǔ shì xuéshēng.', lexicon.syllables).has(5),
    ).toBe(true);
  });

  it('rejects words that are not an HSK1 reading, wrong tones included', () => {
    const b = batch();
    b.entries[0].pinyin = 'gě';
    expect(codes(b)).toContain('word_not_found');
  });

  it('rejects examples with non-HSK1 words, missing headword, bad pinyin or duplicates', () => {
    const b = batch();
    b.entries[0].examples = [
      { hanzi: '我喜欢咖啡。', pinyin: 'Wǒ xǐhuan kāfēi.', translationVi: 'x' },
      { hanzi: '我是学生。', pinyin: 'Wǒ shì.', translationVi: 'x' },
    ];
    expect(codes(b, new Set(['我是学生']))).toEqual(
      expect.arrayContaining([
        'example_not_hsk1',
        'example_missing_word',
        'example_pinyin_count',
        'example_duplicate',
      ]),
    );
  });

  it('enforces meaning style and measure-word label', () => {
    const b = batch();
    b.entries[0].meaningVi = 'Cái.';
    expect(codes(b)).toEqual(
      expect.arrayContaining([
        'meaning_trailing_period',
        'meaning_capitalized',
        'measure_word_label',
      ]),
    );
  });

  it('approval needs reviewer, date and the content hash', () => {
    const b = batch({
      review: {
        status: 'approved',
        reviewer: null,
        reviewedAt: null,
        contentSha256: 'x',
        notes: [],
      },
    });
    expect(codes(b)).toEqual(
      expect.arrayContaining([
        'review_reviewer_missing',
        'review_date_missing',
        'review_hash_mismatch',
      ]),
    );
    const ok = batch();
    ok.review = {
      status: 'approved',
      reviewer: 'Người duyệt',
      reviewedAt: '2026-11-18',
      contentSha256: meaningBatchContentSha256(ok),
      notes: [],
    };
    expect(codes(ok)).toEqual([]);
    ok.entries[1].meaningVi = 'học trò';
    expect(codes(ok)).toEqual(['review_hash_mismatch']);
  });

  it('proper names must be built from HSK1 words', () => {
    expect(
      codes(
        batch({
          properNames: [{ hanzi: '咖啡', pinyin: 'Kāfēi', note: 'tên riêng' }],
        }),
      ),
    ).toContain('proper_name_not_hsk1');
  });

  it('publishes examples only for an approved batch with reviewer, date and matching hash', () => {
    const b = batch();
    expect(exampleStatusFor(b)).toBe('draft');
    const approved = () => ({
      status: 'approved',
      reviewer: 'Người duyệt',
      reviewedAt: '2026-11-18',
      contentSha256: meaningBatchContentSha256(b),
      notes: [],
    });
    b.review = approved();
    expect(exampleStatusFor(b)).toBe('published');
    for (const broken of [
      { reviewer: null },
      { reviewer: '  ' },
      { reviewedAt: null },
      { reviewedAt: '18/11/2026' },
      { contentSha256: 'x' },
      { status: 'changes_requested' },
    ]) {
      b.review = { ...approved(), ...broken };
      expect(exampleStatusFor(b)).toBe('draft');
    }
    b.review = approved();
    b.entries[0].meaningVi = '(lượng từ) cái';
    expect(exampleStatusFor(b)).toBe('draft');
  });
});
