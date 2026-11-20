import {
  TOPIC_CONTENT_ISSUE_CODES,
  validateTopicContentBlocks,
} from './topic-content-blocks';

function grammarPoint(overrides: Record<string, unknown> = {}) {
  return {
    type: 'grammar_point',
    title: 'Câu khẳng định với 是',
    formula: [
      { role: 'subj', zh: '我', vi: 'tôi' },
      { role: 'key', zh: '是', vi: 'là' },
      { role: 'other', zh: '学生', vi: 'học sinh' },
    ],
    explanation: 'Chủ ngữ + 是 + danh từ.',
    examples: [
      {
        hanzi: '我是学生。',
        pinyin: 'Wǒ shì xuésheng.',
        vi: 'Tôi là học sinh.',
        highlight: '是',
      },
    ],
    ...overrides,
  };
}

function dialogue(overrides: Record<string, unknown> = {}) {
  return {
    type: 'dialogue',
    lines: [
      { speaker: 'A', hanzi: '你好！', pinyin: 'Nǐ hǎo!', vi: 'Xin chào!' },
      { speaker: 'B', hanzi: '你好！', pinyin: 'Nǐ hǎo!', vi: 'Xin chào!' },
    ],
    ...overrides,
  };
}

describe('validateTopicContentBlocks', () => {
  it('accepts a valid grammar_point in a grammar topic', () => {
    expect(validateTopicContentBlocks('grammar', [grammarPoint()])).toEqual([]);
  });

  it('accepts a valid dialogue in a key_text topic', () => {
    expect(validateTopicContentBlocks('key_text', [dialogue()])).toEqual([]);
  });

  it('accepts highlight null and highlight absent', () => {
    const example = {
      hanzi: '我是学生。',
      pinyin: 'Wǒ shì xuésheng.',
      vi: 'Tôi là học sinh.',
    };
    expect(
      validateTopicContentBlocks('grammar', [
        grammarPoint({ examples: [{ ...example, highlight: null }] }),
        grammarPoint({ examples: [example] }),
      ]),
    ).toEqual([]);
  });

  it('rejects a wrong formula role', () => {
    const block = grammarPoint();
    (block.formula[0] as Record<string, unknown>).role = 'noun';
    expect(validateTopicContentBlocks('grammar', [block])).toEqual([
      { code: 'topic_block_field_invalid', path: 'content[0].formula[0].role' },
    ]);
  });

  it('rejects a missing field', () => {
    const block: Record<string, unknown> = grammarPoint();
    delete block.explanation;
    expect(validateTopicContentBlocks('grammar', [block])).toEqual([
      { code: 'topic_block_field_invalid', path: 'content[0].explanation' },
    ]);
  });

  it('rejects unknown keys at block, chip, example and line level', () => {
    const block = grammarPoint({ extra: 1 });
    (block.formula[1] as Record<string, unknown>).color = 'red';
    (block.examples[0] as Record<string, unknown>).audio = 'x.mp3';
    const line = dialogue();
    (line.lines[1] as Record<string, unknown>).mood = 'happy';
    expect(validateTopicContentBlocks('grammar', [block])).toEqual([
      { code: 'topic_block_unknown_field', path: 'content[0].extra' },
      {
        code: 'topic_block_unknown_field',
        path: 'content[0].formula[1].color',
      },
      {
        code: 'topic_block_unknown_field',
        path: 'content[0].examples[0].audio',
      },
    ]);
    expect(validateTopicContentBlocks('key_text', [line])).toEqual([
      { code: 'topic_block_unknown_field', path: 'content[0].lines[1].mood' },
    ]);
  });

  it('rejects too many formula chips and empty arrays', () => {
    const chips = Array.from({ length: 13 }, () => ({
      role: 'other',
      zh: '的',
      vi: 'của',
    }));
    expect(
      validateTopicContentBlocks('grammar', [
        grammarPoint({ formula: chips }),
        grammarPoint({ examples: [] }),
      ]),
    ).toEqual([
      { code: 'topic_block_array_size', path: 'content[0].formula' },
      { code: 'topic_block_array_size', path: 'content[1].examples' },
    ]);
    expect(
      validateTopicContentBlocks('key_text', [dialogue({ lines: [] })]),
    ).toEqual([{ code: 'topic_block_array_size', path: 'content[0].lines' }]);
  });

  it('rejects a title empty after trim and a string over max length', () => {
    expect(
      validateTopicContentBlocks('grammar', [
        grammarPoint({ title: '   ' }),
        grammarPoint({ explanation: 'x'.repeat(601) }),
      ]),
    ).toEqual([
      { code: 'topic_block_field_invalid', path: 'content[0].title' },
      { code: 'topic_block_field_invalid', path: 'content[1].explanation' },
    ]);
  });

  it('rejects a non-string dialogue field', () => {
    const block = dialogue();
    (block.lines[0] as Record<string, unknown>).speaker = 42;
    expect(validateTopicContentBlocks('key_text', [block])).toEqual([
      {
        code: 'topic_block_field_invalid',
        path: 'content[0].lines[0].speaker',
      },
    ]);
  });

  it('rejects a highlight that is not in hanzi', () => {
    const example = {
      hanzi: '我是学生。',
      pinyin: 'Wǒ shì xuésheng.',
      vi: 'Tôi là học sinh.',
    };
    expect(
      validateTopicContentBlocks('grammar', [
        grammarPoint({ examples: [example, { ...example, highlight: '很' }] }),
      ]),
    ).toEqual([
      {
        code: 'topic_block_highlight_not_in_hanzi',
        path: 'content[0].examples[1].highlight',
      },
    ]);
    expect(
      validateTopicContentBlocks('grammar', [
        grammarPoint({ examples: [{ ...example, highlight: '' }] }),
      ]),
    ).toEqual([
      {
        code: 'topic_block_field_invalid',
        path: 'content[0].examples[0].highlight',
      },
    ]);
  });

  it('rejects grammar_point outside grammar topics and dialogue outside key_text', () => {
    expect(
      validateTopicContentBlocks('vocabulary', [
        { type: 'text', value: 'x' },
        grammarPoint(),
      ]),
    ).toEqual([{ code: 'topic_block_type_mismatch', path: 'content[1].type' }]);
    expect(validateTopicContentBlocks('grammar', [dialogue()])).toEqual([
      { code: 'topic_block_type_mismatch', path: 'content[0].type' },
    ]);
  });

  it('leaves text, vocabulary_list, legacy and unknown blocks untouched', () => {
    expect(
      validateTopicContentBlocks('grammar', [
        { type: 'text', value: 'x', anything: true },
        { type: 'vocabulary_list', value: 1 },
        { type: 'image', url: 'a.png' },
        { type: 'mystery' },
        { type: 'constructor' },
        'not-an-object',
      ]),
    ).toEqual([]);
  });

  it('returns no issues when content is not an array', () => {
    expect(validateTopicContentBlocks('grammar', { blocks: [] })).toEqual([]);
    expect(validateTopicContentBlocks('grammar', null)).toEqual([]);
  });

  it('exposes a stable code list', () => {
    expect(TOPIC_CONTENT_ISSUE_CODES).toEqual([
      'topic_block_type_mismatch',
      'topic_block_unknown_field',
      'topic_block_field_invalid',
      'topic_block_array_size',
      'topic_block_highlight_not_in_hanzi',
    ]);
  });
});
