import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXAM_LIST_SORT,
  EXAM_LIST_FACET_LIMIT,
  EXAM_LIST_PAGE_LIMIT,
  examListHref,
  parseExamListQuery,
  serializeExamListQuery,
} from './exam-list-query';

describe('exam list query (M4.5 B1)', () => {
  it('reads the filters, the sort and the page', () => {
    expect(
      parseExamListQuery({
        levelCode: 'HSK7_9',
        skill: 'reading',
        sort: 'score',
        page: '3',
      }),
    ).toEqual({
      levelCode: 'HSK7_9',
      skill: 'reading',
      sort: 'score',
      page: 3,
    });
  });

  it('defaults to no filters, newest and page 1', () => {
    expect(parseExamListQuery({})).toEqual({
      levelCode: null,
      skill: null,
      sort: DEFAULT_EXAM_LIST_SORT,
      page: 1,
    });
    expect(DEFAULT_EXAM_LIST_SORT).toBe('newest');
    expect(EXAM_LIST_PAGE_LIMIT).toBe(20);
    expect(EXAM_LIST_FACET_LIMIT).toBe(100);
  });

  it.each([['abc'], ['HSK'], ['HSK0x'], ['HSK-1'], ['']])(
    'ignores the malformed level code %s',
    (levelCode) => {
      expect(parseExamListQuery({ levelCode }).levelCode).toBeNull();
    },
  );

  it('ignores an unknown skill, an unknown sort and a malformed page', () => {
    expect(
      parseExamListQuery({ skill: 'speaking2', sort: 'popular', page: '0' }),
    ).toEqual({ levelCode: null, skill: null, sort: 'newest', page: 1 });
    expect(parseExamListQuery({ page: '1e3', sort: 'oldest' }).page).toBe(1);
  });

  it('builds shareable links and skips the defaults', () => {
    const state = parseExamListQuery({
      levelCode: 'HSK3',
      skill: 'listening',
      sort: 'oldest',
    });
    expect(examListHref(state)).toBe(
      '/learn/exam?levelCode=HSK3&skill=listening&sort=oldest',
    );
    expect(examListHref(state, { sort: 'newest' })).toBe(
      '/learn/exam?levelCode=HSK3&skill=listening',
    );
    expect(examListHref(state, { skill: null, page: 1 })).toBe(
      '/learn/exam?levelCode=HSK3&sort=oldest',
    );
  });

  it('resets to page 1 when a filter or the sort changes', () => {
    const state = parseExamListQuery({
      levelCode: 'HSK3',
      skill: 'reading',
      page: '4',
    });
    expect(examListHref(state, { skill: 'writing' })).toBe(
      '/learn/exam?levelCode=HSK3&skill=writing',
    );
    expect(examListHref(state, { sort: 'score' })).toBe(
      '/learn/exam?levelCode=HSK3&skill=reading&sort=score',
    );
    expect(examListHref(state, { page: 4 })).toBe(
      '/learn/exam?levelCode=HSK3&skill=reading&page=4',
    );
  });

  it('serializes no level code when there is none', () => {
    const params = serializeExamListQuery({
      levelCode: null,
      skill: null,
      sort: 'newest',
      page: 1,
    });
    expect(params.toString()).toBe('');
    expect(
      examListHref({
        levelCode: null,
        skill: null,
        sort: 'newest',
        page: 1,
      }),
    ).toBe('/learn/exam');
  });
});
