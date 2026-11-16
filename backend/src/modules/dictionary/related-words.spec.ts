import { rankRelatedWords, RELATED_WORDS_LIMIT } from './related-words';

const target = { id: 1, hanzi: '学习', levelOrder: 2 };
const word = (id: number, hanzi: string, levelOrder: number | null) => ({
  id,
  hanzi,
  levelOrder,
});

describe('rankRelatedWords (M3.4b, Q307)', () => {
  it('never returns the word itself', () => {
    expect(
      rankRelatedWords(target, [word(1, '学习', 2), word(2, '学生', 1)]),
    ).toEqual([2]);
  });

  it('drops candidates that share no character', () => {
    expect(rankRelatedWords(target, [word(2, '你好', 2)])).toEqual([]);
  });

  it('orders by shared characters, then level distance, then length', () => {
    const ranked = rankRelatedWords(target, [
      word(10, '学', 2), // 1 shared, distance 0, length 1
      word(11, '学习班', 5), // 2 shared, distance 3
      word(12, '复习', 2), // 1 shared, distance 0, length 2
      word(13, '学期', 4), // 1 shared, distance 2
      word(14, '习学', 2), // 2 shared, distance 0
      word(15, '学校', null), // 1 shared, no public level: last
    ]);
    expect(ranked).toEqual([14, 11, 10, 12]);
  });

  it('breaks full ties by id', () => {
    expect(
      rankRelatedWords(target, [word(21, '学生', 2), word(20, '学校', 2)]),
    ).toEqual([20, 21]);
  });

  it(`returns at most ${RELATED_WORDS_LIMIT} words`, () => {
    const many = Array.from({ length: 9 }, (_, i) => word(100 + i, '学生', 2));
    expect(rankRelatedWords(target, many)).toHaveLength(4);
    expect(RELATED_WORDS_LIMIT).toBe(4);
  });
});
