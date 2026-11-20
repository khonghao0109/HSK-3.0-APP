import { describe, expect, it } from 'vitest';

import {
  exampleParts,
  speakerInitial,
  speakerTones,
  topicBlocks,
  topicsForPage,
} from './topic-content';

describe('topicBlocks (M2.5f, Q175)', () => {
  it('keeps text and the lesson_words vocabulary list, in order', () => {
    expect(
      topicBlocks([
        { type: 'text', value: '  Bài 1 gồm 20 từ.  ' },
        { type: 'vocabulary_list', value: 'lesson_words' },
      ]),
    ).toEqual([
      { kind: 'text', value: 'Bài 1 gồm 20 từ.' },
      { kind: 'vocabulary_list' },
    ]);
  });

  it('skips unknown, empty or malformed blocks', () => {
    expect(
      topicBlocks([
        { type: 'image', url: 'x' },
        { type: 'text', value: '   ' },
        { type: 'text', value: 3 },
        { type: 'vocabulary_list', value: 'other' },
        null,
        'text',
      ]),
    ).toEqual([]);
    expect(topicBlocks({ type: 'text', value: 'x' })).toEqual([]);
    expect(topicBlocks(undefined)).toEqual([]);
  });
});

const point = {
  type: 'grammar_point',
  title: ' Hỏi số lượng với 几 ',
  formula: [
    { role: 'subj', zh: '主语', vi: 'Chủ ngữ' },
    { role: 'other', zh: '名词', vi: 'Danh từ' },
  ],
  explanation: 'Dùng 几 để hỏi số lượng nhỏ.',
  examples: [
    {
      hanzi: '你家有几口人？',
      pinyin: 'Nǐ jiā yǒu jǐ kǒu rén?',
      vi: 'Nhà bạn có mấy người?',
      highlight: '几',
    },
    { hanzi: '我有书。', pinyin: 'Wǒ yǒu shū.', vi: 'Tôi có sách.' },
  ],
};

const dialogue = {
  type: 'dialogue',
  lines: [
    { speaker: 'An', hanzi: '你好！', pinyin: 'Nǐ hǎo!', vi: 'Chào bạn!' },
    { speaker: 'Bình', hanzi: '你好！', pinyin: 'Nǐ hǎo!', vi: 'Chào bạn!' },
  ],
};

describe('topicBlocks: grammar_point and dialogue (Pha D, N5–N7)', () => {
  it('reads a grammar point card and a dialogue', () => {
    expect(topicBlocks([point, dialogue])).toEqual([
      {
        kind: 'grammar_point',
        title: 'Hỏi số lượng với 几',
        formula: [
          { role: 'subj', zh: '主语', vi: 'Chủ ngữ' },
          { role: 'other', zh: '名词', vi: 'Danh từ' },
        ],
        explanation: 'Dùng 几 để hỏi số lượng nhỏ.',
        examples: [
          {
            hanzi: '你家有几口人？',
            pinyin: 'Nǐ jiā yǒu jǐ kǒu rén?',
            vi: 'Nhà bạn có mấy người?',
            highlight: '几',
          },
          {
            hanzi: '我有书。',
            pinyin: 'Wǒ yǒu shū.',
            vi: 'Tôi có sách.',
            highlight: null,
          },
        ],
      },
      { kind: 'dialogue', lines: dialogue.lines },
    ]);
  });

  // Blocks saved before the CMS rule may be broken: skip, never crash.
  it.each([
    ['a missing title', { ...point, title: undefined }],
    ['an empty formula', { ...point, formula: [] }],
    [
      'an unknown chip role',
      { ...point, formula: [{ role: 'x', zh: 'a', vi: 'b' }] },
    ],
    ['a chip without zh', { ...point, formula: [{ role: 'subj', vi: 'b' }] }],
    ['an example that is not an object', { ...point, examples: ['x'] }],
    ['no examples', { ...point, examples: undefined }],
    ['a dialogue without lines', { type: 'dialogue', lines: [] }],
    [
      'a line without vi',
      { type: 'dialogue', lines: [{ speaker: 'A', hanzi: 'x', pinyin: 'x' }] },
    ],
  ])('skips a block with %s', (_name, block) => {
    expect(topicBlocks([block, { type: 'text', value: 'ok' }])).toEqual([
      { kind: 'text', value: 'ok' },
    ]);
  });

  it('drops a highlight that is not in the sentence', () => {
    const [card] = topicBlocks([
      { ...point, examples: [{ ...point.examples[0], highlight: '吗' }] },
    ]);
    expect(card?.kind === 'grammar_point' && card.examples[0]?.highlight).toBe(
      null,
    );
  });
});

describe('exampleParts', () => {
  it('splits the sentence around the first occurrence of the highlight', () => {
    expect(exampleParts('几个几', '几')).toEqual({
      before: '',
      mark: '几',
      after: '个几',
    });
    expect(exampleParts('你家有几口人？', '几')).toEqual({
      before: '你家有',
      mark: '几',
      after: '口人？',
    });
    expect(exampleParts('我有书。', null)).toBeNull();
  });
});

describe('speakers (N7)', () => {
  it('shows the first letter of the name, upper case', () => {
    expect(speakerInitial('bình')).toBe('B');
    expect(speakerInitial(' An ')).toBe('A');
    expect(speakerInitial('小明')).toBe('小');
  });

  it('gives each speaker a tone by first appearance, alternating', () => {
    expect(speakerTones(['An', 'Bình', 'An', 'Chi'])).toEqual(
      new Map([
        ['An', 'is-a'],
        ['Bình', 'is-b'],
        ['Chi', 'is-a'],
      ]),
    );
  });
});

describe('topicsForPage', () => {
  const topics = [
    { id: 1, type: 'key_text', orderIndex: 3 },
    { id: 2, type: 'grammar', orderIndex: 2 },
    { id: 3, type: 'vocabulary', orderIndex: 1 },
    { id: 4, type: 'quiz', orderIndex: 4 },
  ];

  it('puts vocabulary topics on the vocabulary page', () => {
    expect(topicsForPage(topics, 'vocabulary').map((t) => t.id)).toEqual([3]);
  });

  it('puts grammar then key_text on the grammar page, by orderIndex', () => {
    expect(topicsForPage(topics, 'grammar').map((t) => t.id)).toEqual([2, 1]);
  });
});
