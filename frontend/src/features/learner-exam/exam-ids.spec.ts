import { describe, expect, it } from 'vitest';

import { parseAttemptId } from './exam-ids';

describe('parseAttemptId (TL-187)', () => {
  it('accepts positive int4 ids', () => {
    expect(parseAttemptId('1')).toBe(1);
    expect(parseAttemptId('2147483647')).toBe(2147483647);
  });

  it('rejects everything else', () => {
    for (const raw of [
      '',
      '0',
      '00',
      '01',
      '-1',
      '1.5',
      '1e3',
      'abc',
      '1x',
      ' 1',
      '2147483648',
    ]) {
      expect(parseAttemptId(raw), raw).toBeNull();
    }
  });
});
