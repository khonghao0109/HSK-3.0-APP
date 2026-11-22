import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type DrillStep,
  arrangedRight,
  sentenceChips,
  unitDrills,
} from './vocabulary-drills';
import type { UnitWord } from './vocabulary-unit';

// Words and examples as in backend/content/hsk1 (bài 01, batch-01).
const word = (
  id: number,
  hanzi: string,
  pinyin: string,
  meaning: string,
  partOfSpeech: string | null,
  example: UnitWord['example'] = null,
): UnitWord => ({
  id,
  hanzi,
  pinyin,
  meaning,
  firstMeaning: meaning.split('; ')[0] ?? null,
  partOfSpeech,
  image: null,
  example,
});

const wo = word(1, '我', 'wǒ', 'tôi, mình', 'đại từ', {
  hanzi: '我是学生。',
  pinyin: 'Wǒ shì xuéshēng.',
  vi: 'Tôi là học sinh.',
});
const shi = word(2, '是', 'shì', 'là', 'động từ', {
  hanzi: '他是我的老师。',
  pinyin: 'Tā shì wǒ de lǎoshī.',
  vi: 'Anh ấy là thầy giáo của tôi.',
});
const ta = word(3, '他', 'tā', 'anh ấy, ông ấy, nó (nam)', 'đại từ', {
  hanzi: '我们都是学生。',
  pinyin: 'Wǒmen dōu shì xuéshēng.',
  vi: 'Chúng tôi đều là học sinh.',
});
const ni = word(4, '你', 'nǐ', 'bạn', 'đại từ');
const women = word(5, '我们', 'wǒmen', 'chúng tôi', 'đại từ');
const laoshi = word(6, '老师', 'lǎoshī', 'thầy giáo, cô giáo', 'danh từ');
const unit = [wo, shi, ta, ni, women];
const pool = [...unit, laoshi];

const kinds = (drills: DrillStep[]) => drills.map((drill) => drill.kind);
const find = <K extends DrillStep['kind']>(drills: DrillStep[], kind: K) =>
  drills.find(
    (drill): drill is Extract<DrillStep, { kind: K }> => drill.kind === kind,
  );

afterEach(() => vi.restoreAllMocks());

const lesson = (...hanzi: string[]) =>
  hanzi.map((item) => ({ hanzi: item, pinyin: '' }));

describe('sentenceChips (Pha G2c)', () => {
  it('splits by the longest lesson word, keeps each chip on whole pinyin words', () => {
    expect(
      sentenceChips(
        '他是我的老师。',
        'Tā shì wǒ de lǎoshī.',
        lesson('他', '是', '我', '老师'),
      ),
    ).toEqual([
      { hanzi: '他', pinyin: 'tā' },
      { hanzi: '是', pinyin: 'shì' },
      { hanzi: '我', pinyin: 'wǒ' },
      { hanzi: '的', pinyin: 'de' },
      { hanzi: '老师', pinyin: 'lǎoshī' },
    ]);
  });

  it('never cuts a pinyin word: characters outside the lesson stay together', () => {
    expect(
      sentenceChips('我是学生。', 'Wǒ shì xuéshēng.', lesson('我', '是')),
    ).toEqual([
      { hanzi: '我', pinyin: 'wǒ' },
      { hanzi: '是', pinyin: 'shì' },
      { hanzi: '学生', pinyin: 'xuéshēng' },
    ]);
  });

  it('keeps a lesson word that spans two pinyin words as one chip', () => {
    expect(
      sentenceChips('不客气，再见。', 'Bú kèqi, zàijiàn.', lesson('不客气')),
    ).toEqual([
      { hanzi: '不客气', pinyin: 'bú kèqi' },
      { hanzi: '再见', pinyin: 'zàijiàn' },
    ]);
  });

  it('keeps the capital of a proper name that starts the sentence', () => {
    expect(
      sentenceChips('北京很大。', 'Běijīng hěn dà.', [
        { hanzi: '北京', pinyin: 'Běijīng' },
      ])?.[0],
    ).toEqual({ hanzi: '北京', pinyin: 'Běijīng' });
  });

  it('gives null when the pinyin does not match the characters', () => {
    expect(
      sentenceChips('我有一点儿。', 'Wǒ yǒu yìdiǎnr.', lesson()),
    ).toBeNull();
    expect(sentenceChips('我是学生。', null, lesson())).toBeNull();
  });
});

