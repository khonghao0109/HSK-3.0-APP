import { describe, expect, it } from 'vitest';

import {
  parseQuestionQuery,
  questionBankItems,
  serializeQuestionQuery,
  withQuestionPage,
  withQuestionSelected,
} from './question-query';

const counts = {
  total: 42,
  bySkill: { listening: 5, reading: 20, writing: 4, speaking: 3 },
  vocabularyGrammar: 10,
};

describe('question URL query contract (TL-89)', () => {
  it('parses allowlisted filters and clamps invalid values', () => {
    expect(
      parseQuestionQuery({
        page: '3',
        limit: '20',
        levelId: '2',
        skill: 'reading',
        type: 'true_false',
        difficulty: '2',
        status: 'published',
        tag: ['tu-vung'],
        q: '  你好  ',
        selected: '9',
        ignored: 'x',
      }),
    ).toEqual({
      page: 3,
      limit: 20,
      levelId: 2,
      skill: 'reading',
      type: 'true_false',
      difficulty: 2,
      status: 'published',
      tag: ['tu-vung'],
      q: '你好',
      selected: 9,
    });
    expect(
      parseQuestionQuery({
        page: '0',
        limit: '999',
        skill: 'grammar',
        type: 'essay',
        status: 'deleted',
        difficulty: '4',
        selected: '9999999999',
      }),
    ).toEqual({ page: 1, limit: 20 });
  });

  it('serializes only non-empty filters and keeps selected out of the API query', () => {
    expect(
      serializeQuestionQuery({
        page: 2,
        limit: 50,
        skill: 'listening',
      }).toString(),
    ).toBe('page=2&limit=50&skill=listening');
    expect(
      serializeQuestionQuery({ page: 1, limit: 20, selected: 7 }).toString(),
    ).toBe('page=1&limit=20&selected=7');
  });

  it('builds pagination links and row-selection links that keep filters', () => {
    const query = parseQuestionQuery({
      skill: 'reading',
      levelId: '3',
      page: '2',
    });
    expect(withQuestionPage(query, 3)).toBe(
      '?page=3&limit=20&levelId=3&skill=reading',
    );
    expect(withQuestionSelected(query, 11)).toBe(
      '?page=2&limit=20&levelId=3&skill=reading&selected=11',
    );
  });

  it('builds the six bank items with counts, hrefs and active state (Q113)', () => {
    const items = questionBankItems(
      counts,
      parseQuestionQuery({ tag: 'tu-vung' }),
    );
    expect(
      items.find((item) => item.key === 'vocabularyGrammar'),
    ).toMatchObject({
      href: '/admin/questions?page=1&limit=20&tag=tu-vung&tag=ngu-phap',
      active: false,
    });
    const vocabItems = questionBankItems(
      counts,
      parseQuestionQuery({ tag: ['tu-vung', 'ngu-phap'] }),
    );
    expect(items.map((item) => [item.label, item.count])).toEqual([
      ['Tất cả câu hỏi', 42],
      ['Nghe hiểu', 5],
      ['Đọc hiểu', 20],
      ['Từ vựng & Ngữ pháp', 10],
      ['Viết', 4],
      ['Nói', 3],
    ]);
    expect(
      vocabItems.find((item) => item.key === 'vocabularyGrammar'),
    ).toMatchObject({
      href: '/admin/questions?page=1&limit=20&tag=tu-vung&tag=ngu-phap',
      active: true,
    });
    expect(items[0]).toMatchObject({
      href: '/admin/questions?page=1&limit=20',
      active: false,
    });
  });
});
