import { resolve } from 'node:path';

import {
  buildLevelLexicon,
  checkJsonLevel,
  checkTextLevel,
  loadLevelLexicon,
  parseHskLevel,
  segmentForLevel,
} from './level-vocabulary';

const lexicon = buildLevelLexicon({
  HSK1: [
    '我',
    '你',
    '是',
    '学生',
    '怎么',
    '没关系',
    '这边',
    '一点儿',
    '点',
    '吃',
    '想',
    '什么',
  ],
  HSK2: ['怎么样', '边', '漂亮'],
  HSK3: ['关系'],
  HSK6: ['样'],
});

describe('level vocabulary (Q356)', () => {
  it('parses level names', () => {
    expect(parseHskLevel('hsk2')).toBe('HSK2');
    expect(parseHskLevel('3')).toBe('HSK3');
    expect(parseHskLevel('HSK7_9')).toBe('HSK7-9');
    expect(parseHskLevel('HSK10')).toBeNull();
  });

  it('keeps the lowest level of a word listed twice', () => {
    const twice = buildLevelLexicon({ HSK1: ['一会儿'], HSK2: ['一会儿'] });
    expect(twice.levelOf.get('一会儿')).toBe('HSK1');
  });

  it('accepts text made of words at or below the target level', () => {
    expect(checkTextLevel('我是学生。', 'HSK1', lexicon)).toEqual([]);
    expect(checkTextLevel('你怎么样？', 'HSK2', lexicon)).toEqual([]);
  });

  it('reports the whole word used above the level, not a stray character', () => {
    const issues = checkTextLevel('你怎么样？', 'HSK1', lexicon, '$.q');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'above_level',
      path: '$.q',
      word: '怎么样',
      level: 'HSK2',
    });
  });

  it('groups consecutive out-of-level characters and flags unknown ones', () => {
    expect(segmentForLevel('我漂亮', 'HSK1', lexicon)).toEqual([
      { text: '我', level: 'HSK1', allowed: true },
      { text: '漂亮', level: 'HSK2', allowed: false },
    ]);
    const [issue] = checkTextLevel('我龘', 'HSK1', lexicon);
    expect(issue).toMatchObject({ word: '龘', level: null });
  });

  it('allows fragments next to a blank or hyphen and quoted parts of a word', () => {
    expect(checkTextLevel('B: ___关系。', 'HSK1', lexicon)).toEqual([]);
    expect(checkTextLevel('Từ phương vị -边', 'HSK1', lexicon)).toEqual([]);
    expect(
      checkTextLevel('没关系: chỗ trống đứng trước 关系', 'HSK1', lexicon),
    ).toEqual([]);
    // Không có dấu chỗ trống, không có từ chứa nó: vẫn là từ HSK3.
    expect(checkTextLevel('关系', 'HSK1', lexicon)[0]?.level).toBe('HSK3');
  });

  it('allows erhua after a valid word', () => {
    expect(checkTextLevel('你想吃点儿什么？', 'HSK1', lexicon)).toEqual([]);
  });

  it('walks JSON, honours properNames and skips metadata keys', () => {
    const issues = checkJsonLevel(
      {
        properNames: [{ hanzi: '小明' }],
        dataSource: { name: '国际中文教育中文水平等级标准' },
        notes: ['漂亮'],
        items: [{ hanzi: '小明是学生' }, { hanzi: '我漂亮' }],
      },
      'HSK1',
      lexicon,
    );
    expect(issues.map((i) => `${i.path} ${i.word}`)).toEqual([
      '$.items[1].hanzi 漂亮',
    ]);
    expect(
      checkJsonLevel({ a: '我漂亮' }, 'HSK1', lexicon, { allowed: ['漂亮'] }),
    ).toEqual([]);
  });

  it('loads the GF0025 lists cumulatively', () => {
    const real = loadLevelLexicon(resolve(__dirname, '../../..'));
    expect(real.levelOf.get('爱')).toBe('HSK1');
    expect(real.levelOf.get('怎么样')).toBe('HSK2');
    expect(checkTextLevel('你身体怎么样？', 'HSK2', real)).toEqual([]);
    expect(checkTextLevel('你身体怎么样？', 'HSK1', real)[0]?.word).toBe(
      '怎么样',
    );
  });
});