describe('arrangedRight', () => {
  const chips = [
    { hanzi: '你', pinyin: 'nǐ' },
    { hanzi: '是', pinyin: 'shì' },
    { hanzi: '你', pinyin: 'nǐ' },
  ];

  it('is true for the sentence order, false otherwise', () => {
    expect(arrangedRight(chips, [0, 1, 2])).toBe(true);
    expect(arrangedRight(chips, [1, 0, 2])).toBe(false);
    expect(arrangedRight(chips, [0, 1])).toBe(false);
  });

  it('accepts identical chips in either place', () => {
    expect(arrangedRight(chips, [2, 1, 0])).toBe(true);
  });
});

describe('unitDrills (Pha G2c)', () => {
  it('ends the unit with matching, fill, arrange, then listen', () => {
    expect(kinds(unitDrills(unit, pool))).toEqual([
      'match',
      'fill',
      'arrange',
      'listen',
    ]);
  });

  it('gives the same drills for the same unit, without Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    expect(unitDrills(unit, pool)).toEqual(unitDrills(unit, pool));
    expect(random).not.toHaveBeenCalled();
  });

  it('matches up to five words with their meanings, meanings shuffled', () => {
    const match = find(unitDrills(unit, pool), 'match');
    expect(match?.pairs).toEqual([
      { id: '1', left: '我', leftReading: 'wǒ', right: 'tôi, mình' },
      { id: '2', left: '是', leftReading: 'shì', right: 'là' },
      {
        id: '3',
        left: '他',
        leftReading: 'tā',
        right: 'anh ấy, ông ấy, nó (nam)',
      },
      { id: '4', left: '你', leftReading: 'nǐ', right: 'bạn' },
      { id: '5', left: '我们', leftReading: 'wǒmen', right: 'chúng tôi' },
    ]);
    expect([...(match?.rightOrder ?? [])].sort()).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(match?.rightOrder).not.toEqual(['1', '2', '3', '4', '5']);
  });

  it('has no matching under three meanings', () => {
    expect(kinds(unitDrills([wo, shi], pool))).not.toContain('match');
  });

  it('fills a blank with three distractors of another part of speech (Q-G3)', () => {
    const fill = find(unitDrills(unit, pool), 'fill');
    expect(fill).toBeDefined();
    if (!fill) return;
    const answer = fill.options[fill.answer];
    expect(fill.options).toHaveLength(4);
    expect(`${fill.before}${answer?.hanzi}${fill.after}`).toBe(fill.sentence);
    const posOf = (hanzi: string) =>
      pool.find((candidate) => candidate.hanzi === hanzi)?.partOfSpeech;
    const target = posOf(answer?.hanzi ?? '');
    for (const option of fill.options) {
      expect(option.pinyin).not.toBe('');
      if (option !== answer) expect(posOf(option.hanzi)).not.toBe(target);
    }
  });

  it('drops the fill drill when only words of the same part of speech remain', () => {
    const nouns = [
      word(11, '学生', 'xuéshēng', 'học sinh', 'danh từ', {
        hanzi: '我是学生。',
        pinyin: 'Wǒ shì xuéshēng.',
        vi: 'Tôi là học sinh.',
      }),
      word(12, '老师', 'lǎoshī', 'thầy giáo', 'danh từ'),
      word(13, '医生', 'yīshēng', 'bác sĩ', 'danh từ'),
      word(14, '名字', 'míngzi', 'tên', 'danh từ'),
    ];
    expect(kinds(unitDrills(nouns, nouns))).not.toContain('fill');
  });

  it('arranges a sentence from its Vietnamese meaning; the bank is shuffled', () => {
    const arrange = find(unitDrills(unit, pool), 'arrange');
    expect(arrange?.vi).not.toBe('');
    const chips = arrange?.chips ?? [];
    expect(chips.map((chip) => chip.hanzi).join('')).toBe(
      arrange?.sentence.replace(/[。，！？]/gu, ''),
    );
    const bank = arrange?.bank ?? [];
    expect([...bank].sort()).toEqual(chips.map((_, index) => index));
    expect(arrangedRight(chips, bank)).toBe(false);
  });

  it('listens to another sentence than the arrange drill', () => {
    const drills = unitDrills(unit, pool);
    expect(find(drills, 'listen')?.sentence).not.toBe(
      find(drills, 'arrange')?.sentence,
    );
  });

  it('drops arrange and listen without a usable example', () => {
    const bare = [ni, women, laoshi].map((item) => ({
      ...item,
      example: null,
    }));
    expect(kinds(unitDrills(bare, bare))).toEqual(['match']);
  });
});
