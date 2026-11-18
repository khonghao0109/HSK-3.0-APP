import { describe, expect, it } from 'vitest';

import { reviewCardView } from '@/features/learner-review/review-model';

import { allVietnamese, firstVietnamese } from './dictionary-display';

/**
 * P2 (PO 17/11/2026): a reviewed Vietnamese meaning is a new `WordMeaning`
 * row after the CC-CEDICT rows. Search rows, the word page and the review
 * card must show it, not the English rows that come first.
 */
const meanings = [
  { order: 1, vi: null, en: 'student' },
  { order: 2, vi: null, en: 'schoolchild' },
  { order: 3, vi: 'học sinh, sinh viên', en: null },
];

describe('Vietnamese batch meaning after CC-CEDICT rows', () => {
  it('search row and word page show the Vietnamese meaning', () => {
    expect(firstVietnamese(meanings)).toBe('học sinh, sinh viên');
    expect(allVietnamese(meanings)).toBe('học sinh, sinh viên');
  });

  it('review card shows Vietnamese, English only when no Vietnamese exists', () => {
    const word = {
      id: 1,
      hanzi: '学生',
      pinyin: 'xue sheng',
      pinyinTone: 'xue2 sheng1',
      example: null,
      meanings,
    };
    expect(reviewCardView(word).meaning).toBe('học sinh, sinh viên');
    expect(
      reviewCardView({ ...word, meanings: meanings.slice(0, 2) }).meaning,
    ).toBe('student; schoolchild');
  });
});
