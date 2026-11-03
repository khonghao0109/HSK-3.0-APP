import { describe, expect, it } from 'vitest';

import {
  conflictCodesFor,
  EXAM_409_BEHAVIOUR,
  pageActionFor,
} from './exam-409-matrix';

describe('exam 409 matrix (TL-188)', () => {
  it('keeps the documented BFF forwarding sets', () => {
    expect([...conflictCodesFor('answer')].sort()).toEqual([
      'EXAM_ANSWER_VERSION_CONFLICT',
      'EXAM_ATTEMPT_CLOSED',
      'EXAM_ATTEMPT_EXPIRED',
      'EXAM_IDEMPOTENCY_KEY_REUSED',
    ]);
    expect([...conflictCodesFor('submit')].sort()).toEqual([
      'EXAM_ATTEMPT_ALREADY_SUBMITTED',
      'EXAM_ATTEMPT_CLOSED',
      'EXAM_ATTEMPT_EXPIRED',
      'EXAM_IDEMPOTENCY_KEY_REUSED',
    ]);
    expect([...conflictCodesFor('grant')].sort()).toEqual([
      'EXAM_ATTEMPT_CLOSED',
      'EXAM_ATTEMPT_EXPIRED',
    ]);
    expect([...conflictCodesFor('result')].sort()).toEqual([
      'EXAM_ATTEMPT_CLOSED',
      'EXAM_ATTEMPT_NOT_TERMINAL',
      'EXAM_RESULT_UNAVAILABLE',
    ]);
    expect([...conflictCodesFor('review')]).toEqual([]);
  });

  it('maps the page actions and defaults unknown codes to retry', () => {
    expect(pageActionFor('review', 'EXAM_ATTEMPT_NOT_TERMINAL')).toBe('take');
    expect(pageActionFor('result', 'EXAM_ATTEMPT_NOT_TERMINAL')).toBe('take');
    expect(pageActionFor('review', 'EXAM_ATTEMPT_CLOSED')).toBe('closed');
    expect(pageActionFor('result', 'EXAM_ATTEMPT_CLOSED')).toBe('closed');
    expect(pageActionFor('result', 'EXAM_RESULT_UNAVAILABLE')).toBe('retry');
    expect(pageActionFor('review', 'EXAM_RESULT_UNAVAILABLE')).toBe('retry');
    expect(pageActionFor('review', 'SOMETHING_NEW')).toBeNull();
    expect(pageActionFor('review', null)).toBeNull();
  });

  it('describes every route in the matrix at most once per code', () => {
    for (const behaviour of Object.values(EXAM_409_BEHAVIOUR)) {
      const unique = new Set(behaviour.forward);
      expect(unique.size).toBe(behaviour.forward.length);
    }
  });
});
